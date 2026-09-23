/**
 * Latency work on the OpenRouter client: streamed replies (real byte streams and buffered fetches),
 * the per-model response-format memo, reasoning switched off for conversation turns, the fast-lane
 * provider sort, the short interactive timeout, and the half-written-JSON preview.
 */
import { describe, expect, it } from 'vitest';
import { OpenRouterClient, INTERACTIVE_TIMEOUT_MS, reasoningFor } from '../src/engine/llm/client';
import { partialReply } from '../src/engine/llm/schemas';

const sse = (chunks: string[], finish = 'stop') =>
  [
    ': OPENROUTER PROCESSING',
    ...chunks.map((c) => `data: ${JSON.stringify({ id: 'x', model: 'anthropic/claude-haiku-4.5', choices: [{ delta: { content: c }, finish_reason: null }] })}`),
    `data: ${JSON.stringify({ id: 'x', model: 'anthropic/claude-haiku-4.5', choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0004 } })}`,
    'data: [DONE]',
    '',
  ].join('\n');

function streamResponse(text: string, pieces = 7): Response {
  const bytes = new TextEncoder().encode(text);
  const step = Math.ceil(bytes.length / pieces);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i >= bytes.length) return ctrl.close();
      ctrl.enqueue(bytes.slice(i, i + step));
      i += step;
    },
  });
  return { ok: true, status: 200, body, text: async () => text, headers: { get: () => null } } as unknown as Response;
}
function bufferedResponse(text: string, status = 200): Response {
  return { ok: status < 400, status, text: async () => text, headers: { get: () => null } } as unknown as Response;
}

const reply = '{"dialogue":[{"speakerId":"sim_1","text":"Hey — yeah, I\'m here.","emotion":"neutral"}],"narration":"She looks up.","minutes":2}';

describe('streaming', () => {
  it('streams tokens from a byte stream and still returns the whole reply with usage', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new OpenRouterClient({ apiKey: 'k', retryBaseMs: 0 }, { fetchImpl: (async (_u: string, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return streamResponse(sse(['{"dialogue":[{"speakerId":"sim_1",', '"text":"Hey — yeah,', ' I\'m here.","emotion":"neutral"}],', '"narration":"She looks up.","minutes":2}'])); }) as unknown as typeof fetch });
    const seen: string[] = [];
    const res = await client.complete('dialogue', [{ role: 'user', content: 'hi' }], { schema: { name: 'o', schema: { type: 'object' } }, onDelta: (t) => seen.push(t) });
    expect(res.text).toBe(reply);
    expect(res.json).toEqual(JSON.parse(reply));
    expect(res.usage.tokensOut).toBe(20);
    expect(res.usage.costUsd).toBeCloseTo(0.0004, 6);
    expect(res.finishReason).toBe('stop');
    expect(seen.length).toBeGreaterThan(2);
    expect(seen[seen.length - 1]).toBe(reply);
    const body = bodies[0];
    expect(body.stream).toBe(true);
    expect((body.provider as Record<string, unknown>).sort).toBe('latency');
    expect((body.provider as Record<string, unknown>).require_parameters).toBe(true);
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.max_tokens).toBe(1000);
  });

  it('parses the same events when the runtime buffers the whole body', async () => {
    const client = new OpenRouterClient({ apiKey: 'k', retryBaseMs: 0 }, { fetchImpl: (async () => bufferedResponse(sse([reply]))) as unknown as typeof fetch });
    const res = await client.complete('dialogue', [{ role: 'user', content: 'hi' }], { schema: { name: 'o', schema: { type: 'object' } }, onDelta: () => undefined });
    expect(res.json).toEqual(JSON.parse(reply));
    expect(res.usage.tokensIn).toBe(100);
  });

  it('surfaces a provider error carried inside the stream', async () => {
    const text = `data: ${JSON.stringify({ error: { message: 'model overloaded', code: 502 } })}\n\n`;
    const client = new OpenRouterClient({ apiKey: 'k', retryBaseMs: 0, maxRetries: 0 }, { fetchImpl: (async () => bufferedResponse(text)) as unknown as typeof fetch });
    await expect(client.complete('dialogue', [{ role: 'user', content: 'hi' }], { onDelta: () => undefined })).rejects.toThrow(/overloaded/);
  });

  it('gives a conversation turn a short leash and one retry, background work the long one', async () => {
    const client = new OpenRouterClient({ apiKey: 'k' });
    expect(client.timeoutFor('dialogue')).toBe(INTERACTIVE_TIMEOUT_MS);
    expect(client.timeoutFor('bio')).toBe(45_000);
    expect(client.retriesFor('dialogue')).toBe(1);
    expect(client.retriesFor('bio')).toBe(3);
    const slow = new OpenRouterClient({ apiKey: 'k', timeoutMs: 40, maxRetries: 0 }, { fetchImpl: ((_u: string, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch });
    await expect(slow.complete('dialogue', [{ role: 'user', content: 'hi' }])).rejects.toThrow(/timed out after 40 ms/);
  });
});

describe('format memo and reasoning', () => {
  it('remembers which response format a model accepted instead of renegotiating every turn', async () => {
    const formats: string[] = [];
    const client = new OpenRouterClient({ apiKey: 'k', retryBaseMs: 0, maxRetries: 0 }, {
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const fmt = body.response_format?.type ?? 'none';
        formats.push(fmt);
        if (fmt === 'json_schema') return bufferedResponse('{"error":{"message":"response_format json_schema is not supported by this provider"}}', 400);
        return bufferedResponse(JSON.stringify({ model: 'm', choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      }) as unknown as typeof fetch,
    });
    const schema = { name: 'o', schema: { type: 'object' } };
    await client.complete('dialogue', [{ role: 'user', content: 'a' }], { schema });
    await client.complete('dialogue', [{ role: 'user', content: 'b' }], { schema });
    expect(formats).toEqual(['json_schema', 'json_object', 'json_object']);
  });

  it('drops the reasoning switch for a model that rejects it, and only once', async () => {
    const seen: (unknown | undefined)[] = [];
    const client = new OpenRouterClient({ apiKey: 'k', retryBaseMs: 0, maxRetries: 0 }, {
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        seen.push(body.reasoning);
        if (body.reasoning) return bufferedResponse('{"error":{"message":"reasoning is not supported"}}', 400);
        return bufferedResponse(JSON.stringify({ model: 'm', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
      }) as unknown as typeof fetch,
    });
    await client.complete('narrate', [{ role: 'user', content: 'a' }]);
    await client.complete('narrate', [{ role: 'user', content: 'b' }]);
    expect(seen).toEqual([{ enabled: false }, undefined, undefined]);
  });

  it('asks for no thinking where it can be switched off and the minimum where it cannot', () => {
    expect(reasoningFor('anthropic/claude-haiku-4.5', 'dialogue')).toEqual({ enabled: false });
    expect(reasoningFor('google/gemini-2.5-flash', 'adjudicate')).toEqual({ enabled: false });
    expect(reasoningFor('openai/gpt-5-mini', 'dialogue')).toEqual({ effort: 'minimal' });
    expect(reasoningFor('google/gemini-2.5-pro', 'dialogue')).toEqual({ effort: 'low' });
    expect(reasoningFor('anthropic/claude-sonnet-5:thinking', 'dialogue')).toBeUndefined();
    expect(reasoningFor('anthropic/claude-sonnet-5', 'bio')).toBeUndefined();
  });
});

describe('partial reply preview', () => {
  it('shows the first line as it grows, then keeps it', () => {
    expect(partialReply('{"dia')).toBeUndefined();
    expect(partialReply('{"dialogue":[{"speakerId":"sim_1","text":"Hey \\u2014 ye')).toEqual({ kind: 'dialogue', speakerId: 'sim_1', text: 'Hey — ye' });
    expect(partialReply('{"dialogue":[{"speakerId":"sim_1","text":"Say \\"hi\\" to')).toEqual({ kind: 'dialogue', speakerId: 'sim_1', text: 'Say "hi" to' });
    expect(partialReply(reply)).toEqual({ kind: 'dialogue', speakerId: 'sim_1', text: "Hey — yeah, I'm here." });
    expect(partialReply('{"narration":"You wait at the counter wh')).toEqual({ kind: 'narration', text: 'You wait at the counter wh' });
    expect(partialReply('{"narration":"You wait.","dialogue":[{"speakerId":"sim_2","text":"Next!"}]}')).toEqual({ kind: 'dialogue', speakerId: 'sim_2', text: 'Next!' });
  });
});
