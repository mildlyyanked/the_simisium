/**
 * Task → model routing, per-task sampling parameters, and an approximate pricing table
 * for cost accounting.
 *
 * NOTE: model slugs are OpenRouter ids (`vendor/model`). Vendors rename and retire models;
 * these defaults may need updating over time. `OpenRouterClient.listModels()` /
 * `validateModels()` check the configured ids against the live catalog at settings time.
 */
import type { LLMTask } from '../core/llmTypes';

export type ModelPreset = 'balanced' | 'quality' | 'budget';

export const DEFAULT_MODELS: Record<LLMTask, string> = {
  dialogue: 'anthropic/claude-haiku-4.5',
  adjudicate: 'anthropic/claude-sonnet-5',
  bio: 'anthropic/claude-sonnet-5',
  narrate: 'google/gemini-2.5-flash-lite',
  summarize: 'anthropic/claude-haiku-4.5',
  director: 'anthropic/claude-opus-5',
};

export const MODEL_PRESETS: Record<ModelPreset, Record<LLMTask, string>> = {
  balanced: { ...DEFAULT_MODELS },
  quality: {
    dialogue: 'anthropic/claude-sonnet-5',
    adjudicate: 'anthropic/claude-opus-5',
    bio: 'anthropic/claude-opus-5',
    narrate: 'google/gemini-2.5-flash',
    summarize: 'anthropic/claude-haiku-4.5',
    director: 'anthropic/claude-opus-5',
  },
  budget: {
    dialogue: 'google/gemini-2.5-flash',
    adjudicate: 'google/gemini-2.5-flash',
    bio: 'deepseek/deepseek-v3.2',
    narrate: 'google/gemini-2.5-flash-lite',
    summarize: 'google/gemini-2.5-flash-lite',
    director: 'anthropic/claude-sonnet-5',
  },
};

/** Sampling parameters per task. */
export const TASK_PARAMS: Record<LLMTask, { temperature: number; maxTokens: number }> = {
  dialogue: { temperature: 0.9, maxTokens: 700 },
  adjudicate: { temperature: 0.4, maxTokens: 1200 },
  bio: { temperature: 0.8, maxTokens: 2000 },
  narrate: { temperature: 0.8, maxTokens: 300 },
  summarize: { temperature: 0.2, maxTokens: 400 },
  director: { temperature: 0.7, maxTokens: 1500 },
};

export interface RoutingConfig {
  /** explicit per-task overrides (win over preset) */
  models?: Partial<Record<LLMTask, string>>;
  preset?: ModelPreset;
}

export function modelFor(task: LLMTask, config: RoutingConfig = {}): string {
  const explicit = config.models?.[task];
  if (explicit && explicit.trim()) return explicit.trim();
  const preset = config.preset ? MODEL_PRESETS[config.preset] : undefined;
  return preset?.[task] ?? DEFAULT_MODELS[task];
}

/**
 * APPROXIMATE list prices in USD per 1M tokens (`in` = prompt, `out` = completion), best-known
 * values at authoring time. OpenRouter returns the exact `usage.cost` when asked; this table is
 * only the fallback estimate (and what the budget guard uses when no cost is reported).
 * Update when vendors change pricing.
 */
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'anthropic/claude-haiku-4.5': { in: 1.0, out: 5.0 },
  'anthropic/claude-sonnet-4.5': { in: 3.0, out: 15.0 },
  'anthropic/claude-sonnet-5': { in: 3.0, out: 15.0 },
  'anthropic/claude-opus-4.5': { in: 5.0, out: 25.0 },
  'anthropic/claude-opus-5': { in: 5.0, out: 25.0 },
  'google/gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  'google/gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'google/gemini-2.5-pro': { in: 1.25, out: 10.0 },
  'deepseek/deepseek-v3.2': { in: 0.27, out: 0.41 },
  'deepseek/deepseek-chat': { in: 0.27, out: 1.1 },
  'openai/gpt-4o-mini': { in: 0.15, out: 0.6 },
  'openai/gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'openai/gpt-4.1': { in: 2.0, out: 8.0 },
  'openai/gpt-5-mini': { in: 0.25, out: 2.0 },
  'meta-llama/llama-3.3-70b-instruct': { in: 0.1, out: 0.3 },
  'mistralai/mistral-small-3.2-24b-instruct': { in: 0.1, out: 0.3 },
  'x-ai/grok-4-fast': { in: 0.2, out: 0.5 },
};

/** Used for models missing from the table; deliberately conservative so the budget guard errs safe. */
export const UNKNOWN_MODEL_PRICING = { in: 3.0, out: 15.0 };

export function pricingFor(model: string): { in: number; out: number; known: boolean } {
  const exact = MODEL_PRICING[model];
  if (exact) return { ...exact, known: true };
  if (model.endsWith(':free')) return { in: 0, out: 0, known: true };
  // OpenRouter variants like ":nitro" / ":floor" / ":thinking"
  const base = model.split(':')[0];
  const byBase = MODEL_PRICING[base];
  if (byBase) return { ...byBase, known: true };
  return { ...UNKNOWN_MODEL_PRICING, known: false };
}

/** Estimated USD for a call, from the pricing table. */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = pricingFor(model);
  const usd = (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Rough cost of one hour of play for a routing config (≈40 dialogue turns, 10 freeform actions, 2 bios). */
export function estimateHourlyCost(config: RoutingConfig = {}): { usd: number; breakdown: Record<LLMTask, number> } {
  const assumptions: Record<LLMTask, { calls: number; tokensIn: number; tokensOut: number }> = {
    dialogue: { calls: 40, tokensIn: 3500, tokensOut: 450 },
    adjudicate: { calls: 10, tokensIn: 3800, tokensOut: 600 },
    bio: { calls: 2, tokensIn: 1500, tokensOut: 1400 },
    narrate: { calls: 15, tokensIn: 900, tokensOut: 80 },
    summarize: { calls: 1, tokensIn: 2500, tokensOut: 250 },
    director: { calls: 0.15, tokensIn: 4000, tokensOut: 900 },
  };
  const breakdown = {} as Record<LLMTask, number>;
  let usd = 0;
  for (const task of Object.keys(assumptions) as LLMTask[]) {
    const a = assumptions[task];
    const c = estimateCost(modelFor(task, config), a.tokensIn, a.tokensOut) * a.calls;
    breakdown[task] = Math.round(c * 10000) / 10000;
    usd += c;
  }
  return { usd: Math.round(usd * 100) / 100, breakdown };
}
