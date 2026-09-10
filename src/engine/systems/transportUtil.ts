/**
 * Pure travel-estimation helpers shared by the transport system and NPC autonomy.
 * No system imports here — only core types/util — so any module may import it.
 */
import { minuteOfDay } from '../core/clock';
import { liquidCash } from '../core/effects';
import type { Sim, TravelMode, Vehicle, VenueId, WorldState } from '../core/types';
import { clamp01, haversineKm, kmToMiles, round2 } from '../core/util';

/** effective urban speeds in km/h */
export const MODE_SPEED_KMH: Record<TravelMode, number> = {
  walk: 5,
  bike: 15,
  drive: 35,
  transit: 20,
  rideshare: 40,
  taxi: 40,
  carpool: 35,
  scooter: 15,
  fly: 800,
};

/** road distance ≈ straight-line × factor */
export const ROAD_FACTOR: Record<TravelMode, number> = {
  walk: 1.2,
  bike: 1.25,
  drive: 1.3,
  transit: 1.35,
  rideshare: 1.3,
  taxi: 1.3,
  carpool: 1.3,
  scooter: 1.25,
  fly: 1,
};

export const TRANSIT_FARE = 2.5;
export const RIDESHARE_BASE = 3.5;
export const RIDESHARE_PER_KM = 1.8;
export const RIDESHARE_MIN_FARE = 8;
export const SCOOTER_UNLOCK = 1;
export const SCOOTER_PER_MIN = 0.39;
export const AVERAGE_MPG = 28;
export const DRIVING_KINDS: readonly Vehicle['kind'][] = ['car', 'truck', 'suv', 'van', 'motorcycle'];
export const CYCLING_KINDS: readonly Vehicle['kind'][] = ['bicycle', 'ebike'];

export interface TravelEstimate {
  minutes: number;
  cost: number;
  distanceKm: number;
}

export function isNight(state: WorldState): boolean {
  const mod = minuteOfDay(state.time.minute);
  return mod >= 22 * 60 || mod < 5 * 60;
}

export function isBadWeather(state: WorldState): boolean {
  const c = state.weather.current.condition;
  return c === 'rain' || c === 'heavy_rain' || c === 'thunderstorm' || c === 'snow' || c === 'sleet' || c === 'hurricane';
}

/** rideshare surge multiplier: nights and bad weather cost more */
export function rideshareSurge(state: WorldState): number {
  let s = 1;
  if (isNight(state)) s *= 1.4;
  if (isBadWeather(state)) s *= 1.3;
  const mod = minuteOfDay(state.time.minute);
  if ((mod >= 7 * 60 && mod < 9 * 60) || (mod >= 16 * 60 + 30 && mod < 18 * 60 + 30)) s *= 1.15; // rush hour
  return round2(s);
}

/** bus/train headway in minutes (12..30) from region transit quality */
export function transitHeadway(state: WorldState): number {
  return Math.round(12 + (1 - clamp01(state.region.transitQuality)) * 18);
}

/** deterministic wait for the next bus, from the clock */
export function transitWaitMinutes(state: WorldState): number {
  const h = transitHeadway(state);
  const w = h - (state.time.minute % h);
  return w <= 0 ? h : w;
}

/** deterministic rideshare pickup wait (4..9 min) from the clock */
export function rideshareWaitMinutes(state: WorldState): number {
  return 4 + (Math.floor(state.time.minute / 3) % 6);
}

export function distanceBetween(state: WorldState, fromVenueId: VenueId, toVenueId: VenueId): number {
  const a = state.venues[fromVenueId];
  const b = state.venues[toVenueId];
  if (!a || !b) return 0;
  return haversineKm(a.location, b.location);
}

/** gallons (or kWh for EVs) a vehicle burns over `km` of road */
export function fuelUnitsForTrip(vehicle: Pick<Vehicle, 'mpg' | 'fuelType' | 'kind'>, km: number): number {
  if (vehicle.fuelType === 'none') return 0;
  const miles = kmToMiles(km);
  if (vehicle.fuelType === 'electric') {
    if (vehicle.kind === 'ebike' || vehicle.kind === 'scooter') return miles * 0.015; // ~0.015 kWh/mile
    return miles * (33.7 / Math.max(60, vehicle.mpg)); // MPGe → kWh/mile
  }
  return miles / Math.max(8, vehicle.mpg);
}

/** dollars of fuel/charge for a trip */
export function fuelCostForTrip(state: WorldState, vehicle: Pick<Vehicle, 'mpg' | 'fuelType' | 'kind'>, km: number): number {
  const units = fuelUnitsForTrip(vehicle, km);
  if (vehicle.fuelType === 'electric') return round2(units * 0.16);
  if (vehicle.fuelType === 'diesel') return round2(units * (state.economy.gasPrice + 0.6));
  return round2(units * state.economy.gasPrice);
}

/**
 * Estimate travel time & cost between two venues for a mode. Deterministic.
 * `opts.vehicle` refines drive cost; `opts.hasBusPass` zeroes the transit fare.
 */
export function estimateTravel(
  state: WorldState,
  fromVenueId: VenueId,
  toVenueId: VenueId,
  mode: TravelMode,
  opts: { vehicle?: Pick<Vehicle, 'mpg' | 'fuelType' | 'kind'>; hasBusPass?: boolean } = {},
): TravelEstimate {
  const straight = distanceBetween(state, fromVenueId, toVenueId);
  if (fromVenueId === toVenueId || straight === 0) return { minutes: 0, cost: 0, distanceKm: 0 };
  const km = straight * ROAD_FACTOR[mode];
  const speed = MODE_SPEED_KMH[mode];
  const moving = (km / speed) * 60;
  let minutes = moving;
  let cost = 0;
  switch (mode) {
    case 'walk':
      break;
    case 'bike':
      minutes += 2; // unlock / lock up
      break;
    case 'scooter':
      minutes += 2;
      cost = SCOOTER_UNLOCK + SCOOTER_PER_MIN * Math.ceil(minutes);
      break;
    case 'drive':
    case 'carpool': {
      minutes += state.region.density === 'urban' ? 5 : state.region.density === 'suburban' ? 2 : 1; // parking
      if (isBadWeather(state)) minutes *= 1.2;
      const v = opts.vehicle ?? { mpg: AVERAGE_MPG, fuelType: 'gas' as const, kind: 'car' as const };
      cost = mode === 'drive' ? fuelCostForTrip(state, v, km) : 0;
      break;
    }
    case 'transit':
      minutes += transitWaitMinutes(state) + 6; // walk to/from stop
      cost = opts.hasBusPass ? 0 : TRANSIT_FARE;
      break;
    case 'rideshare':
    case 'taxi': {
      minutes += rideshareWaitMinutes(state);
      if (isBadWeather(state)) minutes *= 1.15;
      const surge = mode === 'rideshare' ? rideshareSurge(state) : 1.2;
      cost = Math.max(RIDESHARE_MIN_FARE, (RIDESHARE_BASE + RIDESHARE_PER_KM * km) * surge);
      break;
    }
    case 'fly':
      minutes += 150;
      cost = 180 + km * 0.12;
      break;
  }
  return { minutes: Math.max(1, Math.round(minutes)), cost: round2(cost), distanceKm: round2(straight) };
}

/** household vehicles currently parked at `venueId` */
export function vehiclesAt(state: WorldState, sim: Sim, venueId: VenueId): Vehicle[] {
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  if (!hh) return [];
  return hh.vehicleIds.map((id) => state.vehicles[id]).filter((v): v is Vehicle => !!v && v.location.venueId === venueId);
}

export function canDrive(sim: Sim): boolean {
  const st = sim.legal.license.status;
  if (st !== 'valid' && st !== 'permit') return false;
  if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > 0) return false;
  return true;
}

export function driveableVehicle(state: WorldState, sim: Sim, venueId: VenueId): Vehicle | undefined {
  return vehiclesAt(state, sim, venueId).find((v) => DRIVING_KINDS.includes(v.kind) && v.fuel > 3 && v.condition > 5 && !v.issues.includes('repossessed'));
}

export function rideableBike(state: WorldState, sim: Sim, venueId: VenueId): Vehicle | undefined {
  return vehiclesAt(state, sim, venueId).find((v) => CYCLING_KINDS.includes(v.kind) || (v.kind === 'scooter' && v.fuelType === 'electric' && v.fuel > 3));
}

/**
 * Pick the mode a sensible person would use for this trip given what they have on hand.
 * Used by NPC autonomy; never throws.
 */
export function chooseMode(state: WorldState, sim: Sim, fromVenueId: VenueId, toVenueId: VenueId): TravelMode {
  const km = distanceBetween(state, fromVenueId, toVenueId);
  if (km <= 0.35) return 'walk';
  const car = canDrive(sim) ? driveableVehicle(state, sim, fromVenueId) : undefined;
  if (car && (km > 0.8 || isBadWeather(state))) return 'drive';
  const bike = rideableBike(state, sim, fromVenueId);
  if (bike && km <= 12 && !isBadWeather(state)) return 'bike';
  const walkable = km <= 2.5 || (km <= 4 && state.region.walkability > 0.6);
  if (walkable && !isBadWeather(state)) return 'walk';
  if (state.region.transitQuality > 0.15) return 'transit';
  const ride = estimateTravel(state, fromVenueId, toVenueId, 'rideshare');
  if (liquidCash(sim) >= ride.cost + 20) return 'rideshare';
  return 'walk';
}

/** Build a Travel record (does not mutate state). */
export function planTravel(state: WorldState, sim: Sim, toVenueId: VenueId, mode: TravelMode, vehicleId?: Vehicle['id']): Sim['travel'] {
  const from = sim.location.venueId;
  const veh = vehicleId ? state.vehicles[vehicleId] : undefined;
  const est = estimateTravel(state, from, toVenueId, mode, { vehicle: veh, hasBusPass: (sim.inventory.consumables.bus_pass ?? 0) > 0 });
  return { fromVenueId: from, toVenueId, mode, departedAt: state.time.minute, arriveAt: state.time.minute + est.minutes, vehicleId, cost: est.cost };
}
