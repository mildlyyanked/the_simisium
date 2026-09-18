/**
 * Builds an Engine from a WorldState using the content catalog, registered systems,
 * the calendar's holiday resolver, and an LLM service configured from settings.
 * Re-created by the game store whenever API keys / model prefs change.
 */
import { Engine } from '@engine/core/engine';
import type { LLMService, LLMUsage } from '@engine/core/llmTypes';
import type { WorldState } from '@engine/core/types';
import type { HolidayResolver } from '@engine/core/clock';
import { CONTENT } from '@engine/content';
import { SYSTEMS } from '@engine/systems';
import { holidayResolver } from '@engine/systems/calendar';
import { createLLMService } from '@engine/llm';
import { createPlacesProvider } from '@engine/places';
import type { PlacesProvider } from '@engine/places/types';
import { useSettings } from './settings';

export interface EngineBuildResult {
  engine: Engine;
  llm?: LLMService;
  warnings: string[];
}

const resolver: HolidayResolver = holidayResolver;

export function buildLLM(onUsage?: (u: LLMUsage) => void): { llm?: LLMService; warning?: string } {
  const s = useSettings.getState();
  try {
    const llm = createLLMService({
      apiKey: s.openRouterKey || undefined,
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

export function buildPlaces(center?: { lat: number; lng: number }): { places?: PlacesProvider; warning?: string } {
  const s = useSettings.getState();
  try {
    return { places: createPlacesProvider({ googleApiKey: s.googlePlacesKey || undefined, ...(center ? { mockCenter: center } : {}) }) };
  } catch (err) {
    return { warning: `Places layer unavailable: ${(err as Error).message}` };
  }
}

export function buildEngine(state: WorldState, opts: { onUsage?: (u: LLMUsage) => void } = {}): EngineBuildResult {
  const warnings: string[] = [];
  const { llm, warning } = buildLLM(opts.onUsage);
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
