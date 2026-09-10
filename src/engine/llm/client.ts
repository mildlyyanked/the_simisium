/**
 * OpenRouter chat-completions client: structured output negotiation, retries with backoff,
 * timeouts, usage/cost accounting, a per-session budget guard, an LRU cache for deterministic
 * tasks, and request/response logging hooks (the API key is never logged).
 */
import type { LLMTask, LLMUsage } from '../core/llmTypes';
import { estimateCost, modelFor, TASK_PARAMS, type ModelPreset } from './router';
import { extractJson } from './schemas';

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
  /** per-request timeout, default 45 000 ms */
  timeoutMs?: number;
  /** retries on 429/5xx/network, default 3 */
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
  pricing?: { prompt?: number; completion?: number };
  supportedParameters?: string[];
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
    for (let fi = 0; fi < formats.length; fi++) {
      const fmt = formats[fi];
      const msgs = opts.schema && fmt === undefined ? withJsonHint(messages) : messages;
      try {
        const res = await this.request(task, model, msgs, fmt, temperature, maxTokens, opts.signal);
        if (opts.schema) {
          const json = extractJson(res.text);
          if (json === undefined) {
            // structured output requested but nothing parseable came back: try the next format, once
            lastErr = new Error(`Model returned non-JSON for ${task}`);
            if (fi < formats.length - 1) continue;
            throw lastErr;
          }
          res.json = json;
        } else {
          const maybe = res.text.trim().startsWith('{') ? extractJson(res.text) : undefined;
          if (maybe !== undefined) res.json = maybe;
        }
        if (key) this.cache.set(key, res);
        return res;
      } catch (err) {
        lastErr = err;
        // A 400 means the provider rejected the request shape (usually response_format) → degrade format.
        if (err instanceof LLMHttpError && err.status === 400 && fi < formats.length - 1) continue;
        if (err instanceof Error && err.message.startsWith('Model returned non-JSON') && fi < formats.length - 1) continue;
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Single request with retries on 429/5xx/network/timeout. */
  private async request(task: LLMTask, model: string, messages: ChatMessage[], fmt: ResponseFormat, temperature: number, maxTokens: number, outerSignal?: AbortSignal): Promise<CompleteResult> {
    const maxRetries = this.config.maxRetries ?? 3;
    const base = this.config.retryBaseMs ?? 500;
    const fmtLabel: LLMRequestInfo['responseFormat'] = fmt ? fmt.type : 'none';
    const body: Record<string, unknown> = { model, messages, temperature, max_tokens: maxTokens, usage: { include: true } };
    if (this.config.fallbacks?.length) body.models = [model, ...this.config.fallbacks.filter((m) => m !== model)];
    if (fmt) {
      body.response_format = fmt;
      body.provider = { require_parameters: true };
    }
    const info: LLMRequestInfo = { task, model, attempt: 0, responseFormat: fmtLabel, messageCount: messages.length, promptChars: promptChars(messages), cached: false };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      info.attempt = attempt;
      this.config.onRequest?.({ ...info });
      const started = nowMs();
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), this.config.timeoutMs ?? 45_000);
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
        const raw = await resp.text();
        if (!resp.ok) {
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
        try {
          data = JSON.parse(raw) as OpenRouterCompletion;
        } catch {
          throw new LLMHttpError(status, 'OpenRouter returned invalid JSON envelope', raw);
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
        const e = new Error(aborted ? (outerSignal?.aborted ? 'LLM request cancelled' : `LLM request timed out after ${this.config.timeoutMs ?? 45_000} ms`) : `LLM network error: ${(err as Error)?.message ?? String(err)}`);
        this.config.onResponse?.({ ...info, ok: false, status: 0, ms: nowMs() - started, error: e.message });
        if (outerSignal?.aborted) throw e;
        lastErr = e;
        if (attempt < maxRetries) {
          await this.backoff(base, attempt);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timeout);
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

  /** GET /models — for validating configured model ids at settings time. */
  async listModels(): Promise<OpenRouterModelInfo[]> {
    const resp = await this.fetchImpl(`${this.config.baseUrl ?? DEFAULT_BASE}/models`, { method: 'GET', headers: this.headers() });
    const raw = await resp.text();
    if (!resp.ok) throw new LLMHttpError(resp.status, `OpenRouter ${resp.status}: ${snippet(raw)}`, raw);
    const data = JSON.parse(raw) as { data?: { id: string; name?: string; context_length?: number; pricing?: { prompt?: string | number; completion?: string | number }; supported_parameters?: string[] }[] };
    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      pricing: m.pricing ? { prompt: num(m.pricing.prompt), completion: num(m.pricing.completion) } : undefined,
      supportedParameters: m.supported_parameters,
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
