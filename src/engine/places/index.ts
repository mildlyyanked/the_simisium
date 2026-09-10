/**
 * Places layer entry point. `createPlacesProvider` picks Google when a key is present (unless forced to
 * mock) and otherwise serves the curated fixture city; an optional `PlacesCache` wraps either.
 */
import type { LatLng } from '../core/types';
import { cachedProvider, PlacesCache } from './cache';
import { GooglePlacesProvider } from './google';
import { MockPlacesProvider } from './mock';
import type { PlacesProvider } from './types';

export interface PlacesProviderConfig {
  googleApiKey?: string;
  fetchImpl?: typeof fetch;
  cache?: PlacesCache;
  /** force a provider; default = google when a key is present, else mock */
  region?: 'mock' | 'google';
  /** mock only: translate the fixture city to this center */
  mockCenter?: LatLng;
  /** mock only: deterministic jitter radius (km) after translation */
  mockJitterKm?: number;
  /** economy hints for cost estimates */
  gasPrice?: number;
  mpg?: number;
}

export function createPlacesProvider(config: PlacesProviderConfig = {}): PlacesProvider {
  const useGoogle = config.region === 'google' || (config.region !== 'mock' && !!config.googleApiKey);
  let inner: PlacesProvider;
  if (useGoogle && config.googleApiKey) {
    inner = new GooglePlacesProvider({ apiKey: config.googleApiKey, fetchImpl: config.fetchImpl, gasPrice: config.gasPrice, mpg: config.mpg });
  } else {
    inner = new MockPlacesProvider({ center: config.mockCenter, jitterKm: config.mockJitterKm, gasPrice: config.gasPrice, mpg: config.mpg });
  }
  return config.cache ? cachedProvider(inner, config.cache) : inner;
}

export type { PlaceDetails, PlacePrediction, PlaceSummary, PlacesProvider, TravelEstimate } from './types';
export { archetypeForType, archetypeForTypes, archetypeIcon, ALL_ARCHETYPES, TYPE_PRIORITY } from './archetypes';
export { SEARCH_PLAN, ESSENTIAL_ARCHETYPES, SEARCH_PLAN_TOTAL } from './archetypeSearch';
export type { SearchPlanEntry } from './archetypeSearch';
export { PlacesCache, cachedProvider, cacheKeys, hourBucket, memoryAdapter, DETAILS_TTL_MS, SEARCH_TTL_MS, TRAVEL_TTL_MS, GEOCODE_TTL_MS } from './cache';
export type { PlacesCacheAdapter, PlacesCacheOptions } from './cache';
export { estimateTravel, routedTravel, travelCost, trafficMultiplier, weatherMultiplier, surgeMultiplier, modeSpeedKmh, DETOUR_FACTOR, MODE_OVERHEAD_MIN } from './travel';
export type { TravelOpts } from './travel';
export { GooglePlacesProvider, PlacesError, mapPlace, mapPeriods, mapPriceLevel, extractThemes, trimSnippet, redact, SEARCH_FIELD_MASK, DETAILS_FIELD_MASK, ROUTES_FIELD_MASK } from './google';
export type { GoogleProviderOptions, RawPlace } from './google';
export { MockPlacesProvider, MOCK_CITIES, findMockCity, nearestMockCity } from './mock';
export type { MockCity, MockProviderOptions } from './mock';
export { AUSTIN_FIXTURES, AUSTIN_CENTER, AUSTIN_BOUNDS, AUSTIN_BY_ID } from './fixtures/austin';
