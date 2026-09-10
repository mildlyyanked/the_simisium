/**
 * Travel-time & cost estimation. Pure: haversine × urban detour factor × mode speed, plus per-mode
 * overhead (parking, waiting for a bus), traffic by hour of day and weather penalties. Costs use
 * present-day US pricing (gas from price/mpg, $2.50 transit, rideshare base + per-km + per-minute + surge).
 *
 * `routedTravel` prefers the provider's Routes API result and falls back to the estimate.
 */
import type { LatLng, Region, TravelMode, WeatherCondition } from '../core/types';
import { haversineKm, round2 } from '../core/util';
import type { PlacesProvider, TravelEstimate } from './types';

export interface TravelOpts {
  region?: Region;
  /** local hour 0..23 of departure (traffic) */
  hour?: number;
  weatherCondition?: WeatherCondition;
  /** $/gallon, default 3.4 */
  gasPrice?: number;
  /** vehicle mpg, default 28 */
  mpg?: number;
}

/** Route length ÷ straight-line distance, per mode. */
export const DETOUR_FACTOR: Record<TravelMode, number> = {
  walk: 1.2,
  bike: 1.25,
  drive: 1.3,
  transit: 1.4,
  rideshare: 1.3,
  taxi: 1.3,
  carpool: 1.3,
  scooter: 1.25,
  fly: 1.05,
};

/** Fixed minutes added regardless of distance (unlocking, parking, waiting…). */
export const MODE_OVERHEAD_MIN: Record<TravelMode, number> = {
  walk: 0,
  bike: 2,
  drive: 3,
  transit: 8,
  rideshare: 5,
  taxi: 6,
  carpool: 4,
  scooter: 2,
  fly: 150,
};

/** Base cruising speed in km/h. Driving speed grows with trip length (highway share). */
export function modeSpeedKmh(mode: TravelMode, routeKm: number, region?: Region): number {
  const density = region?.density ?? 'urban';
  const densityMul = density === 'urban' ? 0.9 : density === 'suburban' ? 1.0 : 1.25;
  switch (mode) {
    case 'walk':
      return 5.0;
    case 'bike':
      return 15;
    case 'scooter':
      return 14;
    case 'transit': {
      const q = region?.transitQuality ?? 0.5;
      return 18 + 10 * q; // 18..28 km/h incl. stops
    }
    case 'fly':
      return 800;
    case 'drive':
    case 'rideshare':
    case 'taxi':
    case 'carpool': {
      const base = 30 + Math.min(45, routeKm * 1.5); // 30 km/h short hops → 75 km/h long trips
      return base * densityMul;
    }
    default:
      return 30;
  }
}

/** Traffic multiplier on travel *time* by local hour (driving modes only). */
export function trafficMultiplier(hour: number | undefined, region?: Region): number {
  if (hour === undefined) return 1;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const density = region?.density ?? 'urban';
  const rushScale = density === 'urban' ? 1 : density === 'suburban' ? 0.7 : 0.35;
  let m = 1;
  if (h >= 7 && h < 9) m = 1.35;
  else if (h >= 16 && h < 19) m = 1.4;
  else if (h >= 9 && h < 16) m = 1.1;
  else if (h >= 19 && h < 22) m = 1.05;
  else m = 0.9;
  return 1 + (m - 1) * rushScale;
}

/** Weather multiplier on travel time per mode. */
export function weatherMultiplier(mode: TravelMode, w?: WeatherCondition): number {
  if (!w) return 1;
  const wheels = mode === 'drive' || mode === 'rideshare' || mode === 'taxi' || mode === 'carpool';
  const exposed = mode === 'walk' || mode === 'bike' || mode === 'scooter';
  switch (w) {
    case 'rain':
      return wheels ? 1.15 : exposed ? 1.15 : mode === 'transit' ? 1.1 : 1;
    case 'heavy_rain':
    case 'thunderstorm':
      return wheels ? 1.3 : exposed ? 1.35 : mode === 'transit' ? 1.2 : 1;
    case 'snow':
    case 'sleet':
      return wheels ? 1.5 : exposed ? 1.5 : mode === 'transit' ? 1.3 : mode === 'fly' ? 1.5 : 1;
    case 'fog':
      return wheels ? 1.15 : 1.05;
    case 'windy':
      return exposed ? 1.1 : 1;
    case 'heat_wave':
      return exposed ? 1.1 : 1;
    case 'hurricane':
    case 'tornado_watch':
      return 3;
    case 'smoke':
      return exposed ? 1.15 : 1;
    default:
      return 1;
  }
}

/** Surge multiplier for rideshare/taxi fares (night, bad weather, rush). */
export function surgeMultiplier(hour?: number, w?: WeatherCondition): number {
  let s = 1;
  if (hour !== undefined) {
    const h = ((Math.floor(hour) % 24) + 24) % 24;
    if (h >= 22 || h < 4) s *= 1.4;
    else if ((h >= 7 && h < 9) || (h >= 16 && h < 19)) s *= 1.2;
  }
  if (w === 'rain' || w === 'fog' || w === 'windy') s *= 1.3;
  else if (w === 'heavy_rain' || w === 'thunderstorm' || w === 'snow' || w === 'sleet') s *= 1.6;
  else if (w === 'hurricane' || w === 'tornado_watch') s *= 2.5;
  return s;
}

/** Dollar cost of a trip given its route length and duration. Shared by estimate and Routes-API paths. */
export function travelCost(mode: TravelMode, distanceKm: number, minutes: number, opts: TravelOpts = {}): number {
  const gasPrice = opts.gasPrice ?? 3.4;
  const mpg = Math.max(8, opts.mpg ?? 28);
  const miles = distanceKm * 0.621371;
  const gas = (miles / mpg) * gasPrice;
  switch (mode) {
    case 'walk':
    case 'bike':
      return 0;
    case 'drive':
      return round2(gas);
    case 'carpool':
      return round2(gas / 2);
    case 'transit':
      return distanceKm <= 0.05 ? 0 : 2.5;
    case 'rideshare': {
      const fare = (3.5 + 1.8 * distanceKm + 0.35 * minutes) * surgeMultiplier(opts.hour, opts.weatherCondition);
      return round2(Math.max(8, fare));
    }
    case 'taxi': {
      const fare = (3.5 + 2.2 * distanceKm + 0.45 * minutes) * Math.min(1.3, surgeMultiplier(opts.hour, opts.weatherCondition));
      return round2(Math.max(9, fare));
    }
    case 'scooter':
      return round2(1 + 0.39 * minutes);
    case 'fly':
      return round2(89 + 0.12 * distanceKm);
    default:
      return 0;
  }
}

/**
 * Pure travel estimate. Walking 1 km ≈ 14 min; driving 10 km across town ≈ 20 min off-peak.
 */
export function estimateTravel(from: LatLng, to: LatLng, mode: TravelMode, opts: TravelOpts = {}): TravelEstimate {
  const straightKm = haversineKm(from, to);
  const routeKm = straightKm * (DETOUR_FACTOR[mode] ?? 1.3);
  const speed = modeSpeedKmh(mode, routeKm, opts.region);
  const isDriving = mode === 'drive' || mode === 'rideshare' || mode === 'taxi' || mode === 'carpool';
  const traffic = isDriving ? trafficMultiplier(opts.hour, opts.region) : mode === 'transit' ? 1 + (trafficMultiplier(opts.hour, opts.region) - 1) * 0.5 : 1;
  const weather = weatherMultiplier(mode, opts.weatherCondition);
  let overhead = MODE_OVERHEAD_MIN[mode] ?? 0;
  if (mode === 'transit') {
    const q = opts.region?.transitQuality ?? 0.5;
    overhead = 6 + (1 - q) * 14; // 6..20 min average wait
  }
  const moving = (routeKm / speed) * 60 * traffic * weather;
  const minutes = straightKm < 0.02 ? 0 : Math.max(1, Math.round(moving + overhead));
  const distanceKm = round2(routeKm);
  return {
    mode,
    minutes,
    distanceKm,
    cost: travelCost(mode, distanceKm, minutes, opts),
    source: 'estimate',
  };
}

/**
 * Prefer the provider's Routes API result; fall back to the pure estimate on any error.
 * The provider is expected to already compute cost; we still re-derive it from the returned distance/minutes
 * when it reports zero for a paid mode, so the caller always gets a sane fare.
 */
export async function routedTravel(provider: PlacesProvider | undefined, from: LatLng, to: LatLng, mode: TravelMode, opts: TravelOpts & { departAtIso?: string } = {}): Promise<TravelEstimate> {
  if (!provider || mode === 'fly') return estimateTravel(from, to, mode, opts);
  try {
    const r = await provider.travel(from, to, mode, opts.departAtIso);
    if (!r || !Number.isFinite(r.minutes) || !Number.isFinite(r.distanceKm) || r.minutes < 0) return estimateTravel(from, to, mode, opts);
    const cost = r.cost > 0 || mode === 'walk' || mode === 'bike' ? r.cost : travelCost(mode, r.distanceKm, r.minutes, opts);
    return { ...r, cost: round2(cost) };
  } catch {
    return estimateTravel(from, to, mode, opts);
  }
}
