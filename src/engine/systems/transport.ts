/**
 * Transport system — travel actions between venues (walk/bike/drive/transit/rideshare/scooter),
 * arrivals & discovery, vehicles (fuel, wear, breakdowns, accidents, DUI/speeding checks,
 * registration, insurance), dealerships, refuelling/charging, mechanics and the DMV.
 *
 * Pure estimation helpers live in `transportUtil.ts` (NPC autonomy imports those).
 *
 * Custom effect kinds handled: `transport:refuel {vehicleId?}`, `transport:bus`, `transport:repossess {vehicleId}`,
 * `transport:damage {vehicleId, amount}`, `transport:teleport {venueId}` (debug/story).
 * Scheduled kinds owned: `registration_expiry`, `_tow_arrival`.
 */
import type { GameEvent } from '../core/events';
import { newVehicleId, shortId } from '../core/ids';
import { RNG } from '../core/rng';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, LoanRef, RecurringBill, Requirement, Sim, SimId, TravelMode, Vehicle, VehicleId, Venue, VenueId } from '../core/types';
import { DAY, clamp, clamp100, formatDuration, formatMoney, isFiniteNumber, kmToMiles, round2 } from '../core/util';
import type { VehicleDef } from '../content/types';
import { newsEffects } from './story';
import { isBanned } from './social';
import { CYCLING_KINDS, DRIVING_KINDS, TRANSIT_FARE, canDrive, driveableVehicle, estimateTravel, fuelUnitsForTrip, isBadWeather, isNight, rideableBike, transitWaitMinutes, vehiclesAt } from './transportUtil';

type Ctx = SystemContext;

export const TOW_COST = 120;
export const CAR_WASH_COST = 12;
export const REGISTRATION_FEE = 75;
export const ACCIDENT_DEDUCTIBLE = 500;
export const BICYCLE_PRICE = 350;
export const THRIFT_BICYCLE_PRICE = 120;
export const EV_PUBLIC_KWH = 0.42;
export const EV_HOME_KWH = 0.15;
export const MAX_WALK_KM = 12;

const COLORS = ['white', 'black', 'silver', 'gray', 'blue', 'red', 'dark green', 'beige', 'maroon'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function act(id: string, label: string, category: ActionDef['category'], minutes: number, extra: Partial<ActionDef> = {}): ActionDef {
  return { id, label, category, durationMinutes: minutes, effects: {}, interruptible: true, ...extra };
}
function moneyReq(amount: number): Requirement {
  return { kind: 'money', reason: `Costs ${formatMoney(amount)}`, params: { amount, noCredit: true } };
}
const PHONE_REQ: Requirement = { kind: 'flag', reason: 'Your phone is dead', params: { flag: 'phone_dead', not: true } };
const LICENSE_REQ: Requirement = { kind: 'license', reason: 'No valid license', params: { allowPermit: true } };

function you(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName;
}
function vname(v: Vehicle): string {
  return `${v.year} ${v.make} ${v.model}`;
}
function notify(ctx: Ctx, sim: Sim, title: string, body: string, actionId?: string): void {
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app: 'car', title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'car', title, body });
}
function headOfHousehold(ctx: Ctx, hhId: string): Sim | undefined {
  const hh = ctx.state.households[hhId as keyof typeof ctx.state.households];
  if (!hh) return undefined;
  const alive = hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive);
  return ctx.state.sims[alive.find((id) => ctx.query.isControlled(id)) ?? alive[0]];
}
function upsertBill(sim: Sim, bill: Omit<RecurringBill, 'missed'> & { missed?: number }): void {
  const ex = sim.finance.bills.find((b) => b.id === bill.id);
  if (ex) {
    ex.amount = round2(bill.amount);
    ex.name = bill.name;
    return;
  }
  sim.finance.bills.push({ missed: 0, ...bill, amount: round2(bill.amount) });
}
function dropBill(sim: Sim, id: string): void {
  sim.finance.bills = sim.finance.bills.filter((b) => b.id !== id);
  delete sim.flags[`bill_due:${id}`];
  delete sim.flags[`bill_arrears:${id}`];
  delete sim.flags[`bill_paid_month:${id}`];
}

/** charge via the effect pipeline; returns whether the debit landed */
function charge(ctx: Ctx, sim: Sim, amount: number, memo: string, category = 'transport'): boolean {
  if (amount <= 0) return true;
  const before = sim.finance.transactions.length;
  ctx.applyEffects(sim.id, { money: { amount: -round2(amount), memo, category } }, 'transport');
  return sim.finance.transactions.length > before;
}

function defFor(ctx: Ctx, v: Vehicle): VehicleDef | undefined {
  return ctx.content.vehicles.find((d) => d.make === v.make && d.model === v.model);
}

function reliabilityOf(ctx: Ctx, v: Vehicle): number {
  return defFor(ctx, v)?.reliability ?? 0.8;
}

/** used price from MSRP, age and mileage */
export function usedPrice(def: VehicleDef, year: number, mileage: number, currentYear: number, condition = 85): number {
  const age = Math.max(0, currentYear - year);
  let v = def.basePriceNew;
  if (def.kind === 'bicycle' || def.kind === 'ebike' || def.kind === 'scooter') v *= Math.pow(0.8, age);
  else {
    v *= age === 0 ? 1 : 0.8 * Math.pow(0.9, age - 1);
    v *= Math.max(0.35, 1 - mileage / 400000);
  }
  v *= 0.7 + 0.3 * (condition / 100);
  v *= 0.85 + 0.3 * def.reliability;
  return Math.max(def.kind === 'bicycle' ? 40 : 600, Math.round(v / 50) * 50);
}

function makeVehicle(ctx: Ctx, def: VehicleDef, year: number, mileage: number, condition: number, value: number, venueId: VenueId, hhId?: string): Vehicle {
  const isEv = def.fuelType === 'electric';
  const twoWheels = def.kind === 'bicycle' || def.kind === 'ebike' || def.kind === 'scooter';
  const v: Vehicle = {
    id: newVehicleId(ctx.rng),
    kind: def.kind,
    make: def.make,
    model: def.model,
    year,
    color: ctx.rng.pick(COLORS),
    ownerHouseholdId: hhId as Vehicle['ownerHouseholdId'],
    value,
    mileage,
    fuel: def.fuelType === 'none' ? 100 : isEv ? 80 : 45,
    fuelType: def.fuelType,
    tankGallons: def.tankGallons,
    mpg: def.mpg,
    condition,
    registrationExpiresAt: twoWheels ? undefined : ctx.state.time.minute + 365 * DAY,
    insurance: twoWheels ? undefined : { provider: 'GEICO', monthly: round2(def.insuranceMonthly * ctx.state.region.costOfLiving * (value > 20000 ? 1.2 : 1)), active: true, coverage: value > 12000 ? 'full' : 'liability' },
    location: { venueId },
    seats: def.seats,
    issues: [],
    parkedIllegally: false,
  };
  return v;
}

interface Lot {
  def: VehicleDef;
  year: number;
  mileage: number;
  condition: number;
  price: number;
}

/** 6 deterministic vehicles on a dealer lot this month */
export function dealerLot(ctx: Ctx, venue: Venue): Lot[] {
  const c = ctx.clock.day;
  const rng = new RNG(`lot:${venue.id}:${c.year}-${c.month}`);
  const defs = ctx.content.vehicles.filter((d) => d.kind !== 'bicycle' && d.kind !== 'ebike' && (d.kind !== 'scooter' || d.fuelType === 'gas'));
  if (!defs.length) return [];
  const out: Lot[] = [];
  for (const def of rng.pickN(defs, Math.min(6, defs.length))) {
    const [y0, y1] = def.years;
    const maxYear = Math.min(y1, c.year);
    const minYear = Math.max(y0, maxYear - 12);
    const year = rng.int(minYear, maxYear);
    const age = c.year - year;
    const mileage = age === 0 ? rng.int(5, 40) : Math.round(age * rng.range(8000, 15000));
    const condition = clamp100(Math.round(100 - age * rng.range(2, 5)));
    const price = Math.round(usedPrice(def, year, mileage, c.year, condition) * (1 + 0.4 * (venue.priceMultiplier - 1)) * ctx.state.region.costOfLiving);
    out.push({ def, year, mileage, condition, price });
  }
  return out;
}

function lotLabel(l: Lot): string {
  return `${l.year} ${l.def.make} ${l.def.model} · ${l.mileage.toLocaleString('en-US')} mi · ${l.def.fuelType === 'electric' ? `${l.def.mpg} MPGe` : `${l.def.mpg} mpg`}`;
}

function autoLoanApr(score: number): number {
  if (score >= 780) return 0.055;
  if (score >= 720) return 0.069;
  if (score >= 660) return 0.089;
  if (score >= 600) return 0.129;
  return 0.189;
}

function pmt(principal: number, apr: number, n: number): number {
  const r = apr / 12;
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

function addVehicleToHousehold(ctx: Ctx, sim: Sim, v: Vehicle): void {
  const hh = ctx.query.householdOf(sim.id);
  ctx.state.vehicles[v.id] = v;
  if (hh) {
    hh.vehicleIds.push(v.id);
    v.ownerHouseholdId = hh.id;
    if (v.insurance) {
      const head = headOfHousehold(ctx, hh.id) ?? sim;
      upsertBill(head, { id: `veh_ins:${v.id}`, name: `Car insurance — ${v.make} ${v.model}`, amount: v.insurance.monthly, dueDayOfMonth: 22, category: 'insurance', autopay: true, linkedId: v.id });
    }
    if (v.registrationExpiresAt) ctx.schedule({ atMinute: v.registrationExpiresAt, kind: 'registration_expiry', label: `Registration expires: ${v.make} ${v.model}`, simId: sim.id, payload: { vehicleId: v.id } });
    ctx.emit({ type: 'transport:vehicle_purchased', householdId: hh.id, vehicleId: v.id });
  }
}

function removeVehicle(ctx: Ctx, v: Vehicle): void {
  const hh = v.ownerHouseholdId ? ctx.state.households[v.ownerHouseholdId] : undefined;
  if (hh) {
    hh.vehicleIds = hh.vehicleIds.filter((x) => x !== v.id);
    for (const id of hh.simIds) {
      const s = ctx.state.sims[id];
      if (s) dropBill(s, `veh_ins:${v.id}`);
    }
  }
  ctx.state.scheduled = ctx.state.scheduled.filter((e) => e.payload?.vehicleId !== v.id);
  delete ctx.state.vehicles[v.id];
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------
function destinations(ctx: Ctx, sim: Sim): Venue[] {
  const here = sim.location.venueId;
  const out: Venue[] = [];
  const seen = new Set<VenueId>([here]);
  const push = (v?: Venue) => {
    if (v && !seen.has(v.id)) {
      seen.add(v.id);
      out.push(v);
    }
  };
  push(ctx.query.homeOf(sim.id));
  if (sim.career.job?.employerVenueId) push(ctx.state.venues[sim.career.job.employerVenueId]);
  if (sim.career.secondJob?.employerVenueId) push(ctx.state.venues[sim.career.secondJob.employerVenueId]);
  if (sim.education.enrollment?.institutionVenueId) push(ctx.state.venues[sim.education.enrollment.institutionVenueId]);
  for (const id of ctx.state.player.favorites) push(ctx.state.venues[id]);
  for (const v of Object.values(ctx.state.venues)) if (v.discovered) push(v);
  return out;
}

function travelActions(ctx: Ctx, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  if (sim.travel) return out;
  const here = sim.location.venueId;
  const state = ctx.state;
  const car = driveableVehicle(state, sim, here);
  const bike = rideableBike(state, sim, here);
  const hasBusPass = (sim.inventory.consumables.bus_pass ?? 0) > 0;
  const transitOk = state.region.transitQuality > 0.15 && !newsEffects(state).transitDown;
  const scooterOk = state.region.density === 'urban';
  const phoneOk = !sim.flags.phone_dead && sim.phone.plan.active;
  const isChild = sim.lifeStage === 'infant' || sim.lifeStage === 'toddler' || sim.lifeStage === 'child';
  const mkTarget = (v: Venue) => ({ kind: 'venue' as const, id: v.id, name: v.name });
  for (const v of destinations(ctx, sim)) {
    const km = ctx.query.distanceKm(here, v.id);
    if (km <= 0) continue;
    if (isBanned(v, sim.id, state.time.minute)) continue;
    const add = (mode: TravelMode, extra: Partial<ActionDef> = {}) => {
      const est = estimateTravel(state, here, v.id, mode, { vehicle: mode === 'drive' ? car : undefined, hasBusPass });
      const label = `${modeVerb(mode)} to ${v.name} (${formatDuration(est.minutes)}${est.cost ? `, ${formatMoney(est.cost)}` : ''}${mode === 'drive' && est.cost ? ' gas' : ''})`;
      out.push(act(`travel:${v.id}:${mode}`, label, 'travel', est.minutes, { group: 'Go somewhere', target: mkTarget(v), icon: mode, params: { mode, venueId: v.id, distanceKm: est.distanceKm, vehicleId: mode === 'drive' ? car?.id : mode === 'bike' ? bike?.id : undefined }, ...extra }));
    };
    if (km <= MAX_WALK_KM) add('walk', { effects: { perMinute: { energy: -0.05, hygiene: -0.03, fun: 0.02 }, fitness: km > 1 ? 0.2 : 0 } });
    if (bike && km <= 25) add('bike', { effects: { perMinute: { energy: -0.08, hygiene: -0.05, fun: 0.04 }, fitness: km > 1 ? 0.4 : 0 } });
    if (car && !isChild) add('drive', { requirements: [LICENSE_REQ], effects: { skills: { driving: Math.min(30, 4 + km) } } });
    if (transitOk) {
      const est = estimateTravel(state, here, v.id, 'transit', { hasBusPass });
      add('transit', { cost: est.cost > 0 ? { amount: est.cost, memo: 'Transit fare', category: 'transport' } : undefined, requirements: est.cost > 0 ? [moneyReq(est.cost)] : [], effects: { perMinute: { comfort: -0.05, fun: -0.02 } } });
    }
    if (phoneOk && !isChild) {
      const est = estimateTravel(state, here, v.id, 'rideshare');
      add('rideshare', { cost: { amount: est.cost, memo: 'Rideshare', category: 'transport', counterparty: 'Uber' }, requirements: [PHONE_REQ, { kind: 'money', reason: `Fare ${formatMoney(est.cost)}`, params: { amount: est.cost } }], effects: { perMinute: { comfort: 0.02 } } });
      if (scooterOk && km <= 8) {
        const s = estimateTravel(state, here, v.id, 'scooter');
        add('scooter', { cost: { amount: s.cost, memo: 'Scooter rental', category: 'transport', counterparty: 'Lime' }, requirements: [PHONE_REQ, moneyReq(s.cost)], effects: { perMinute: { fun: 0.06, energy: -0.02 } } });
      }
    }
  }
  return out;
}

function modeVerb(mode: TravelMode): string {
  switch (mode) {
    case 'walk':
      return 'Walk';
    case 'bike':
      return 'Bike';
    case 'drive':
      return 'Drive';
    case 'transit':
      return 'Take the bus';
    case 'rideshare':
      return 'Call a ride';
    case 'scooter':
      return 'Rent a scooter';
    default:
      return 'Go';
  }
}

/** all pre-departure rolls for a drive: fuel, breakdown, accident, police. Returns extra minutes and mode override. */
function driveHazards(ctx: Ctx, sim: Sim, v: Vehicle, km: number, to: Venue): { extraMinutes: number; stranded: boolean } {
  const state = ctx.state;
  let extra = 0;
  // fuel
  const units = fuelUnitsForTrip(v, km * 1.3);
  const pct = v.tankGallons > 0 ? (units / v.tankGallons) * 100 : 0;
  if (v.fuelType !== 'none') {
    if (pct > v.fuel) {
      v.fuel = 0;
      v.mileage = Math.round(v.mileage + kmToMiles(km) * (v.fuel / Math.max(1, pct)));
      ctx.emit({ type: 'transport:out_of_fuel', vehicleId: v.id, simId: sim.id });
      ctx.log({ text: `The ${vname(v)} sputters and dies — out of ${v.fuelType === 'electric' ? 'charge' : 'gas'}. ${you(ctx, sim)} ${ctx.query.isControlled(sim.id) ? 'leave' : 'leaves'} it on the shoulder and ${ctx.query.isControlled(sim.id) ? 'walk' : 'walks'} the rest of the way.`, kind: 'travel', simId: sim.id, importance: 2 });
      return { extraMinutes: 20, stranded: true };
    }
    v.fuel = round2(Math.max(0, v.fuel - pct));
  }
  v.mileage = Math.round(v.mileage + kmToMiles(km * 1.3));
  v.condition = clamp100(v.condition - km * 0.01);
  const rel = reliabilityOf(ctx, v);
  // breakdown
  const pBreak = (1 - rel) * 0.012 + (v.condition < 30 ? 0.06 : v.condition < 50 ? 0.02 : 0) + v.issues.length * 0.01;
  if (ctx.rng.chance(pBreak * Math.min(2, 0.5 + km / 10))) {
    const issue = ctx.rng.pick(['dead battery', 'flat tire', 'overheating', 'alternator', 'transmission slipping', 'check engine light']);
    v.issues.push(issue);
    v.condition = clamp100(v.condition - 10);
    ctx.emit({ type: 'transport:breakdown', vehicleId: v.id, simId: sim.id, issue });
    const towed = charge(ctx, sim, TOW_COST, `Tow truck (${issue})`);
    const mech = ctx.query.nearestVenue(to.id, 'mechanic');
    if (towed && mech) {
      v.location = { venueId: mech.id };
      ctx.log({ text: `The ${vname(v)} breaks down (${issue}). A tow truck hauls it to ${mech.name} for ${formatMoney(TOW_COST)}; ${you(ctx, sim).toLowerCase()} finish${ctx.query.isControlled(sim.id) ? '' : 'es'} the trip on foot.`, kind: 'travel', simId: sim.id, importance: 2 });
      if (mech.id !== to.id) mech.discovered = true;
    } else {
      ctx.log({ text: `The ${vname(v)} breaks down (${issue}).${towed ? ` Towed for ${formatMoney(TOW_COST)}.` : " You can't afford a tow; it sits on the shoulder."} ${you(ctx, sim)} walk${ctx.query.isControlled(sim.id) ? '' : 's'} the rest of the way.`, kind: 'travel', simId: sim.id, importance: 2 });
    }
    notify(ctx, sim, 'Breakdown', `${v.make} ${v.model}: ${issue}. Get it repaired at a mechanic.`);
    return { extraMinutes: 45, stranded: true };
  }
  // accident
  const bac = sim.body.bloodAlcohol;
  let pAcc = 0.0015 * Math.max(0.5, km / 8);
  if (isBadWeather(state)) pAcc *= 2;
  if (bac >= 0.08) pAcc *= 6;
  else if (bac >= 0.04) pAcc *= 2;
  if (isNight(state)) pAcc *= 1.3;
  if (sim.needs.energy < 15) pAcc *= 2;
  pAcc *= 1 - 0.04 * (sim.skills.driving?.level ?? 0);
  if (ctx.rng.chance(pAcc)) {
    const severity = ctx.rng.weighted([{ weight: 6, value: 1 }, { weight: 3, value: 2 }, { weight: 1, value: 3 }]);
    const atFault = ctx.rng.chance(bac >= 0.08 ? 0.9 : 0.5);
    v.condition = clamp100(v.condition - severity * 15);
    if (severity >= 3) v.issues.push('collision damage');
    ctx.emit({ type: 'transport:accident', simId: sim.id, vehicleId: v.id, severity, atFault });
    ctx.emit({ type: 'legal:police_called', venueId: to.id, reason: 'traffic accident', simId: sim.id });
    const desc = severity === 1 ? 'a fender-bender' : severity === 2 ? 'a real collision' : 'a serious crash';
    ctx.log({ text: `${you(ctx, sim)} ${ctx.query.isControlled(sim.id) ? 'get' : 'gets'} into ${desc} on the way to ${to.name}${atFault ? ' — your fault' : ''}.`, kind: 'alert', simId: sim.id, importance: severity >= 2 ? 3 : 2 });
    const effects: ActionDef['effects'] = { stress: 10 * severity, moodlets: [{ emotion: 'scared', label: 'Car accident', intensity: -8 * severity, durationMinutes: DAY * severity }] };
    if (severity >= 2) effects.custom = [{ kind: 'health:injury', payload: { name: severity === 3 ? 'whiplash and bruised ribs' : 'whiplash', bodyPart: 'neck', severity } }];
    ctx.applyEffects(sim.id, effects, 'transport:accident');
    if (v.insurance?.active && v.insurance.coverage === 'full') {
      if (charge(ctx, sim, ACCIDENT_DEDUCTIBLE, 'Insurance deductible (accident)', 'insurance')) {
        v.condition = clamp100(v.condition + severity * 12);
        v.issues = v.issues.filter((i) => i !== 'collision damage');
        ctx.log({ text: `Insurance covers the repairs after a ${formatMoney(ACCIDENT_DEDUCTIBLE)} deductible.`, kind: 'money', simId: sim.id, importance: 1 });
      }
      v.insurance.monthly = round2(v.insurance.monthly * (atFault ? 1.25 : 1.05));
    } else if (atFault && v.insurance?.active) {
      v.insurance.monthly = round2(v.insurance.monthly * 1.3);
    }
    if (bac >= 0.08) ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'dui', venueId: to.id, witnessed: true });
    extra += 30 + 15 * severity;
    if (severity >= 3) return { extraMinutes: extra + 60, stranded: true };
  }
  // police
  if (bac >= 0.08 && ctx.rng.chance(0.08)) {
    ctx.emit({ type: 'transport:pulled_over', simId: sim.id, reason: 'swerving' });
    ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'dui', venueId: to.id, witnessed: true });
    extra += 25;
  } else if (ctx.rng.chance(0.015)) {
    ctx.emit({ type: 'transport:pulled_over', simId: sim.id, reason: 'speeding' });
    ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'speeding', venueId: to.id, witnessed: true });
    extra += 15;
  } else if (v.registrationExpiresAt !== undefined && v.registrationExpiresAt < state.time.minute && ctx.rng.chance(0.03)) {
    ctx.emit({ type: 'transport:pulled_over', simId: sim.id, reason: 'expired registration' });
    ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'expired_registration', venueId: to.id, witnessed: true });
    extra += 15;
  }
  // parking
  if (state.region.density === 'urban' && to.archetype !== 'home' && to.archetype !== 'parking' && !ctx.query.findObject(to.id, 'parking_space') && ctx.rng.chance(0.03)) {
    v.parkedIllegally = true;
    ctx.emit({ type: 'legal:crime_committed', simId: sim.id, crimeId: 'parking_violation', venueId: to.id, witnessed: false });
  }
  return { extraMinutes: extra, stranded: false };
}

function executeTravel(ctx: Ctx, sim: Sim, action: ActionDef, params: Record<string, unknown>): { ok: boolean; text?: string; durationMinutes?: number } {
  const [, venueId, modeRaw] = action.id.split(':');
  const to = ctx.state.venues[venueId as VenueId];
  if (!to) return { ok: false, text: 'Unknown destination.' };
  if (sim.travel) return { ok: false, text: 'Already travelling.' };
  let mode = (modeRaw ?? params.mode) as TravelMode;
  const here = sim.location.venueId;
  if (here === to.id) return { ok: false, text: "You're already there." };
  const km = ctx.query.distanceKm(here, to.id);
  const state = ctx.state;
  let vehicle: Vehicle | undefined;
  let extra = 0;
  if (mode === 'drive') {
    vehicle = driveableVehicle(state, sim, here);
    if (!vehicle) return { ok: false, text: 'No drivable vehicle here.' };
    if (!canDrive(sim)) return { ok: false, text: 'No valid license.' };
    const hz = driveHazards(ctx, sim, vehicle, km, to);
    extra += hz.extraMinutes;
    if (hz.stranded) {
      mode = 'walk';
      vehicle = undefined;
    }
  } else if (mode === 'bike') {
    vehicle = rideableBike(state, sim, here);
    if (!vehicle) return { ok: false, text: 'No bike here.' };
    if (vehicle.fuelType === 'electric') vehicle.fuel = round2(Math.max(0, vehicle.fuel - km * 2));
    vehicle.condition = clamp100(vehicle.condition - km * 0.02);
  } else if (mode === 'transit') {
    if (state.region.transitQuality <= 0.15) return { ok: false, text: 'No transit here.' };
    if (ctx.rng.chance(0.04)) {
      extra += transitWaitMinutes(state) + 4;
      ctx.emit({ type: 'transport:missed_bus', simId: sim.id });
      ctx.log({ text: `${you(ctx, sim)} just miss${ctx.query.isControlled(sim.id) ? '' : 'es'} the bus and wait${ctx.query.isControlled(sim.id) ? '' : 's'} for the next one.`, kind: 'travel', simId: sim.id, importance: 0 });
    }
  } else if (mode === 'rideshare' || mode === 'scooter') {
    if (sim.flags.phone_dead) return { ok: false, text: 'Your phone is dead.' };
  }
  const est = estimateTravel(state, here, to.id, mode, { vehicle, hasBusPass: (sim.inventory.consumables.bus_pass ?? 0) > 0 });
  const minutes = Math.max(1, est.minutes + extra);
  const now = state.time.minute;
  sim.travel = { fromVenueId: here, toVenueId: to.id, mode, departedAt: now, arriveAt: now + minutes, vehicleId: vehicle?.id, cost: mode === 'drive' ? est.cost : action.cost?.amount ?? 0 };
  if (vehicle) sim.flags.travel_vehicle = vehicle.id;
  else delete sim.flags.travel_vehicle;
  ctx.emit({ type: 'sim:departed', simId: sim.id, venueId: here });
  ctx.emit({ type: 'transport:departed', simId: sim.id, mode, to: to.id, eta: now + minutes });
  if (ctx.query.isControlled(sim.id)) ctx.log({ text: `${modeVerb(mode).replace('Call a ride', 'You call a ride').replace(/^(Walk|Bike|Drive|Take the bus|Rent a scooter)/, (m) => `You ${m.toLowerCase()}`)} to ${to.name} — about ${formatDuration(minutes)}.`, kind: 'travel', simId: sim.id, importance: 0 });
  return { ok: true, durationMinutes: minutes, text: `On the way to ${to.name}.` };
}

function onArrived(ctx: Ctx, simId: SimId, venueId: VenueId, mode: string): void {
  const sim = ctx.state.sims[simId];
  const venue = ctx.state.venues[venueId];
  if (!sim || !venue) return;
  const vid = sim.flags.travel_vehicle as VehicleId | undefined;
  if (vid) {
    const v = ctx.state.vehicles[vid];
    if (v) v.location = { venueId };
    delete sim.flags.travel_vehicle;
  }
  if (ctx.query.isControlled(simId)) {
    if (!venue.discovered) {
      venue.discovered = true;
      ctx.state.stats.placesVisited += 1;
      ctx.emit({ type: 'venue:discovered', venueId, simId });
    } else if (venue.lastVisited === undefined) ctx.state.stats.placesVisited += 1;
    venue.lastVisited = ctx.state.time.minute;
    ctx.log({ text: `You arrive at ${venue.name}${mode === 'drive' ? ' and park' : mode === 'transit' ? ' and step off the bus' : ''}.`, kind: 'travel', simId, importance: 0, venueId });
  }
}

// ---------------------------------------------------------------------------
// Vehicle daily upkeep
// ---------------------------------------------------------------------------
function dailyVehicles(ctx: Ctx): void {
  const player = ctx.state.households[ctx.state.player.householdId];
  const hhIds = new Set<string>();
  if (player) hhIds.add(player.id);
  for (const s of ctx.query.simulatedSims()) if (s.lod === 'full' && s.householdId) hhIds.add(s.householdId);
  for (const hhId of hhIds) {
    const hh = ctx.state.households[hhId as keyof typeof ctx.state.households];
    if (!hh) continue;
    const head = headOfHousehold(ctx, hh.id);
    for (const vid of hh.vehicleIds) {
      const v = ctx.state.vehicles[vid];
      if (!v) continue;
      v.condition = clamp100(v.condition - 0.03);
      v.value = Math.max(v.kind === 'bicycle' ? 25 : 300, round2(v.value * (1 - 0.00035)));
      if (head && v.insurance?.active) upsertBill(head, { id: `veh_ins:${v.id}`, name: `Car insurance — ${v.make} ${v.model}`, amount: v.insurance.monthly, dueDayOfMonth: 22, category: 'insurance', autopay: true, linkedId: v.id });
      if (head) {
        const bill = head.finance.bills.find((b) => b.id === `veh_ins:${v.id}`);
        if (bill && bill.missed >= 2 && v.insurance?.active) {
          v.insurance.active = false;
          ctx.log({ text: `${v.insurance.provider} cancelled the insurance on the ${vname(v)} for non-payment.`, kind: 'alert', simId: head.id, importance: 2 });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Venue actions (dealer, gas, mechanic, dmv, bikes, wash)
// ---------------------------------------------------------------------------
function venueActions(ctx: Ctx, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const venue = ctx.query.venue(sim.location.venueId);
  const state = ctx.state;
  const hh = ctx.query.householdOf(sim.id);
  const col = state.region.costOfLiving;
  const isChild = sim.lifeStage === 'infant' || sim.lifeStage === 'toddler' || sim.lifeStage === 'child';
  if (isChild) return out;
  const hereVehicles = vehiclesAt(state, sim, venue.id);
  const home = ctx.query.homeOf(sim.id);

  if (venue.archetype === 'car_dealer') {
    const g = 'Dealership';
    dealerLot(ctx, venue).forEach((l, i) => {
      out.push(act(`transport:buy_vehicle:${i}`, `Buy ${lotLabel(l)} — ${formatMoney(l.price, { cents: false })} cash`, 'shop', 90, { group: g, requirements: [moneyReq(l.price)], description: `Condition ${l.condition}/100 · reliability ${(l.def.reliability * 100).toFixed(0)}% · insurance ≈ ${formatMoney(l.def.insuranceMonthly * col)}/mo` }));
      const down = Math.round(l.price * 0.1);
      const apr = autoLoanApr(sim.finance.creditScore);
      out.push(act(`transport:finance_vehicle:${i}`, `Finance ${lotLabel(l)} — ${formatMoney(down, { cents: false })} down, ${formatMoney(pmt(l.price - down, apr, 60))}/mo`, 'shop', 150, { group: g, requirements: [moneyReq(down)], description: `60 months at ${(apr * 100).toFixed(1)}% APR (credit ${sim.finance.creditScore}).`, params: { down } }));
    });
    for (const v of hereVehicles.filter((x) => !CYCLING_KINDS.includes(x.kind))) {
      const offer = Math.round(v.value * 0.6);
      out.push(act(`transport:sell_vehicle:${v.id}`, `Sell the ${vname(v)} to the dealer (${formatMoney(offer, { cents: false })})`, 'finance', 60, { group: g, target: { kind: 'vehicle', id: v.id, name: vname(v) }, params: { offer } }));
      dealerLot(ctx, venue).forEach((l, i) => {
        const tradeIn = Math.round(v.value * 0.7);
        if (l.price > tradeIn) out.push(act(`transport:trade_in:${v.id}:${i}`, `Trade the ${v.make} ${v.model} (${formatMoney(tradeIn, { cents: false })}) for ${l.year} ${l.def.make} ${l.def.model} — pay ${formatMoney(l.price - tradeIn, { cents: false })}`, 'shop', 120, { group: g, requirements: [moneyReq(l.price - tradeIn)], params: { tradeIn } }));
      });
    }
  }
  if (['retail', 'mall', 'thrift_store', 'hardware'].includes(venue.archetype)) {
    const price = round2((venue.archetype === 'thrift_store' ? THRIFT_BICYCLE_PRICE : BICYCLE_PRICE) * venue.priceMultiplier * col);
    out.push(act('transport:buy_bicycle', `Buy a bicycle (${formatMoney(price)})`, 'shop', 30, { group: 'Shop', requirements: [moneyReq(price)], params: { price } }));
  }
  if (venue.archetype === 'gas_station' || ctx.query.findObject(venue.id, 'fuel_pump')) {
    for (const v of hereVehicles.filter((x) => (x.fuelType === 'gas' || x.fuelType === 'diesel' || x.fuelType === 'hybrid') && x.fuel < 98)) {
      const gallons = round2(((100 - v.fuel) / 100) * v.tankGallons);
      const cost = round2(gallons * (state.economy.gasPrice + (v.fuelType === 'diesel' ? 0.6 : 0)) * venue.priceMultiplier);
      out.push(act(`transport:refuel:${v.id}`, `Fill up the ${v.make} ${v.model} (${gallons} gal, ${formatMoney(cost)})`, 'shop', 6, { group: 'Vehicle', target: { kind: 'vehicle', id: v.id, name: vname(v) }, cost: { amount: cost, memo: `Gas — ${v.make} ${v.model}`, category: 'transport', counterparty: venue.name }, requirements: [moneyReq(cost)], params: { gallons } }));
    }
    out.push(...carWashActions(ctx, venue, hereVehicles));
  }
  if (venue.archetype === 'car_wash') out.push(...carWashActions(ctx, venue, hereVehicles));
  const homeCharger = home && venue.id === home.id && ctx.query.findObject(home.id, 'car_charger_home');
  if (venue.archetype === 'ev_charger' || ctx.query.findObject(venue.id, 'ev_charger') || homeCharger) {
    const rate = homeCharger ? EV_HOME_KWH : EV_PUBLIC_KWH;
    for (const v of hereVehicles.filter((x) => x.fuelType === 'electric' && x.fuel < 98)) {
      const kwh = round2(((100 - v.fuel) / 100) * v.tankGallons);
      const cost = round2(kwh * rate);
      const minutes = homeCharger ? Math.round(kwh / 7 * 60) : Math.round(kwh / 50 * 60) + 5;
      out.push(act(`transport:charge:${v.id}`, `Charge the ${v.make} ${v.model} (${kwh} kWh, ${formatMoney(cost)}, ${formatDuration(minutes)})`, 'shop', minutes, { group: 'Vehicle', target: { kind: 'vehicle', id: v.id, name: vname(v) }, cost: cost > 0 ? { amount: cost, memo: `Charging — ${v.make} ${v.model}`, category: 'transport' } : undefined, requirements: cost > 0 ? [moneyReq(cost)] : [] }));
    }
  }
  if (venue.archetype === 'mechanic') {
    for (const v of hereVehicles) {
      if (!v.issues.length && v.condition >= 90) continue;
      const cost = round2((v.issues.length * 180 + Math.max(0, 95 - v.condition) * 9) * col * venue.priceMultiplier);
      if (cost <= 0) continue;
      out.push(act(`transport:repair:${v.id}`, `Repair the ${vname(v)}${v.issues.length ? ` (${v.issues.join(', ')})` : ''} — ${formatMoney(cost)}`, 'shop', 120, { group: 'Mechanic', target: { kind: 'vehicle', id: v.id, name: vname(v) }, cost: { amount: cost, memo: `Repairs — ${v.make} ${v.model}`, category: 'transport', counterparty: venue.name }, requirements: [moneyReq(cost)] }));
    }
    // vehicles left elsewhere (towed / broken at home) can be sent for pickup
    if (hh) for (const vid of hh.vehicleIds) {
      const v = state.vehicles[vid];
      if (!v || v.location.venueId === venue.id || !v.issues.length) continue;
      const cost = round2((TOW_COST + v.issues.length * 180 + Math.max(0, 95 - v.condition) * 9) * col);
      out.push(act(`transport:repair:${v.id}`, `Have the ${vname(v)} towed here and repaired — ${formatMoney(cost)}`, 'shop', 30, { group: 'Mechanic', cost: { amount: cost, memo: `Tow & repairs — ${v.make} ${v.model}`, category: 'transport' }, requirements: [moneyReq(cost)] }));
    }
  }
  if (venue.archetype === 'dmv' && hh) {
    for (const vid of hh.vehicleIds) {
      const v = state.vehicles[vid];
      if (!v || v.registrationExpiresAt === undefined) continue;
      const soon = v.registrationExpiresAt - state.time.minute < 60 * DAY;
      if (!soon) continue;
      const fee = round2(REGISTRATION_FEE * col);
      out.push(act(`transport:renew_registration:${v.id}`, `Renew registration: ${vname(v)} (${formatMoney(fee)})`, 'civic', 45, { group: 'DMV', cost: { amount: fee, memo: `Registration — ${v.make} ${v.model}`, category: 'civic' }, requirements: [moneyReq(fee)] }));
    }
  }
  return out;
}

function carWashActions(ctx: Ctx, venue: Venue, hereVehicles: Vehicle[]): ActionDef[] {
  const cost = round2(CAR_WASH_COST * venue.priceMultiplier);
  return hereVehicles.filter((v) => DRIVING_KINDS.includes(v.kind)).map((v) => act(`transport:wash:${v.id}`, `Get the ${v.make} ${v.model} washed (${formatMoney(cost)})`, 'shop', 20, { group: 'Vehicle', target: { kind: 'vehicle', id: v.id, name: vname(v) }, cost: { amount: cost, memo: 'Car wash', category: 'transport' }, requirements: [moneyReq(cost)], effects: { moodlets: [{ emotion: 'proud', label: 'Clean car', intensity: 3, durationMinutes: 480 }] } }));
}

function executeTransport(ctx: Ctx, sim: Sim, action: ActionDef, params: Record<string, unknown>): { ok: boolean; text?: string; durationMinutes?: number } {
  const parts = action.id.split(':');
  const op = parts[1];
  const target = parts[2];
  const venue = ctx.query.venue(sim.location.venueId);
  const state = ctx.state;
  const c = ctx.clock.day;
  switch (op) {
    case 'buy_vehicle':
    case 'finance_vehicle':
    case 'trade_in': {
      const idx = Number(op === 'trade_in' ? parts[3] : target);
      const lot = dealerLot(ctx, venue)[idx];
      if (!lot) return { ok: false, text: 'That car sold.' };
      let price = lot.price;
      let tradeIn: Vehicle | undefined;
      if (op === 'trade_in') {
        tradeIn = state.vehicles[target as VehicleId];
        if (!tradeIn) return { ok: false, text: 'No trade-in.' };
        price -= Number(params.tradeIn ?? Math.round(tradeIn.value * 0.7));
      }
      let loan: LoanRef | undefined;
      if (op === 'finance_vehicle') {
        const down = Number(params.down ?? Math.round(price * 0.1));
        if (sim.finance.creditScore < 520) return { ok: false, text: `Financing denied: credit score ${sim.finance.creditScore}.` };
        if (!charge(ctx, sim, down, `Down payment — ${lot.def.make} ${lot.def.model}`, 'vehicle')) return { ok: false, text: `You need ${formatMoney(down)} down.` };
        const apr = autoLoanApr(sim.finance.creditScore);
        const principal = round2(price - down);
        loan = { id: shortId(ctx.rng, 'loan'), kind: 'auto', lender: 'Capital One Auto Finance', principal, balance: principal, apr, monthlyPayment: pmt(principal, apr, 60), nextDueAt: state.time.minute + 30 * DAY, missedPayments: 0, termMonths: 60, startedAt: state.time.minute, inDefault: false, deferred: false };
      } else if (!charge(ctx, sim, price, `Vehicle purchase — ${lot.year} ${lot.def.make} ${lot.def.model}`, 'vehicle')) return { ok: false, text: `You need ${formatMoney(price)}.` };
      const v = makeVehicle(ctx, lot.def, lot.year, lot.mileage, lot.condition, lot.price, venue.id, sim.householdId);
      addVehicleToHousehold(ctx, sim, v);
      if (loan) {
        loan.collateralId = v.id;
        sim.finance.loans.push(loan);
      }
      if (tradeIn) removeVehicle(ctx, tradeIn);
      ctx.log({ text: `${you(ctx, sim)} ${ctx.query.isControlled(sim.id) ? 'drive' : 'drives'} off the lot in a ${v.color} ${vname(v)}${loan ? ` (${formatMoney(loan.monthlyPayment)}/month for 60 months)` : ''}.`, kind: 'narrative', simId: sim.id, importance: 3 });
      return { ok: true, text: `It's yours: a ${v.color} ${vname(v)}.${loan ? ` Auto loan ${formatMoney(loan.monthlyPayment)}/month.` : ''} Insurance ≈ ${formatMoney(v.insurance?.monthly ?? 0)}/month.` };
    }
    case 'sell_vehicle': {
      const v = state.vehicles[target as VehicleId];
      if (!v) return { ok: false, text: 'No such vehicle.' };
      const loan = sim.finance.loans.find((l) => l.collateralId === v.id);
      const offer = Number(params.offer ?? Math.round(v.value * 0.6));
      const net = round2(offer - (loan?.balance ?? 0));
      if (net < 0) return { ok: false, text: `You owe ${formatMoney(loan!.balance)} on it; the offer of ${formatMoney(offer)} won't cover the loan.` };
      if (loan) sim.finance.loans = sim.finance.loans.filter((l) => l.id !== loan.id);
      removeVehicle(ctx, v);
      ctx.applyEffects(sim.id, { money: { amount: net, memo: `Sold ${vname(v)}`, category: 'sale', account: 'checking' } }, 'transport:sell');
      return { ok: true, text: `Sold the ${vname(v)} for ${formatMoney(offer)}${loan ? ` (${formatMoney(loan.balance)} went to the loan)` : ''}.` };
    }
    case 'buy_bicycle': {
      const price = Number(params.price ?? BICYCLE_PRICE);
      if (!charge(ctx, sim, price, 'Bicycle', 'vehicle')) return { ok: false, text: `You need ${formatMoney(price)}.` };
      const defs = ctx.content.vehicles.filter((d) => d.kind === 'bicycle');
      const def: VehicleDef = defs.length ? (venue.archetype === 'thrift_store' ? defs[0] : ctx.rng.pick(defs)) : { make: 'Schwinn', model: 'Cruiser', kind: 'bicycle', fuelType: 'none', basePriceNew: 350, mpg: 0, tankGallons: 0, seats: 1, reliability: 0.8, insuranceMonthly: 0, years: [2015, 2026], tags: [] };
      const v = makeVehicle(ctx, def, venue.archetype === 'thrift_store' ? c.year - ctx.rng.int(3, 9) : c.year, 0, venue.archetype === 'thrift_store' ? 60 : 100, price, venue.id, sim.householdId);
      addVehicleToHousehold(ctx, sim, v);
      return { ok: true, text: `A ${v.color} ${def.make} ${def.model}. Wheels!` };
    }
    case 'refuel': {
      const v = state.vehicles[target as VehicleId];
      if (!v) return { ok: false, text: 'No such vehicle.' };
      v.fuel = 100;
      return { ok: true, text: `Tank full.` };
    }
    case 'charge': {
      const v = state.vehicles[target as VehicleId];
      if (!v) return { ok: false, text: 'No such vehicle.' };
      v.fuel = 100;
      return { ok: true, text: `Charged to 100%.` };
    }
    case 'wash': {
      const v = state.vehicles[target as VehicleId];
      if (v) v.condition = clamp100(v.condition + 1);
      return { ok: true, text: 'Shiny.' };
    }
    case 'repair': {
      const v = state.vehicles[target as VehicleId];
      if (!v) return { ok: false, text: 'No such vehicle.' };
      v.issues = [];
      v.condition = clamp100(Math.max(v.condition, 95));
      v.location = { venueId: venue.id };
      return { ok: true, text: `The ${vname(v)} runs like new. Well, newer.` };
    }
    case 'renew_registration': {
      const v = state.vehicles[target as VehicleId];
      if (!v) return { ok: false, text: 'No such vehicle.' };
      v.registrationExpiresAt = Math.max(v.registrationExpiresAt ?? state.time.minute, state.time.minute) + 365 * DAY;
      v.issues = v.issues.filter((i) => i !== 'expired registration');
      state.scheduled = state.scheduled.filter((e) => !(e.kind === 'registration_expiry' && e.payload?.vehicleId === v.id));
      ctx.schedule({ atMinute: v.registrationExpiresAt, kind: 'registration_expiry', label: `Registration expires: ${v.make} ${v.model}`, simId: sim.id, payload: { vehicleId: v.id } });
      return { ok: true, text: `Registration renewed for a year. Only took ${formatDuration(action.durationMinutes)}.` };
    }
    default:
      return { ok: false, text: `Unknown transport action ${op}` };
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const transportSystem: System = {
  id: 'transport',
  intervalMinutes: 5,

  onInit(ctx) {
    for (const hh of Object.values(ctx.state.households)) {
      const head = headOfHousehold(ctx, hh.id);
      for (const vid of hh.vehicleIds) {
        const v = ctx.state.vehicles[vid];
        if (!v) continue;
        if (!v.ownerHouseholdId) v.ownerHouseholdId = hh.id;
        if (v.registrationExpiresAt === undefined && DRIVING_KINDS.includes(v.kind)) v.registrationExpiresAt = ctx.state.time.minute + ctx.rng.int(30, 365) * DAY;
        if (v.registrationExpiresAt !== undefined && !ctx.state.scheduled.some((e) => e.kind === 'registration_expiry' && e.payload?.vehicleId === v.id)) ctx.schedule({ atMinute: v.registrationExpiresAt, kind: 'registration_expiry', label: `Registration expires: ${v.make} ${v.model}`, simId: head?.id, payload: { vehicleId: v.id } });
        if (head && v.insurance?.active) upsertBill(head, { id: `veh_ins:${v.id}`, name: `Car insurance — ${v.make} ${v.model}`, amount: v.insurance.monthly, dueDayOfMonth: 22, category: 'insurance', autopay: true, linkedId: v.id });
      }
    }
  },

  onTick(ctx, dt) {
    // EVs plugged in at a home charger trickle-charge (~10%/hour)
    const hh = ctx.state.households[ctx.state.player.householdId];
    if (!hh) return;
    const home = ctx.state.venues[hh.homeVenueId];
    if (!home || !ctx.query.findObject(home.id, 'car_charger_home')) return;
    for (const vid of hh.vehicleIds) {
      const v = ctx.state.vehicles[vid];
      if (v && v.fuelType === 'electric' && v.location.venueId === home.id && v.fuel < 100) v.fuel = clamp100(round2(v.fuel + (10 / 60) * dt));
    }
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'transport:arrived':
        onArrived(ctx, event.simId, event.venueId, event.mode);
        break;
      case 'time:day':
        dailyVehicles(ctx);
        break;
      case 'scheduled:fired': {
        const ev = event.event;
        if (ev.kind === 'registration_expiry') {
          const v = ctx.state.vehicles[String(ev.payload?.vehicleId) as VehicleId];
          if (!v) break;
          if ((v.registrationExpiresAt ?? 0) <= ctx.state.time.minute) {
            if (!v.issues.includes('expired registration')) v.issues.push('expired registration');
            const head = v.ownerHouseholdId ? headOfHousehold(ctx, v.ownerHouseholdId) : undefined;
            if (head) {
              ctx.log({ text: `The registration on the ${vname(v)} expired. Renew it at the DMV (${formatMoney(REGISTRATION_FEE)}) before you get pulled over.`, kind: 'alert', simId: head.id, importance: 2 });
              notify(ctx, head, 'Registration expired', `${v.make} ${v.model}: renew at the DMV.`);
            }
          }
        }
        break;
      }
      case 'custom': {
        const sim = event.simId ? ctx.state.sims[event.simId] : undefined;
        const p = event.payload ?? {};
        if (event.kind === 'transport:refuel' && sim) {
          const here = sim.location.venueId;
          const explicit = typeof p.vehicleId === 'string' ? ctx.state.vehicles[p.vehicleId as VehicleId] : undefined;
          const v: Vehicle | undefined = explicit ?? vehiclesAt(ctx.state, sim, here).find((x) => x.fuelType !== 'none' && x.fuelType !== 'electric');
          if (!v) break;
          const gallons = round2(((100 - v.fuel) / 100) * v.tankGallons);
          const cost = round2(gallons * ctx.state.economy.gasPrice);
          if (gallons > 0 && charge(ctx, sim, cost, `Gas — ${v.make} ${v.model}`)) {
            v.fuel = 100;
            ctx.log({ text: `${you(ctx, sim)} fill${ctx.query.isControlled(sim.id) ? '' : 's'} up the ${v.make} ${v.model}: ${gallons} gal, ${formatMoney(cost)}.`, kind: 'money', simId: sim.id, importance: 0 });
          }
        } else if (event.kind === 'transport:bus' && sim) {
          const wait = transitWaitMinutes(ctx.state);
          ctx.log({ text: ctx.state.region.transitQuality > 0.15 ? `Next bus in ${wait} minutes. Fare ${formatMoney(TRANSIT_FARE)}${(sim.inventory.consumables.bus_pass ?? 0) > 0 ? ' (you have a pass)' : ''}.` : 'The schedule on the sign is faded. Buses here are… theoretical.', kind: 'travel', simId: sim.id, importance: 0 });
        } else if (event.kind === 'transport:repossess') {
          const v = ctx.state.vehicles[String(p.vehicleId) as VehicleId];
          if (!v) break;
          const head = v.ownerHouseholdId ? headOfHousehold(ctx, v.ownerHouseholdId) : sim;
          removeVehicle(ctx, v);
          ctx.log({ text: `A tow truck took the ${vname(v)} in the night. Repossessed.`, kind: 'alert', simId: head?.id, importance: 3 });
          if (head && ctx.query.isControlled(head.id)) ctx.interrupt({ kind: 'event', title: 'Repossession', body: `The ${vname(v)} is gone — repossessed by the lender.`, simId: head.id, options: [] });
        } else if (event.kind === 'transport:damage') {
          const v = ctx.state.vehicles[String(p.vehicleId) as VehicleId];
          if (v) v.condition = clamp100(v.condition - (isFiniteNumber(p.amount) ? Number(p.amount) : 10));
        } else if (event.kind === 'transport:teleport' && sim && p.venueId && ctx.state.venues[String(p.venueId) as VenueId]) {
          ctx.applyEffects(sim.id, { moveTo: { venueId: String(p.venueId) as VenueId } }, 'transport:teleport');
        }
        break;
      }
      default:
        break;
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    if (!sim.body.alive) return [];
    if (sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute) return [];
    return [...travelActions(ctx, sim), ...venueActions(ctx, sim)];
  },

  handles: (id) => id.startsWith('travel:') || id.startsWith('transport:'),

  execute(ctx, simId, action, params) {
    const sim = ctx.query.sim(simId);
    if (action.id.startsWith('travel:')) return executeTravel(ctx, sim, action, params);
    return executeTransport(ctx, sim, action, params);
  },
};

export { clamp };
