/**
 * Places cache: in-memory LRU (max 2,000 entries) with an optional async persistence adapter so a world
 * stays stable offline and API calls are not repeated across sessions.
 *
 * Key conventions:
 *   nearby:<lat4>,<lng4>:<radius>:<types sorted, comma-joined>
 *   text:<query lower-cased>:<lat4>,<lng4>
 *   details:<placeId>
 *   travel:<lat4>,<lng4>-<lat4>,<lng4>:<mode>:<hourBucket>
 *   geocode:<address lower-cased>
 *   reverse:<lat4>,<lng4>
 *
 * Time source: the cache is an I/O adapter, not simulation state, so TTLs use wall-clock milliseconds via
 * an injectable `now()` (defaults to `Date.now`). Simulation code must never read this clock.
 */
import type { LatLng, TravelMode } from '../core/types';
import type { PlaceDetails, PlacePrediction, PlaceSummary, PlacesProvider, TravelEstimate } from './types';

export interface PlacesCacheAdapter {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface PlacesCacheOptions {
  adapter?: PlacesCacheAdapter;
  /** max in-memory entries (LRU eviction) */
  maxEntries?: number;
  /** default TTL in ms (30 days) */
  ttlMs?: number;
  /** wall clock in ms; injectable for tests */
  now?: () => number;
}

interface Envelope<T> {
  at: number;
  ttl: number;
  value: T;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DETAILS_TTL_MS = 30 * DAY_MS;
export const SEARCH_TTL_MS = 30 * DAY_MS;
export const TRAVEL_TTL_MS = 7 * DAY_MS;
export const GEOCODE_TTL_MS = 90 * DAY_MS;

export const fmt4 = (n: number): string => (Math.round(n * 10000) / 10000).toFixed(4);
export const latLngKey = (p: LatLng): string => `${fmt4(p.lat)},${fmt4(p.lng)}`;

export const cacheKeys = {
  nearby: (center: LatLng, radiusM: number, types: string[]): string => `nearby:${latLngKey(center)}:${Math.round(radiusM)}:${[...types].sort().join(',')}`,
  text: (query: string, center: LatLng): string => `text:${query.trim().toLowerCase()}:${latLngKey(center)}`,
  details: (placeId: string): string => `details:${placeId}`,
  travel: (from: LatLng, to: LatLng, mode: TravelMode, hourBucket: number): string => `travel:${latLngKey(from)}-${latLngKey(to)}:${mode}:${hourBucket}`,
  geocode: (address: string): string => `geocode:${address.trim().toLowerCase()}`,
  reverse: (p: LatLng): string => `reverse:${latLngKey(p)}`,
  autocomplete: (input: string, center?: LatLng): string => `auto:${input.trim().toLowerCase()}:${center ? latLngKey(center) : '-'}`,
};

/** 3-hour buckets so the travel cache distinguishes rush hour from night. */
export function hourBucket(departAtIso?: string): number {
  if (!departAtIso) return -1;
  const m = /T(\d{2}):/.exec(departAtIso);
  if (!m) return -1;
  return Math.floor(Number(m[1]) / 3);
}

export class PlacesCache {
  private readonly mem = new Map<string, Envelope<unknown>>();
  private readonly adapter?: PlacesCacheAdapter;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  /** simple stats for debugging/UI */
  readonly stats = { hits: 0, misses: 0, evictions: 0, persisted: 0 };

  constructor(opts: PlacesCacheOptions = {}) {
    this.adapter = opts.adapter;
    this.maxEntries = Math.max(1, opts.maxEntries ?? 2000);
    this.ttlMs = opts.ttlMs ?? DETAILS_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
  }

  get size(): number {
    return this.mem.size;
  }

  private fresh(e: Envelope<unknown> | undefined): boolean {
    if (!e) return false;
    return e.ttl <= 0 || this.now() - e.at < e.ttl;
  }

  private touch(key: string, e: Envelope<unknown>): void {
    // Map preserves insertion order; re-inserting moves the key to the end (most recently used).
    this.mem.delete(key);
    this.mem.set(key, e);
    while (this.mem.size > this.maxEntries) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
      this.stats.evictions++;
    }
  }

  /** Synchronous in-memory read (no adapter). */
  peek<T>(key: string): T | undefined {
    const e = this.mem.get(key);
    if (!this.fresh(e)) {
      if (e) this.mem.delete(key);
      return undefined;
    }
    this.touch(key, e!);
    return e!.value as T;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const inMem = this.peek<T>(key);
    if (inMem !== undefined) {
      this.stats.hits++;
      return inMem;
    }
    if (this.adapter) {
      try {
        const raw = await this.adapter.get(key);
        if (raw) {
          const e = JSON.parse(raw) as Envelope<T>;
          if (e && typeof e === 'object' && 'value' in e && this.fresh(e)) {
            this.touch(key, e);
            this.stats.hits++;
            return e.value;
          }
        }
      } catch {
        // corrupt / unavailable persistence is treated as a miss
      }
    }
    this.stats.misses++;
    return undefined;
  }

  async set<T>(key: string, value: T, ttlMs = this.ttlMs): Promise<void> {
    const e: Envelope<T> = { at: this.now(), ttl: ttlMs, value };
    this.touch(key, e);
    if (this.adapter) {
      try {
        await this.adapter.set(key, JSON.stringify(e));
        this.stats.persisted++;
      } catch {
        // persistence failures must never break gameplay
      }
    }
  }

  /** Read-through helper. */
  async getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs = this.ttlMs): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const v = await loader();
    await this.set(key, v, ttlMs);
    return v;
  }

  has(key: string): boolean {
    return this.fresh(this.mem.get(key));
  }

  delete(key: string): void {
    this.mem.delete(key);
  }

  clear(): void {
    this.mem.clear();
  }

  /** Snapshot of all in-memory entries (for saving into WorldState.placesCache or debugging). */
  entries(): [string, unknown][] {
    const out: [string, unknown][] = [];
    for (const [k, e] of this.mem) if (this.fresh(e)) out.push([k, e.value]);
    return out;
  }

  /** Bulk import (e.g. from a save). */
  seed(entries: Iterable<[string, unknown]>, ttlMs = this.ttlMs): void {
    for (const [k, v] of entries) this.touch(k, { at: this.now(), ttl: ttlMs, value: v });
  }
}

/** Adapter backed by a plain object (tests, or serialising into a save). */
export function memoryAdapter(store: Record<string, string> = {}): PlacesCacheAdapter & { store: Record<string, string> } {
  return {
    store,
    async get(key) {
      return store[key];
    },
    async set(key, value) {
      store[key] = value;
    },
  };
}

/**
 * Wrap a provider so searches, details, travel and geocoding are served from the cache when possible.
 * Autocomplete is cached briefly in memory only (results are cheap and change with each keystroke).
 */
export function cachedProvider(inner: PlacesProvider, cache: PlacesCache): PlacesProvider {
  return {
    id: inner.id,
    async searchNearby(center, radiusM, includedTypes, maxResults) {
      const key = cacheKeys.nearby(center, radiusM, includedTypes) + (maxResults ? `:n${maxResults}` : '');
      return cache.getOrLoad<PlaceSummary[]>(key, () => inner.searchNearby(center, radiusM, includedTypes, maxResults), SEARCH_TTL_MS);
    },
    async searchText(query, center, radiusM, maxResults) {
      const key = cacheKeys.text(query, center) + `:${Math.round(radiusM)}` + (maxResults ? `:n${maxResults}` : '');
      return cache.getOrLoad<PlaceSummary[]>(key, () => inner.searchText(query, center, radiusM, maxResults), SEARCH_TTL_MS);
    },
    async details(placeId) {
      return cache.getOrLoad<PlaceDetails>(cacheKeys.details(placeId), () => inner.details(placeId), DETAILS_TTL_MS);
    },
    async autocomplete(input, center) {
      const key = cacheKeys.autocomplete(input, center);
      const hit = cache.peek<PlacePrediction[]>(key);
      if (hit) return hit;
      const v = await inner.autocomplete(input, center);
      await cache.set(key, v, 10 * 60 * 1000);
      return v;
    },
    async geocode(address) {
      const key = cacheKeys.geocode(address);
      const hit = await cache.get<Awaited<ReturnType<PlacesProvider['geocode']>> | null>(key);
      if (hit !== undefined) return hit ?? undefined;
      const v = await inner.geocode(address);
      await cache.set(key, v ?? null, GEOCODE_TTL_MS);
      return v;
    },
    async reverseGeocode(location) {
      const key = cacheKeys.reverse(location);
      const hit = await cache.get<Awaited<ReturnType<PlacesProvider['reverseGeocode']>> | null>(key);
      if (hit !== undefined) return hit ?? undefined;
      const v = await inner.reverseGeocode(location);
      await cache.set(key, v ?? null, GEOCODE_TTL_MS);
      return v;
    },
    async travel(from, to, mode, departAtIso) {
      const key = cacheKeys.travel(from, to, mode, hourBucket(departAtIso));
      return cache.getOrLoad<TravelEstimate>(key, () => inner.travel(from, to, mode, departAtIso), TRAVEL_TTL_MS);
    },
  };
}
