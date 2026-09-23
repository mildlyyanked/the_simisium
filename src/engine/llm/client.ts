/**
 * OpenRouter chat-completions client: structured output negotiation, retries with backoff,
 * timeouts, usage/cost accounting, a per-session budget guard, an LRU cache for deterministic
 * tasks, and request/response logging hooks (the API key is never logged).
 */
import type { LLMTask, LLMUsage } from '../core/llmTypes';
import { estimateCost, modelFor, TASK_PARAMS, type ModelPreset } from './router';
import { extractJson, firstBalancedObject } from './schemas';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequestInfo {
  task: LLMTask;
  model: string;
  attempt: number;
  responseFormat: 'json_schema' | 'json_object' | 'none';
  messageCount: number;
  promptChars: number;
  cached: boolean;
  /** the reply was streamed token by token */
  streamed?: boolean;
}

export interface LLMResponseInfo extends LLMRequestInfo {
  ok: boolean;
  status?: number;
  ms: number;
  usage?: LLMUsage;
  error?: string;
  /** model actually served (OpenRouter may route to a fallback) */
  servedModel?: string;
}

export interface LLMConfig {
  apiKey?: string;
  /** default https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** per-task overrides (win over preset) */
  models?: Partial<Record<LLMTask, string>>;
  preset?: ModelPreset;
  /** OpenRouter routing array: models to try if the primary fails */
  fallbacks?: string[];
  /** image-capable model for portraits (default google/gemini-2.5-flash-image) */
  imageModel?: string;
  /** per-request timeout (idle timeout while streaming); default 30 s for conversation turns, 45 s otherwise */
  timeoutMs?: number;
  /** retries on 429/5xx/network, default 3 (capped at 1 for conversation turns, which fall back instead of waiting) */
  maxRetries?: number;
  /** base backoff in ms (doubles each retry), default 500; set 0 in tests */
  retryBaseMs?: number;
  /** refuse calls once the session's estimated spend reaches this (USD) */
  budgetUsd?: number;
  /** LRU entries for cached tasks, default 200 */
  cacheSize?: number;
  /** attribution headers */
  referer?: string;
  title?: string;
  onRequest?: (info: LLMRequestInfo) => void;
  onResponse?: (info: LLMResponseInfo) => void;
}

export interface CompleteOptions {
  /** ask for structured output; the client negotiates json_schema → json_object → plain JSON */
  schema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxTokens?: number;
  /** override routing */
  model?: string;
  /** use the LRU cache (deterministic tasks only) */
  cache?: boolean;
  signal?: AbortSignal;
  /** receive the text so far as it streams in (turns on SSE streaming for this call) */
  onDelta?: (textSoFar: string) => void;
}

export interface CompleteResult {
  text: string;
  /** parsed JSON when a schema was requested (or the text happened to be JSON) */
  json?: unknown;
  usage: LLMUsage;
  servedModel: string;
  finishReason?: string;
}

export class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly budgetUsd: number) {
    super(`LLM budget exceeded: spent $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

export class LLMHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: string) {
    super(message);
    this.name = 'LLMHttpError';
  }
}

export interface OpenRouterModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
  pricing?: { prompt?: number; completion?: number; image?: number };
  supportedParameters?: string[];
  outputModalities?: string[];
}

type ResponseFormat = { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } } | { type: 'json_object' } | undefined;

interface OpenRouterCompletion {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | { type: string; text?: string }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
/** Tasks the player waits on: they get a short leash and a fast lane. */
const INTERACTIVE: ReadonlySet<LLMTask> = new Set<LLMTask>(['dialogue', 'adjudicate', 'narrate']);
export const INTERACTIVE_TIMEOUT_MS = 30_000;
export const BACKGROUND_TIMEOUT_MS = 45_000;

/**
 * Reasoning models spend seconds thinking before the first word; for a conversation turn that is wasted
 * time. Interactive tasks ask for no reasoning where it can be switched off, and the minimum where it
 * cannot. Background tasks (bios, dilemmas) keep the model's default.
 */
export function reasoningFor(model: string, task: LLMTask): Record<string, unknown> | undefined {
  if (!INTERACTIVE.has(task)) return undefined;
  const m = model.toLowerCase();
  if (m.includes(':thinking') || m.includes('reasoning') || m.includes('deepseek-r1')) return undefined;
  if (/openai\/(gpt-5|o[1-9])/.test(m)) return { effort: 'minimal' };
  if (/gemini-2\.5-pro|gemini-3/.test(m)) return { effort: 'low' };
  return { enabled: false };
}
const JSON_ONLY_HINT = '\n\nReturn ONLY a single JSON object matching the requested shape. No prose, no markdown fences.';

/** Small non-cryptographic 64-bit-ish hash (two FNV-1a lanes) for cache keys. */
export function hashKey(s: string): string {
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c;
    a = Math.imul(a, 16777619);
    b ^= c;
    b = Math.imul(b, 0x01000193) + 0x9e3779b9;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

class LRU<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.map.delete(first);
    }
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

export class OpenRouterClient {
  readonly config: LLMConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: LRU<CompleteResult>;
  private spent = 0;
  private calls = 0;
  private sleepImpl: (ms: number) => Promise<void>;
  /** which response format a model accepted, so negotiation is paid for once per session, not per turn */
  private formatMemo = new Map<string, number>();
  /** models that rejected the reasoning parameter */
  private noReasoning = new Set<string>();

  constructor(config: LLMConfig, deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}) {
    this.config = config;
    const f = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) throw new Error('No fetch implementation available');
    this.fetchImpl = f;
    this.cache = new LRU(config.cacheSize ?? 200);
    this.sleepImpl = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get hasKey(): boolean {
    return !!this.config.apiKey && this.config.apiKey.trim().length > 0;
  }
  get spentUsd(): number {
    return this.spent;
  }
  get callCount(): number {
    return this.calls;
  }
  get cacheSize(): number {
    return this.cache.size;
  }
  resetBudget(): void {
    this.spent = 0;
  }
  clearCache(): void {
    this.cache.clear();
  }

  modelFor(task: LLMTask): string {
    return modelFor(task, this.config);
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey ?? ''}`,
      'HTTP-Referer': this.config.referer ?? 'https://simisium.app',
      'X-Title': this.config.title ?? 'The Simisium',
    };
  }

  private assertBudget(): void {
    const b = this.config.budgetUsd;
    if (b !== undefined && b >= 0 && this.spent >= b) throw new BudgetExceededError(this.spent, b);
  }

  /**
   * One chat completion for a task. With `schema`, negotiates structured output:
   * json_schema (strict) → json_object → plain prompt with "Return ONLY JSON"; parsing is tolerant.
   */
  async complete(task: LLMTask, messages: ChatMessage[], opts: CompleteOptions = {}): Promise<CompleteResult> {
    if (!this.hasKey) throw new Error('OpenRouter API key not configured');
    const model = opts.model ?? this.modelFor(task);
    const params = TASK_PARAMS[task];
    const temperature = opts.temperature ?? params.temperature;
    const maxTokens = opts.maxTokens ?? params.maxTokens;
    const key = opts.cache ? hashKey(`${model}|${temperature}|${opts.schema?.name ?? ''}|${JSON.stringify(messages)}`) : undefined;
    if (key) {
      const hit = this.cache.get(key);
      if (hit) {
        const usage: LLMUsage = { ...hit.usage, cached: true, ms: 0, costUsd: 0 };
        this.config.onRequest?.({ task, model, attempt: 0, responseFormat: opts.schema ? 'json_schema' : 'none', messageCount: messages.length, promptChars: promptChars(messages), cached: true });
        this.config.onResponse?.({ task, model, attempt: 0, responseFormat: opts.schema ? 'json_schema' : 'none', messageCount: messages.length, promptChars: promptChars(messages), cached: true, ok: true, ms: 0, usage, servedModel: hit.servedModel });
        return { ...hit, usage };
      }
    }
    this.assertBudget();

    const formats: ResponseFormat[] = opts.schema
      ? [{ type: 'json_schema', json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } }, { type: 'json_object' }, undefined]
      : [undefined];

    let lastErr: unknown;
    let fi = Math.min(this.formatMemo.get(model) ?? 0, formats.length - 1);
    while (fi < formats.length) {
      const fmt = formats[fi];
      const msgs = opts.schema && fmt === undefined ? withJsonHint(messages) : messages;
      const reasoning = this.noReasoning.has(model) ? undefined : reasoningFor(model, task);
      opts.onDelta?.('');
      try {
        const res = await this.request(task, model, msgs, fmt, temperature, maxTokens, { signal: opts.signal, onDelta: opts.onDelta, reasoning });
        if (opts.schema) {
          const json = extractJson(res.text);
          if (json === undefined) {
            // structured output requested but nothing parseable came back: try the next format, once
            lastErr = new Error(`Model returned non-JSON for ${task} (${res.finishReason ?? 'no finish reason'}, ${res.text.length} chars${res.text ? `: "${snippet(res.text).slice(0, 100)}"` : ''})`);
            if (fi < formats.length - 1) {
              fi++;
              continue;
            }
            throw lastErr;
          }
          res.json = json;
        } else {
          const maybe = res.text.trim().startsWith('{') ? extractJson(res.text) : undefined;
          if (maybe !== undefined) res.json = maybe;
        }
        this.formatMemo.set(model, fi);
        if (key) this.cache.set(key, res);
        return res;
      } catch (err) {
        lastErr = err;
        // A 400/404/422 means the provider rejected the request shape: the reasoning switch or the response_format.
        if (err instanceof LLMHttpError && (err.status === 400 || err.status === 404 || err.status === 422)) {
          const aboutFormat = /response_format|json_schema|structured|schema/i.test(err.body ?? err.message);
          if (reasoning && !aboutFormat) {
            this.noReasoning.add(model);
            continue; // same format, without the reasoning parameter
          }
          if (fi < formats.length - 1) {
            fi++;
            continue;
          }
          if (reasoning) {
            this.noReasoning.add(model);
            continue;
          }
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  timeoutFor(task: LLMTask): number {
    return this.config.timeoutMs ?? (INTERACTIVE.has(task) ? INTERACTIVE_TIMEOUT_MS : BACKGROUND_TIMEOUT_MS);
  }

  retriesFor(task: LLMTask): number {
    const cfg = this.config.maxRetries ?? 3;
    return INTERACTIVE.has(task) ? Math.min(cfg, 1) : cfg;
  }

  /** Single request with retries on 429/5xx/network/timeout. Streams when `onDelta` is given. */
  private async request(task: LLMTask, model: string, messages: ChatMessage[], fmt: ResponseFormat, temperature: number, maxTokens: number, extra: { signal?: AbortSignal; onDelta?: (t: string) => void; reasoning?: Record<string, unknown> } = {}): Promise<CompleteResult> {
    const maxRetries = this.retriesFor(task);
    const timeoutMs = this.timeoutFor(task);
    const base = this.config.retryBaseMs ?? 500;
    const interactive = INTERACTIVE.has(task);
    const streamed = !!extra.onDelta;
    const outerSignal = extra.signal;
    const fmtLabel: LLMRequestInfo['responseFormat'] = fmt ? fmt.type : 'none';
    const body: Record<string, unknown> = { model, messages, temperature, max_tokens: maxTokens, usage: { include: true } };
    if (this.config.fallbacks?.length) body.models = [model, ...this.config.fallbacks.filter((m) => m !== model)];
    const provider: Record<string, unknown> = {};
    if (fmt) {
      body.response_format = fmt;
      provider.require_parameters = true;
    }
    // the player is waiting: route to the provider answering fastest right now
    if (interactive) provider.sort = 'latency';
    if (Object.keys(provider).length) body.provider = provider;
    if (extra.reasoning) body.reasoning = extra.reasoning;
    if (streamed) body.stream = true;
    const info: LLMRequestInfo = { task, model, attempt: 0, responseFormat: fmtLabel, messageCount: messages.length, promptChars: promptChars(messages), cached: false, streamed };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      info.attempt = attempt;
      this.config.onRequest?.({ ...info });
      const started = nowMs();
      const ctrl = new AbortController();
      // idle timeout: while a reply streams, every chunk buys more time; a hard cap keeps a runaway stream bounded
      let timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const hardCap = setTimeout(() => ctrl.abort(), timeoutMs * 4);
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(), timeoutMs);
      };
      const onOuterAbort = () => ctrl.abort();
      outerSignal?.addEventListener('abort', onOuterAbort);
      let status = 0;
      try {
        const resp = await this.fetchImpl(`${this.config.baseUrl ?? DEFAULT_BASE}/chat/completions`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        status = resp.status;
        if (!resp.ok) {
          const raw = await resp.text();
          const err = new LLMHttpError(status, `OpenRouter ${status}: ${snippet(raw)}`, raw);
          if (retryable(status) && attempt < maxRetries) {
            lastErr = err;
            this.config.onResponse?.({ ...info, ok: false, status, ms: nowMs() - started, error: err.message });
            await this.backoff(base, attempt, resp.headers?.get?.('retry-after'));
            continue;
          }
          this.config.onResponse?.({ ...info, ok: false, status, ms: nowMs() - started, error: err.message });
          throw err;
        }
        let data: OpenRouterCompletion;
        let raw = '';
        if (streamed) {
          const acc = await readSse(resp, touch, extra.onDelta);
          raw = acc.raw;
          data = acc.error
            ? { error: acc.error }
            : acc.text || acc.finishReason || acc.usage
              ? { model: acc.model, choices: [{ message: { content: acc.text }, finish_reason: acc.finishReason }], usage: acc.usage }
              : (salvageEnvelope(raw) ?? { choices: [] });
        } else {
          raw = await resp.text();
          try {
            data = JSON.parse(raw) as OpenRouterCompletion;
          } catch {
            // keep-alive comment lines, a stray prefix, or a truncated body: salvage the first object, else retry
            const salvaged = salvageEnvelope(raw);
            if (salvaged) data = salvaged;
            else {
              const err = new LLMHttpError(status, `OpenRouter returned invalid JSON envelope (${raw.length} chars: ${snippet(raw).slice(0, 80) || 'empty body'})`, raw);
              if (attempt < maxRetries) {
                lastErr = err;
                this.config.onResponse?.({ ...info, ok: false, status, ms: nowMs() - started, error: err.message });
                await this.backoff(base, attempt);
                continue;
              }
              throw err;
            }
          }
        }
        if (data.error) {
          // OpenRouter sometimes reports provider errors inside a 200 envelope
          const code = data.error.code ?? 500;
          const err = new LLMHttpError(code, `OpenRouter error: ${data.error.message ?? 'unknown'}`, raw);
          if (retryable(code) && attempt < maxRetries) {
            lastErr = err;
            this.config.onResponse?.({ ...info, ok: false, status: code, ms: nowMs() - started, error: err.message });
            await this.backoff(base, attempt);
            continue;
          }
          throw err;
        }
        const text = contentText(data);
        const served = data.model ?? model;
        const tokensIn = data.usage?.prompt_tokens ?? 0;
        const tokensOut = data.usage?.completion_tokens ?? 0;
        const cost = typeof data.usage?.cost === 'number' && Number.isFinite(data.usage.cost) ? data.usage.cost : estimateCost(served, tokensIn, tokensOut);
        const ms = nowMs() - started;
        const usage: LLMUsage = { task, model: served, tokensIn, tokensOut, costUsd: round6(cost), ms, cached: false };
        this.spent = round6(this.spent + usage.costUsd);
        this.calls += 1;
        this.config.onResponse?.({ ...info, ok: true, status, ms, usage, servedModel: served });
        return { text, usage, servedModel: served, finishReason: data.choices?.[0]?.finish_reason };
      } catch (err) {
        if (err instanceof LLMHttpError) throw err;
        // network / abort
        const aborted = (err as Error)?.name === 'AbortError' || ctrl.signal.aborted;
        const e = new Error(aborted ? (outerSignal?.aborted ? 'LLM request cancelled' : `LLM request timed out after ${timeoutMs} ms`) : `LLM network error: ${(err as Error)?.message ?? String(err)}`);
        this.config.onResponse?.({ ...info, ok: false, status: 0, ms: nowMs() - started, error: e.message });
        if (outerSignal?.aborted) throw e;
        lastErr = e;
        if (attempt < maxRetries) {
          await this.backoff(base, attempt);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
        clearTimeout(hardCap);
        outerSignal?.removeEventListener('abort', onOuterAbort);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async backoff(base: number, attempt: number, retryAfter?: string | null): Promise<void> {
    let ms = base * 2 ** attempt;
    const ra = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(ra) && ra > 0) ms = Math.max(ms, Math.min(30_000, ra * 1000));
    if (ms > 0) await this.sleepImpl(ms);
  }

  /**
   * Generate one image with an image-capable chat model (OpenRouter `modalities: ["image","text"]`).
   * Returns a data URL. Not cached, not retried on content errors; network/5xx retries as usual.
   */
  async generateImage(prompt: string, model: string, opts: { signal?: AbortSignal; aspect?: string } = {}): Promise<{ dataUrl: string; usage: LLMUsage; servedModel: string }> {
    if (!this.hasKey) throw new Error('OpenRouter API key not configured');
    this.assertBudget();
    const body = { model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'], usage: { include: true } };
    const started = nowMs();
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), Math.max(this.config.timeoutMs ?? 45_000, 120_000));
    const onOuterAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);
    try {
      const resp = await this.fetchImpl(`${this.config.baseUrl ?? DEFAULT_BASE}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: ctrl.signal });
      const raw = await resp.text();
      if (!resp.ok) throw new LLMHttpError(resp.status, `OpenRouter ${resp.status}: ${snippet(raw)}`, raw);
      let data: OpenRouterCompletion & { choices?: { message?: { images?: { type?: string; image_url?: { url?: string } }[]; content?: unknown } }[] };
      try {
        data = JSON.parse(raw);
      } catch {
        const salvaged = salvageEnvelope(raw);
        if (!salvaged) throw new LLMHttpError(resp.status, 'OpenRouter returned invalid JSON envelope', raw);
        data = salvaged;
      }
      if (data.error) throw new LLMHttpError(data.error.code ?? 500, `OpenRouter error: ${data.error.message ?? 'unknown'}`, raw);
      const msg = data.choices?.[0]?.message;
      let url = msg?.images?.find((i) => i?.image_url?.url)?.image_url?.url;
      if (!url && Array.isArray(msg?.content)) {
        const part = (msg!.content as { type?: string; image_url?: { url?: string } }[]).find((p) => p?.type === 'image_url' && p.image_url?.url);
        url = part?.image_url?.url;
      }
      if (!url) throw new Error(`The model returned no image${typeof msg?.content === 'string' && msg.content ? ` (${snippet(msg.content).slice(0, 120)})` : ''}. Pick a model that outputs images.`);
      const served = data.model ?? model;
      const tokensIn = data.usage?.prompt_tokens ?? 0;
      const tokensOut = data.usage?.completion_tokens ?? 0;
      const cost = typeof data.usage?.cost === 'number' && Number.isFinite(data.usage.cost) ? data.usage.cost : 0.04;
      const usage: LLMUsage = { task: 'narrate', model: served, tokensIn, tokensOut, costUsd: round6(cost), ms: nowMs() - started, cached: false };
      this.spent = round6(this.spent + usage.costUsd);
      this.calls += 1;
      return { dataUrl: url, usage, servedModel: served };
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  /** GET /models — for validating configured model ids at settings time. */
  async listModels(): Promise<OpenRouterModelInfo[]> {
    const resp = await this.fetchImpl(`${this.config.baseUrl ?? DEFAULT_BASE}/models`, { method: 'GET', headers: this.headers() });
    const raw = await resp.text();
    if (!resp.ok) throw new LLMHttpError(resp.status, `OpenRouter ${resp.status}: ${snippet(raw)}`, raw);
    const data = JSON.parse(raw) as { data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string | number; completion?: string | number; image?: string | number }; supported_parameters?: string[]; architecture?: { output_modalities?: string[] } }[] };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      pricing: m.pricing ? { prompt: num(m.pricing.prompt), completion: num(m.pricing.completion), image: num(m.pricing.image) } : undefined,
      supportedParameters: m.supported_parameters,
      outputModalities: m.architecture?.output_modalities,
    }));
  }

  /** Returns the configured model ids (for all tasks + fallbacks) that the catalog does not list. */
  async validateModels(): Promise<{ ok: boolean; missing: string[]; checked: string[] }> {
    const list = await this.listModels();
    const ids = new Set(list.map((m) => m.id));
    const tasks: LLMTask[] = ['dialogue', 'adjudicate', 'bio', 'narrate', 'summarize', 'director'];
    const checked = [...new Set([...tasks.map((t) => this.modelFor(t)), ...(this.config.fallbacks ?? [])])];
    const missing = checked.filter((id) => !ids.has(id) && !ids.has(id.split(':')[0]));
    return { ok: missing.length === 0, missing, checked };
  }
}

// ---------------------------------------------------------------------------
interface SseAccumulator {
  raw: string;
  text: string;
  model?: string;
  finishReason?: string;
  usage?: OpenRouterCompletion['usage'];
  error?: { message?: string; code?: number };
}

/**
 * Read a streamed chat completion (server-sent events). Works on a real byte stream (`body.getReader`)
 * and on a runtime whose fetch buffers the whole body (then the SSE text is parsed in one go).
 */
export async function readSse(resp: Response, onChunk: () => void, onDelta?: (textSoFar: string) => void): Promise<SseAccumulator> {
  const out: SseAccumulator = { raw: '', text: '' };
  let buffer = '';
  const handleLine = (line: string) => {
    const l = line.replace(/\r$/, '');
    if (!l || l.startsWith(':')) return;
    if (!l.startsWith('data:')) return;
    const payload = l.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk: { model?: string; choices?: { delta?: { content?: string | null }; message?: { content?: string }; finish_reason?: string | null }[]; usage?: OpenRouterCompletion['usage']; error?: { message?: string; code?: number } };
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    if (chunk.error) out.error = chunk.error;
    if (chunk.model) out.model = chunk.model;
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content ?? (typeof choice?.message?.content === 'string' ? choice.message.content : undefined);
    if (typeof delta === 'string' && delta) {
      out.text += delta;
      onDelta?.(out.text);
    }
    if (choice?.finish_reason) out.finishReason = choice.finish_reason;
    if (chunk.usage) out.usage = chunk.usage;
  };
  const feed = (piece: string) => {
    out.raw += piece;
    buffer += piece;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  };
  const body = (resp as { body?: { getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null }).body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = utf8Decoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk();
      if (value) feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode());
  } else {
    feed(await resp.text());
  }
  if (buffer) handleLine(buffer);
  return out;
}

/** TextDecoder where the runtime has one; otherwise a small streaming UTF-8 decoder. */
function utf8Decoder(): { decode(input?: Uint8Array, opts?: { stream?: boolean }): string } {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder();
  let pending: number[] = [];
  return {
    decode(input?: Uint8Array, opts?: { stream?: boolean }): string {
      const bytes = [...pending, ...(input ?? [])];
      pending = [];
      let out = '';
      let i = 0;
      while (i < bytes.length) {
        const b = bytes[i];
        const need = b < 0x80 ? 1 : b >> 5 === 0b110 ? 2 : b >> 4 === 0b1110 ? 3 : b >> 3 === 0b11110 ? 4 : 1;
        if (i + need > bytes.length) {
          if (opts?.stream) {
            pending = bytes.slice(i);
            break;
          }
          out += '\ufffd';
          break;
        }
        let cp = need === 1 ? b : need === 2 ? b & 0x1f : need === 3 ? b & 0x0f : b & 0x07;
        for (let k = 1; k < need; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
        out += String.fromCodePoint(cp);
        i += need;
      }
      return out;
    },
  };
}

function promptChars(messages: ChatMessage[]): number {
  return messages.reduce((s, m) => s + m.content.length, 0);
}
function withJsonHint(messages: ChatMessage[]): ChatMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const sys = out.find((m) => m.role === 'system');
  if (sys) sys.content += JSON_ONLY_HINT;
  else out.unshift({ role: 'system', content: JSON_ONLY_HINT.trim() });
  return out;
}
function retryable(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}
/** Parse an envelope that arrived with SSE-style comment lines or junk around it. */
function salvageEnvelope(raw: string): OpenRouterCompletion | undefined {
  const cleaned = raw
    .split('\n')
    .filter((l) => !l.startsWith(':') && !l.startsWith('data: [DONE]'))
    .map((l) => (l.startsWith('data:') ? l.slice(5) : l))
    .join('\n')
    .trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return undefined;
  const obj = firstBalancedObject(cleaned.slice(start));
  if (!obj) return undefined;
  try {
    const parsed = JSON.parse(obj) as OpenRouterCompletion;
    return parsed && typeof parsed === 'object' && (parsed.choices || parsed.error) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function snippet(s: string): string {
  return s.replace(/\s+/g, ' ').slice(0, 200);
}
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function contentText(data: OpenRouterCompletion): string {
  const c = data.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p.text ?? '').join('');
  return '';
}
