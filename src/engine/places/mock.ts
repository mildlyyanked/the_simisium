/**
 * Offline provider serving the Austin fixtures (or any fixture list). Deterministic: no wall clock, no
 * Math.random. Fixtures can be translated to another city's center so the mock works for any chosen city.
 */
import type { GooglePlaceData, LatLng, TravelMode } from '../core/types';
import { haversineKm } from '../core/util';
import { AUSTIN_BOUNDS, AUSTIN_CENTER, AUSTIN_FIXTURES } from './fixtures/austin';
import { PlacesError } from './google';
import { estimateTravel } from './travel';
import type { PlaceDetails, PlacePrediction, PlaceSummary, PlacesProvider, TravelEstimate } from './types';

export interface MockCity {
  name: string;
  state: string;
  stateCode: string;
  lat: number;
  lng: number;
  timezone: string;
}

export const MOCK_CITIES: MockCity[] = [
  { name: 'Austin', state: 'Texas', stateCode: 'TX', lat: 30.2672, lng: -97.7431, timezone: 'America/Chicago' },
  { name: 'Dallas', state: 'Texas', stateCode: 'TX', lat: 32.7767, lng: -96.797, timezone: 'America/Chicago' },
  { name: 'Houston', state: 'Texas', stateCode: 'TX', lat: 29.7604, lng: -95.3698, timezone: 'America/Chicago' },
  { name: 'San Antonio', state: 'Texas', stateCode: 'TX', lat: 29.4241, lng: -98.4936, timezone: 'America/Chicago' },
  { name: 'New York', state: 'New York', stateCode: 'NY', lat: 40.7128, lng: -74.006, timezone: 'America/New_York' },
  { name: 'Los Angeles', state: 'California', stateCode: 'CA', lat: 34.0522, lng: -118.2437, timezone: 'America/Los_Angeles' },
  { name: 'Chicago', state: 'Illinois', stateCode: 'IL', lat: 41.8781, lng: -87.6298, timezone: 'America/Chicago' },
  { name: 'Seattle', state: 'Washington', stateCode: 'WA', lat: 47.6062, lng: -122.3321, timezone: 'America/Los_Angeles' },
  { name: 'Denver', state: 'Colorado', stateCode: 'CO', lat: 39.7392, lng: -104.9903, timezone: 'America/Denver' },
  { name: 'Miami', state: 'Florida', stateCode: 'FL', lat: 25.7617, lng: -80.1918, timezone: 'America/New_York' },
  { name: 'Atlanta', state: 'Georgia', stateCode: 'GA', lat: 33.749, lng: -84.388, timezone: 'America/New_York' },
  { name: 'Boston', state: 'Massachusetts', stateCode: 'MA', lat: 42.3601, lng: -71.0589, timezone: 'America/New_York' },
  { name: 'Phoenix', state: 'Arizona', stateCode: 'AZ', lat: 33.4484, lng: -112.074, timezone: 'America/Phoenix' },
  { name: 'Portland', state: 'Oregon', stateCode: 'OR', lat: 45.5152, lng: -122.6784, timezone: 'America/Los_Angeles' },
  { name: 'Nashville', state: 'Tennessee', stateCode: 'TN', lat: 36.1627, lng: -86.7816, timezone: 'America/Chicago' },
  { name: 'Minneapolis', state: 'Minnesota', stateCode: 'MN', lat: 44.9778, lng: -93.265, timezone: 'America/Chicago' },
];

export interface MockProviderOptions {
  /** fixture list (defaults to Austin) */
  fixtures?: GooglePlaceData[];
  /** the fixtures' native center (defaults to Austin's) */
  fixtureCenter?: LatLng;
  /** translate fixtures so their center lands here (e.g. another city's center) */
  center?: LatLng;
  /** deterministic per-place jitter radius in km applied after translation (0 = none) */
  jitterKm?: number;
  /** city/state reported by reverseGeocode inside the translated fixture bounds (defaults to Austin, or the MOCK_CITY nearest `center`) */
  region?: { city: string; state: string; stateCode: string };
  /** simulated latency in ms (0 = none). Uses setTimeout, never the clock. */
  latencyMs?: number;
  /** region hints for travel estimates */
  gasPrice?: number;
  mpg?: number;
}

/** Stable 32-bit hash for deterministic jitter. */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function citySlug(c: MockCity): string {
  return c.name.toLowerCase().replace(/[^a-z]+/g, '_');
}

export function nearestMockCity(p: LatLng): MockCity {
  let best = MOCK_CITIES[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of MOCK_CITIES) {
    const d = haversineKm(p, { lat: c.lat, lng: c.lng });
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function findMockCity(q: string): MockCity | undefined {
  const s = q.trim().toLowerCase();
  if (!s) return undefined;
  const exact = MOCK_CITIES.find((c) => c.name.toLowerCase() === s || `${c.name}, ${c.stateCode}`.toLowerCase() === s || `${c.name}, ${c.state}`.toLowerCase() === s);
  if (exact) return exact;
  const stripped = s.replace(/,?\s*(usa|united states|us)$/i, '').trim();
  return MOCK_CITIES.find((c) => stripped === c.name.toLowerCase() || stripped.startsWith(c.name.toLowerCase() + ',') || stripped.startsWith(c.name.toLowerCase() + ' '));
}

export class MockPlacesProvider implements PlacesProvider {
  readonly id = 'mock' as const;
  readonly fixtures: GooglePlaceData[];
  readonly center: LatLng;
  private readonly byId: Map<string, GooglePlaceData>;
  private readonly bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  private readonly region: { city: string; state: string; stateCode: string };
  private readonly latencyMs: number;
  private readonly gasPrice?: number;
  private readonly mpg?: number;

  constructor(opts: MockProviderOptions = {}) {
    const src = opts.fixtures ?? AUSTIN_FIXTURES;
    const from = opts.fixtureCenter ?? AUSTIN_CENTER;
    const to = opts.center ?? from;
    this.center = { lat: to.lat, lng: to.lng };
    const dLat = to.lat - from.lat;
    // keep east-west distances roughly constant when moving between latitudes
    const lngScale = Math.cos((from.lat * Math.PI) / 180) / Math.max(0.1, Math.cos((to.lat * Math.PI) / 180));
    const jitter = opts.jitterKm ?? 0;
    this.fixtures = src.map((f) => {
      let lat = f.location.lat + dLat;
      let lng = to.lng + (f.location.lng - from.lng) * lngScale;
      if (jitter > 0) {
        const h = hash32(f.placeId);
        const ang = ((h & 0xffff) / 0xffff) * Math.PI * 2;
        const r = (((h >>> 16) & 0xffff) / 0xffff) * jitter;
        lat += (r * Math.cos(ang)) / 111.32;
        lng += (r * Math.sin(ang)) / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
      }
      return { ...f, location: { lat, lng } };
    });
    this.byId = new Map(this.fixtures.map((f) => [f.placeId, f]));
    const b = opts.fixtureCenter || opts.fixtures ? this.computeBounds() : { minLat: AUSTIN_BOUNDS.minLat + dLat, maxLat: AUSTIN_BOUNDS.maxLat + dLat, minLng: to.lng + (AUSTIN_BOUNDS.minLng - from.lng) * lngScale, maxLng: to.lng + (AUSTIN_BOUNDS.maxLng - from.lng) * lngScale };
    this.bounds = { minLat: Math.min(b.minLat, b.maxLat), maxLat: Math.max(b.minLat, b.maxLat), minLng: Math.min(b.minLng, b.maxLng), maxLng: Math.max(b.minLng, b.maxLng) };
    if (opts.region) this.region = opts.region;
    else if (opts.center) {
      const c = nearestMockCity(opts.center);
      this.region = { city: c.name, state: c.state, stateCode: c.stateCode };
    } else this.region = { city: 'Austin', state: 'Texas', stateCode: 'TX' };
    this.latencyMs = opts.latencyMs ?? 0;
    this.gasPrice = opts.gasPrice;
    this.mpg = opts.mpg;
  }

  private computeBounds() {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const f of this.fixtures) {
      minLat = Math.min(minLat, f.location.lat);
      maxLat = Math.max(maxLat, f.location.lat);
      minLng = Math.min(minLng, f.location.lng);
      maxLng = Math.max(maxLng, f.location.lng);
    }
    return { minLat: minLat - 0.01, maxLat: maxLat + 0.01, minLng: minLng - 0.01, maxLng: maxLng + 0.01 };
  }

  private async delay(): Promise<void> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  private inBounds(p: LatLng): boolean {
    return p.lat >= this.bounds.minLat && p.lat <= this.bounds.maxLat && p.lng >= this.bounds.minLng && p.lng <= this.bounds.maxLng;
  }

  async searchNearby(center: LatLng, radiusM: number, includedTypes: string[], maxResults = 20): Promise<PlaceSummary[]> {
    await this.delay();
    const wanted = new Set(includedTypes);
    const radiusKm = Math.max(0, radiusM) / 1000;
    const hits: { p: GooglePlaceData; d: number }[] = [];
    for (const f of this.fixtures) {
      if (wanted.size && !f.types.some((t) => wanted.has(t))) continue;
      const d = haversineKm(center, f.location);
      if (d <= radiusKm) hits.push({ p: f, d });
    }
    hits.sort((a, b) => a.d - b.d || a.p.placeId.localeCompare(b.p.placeId));
    return hits.slice(0, Math.max(1, Math.min(20, maxResults))).map((h) => summaryOf(h.p));
  }

  async searchText(query: string, center: LatLng, radiusM: number, maxResults = 20): Promise<PlaceSummary[]> {
    await this.delay();
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    if (!tokens.length) return [];
    const radiusKm = Math.max(1, radiusM / 1000) * 3; // text search is biased, not restricted
    const scored: { p: GooglePlaceData; score: number; d: number }[] = [];
    for (const f of this.fixtures) {
      const name = f.displayName.toLowerCase();
      const typeText = f.types.join(' ').replace(/_/g, ' ');
      let score = 0;
      if (name.includes(query.toLowerCase().trim())) score += 5;
      for (const tk of tokens) {
        if (name.includes(tk)) score += 2;
        if (typeText.includes(tk)) score += 1;
        if (f.primaryType && f.primaryType.replace(/_/g, ' ').includes(tk)) score += 1;
      }
      if (!score) continue;
      const d = haversineKm(center, f.location);
      if (d > radiusKm) continue;
      scored.push({ p: f, score, d });
    }
    scored.sort((a, b) => b.score - a.score || a.d - b.d || a.p.placeId.localeCompare(b.p.placeId));
    return scored.slice(0, Math.max(1, Math.min(20, maxResults))).map((s) => summaryOf(s.p));
  }

  async details(placeId: string): Promise<PlaceDetails> {
    await this.delay();
    const f = this.byId.get(placeId);
    if (!f) throw new PlacesError(`Unknown place ${placeId}`, 404, 'mock:details');
    return { ...f, types: [...f.types], openingPeriods: f.openingPeriods?.map((p) => ({ ...p })) };
  }

  async autocomplete(input: string, center?: LatLng): Promise<PlacePrediction[]> {
    await this.delay();
    const q = input.trim().toLowerCase();
    if (!q) return [];
    const out: PlacePrediction[] = [];
    for (const c of MOCK_CITIES) {
      if (c.name.toLowerCase().startsWith(q)) out.push({ placeId: `city:${citySlug(c)}`, text: c.name, secondaryText: `${c.stateCode}, USA`, types: ['locality', 'political'] });
    }
    const venues = this.fixtures
      .filter((f) => f.displayName.toLowerCase().includes(q))
      .map((f) => ({ f, d: center ? haversineKm(center, f.location) : 0 }))
      .sort((a, b) => a.d - b.d || a.f.displayName.localeCompare(b.f.displayName))
      .slice(0, 5);
    for (const { f } of venues) out.push({ placeId: f.placeId, text: f.displayName, secondaryText: f.formattedAddress, types: [...f.types] });
    return out;
  }

  async geocode(address: string): Promise<{ location: LatLng; formatted: string; city?: string; state?: string; stateCode?: string } | undefined> {
    await this.delay();
    const q = address.trim();
    if (!q) return undefined;
    if (q.startsWith('city:')) {
      const c = MOCK_CITIES.find((x) => citySlug(x) === q.slice(5));
      if (c) return { location: { lat: c.lat, lng: c.lng }, formatted: `${c.name}, ${c.stateCode}, USA`, city: c.name, state: c.state, stateCode: c.stateCode };
    }
    const city = findMockCity(q);
    if (city) return { location: { lat: city.lat, lng: city.lng }, formatted: `${city.name}, ${city.stateCode}, USA`, city: city.name, state: city.state, stateCode: city.stateCode };
    const ql = q.toLowerCase();
    const venue = this.fixtures.find((f) => f.displayName.toLowerCase() === ql) ?? this.fixtures.find((f) => f.displayName.toLowerCase().includes(ql) || (f.formattedAddress ?? '').toLowerCase().includes(ql));
    if (venue) return { location: { ...venue.location }, formatted: venue.formattedAddress ?? venue.displayName, city: this.region.city, state: this.region.state, stateCode: this.region.stateCode };
    // "1234 Somewhere St, Denver, CO" → any known city mentioned anywhere
    const mentioned = MOCK_CITIES.find((c) => ql.includes(c.name.toLowerCase()));
    if (mentioned) return { location: { lat: mentioned.lat, lng: mentioned.lng }, formatted: `${mentioned.name}, ${mentioned.stateCode}, USA`, city: mentioned.name, state: mentioned.state, stateCode: mentioned.stateCode };
    return undefined;
  }

  async reverseGeocode(location: LatLng): Promise<{ formatted: string; city?: string; state?: string; stateCode?: string } | undefined> {
    await this.delay();
    if (this.inBounds(location)) return { formatted: `${this.region.city}, ${this.region.stateCode}, USA`, city: this.region.city, state: this.region.state, stateCode: this.region.stateCode };
    const c = nearestMockCity(location);
    return { formatted: `${c.name}, ${c.stateCode}, USA`, city: c.name, state: c.state, stateCode: c.stateCode };
  }

  async travel(from: LatLng, to: LatLng, mode: TravelMode, departAtIso?: string): Promise<TravelEstimate> {
    await this.delay();
    const m = departAtIso ? /T(\d{2}):/.exec(departAtIso) : null;
    return estimateTravel(from, to, mode, { hour: m ? Number(m[1]) : undefined, gasPrice: this.gasPrice, mpg: this.mpg });
  }
}

/** Search results carry the same fields as details in the mock (Google's search masks omit reviews etc). */
function summaryOf(f: GooglePlaceData): PlaceSummary {
  const s: PlaceSummary = { ...f, types: [...f.types] };
  delete s.reviewSnippets;
  delete s.reviewThemes;
  delete s.editorialSummary;
  delete s.phone;
  delete s.website;
  return s;
}
