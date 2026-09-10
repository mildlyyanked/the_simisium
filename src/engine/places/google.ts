/**
 * Google Maps Platform provider: Places API (New), Geocoding API and Routes API.
 *
 * - Minimal field masks (billing SKU aware): nearby/text searches request the "Pro" fields we need;
 *   details additionally requests editorial summary, reviews, phone, website and photos.
 * - Robust: HTTP errors become `PlacesError` (status + message), 429/5xx are retried 3× with backoff,
 *   `fetchImpl` and `sleep` are injectable for tests, and the API key is never logged or echoed.
 * - Session tokens for autocomplete are intentionally skipped (optional optimisation).
 */
import type { GooglePlaceData, LatLng, OpeningPeriod, TravelMode, Weekday } from '../core/types';
import { round2 } from '../core/util';
import { estimateTravel, travelCost } from './travel';
import type { PlaceDetails, PlacePrediction, PlaceSummary, PlacesProvider, TravelEstimate } from './types';

export const PLACES_BASE = 'https://places.googleapis.com/v1';
export const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
export const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export const SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.types,places.primaryType,places.location,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus,places.currentOpeningHours.periods,places.regularOpeningHours.periods';
export const DETAILS_FIELD_MASK =
  'id,displayName,formattedAddress,types,primaryType,location,rating,userRatingCount,priceLevel,businessStatus,currentOpeningHours.periods,regularOpeningHours.periods,editorialSummary,reviews,internationalPhoneNumber,websiteUri,photos';
export const ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters';

export class PlacesError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryable: boolean;
  constructor(message: string, status: number, endpoint: string) {
    super(redact(message));
    this.name = 'PlacesError';
    this.status = status;
    this.endpoint = endpoint;
    this.retryable = status === 429 || status >= 500;
  }
}

/** Strip anything that looks like an API key from a message. */
export function redact(s: string): string {
  return s.replace(/key=[^&\s"']+/gi, 'key=REDACTED').replace(/AIza[0-9A-Za-z_-]{20,}/g, 'REDACTED');
}

export interface GoogleProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** retries on 429/5xx (default 3) */
  retries?: number;
  /** base backoff in ms (default 400) */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  languageCode?: string;
  regionCode?: string;
  /** ISO timestamp source for `fetchedAt` (injectable; defaults to wall clock) */
  nowIso?: () => string;
  /** optional hook for request logging (never receives the key) */
  onRequest?: (info: { endpoint: string; method: string; attempt: number }) => void;
  /** default gas price / mpg for cost estimates */
  gasPrice?: number;
  mpg?: number;
}

// ---------------------------------------------------------------------------
// Raw Google shapes (only what we read)
// ---------------------------------------------------------------------------
interface RawTimePoint {
  day?: number;
  hour?: number;
  minute?: number;
}
interface RawPeriod {
  open?: RawTimePoint;
  close?: RawTimePoint;
}
interface RawReview {
  rating?: number;
  text?: { text?: string; languageCode?: string };
  originalText?: { text?: string };
  relativePublishTimeDescription?: string;
}
export interface RawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  types?: string[];
  primaryType?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: { periods?: RawPeriod[] };
  currentOpeningHours?: { periods?: RawPeriod[] };
  editorialSummary?: { text?: string };
  reviews?: RawReview[];
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  photos?: { name?: string }[];
}

// ---------------------------------------------------------------------------
// Mapping helpers (exported for tests)
// ---------------------------------------------------------------------------
const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export function mapPriceLevel(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = PRICE_LEVELS[s];
  return v === undefined ? undefined : v;
}

/** Google periods → OpeningPeriod[] (minutes since midnight; close may exceed 1440). */
export function mapPeriods(periods: RawPeriod[] | undefined): OpeningPeriod[] | undefined {
  if (!periods || periods.length === 0) return undefined;
  const out: OpeningPeriod[] = [];
  // 24/7 is represented as a single period opening Sunday 00:00 with no close.
  const allDay = periods.find((p) => p.open && !p.close);
  if (allDay && periods.length === 1) {
    for (let d = 0; d < 7; d++) out.push({ day: d as Weekday, open: 0, close: 1440 });
    return out;
  }
  for (const p of periods) {
    if (!p.open || typeof p.open.day !== 'number') continue;
    const day = (((p.open.day % 7) + 7) % 7) as Weekday;
    const open = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    let close = 1440;
    if (p.close && typeof p.close.day === 'number') {
      close = (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0);
      const dayDiff = (p.close.day - day + 7) % 7;
      if (dayDiff > 0) close += 1440 * Math.min(dayDiff, 1);
      else if (close <= open) close += 1440;
    }
    out.push({ day, open, close });
  }
  out.sort((a, b) => a.day - b.day || a.open - b.open);
  return out.length ? out : undefined;
}

const THEME_PATTERNS: [string, RegExp][] = [
  ['friendly staff', /\b(friendly|welcoming|kind|helpful|sweet|attentive|warm)\b/i],
  ['rude staff', /\b(rude|unfriendly|ignored|dismissive|snarky|attitude)\b/i],
  ['slow service', /\b(slow|took forever|forever|long wait|waited (?:an|a) (?:hour|while)|understaffed)\b/i],
  ['fast service', /\b(quick|fast|prompt|speedy|in and out)\b/i],
  ['clean', /\b(clean|spotless|tidy|well[- ]kept|immaculate)\b/i],
  ['dirty', /\b(dirty|gross|filthy|sticky|smell(?:s|ed|y)?|run[- ]down)\b/i],
  ['pricey', /\b(pricey|expensive|overpriced|steep|\$\$\$)\b/i],
  ['good value', /\b(cheap|affordable|value|reasonable|bargain|deal)\b/i],
  ['cozy', /\b(cozy|cosy|intimate|homey|charming|warm vibe)\b/i],
  ['loud', /\b(loud|noisy|deafening|blaring)\b/i],
  ['quiet', /\b(quiet|peaceful|calm|serene|chill)\b/i],
  ['crowded', /\b(crowded|packed|busy|slammed|line out the door|no seats?)\b/i],
  ['long lines', /\b(lines?|queue|wait(?:ed|ing)? in line)\b/i],
  ['great coffee', /\b(coffee|espresso|latte|cold brew)\b/i],
  ['great food', /\b(delicious|tasty|yummy|flavorful|best (?:tacos|burger|bbq|brisket|pizza|ramen|sushi)|amazing food|great food|incredible)\b/i],
  ['good drinks', /\b(cocktails?|drinks?|beer selection|margaritas?|wine list|happy hour)\b/i],
  ['patio', /\b(patio|outdoor seating|outside seating|deck|rooftop)\b/i],
  ['family friendly', /\b(kids?|family|children|stroller|toddler)\b/i],
  ['dog friendly', /\b(dogs?|pup|puppy)\b/i],
  ['great views', /\b(views?|scenery|skyline|sunset)\b/i],
  ['live music', /\b(live music|band|dj|musicians?)\b/i],
  ['well stocked', /\b(selection|variety|stocked|everything you need|huge inventory)\b/i],
  ['parking hassle', /\b(parking)\b/i],
  ['dated', /\b(dated|outdated|old|needs (?:an )?update|worn)\b/i],
  ['late night', /\b(late night|open late|after midnight|2 ?am)\b/i],
  ['knowledgeable staff', /\b(knowledgeable|expert|professional|know their stuff)\b/i],
  ['good for studying', /\b(study|wifi|wi-fi|laptop|outlets?)\b/i],
  ['date night', /\b(date night|romantic|anniversary)\b/i],
  ['hidden gem', /\b(hidden gem|local favorite|underrated)\b/i],
  ['long waits', /\b(wait(?:ed|ing)? (?:\d+|an hour|hours|forever)|appointment (?:took|was) forever)\b/i],
];

/** Derive short review themes by keyword frequency across review texts. */
export function extractThemes(texts: string[], max = 6): string[] {
  if (!texts.length) return [];
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const [theme, re] of THEME_PATTERNS) if (re.test(t)) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

export function trimSnippet(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

function mapBusinessStatus(s: string | undefined): GooglePlaceData['businessStatus'] {
  if (s === 'OPERATIONAL' || s === 'CLOSED_TEMPORARILY' || s === 'CLOSED_PERMANENTLY') return s;
  return undefined;
}

/** Raw Places API (New) place → GooglePlaceData. */
export function mapPlace(raw: RawPlace, fetchedAt?: string): GooglePlaceData {
  const reviewTexts = (raw.reviews ?? []).map((r) => r.text?.text ?? r.originalText?.text ?? '').filter((t) => t.trim().length > 0);
  const snippets = reviewTexts.slice(0, 4).map((t) => trimSnippet(t, 160));
  const themes = extractThemes(reviewTexts);
  const data: GooglePlaceData = {
    placeId: raw.id ?? '',
    displayName: raw.displayName?.text ?? '',
    formattedAddress: raw.formattedAddress,
    types: raw.types ?? [],
    primaryType: raw.primaryType,
    location: { lat: raw.location?.latitude ?? 0, lng: raw.location?.longitude ?? 0 },
    rating: typeof raw.rating === 'number' ? raw.rating : undefined,
    userRatingCount: typeof raw.userRatingCount === 'number' ? raw.userRatingCount : undefined,
    priceLevel: mapPriceLevel(raw.priceLevel),
    openingPeriods: mapPeriods(raw.regularOpeningHours?.periods ?? raw.currentOpeningHours?.periods),
    phone: raw.internationalPhoneNumber ?? raw.nationalPhoneNumber,
    website: raw.websiteUri,
    editorialSummary: raw.editorialSummary?.text,
    reviewSnippets: snippets.length ? snippets : undefined,
    reviewThemes: themes.length ? themes : undefined,
    photoRef: raw.photos?.[0]?.name,
    businessStatus: mapBusinessStatus(raw.businessStatus),
    fetchedAt,
  };
  // drop undefined keys so cached JSON stays compact
  for (const k of Object.keys(data) as (keyof GooglePlaceData)[]) if (data[k] === undefined) delete data[k];
  return data;
}

const TRAVEL_MODE_TO_ROUTES: Partial<Record<TravelMode, 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT'>> = {
  walk: 'WALK',
  bike: 'BICYCLE',
  scooter: 'BICYCLE',
  drive: 'DRIVE',
  rideshare: 'DRIVE',
  taxi: 'DRIVE',
  carpool: 'DRIVE',
  transit: 'TRANSIT',
};

function parseDurationSeconds(d: unknown): number | undefined {
  if (typeof d === 'string') {
    const m = /^(\d+(?:\.\d+)?)s$/.exec(d);
    if (m) return Number(m[1]);
  }
  if (d && typeof d === 'object' && 'seconds' in d) return Number((d as { seconds: unknown }).seconds);
  return undefined;
}

function hourFromIso(iso?: string): number | undefined {
  if (!iso) return undefined;
  const m = /T(\d{2}):/.exec(iso);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export class GooglePlacesProvider implements PlacesProvider {
  readonly id = 'google' as const;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly languageCode: string;
  private readonly regionCode: string;
  private readonly nowIso: () => string;
  private readonly onRequest?: GoogleProviderOptions['onRequest'];
  private readonly gasPrice?: number;
  private readonly mpg?: number;

  constructor(opts: GoogleProviderOptions) {
    if (!opts.apiKey) throw new Error('GooglePlacesProvider requires an apiKey');
    this.apiKey = opts.apiKey;
    const f = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) throw new Error('No fetch implementation available');
    this.fetchImpl = f;
    this.retries = opts.retries ?? 3;
    this.backoffMs = opts.backoffMs ?? 400;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.languageCode = opts.languageCode ?? 'en';
    this.regionCode = opts.regionCode ?? 'US';
    this.nowIso = opts.nowIso ?? (() => new Date().toISOString());
    this.onRequest = opts.onRequest;
    this.gasPrice = opts.gasPrice;
    this.mpg = opts.mpg;
  }

  // ---- transport -----------------------------------------------------------
  private async request<T>(endpoint: string, url: string, init: RequestInit): Promise<T> {
    let attempt = 0;
    for (;;) {
      this.onRequest?.({ endpoint, method: init.method ?? 'GET', attempt });
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (e) {
        if (attempt < this.retries) {
          await this.sleep(this.backoffMs * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new PlacesError(`${endpoint}: network error: ${(e as Error).message}`, 0, endpoint);
      }
      if (res.ok) {
        const text = await res.text();
        if (!text.trim()) return {} as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new PlacesError(`${endpoint}: invalid JSON response`, res.status, endpoint);
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.retries) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs * 2 ** attempt;
        await this.sleep(wait);
        attempt++;
        continue;
      }
      let message = `${endpoint}: HTTP ${res.status}`;
      try {
        const body = await res.text();
        const parsed = JSON.parse(body) as { error?: { message?: string; status?: string }; error_message?: string; status?: string };
        const m = parsed.error?.message ?? parsed.error_message ?? parsed.status;
        if (m) message += ` – ${m}`;
      } catch {
        // ignore body parse errors
      }
      throw new PlacesError(message, res.status, endpoint);
    }
  }

  private placesPost<T>(endpoint: string, path: string, body: unknown, fieldMask?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey };
    if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
    return this.request<T>(endpoint, `${PLACES_BASE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  // ---- PlacesProvider --------------------------------------------------------
  async searchNearby(center: LatLng, radiusM: number, includedTypes: string[], maxResults = 20): Promise<PlaceSummary[]> {
    const body = {
      includedTypes: includedTypes.slice(0, 50),
      maxResultCount: Math.min(20, Math.max(1, Math.round(maxResults))),
      locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50000, Math.max(1, radiusM)) } },
      rankPreference: 'POPULARITY',
      languageCode: this.languageCode,
      regionCode: this.regionCode,
    };
    const res = await this.placesPost<{ places?: RawPlace[] }>('places:searchNearby', 'places:searchNearby', body, SEARCH_FIELD_MASK);
    const at = this.nowIso();
    return (res.places ?? []).map((p) => mapPlace(p, at)).filter((p) => p.placeId);
  }

  async searchText(query: string, center: LatLng, radiusM: number, maxResults = 20): Promise<PlaceSummary[]> {
    const body = {
      textQuery: query,
      locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: Math.min(50000, Math.max(1, radiusM)) } },
      maxResultCount: Math.min(20, Math.max(1, Math.round(maxResults))),
      languageCode: this.languageCode,
      regionCode: this.regionCode,
    };
    const res = await this.placesPost<{ places?: RawPlace[] }>('places:searchText', 'places:searchText', body, SEARCH_FIELD_MASK);
    const at = this.nowIso();
    return (res.places ?? []).map((p) => mapPlace(p, at)).filter((p) => p.placeId);
  }

  async details(placeId: string): Promise<PlaceDetails> {
    const id = placeId.startsWith('places/') ? placeId.slice(7) : placeId;
    const res = await this.request<RawPlace>('places:get', `${PLACES_BASE}/places/${encodeURIComponent(id)}?languageCode=${this.languageCode}&regionCode=${this.regionCode}`, {
      method: 'GET',
      headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
    });
    const data = mapPlace(res, this.nowIso());
    if (!data.placeId) data.placeId = id;
    return data;
  }

  async autocomplete(input: string, center?: LatLng): Promise<PlacePrediction[]> {
    if (!input.trim()) return [];
    const body: Record<string, unknown> = { input, languageCode: this.languageCode, regionCode: this.regionCode };
    if (center) body.locationBias = { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: 50000 } };
    const res = await this.placesPost<{
      suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }; types?: string[] } }[];
    }>('places:autocomplete', 'places:autocomplete', body);
    const out: PlacePrediction[] = [];
    for (const s of res.suggestions ?? []) {
      const p = s.placePrediction;
      if (!p?.placeId) continue;
      out.push({
        placeId: p.placeId,
        text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text,
        types: p.types ?? [],
      });
    }
    return out;
  }

  private parseGeocode(res: { status?: string; results?: GeocodeResult[]; error_message?: string }, endpoint: string) {
    if (res.status === 'ZERO_RESULTS' || !res.results?.length) return undefined;
    if (res.status && res.status !== 'OK') throw new PlacesError(`${endpoint}: ${res.status}${res.error_message ? ' – ' + res.error_message : ''}`, 400, endpoint);
    const r = res.results[0];
    const comp = (type: string, short = false) => {
      const c = r.address_components?.find((x) => x.types?.includes(type));
      return c ? (short ? c.short_name : c.long_name) : undefined;
    };
    const city = comp('locality') ?? comp('postal_town') ?? comp('sublocality') ?? comp('administrative_area_level_2');
    return {
      location: { lat: r.geometry?.location?.lat ?? 0, lng: r.geometry?.location?.lng ?? 0 },
      formatted: r.formatted_address ?? '',
      city,
      state: comp('administrative_area_level_1'),
      stateCode: comp('administrative_area_level_1', true),
    };
  }

  async geocode(address: string): Promise<{ location: LatLng; formatted: string; city?: string; state?: string; stateCode?: string } | undefined> {
    if (!address.trim()) return undefined;
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&region=${this.regionCode.toLowerCase()}&language=${this.languageCode}&key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.request<{ status?: string; results?: GeocodeResult[]; error_message?: string }>('geocode', url, { method: 'GET' });
    return this.parseGeocode(res, 'geocode');
  }

  async reverseGeocode(location: LatLng): Promise<{ formatted: string; city?: string; state?: string; stateCode?: string } | undefined> {
    const url = `${GEOCODE_URL}?latlng=${location.lat},${location.lng}&result_type=locality|administrative_area_level_1&language=${this.languageCode}&key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.request<{ status?: string; results?: GeocodeResult[]; error_message?: string }>('reverseGeocode', url, { method: 'GET' });
    const g = this.parseGeocode(res, 'reverseGeocode');
    if (!g) return undefined;
    return { formatted: g.formatted, city: g.city, state: g.state, stateCode: g.stateCode };
  }

  async travel(from: LatLng, to: LatLng, mode: TravelMode, departAtIso?: string): Promise<TravelEstimate> {
    const routesMode = TRAVEL_MODE_TO_ROUTES[mode];
    const hour = hourFromIso(departAtIso);
    const costOpts = { hour, gasPrice: this.gasPrice, mpg: this.mpg };
    if (!routesMode) return estimateTravel(from, to, mode, costOpts);
    const body: Record<string, unknown> = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode: routesMode,
      languageCode: this.languageCode,
      units: 'IMPERIAL',
    };
    // departureTime must be in the future for TRAFFIC_AWARE; sim time may be in the past, so we omit it.
    if (routesMode === 'DRIVE') body.routingPreference = 'TRAFFIC_AWARE';
    try {
      const res = await this.request<{ routes?: { duration?: unknown; distanceMeters?: number }[] }>('routes', ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': ROUTES_FIELD_MASK },
        body: JSON.stringify(body),
      });
      const r = res.routes?.[0];
      const secs = parseDurationSeconds(r?.duration);
      if (!r || secs === undefined || typeof r.distanceMeters !== 'number') return estimateTravel(from, to, mode, costOpts);
      let minutes = Math.max(1, Math.round(secs / 60));
      // waiting/parking overhead the router doesn't model
      if (mode === 'rideshare') minutes += 5;
      else if (mode === 'taxi') minutes += 6;
      else if (mode === 'drive') minutes += 3;
      else if (mode === 'carpool') minutes += 4;
      const distanceKm = round2(r.distanceMeters / 1000);
      return { mode, minutes, distanceKm, cost: travelCost(mode, distanceKm, minutes, costOpts), source: 'routes_api' };
    } catch (e) {
      if (e instanceof PlacesError && !e.retryable && e.status !== 0 && e.status !== 400 && e.status !== 404) throw e;
      return estimateTravel(from, to, mode, costOpts);
    }
  }
}

interface GeocodeResult {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: { long_name: string; short_name: string; types?: string[] }[];
}
