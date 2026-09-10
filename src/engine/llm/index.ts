/**
 * LLM layer entry point. `createLLMService` returns the live OpenRouter service when an API key is
 * configured, otherwise the deterministic fallback (which the live service also uses per call on failure).
 */
import type { ContentCatalog } from '../content/types';
import type { HolidayResolver } from '../core/clock';
import type { LLMService, LLMTask, LLMUsage } from '../core/llmTypes';
import type { LLMConfig } from './client';
import { FallbackLLMService } from './fallback';
import { OpenRouterLLMService } from './service';

export interface CreateLLMServiceOptions extends LLMConfig {
  content: ContentCatalog;
  fetchImpl?: typeof fetch;
  onUsage?: (u: LLMUsage) => void;
  onError?: (task: LLMTask, error: Error) => void;
  holidayResolver?: HolidayResolver;
}

export function createLLMService(config: CreateLLMServiceOptions): LLMService {
  if (config.apiKey && config.apiKey.trim()) return new OpenRouterLLMService(config);
  return new FallbackLLMService(config.content);
}

export { OpenRouterClient, BudgetExceededError, LLMHttpError, hashKey } from './client';
export type { LLMConfig, ChatMessage, CompleteOptions, CompleteResult, LLMRequestInfo, LLMResponseInfo, OpenRouterModelInfo } from './client';
export { DEFAULT_MODELS, MODEL_PRESETS, MODEL_PRICING, TASK_PARAMS, UNKNOWN_MODEL_PRICING, modelFor, pricingFor, estimateCost, estimateHourlyCost } from './router';
export type { ModelPreset, RoutingConfig } from './router';
export { InteractionOutcomeSchema, EffectBundleSchema, BioSchema, DirectorSchema, NpcMessageSchema, BIO_CATEGORIES, toJsonSchema, extractJson, repairJson, stripCodeFences, firstBalancedObject } from './schemas';
export { buildSceneContext, renderSceneContext } from './context';
export type { SceneContext, ActorContext, NpcContext, VenueContext, WorldContext, BuildContextOptions } from './context';
export { FallbackLLMService, classifyIntent } from './fallback';
export { OpenRouterLLMService, coerceOutcome } from './service';
export type { OpenRouterServiceOptions } from './service';
export { generateBioFallback, buildBioTokens, expandTemplate, BUILTIN_BIO_TEMPLATES, DEPTH_BY_CATEGORY } from './bioFallback';
export { relevantMemories, recentMemories, compactMemoriesIfNeeded, MEMORY_COMPACT_THRESHOLD, MEMORY_COMPACT_BATCH } from './memory';
export * as prompts from './prompts';
