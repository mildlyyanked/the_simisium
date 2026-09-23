/**
 * Builds an Engine from a WorldState using the content catalog, registered systems,
 * the calendar's holiday resolver, and an LLM service configured from settings.
 * Re-created by the game store whenever API keys / model prefs change.
 */
import { Engine } from '@engine/core/engine';
import type { LLMService, LLMUsage } from '@engine/core/llmTypes';
import type { LLMResponseInfo } from '@engine/llm';
import type { WorldState } from '@engine/core/types';
import type { HolidayResolver } from '@engine/core/clock';
import { CONTENT } from '@engine/content';
import { SYSTEMS } from '@engine/systems';
import { holidayResolver } from '@engine/systems/calendar';
import { createLLMService } from '@engine/llm';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createPlacesProvider, PlacesCache } from '@engine/places';
import type { PlacesProvider } from '@engine/places/types';
import { useSettings } from './settings';

export interface EngineBuildResult {
  engine: Engine;
  llm?: LLMService;
  warnings: string[];
}

const resolver: HolidayResolver = holidayResolver;

/**
 * React Native's built-in fetch buffers whole responses, which makes streaming pointless; Expo's fetch
 * (OkHttp / URLSession underneath) exposes the body as a stream so replies can be shown as they arrive.
 */
let streamingFetch: typeof fetch | null | undefined;
function nativeStreamingFetch(): typeof fetch | undefined {
  if (Platform.OS === 'web') return undefined;
  if (streamingFetch !== undefined) return streamingFetch ?? undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo/fetch') as { fetch?: typeof fetch };
    streamingFetch = typeof mod.fetch === 'function' ? mod.fetch : null;
  } catch {
    streamingFetch = null;
  }
  return streamingFetch ?? undefined;
}

export function buildLLM(onUsage?: (u: LLMUsage) => void, onResponse?: (r: LLMResponseInfo) => void): { llm?: LLMService; warning?: string } {
  const s = useSettings.getState();
  try {
    const llm = createLLMService({
      apiKey: s.openRouterKey || undefined,
      fetchImpl: nativeStreamingFetch(),
      onResponse,
      models: s.modelOverrides,
      preset: s.modelPreset,
      imageModel: s.imageModel,
      budgetUsd: s.budgetUsd,
      content: CONTENT,
      onUsage,
    });
    return { llm };
  } catch (err) {
    return { warning: `LLM layer unavailable: ${(err as Error).message}` };
  }
}

/**
 * One places cache for the whole app, persisted in AsyncStorage: a search or a lookup that was paid
 * for once is never requested from Google again on this device (30-day TTL for searches/details).
 */
let placesCache: PlacesCache | undefined;
export function sharedPlacesCache(): PlacesCache {
  placesCache ??= new PlacesCache({
    adapter: {
      get: async (key) => (await AsyncStorage.getItem(`simisium:places:${key}`)) ?? undefined,
      set: async (key, value) => AsyncStorage.setItem(`simisium:places:${key}`, value),
    },
    maxEntries: 2000,
  });
  return placesCache;
}

export function buildPlaces(center?: { lat: number; lng: number }): { places?: PlacesProvider; warning?: string } {
  const s = useSettings.getState();
  try {
    return { places: createPlacesProvider({ googleApiKey: s.googlePlacesKey || undefined, cache: sharedPlacesCache(), ...(center ? { mockCenter: center } : {}) }) };
  } catch (err) {
    return { warning: `Places layer unavailable: ${(err as Error).message}` };
  }
}

export function buildEngine(state: WorldState, opts: { onUsage?: (u: LLMUsage) => void; onResponse?: (r: LLMResponseInfo) => void } = {}): EngineBuildResult {
  const warnings: string[] = [];
  const { llm, warning } = buildLLM(opts.onUsage, opts.onResponse);
  if (warning) warnings.push(warning);
  const engine = new Engine(state, {
    content: CONTENT,
    systems: SYSTEMS,
    llm,
    holidayResolver: resolver,
    maxAdvance: 1440 * 3,
  });
  return { engine, llm, warnings };
}
