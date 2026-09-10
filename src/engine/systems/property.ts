/**
 * Property system — residences, rent & eviction, home condition, chores & cleanliness,
 * repairs, listings (rent/buy), moving, home insurance and loss events.
 *
 * Bills: this system pushes `rent`, `insurance_*`, `property_tax`, `hoa` RecurringBills onto the
 * head-of-household's `sim.finance.bills` (finance pays them and emits money:bill_* events).
 *
 * Custom effect kinds handled: `chore:clean {amount}`, `chore:laundry`, `chore:dishes`,
 * `property:foreclose {venueId}`, `property:damage {objectId?, amount?}`.
 * Scheduled kinds owned: `_repair_arrival`, `_landlord_repair`, `_insurance_payout`, `_exterminator`, `_home_sale`.
 */
import { transact } from '../core/effects';
import { makeObject, makeVenue, placeObject } from '../core/factories';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import { RNG } from '../core/rng';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, Household, LoanRef, ObjectId, RecurringBill, Requirement, Residence, Sim, SimId, Venue, VenueId } from '../core/types';
import { DAY, clamp, clamp100, formatMoney, isFiniteNumber, round2 } from '../core/util';

type Ctx = SystemContext;

export const RENTERS_INSURANCE = 15;
export const HOMEOWNERS_INSURANCE = 120;
export const INSURANCE_DEDUCTIBLE = 500;
export const PROPERTY_TAX_RATE = 0.018;
export const CONDITION_DECAY_PER_DAY = 0.1;
export const EXTERMINATOR_COST = 150;
export const MIN_DOWN_PCT = 0.035;
export const CLOSING_COST_PCT = 0.02;
export const LEASE_MIN_CREDIT = 620;

const ESSENTIALS: { defId: string; room: string }[] = [
  { defId: 'toilet', room: 'Bathroom' },
  { defId: 'shower', room: 'Bathroom' },
  { defId: 'bathroom_sink', room: 'Bathroom' },
  { defId: 'kitchen_sink', room: 'Kitchen' },
  { defId: 'fridge', room: 'Kitchen' },
  { defId: 'stove', room: 'Kitchen' },
];

const CHORE_DEFS: { id: string; label: string; ratePerDay: number }[] = [
  { id: 'dishes', label: 'Dishes', ratePerDay: 20 },
  { id: 'trash', label: 'Take out the trash', ratePerDay: 15 },
  { id: 'laundry', label: 'Laundry', ratePerDay: 12 },
  { id: 'vacuum', label: 'Vacuum', ratePerDay: 8 },
  { id: 'bathroom', label: 'Clean the bathroom', ratePerDay: 10 },
  { id: 'yard', label: 'Yard work', ratePerDay: 5 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function upsertBill(sim: Sim, bill: Omit<RecurringBill, 'missed'> & { missed?: number }): RecurringBill {
  const ex = sim.finance.bills.find((b) => b.id === bill.id);
  if (ex) {
    ex.name = bill.name;
    ex.amount = round2(bill.amount);
    ex.dueDayOfMonth = bill.dueDayOfMonth;
    ex.category = bill.category;
    ex.linkedId = bill.linkedId;
    return ex;
  }
  const b: RecurringBill = { missed: 0, ...bill, amount: round2(bill.amount) };
  sim.finance.bills.push(b);
  return b;
}

function dropBill(sim: Sim, id: string): void {
  sim.finance.bills = sim.finance.bills.filter((b) => b.id !== id);
  delete sim.flags[`bill_due:${id}`];
  delete sim.flags[`bill_arrears:${id}`];
  delete sim.flags[`bill_paid_month:${id}`];
}

export function headOfHousehold(ctx: Ctx, hh: Household): Sim | undefined {
  const alive = hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive);
  const controlled = alive.find((id) => ctx.query.isControlled(id));
  return ctx.state.sims[controlled ?? alive[0]];
}

/** The home venue of a sim's household (undefined for sims without a household). */
export function homeVenueOf(ctx: Ctx, simId: SimId): Venue | undefined {
  return ctx.query.homeOf(simId);
}

function isHomeArchetype(v: Venue): boolean {
  return v.archetype === 'home' || v.archetype === 'apartment_building' || v.archetype === 'shelter';
}

function you(ctx: Ctx, sim: Sim): string {
  return ctx.query.isControlled(sim.id) ? 'You' : sim.identity.firstName;
}

function notify(ctx: Ctx, sim: Sim, title: string, body: string, actionId?: string): void {
  sim.phone.notifications.push({ id: shortId(ctx.rng, 'ntf'), at: ctx.state.time.minute, app: 'home', title, body, read: false, actionId });
  if (sim.phone.notifications.length > 60) sim.phone.notifications.splice(0, sim.phone.notifications.length - 60);
  ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'home', title, body });
}

function pushMail(ctx: Ctx, hh: Household, m: { from: string; subject: string; body: string; kind: Household['mail'][number]['kind']; amount?: number; actionId?: string }): void {
  hh.mail.push({ id: shortId(ctx.rng, 'mail'), at: ctx.state.time.minute, read: false, ...m });
  if (hh.mail.length > 60) hh.mail.splice(0, hh.mail.length - 60);
  ctx.emit({ type: 'amenity:mail', householdId: hh.id, mailId: hh.mail[hh.mail.length - 1].id });
}

/** households worth simulating daily: the player's plus any with a full-lod member */
function activeHouseholds(ctx: Ctx): Household[] {
  const out: Household[] = [];
  const seen = new Set<string>();
  const add = (h?: Household) => {
    if (h && !seen.has(h.id)) {
      seen.add(h.id);
      out.push(h);
    }
  };
  add(ctx.state.households[ctx.state.player.householdId]);
  for (const s of ctx.query.simulatedSims()) if (s.lod === 'full') add(ctx.query.householdOf(s.id));
  return out;
}

function defaultResidence(ctx: Ctx, kind: Residence['kind'] = 'apartment'): Residence {
  const r = ctx.state.region;
  const rent = round2(r.medianRent1br * ctx.state.economy.rentIndex);
  return {
    kind,
    bedrooms: 1,
    bathrooms: 1,
    sqft: kind === 'house' ? 1400 : 720,
    tenure: 'rent',
    monthlyRent: rent,
    marketValue: round2(r.medianHomePrice * (kind === 'house' ? 1 : 0.55)),
    condition: 72,
    utilities: [],
    furnishingLevel: 40,
    securitySystem: false,
    yard: kind === 'house',
    garage: kind === 'house',
    petsAllowed: true,
  };
}

function ensureRooms(venue: Venue, bedrooms: number, bathrooms: number): void {
  const want = ['Kitchen', 'Living Room'];
  for (let i = 1; i <= Math.max(1, bedrooms); i++) want.push(bedrooms > 1 ? `Bedroom ${i}` : 'Bedroom');
  for (let i = 1; i <= Math.max(1, Math.ceil(bathrooms)); i++) want.push(bathrooms > 1 ? `Bathroom ${i}` : 'Bathroom');
  for (const name of want) {
    const id = name.toLowerCase().replace(/\s+/g, '_');
    if (!venue.rooms.some((r) => r.id === id)) venue.rooms.push({ id, name, objectIds: [] });
  }
}

function roomFor(venue: Venue, preferred: string): string | undefined {
  const pid = preferred.toLowerCase().replace(/\s+/g, '_');
  const exact = venue.rooms.find((r) => r.id === pid || r.id.startsWith(`${pid}_`));
  return (exact ?? venue.rooms[0])?.id;
}

function ensureEssentials(ctx: Ctx, venue: Venue, hh: Household): void {
  for (const e of ESSENTIALS) {
    if (ctx.query.findObject(venue.id, e.defId)) continue;
    const obj = makeObject(e.defId, { rng: ctx.rng, ownerHouseholdId: hh.id, quality: 2 });
    placeObject(ctx.state, obj, venue.id, roomFor(venue, e.room));
  }
}

function ensureChores(hh: Household, res: Residence | undefined): void {
  for (const c of CHORE_DEFS) {
    if (c.id === 'yard' && !res?.yard) continue;
    if (!hh.chores.some((x) => x.id === c.id)) hh.chores.push({ id: c.id, label: c.label, dirtiness: 20 });
  }
  if (!res?.yard) hh.chores = hh.chores.filter((c) => c.id !== 'yard');
}

function syncHousingBills(ctx: Ctx, hh: Household): void {
  const head = headOfHousehold(ctx, hh);
  const home = ctx.state.venues[hh.homeVenueId];
  if (!head || !home?.residence) return;
  const res = home.residence;
  const col = ctx.state.region.costOfLiving;
  // strip housing bills from non-head members (they may have been head before)
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (s && s.id !== head.id) for (const bid of ['rent', 'insurance_renters', 'insurance_home', 'property_tax', 'hoa']) dropBill(s, bid);
  }
  if (res.tenure === 'rent' && (res.monthlyRent ?? 0) > 0) {
    upsertBill(head, { id: 'rent', name: `Rent — ${home.name}`, amount: res.monthlyRent!, dueDayOfMonth: 1, category: 'rent', autopay: head.finance.bills.find((b) => b.id === 'rent')?.autopay ?? false, linkedId: home.id });
    dropBill(head, 'insurance_home');
    dropBill(head, 'property_tax');
    if (!head.flags.declined_renters_insurance) upsertBill(head, { id: 'insurance_renters', name: 'Renters insurance', amount: round2(RENTERS_INSURANCE * col), dueDayOfMonth: 5, category: 'insurance', autopay: true, linkedId: home.id });
  } else if (res.tenure === 'own') {
    dropBill(head, 'rent');
    dropBill(head, 'insurance_renters');
    upsertBill(head, { id: 'insurance_home', name: 'Homeowners insurance', amount: round2(HOMEOWNERS_INSURANCE * col * Math.max(0.5, res.marketValue / 400000)), dueDayOfMonth: 5, category: 'insurance', autopay: true, linkedId: home.id });
    const tax = res.propertyTaxAnnual ?? round2(res.marketValue * PROPERTY_TAX_RATE);
    res.propertyTaxAnnual = tax;
    upsertBill(head, { id: 'property_tax', name: 'Property tax (escrow)', amount: round2(tax / 12), dueDayOfMonth: 1, category: 'other', autopay: true, linkedId: home.id });
  } else {
    for (const bid of ['rent', 'insurance_renters', 'insurance_home', 'property_tax']) dropBill(head, bid);
  }
  if (res.hoaMonthly && res.hoaMonthly > 0) upsertBill(head, { id: 'hoa', name: 'HOA dues', amount: res.hoaMonthly, dueDayOfMonth: 1, category: 'other', autopay: true, linkedId: home.id });
  else dropBill(head, 'hoa');
}

function ensureHome(ctx: Ctx, hh: Household): void {
  const home = ctx.state.venues[hh.homeVenueId];
  if (!home) return;
  if (!home.residence && isHomeArchetype(home)) home.residence = defaultResidence(ctx, home.archetype === 'shelter' ? 'room' : 'apartment');
  if (home.archetype === 'shelter' && home.residence) home.residence.tenure = 'shelter';
  if (!home.residence) return;
  if (!home.rooms.length) ensureRooms(home, home.residence.bedrooms, home.residence.bathrooms);
  home.discovered = true;
  if (!home.ownerHouseholdId && home.residence.tenure !== 'shelter') home.ownerHouseholdId = hh.id;
  ensureChores(hh, home.residence);
  syncHousingBills(ctx, hh);
}

function isInsured(ctx: Ctx, hh: Household): boolean {
  const head = headOfHousehold(ctx, hh);
  if (!head) return false;
  const b = head.finance.bills.find((x) => x.id === 'insurance_renters' || x.id === 'insurance_home');
  return !!b && b.missed < 2;
}

// ---------------------------------------------------------------------------
// Daily upkeep
// ---------------------------------------------------------------------------
function dailyUpkeep(ctx: Ctx, hh: Household): void {
  const home = ctx.state.venues[hh.homeVenueId];
  const res = home?.residence;
  if (!home || !res) return;
  ensureChores(hh, res);
  const members = hh.simIds.filter((id) => ctx.state.sims[id]?.body.alive);
  const people = members.length;
  const neatCount = members.filter((id) => ctx.state.sims[id]?.personality.traits.includes('neat')).length;
  const slobCount = members.filter((id) => ctx.state.sims[id]?.personality.traits.includes('slob')).length;
  // condition decay (faster for old/poorly maintained homes)
  res.condition = clamp100(res.condition - CONDITION_DECAY_PER_DAY * (res.condition < 40 ? 1.5 : 1));
  // chores build up
  let choreDirt = 0;
  for (const c of hh.chores) {
    const def = CHORE_DEFS.find((d) => d.id === c.id);
    const rate = (def?.ratePerDay ?? 10) * (0.7 + 0.3 * people) * (1 + 0.3 * slobCount) * (1 - 0.15 * neatCount);
    c.dirtiness = Math.min(150, c.dirtiness + rate);
    choreDirt += Math.max(0, c.dirtiness - 50) / 50;
  }
  // dirty objects drag cleanliness
  let dirtyObjects = 0;
  for (const o of ctx.query.objectsAt(home.id)) if ((o.state.dirty ?? 0) > 50) dirtyObjects += 1;
  const drop = Math.min(10, choreDirt + dirtyObjects * 0.8);
  if (drop > 0) home.cleanliness = clamp100(home.cleanliness - drop);
  // filthy home moodlets & pests
  if (home.cleanliness < 30) {
    for (const s of ctx.query.simsAt(home.id)) ctx.applyEffects(s.id, { moodlets: [{ id: 'filthy_home', emotion: 'uncomfortable', label: 'Filthy home', intensity: -8, durationMinutes: DAY }] }, 'property:filth');
    if (home.cleanliness < 25 && !home.tags.includes('cockroaches') && ctx.rng.chance(0.05)) {
      home.tags.push('cockroaches');
      ctx.log({ text: `Cockroaches. In the kitchen. ${home.name} has a pest problem.`, kind: 'alert', importance: 2, venueId: home.id });
    }
  }
  if (home.tags.includes('cockroaches')) {
    for (const s of ctx.query.simsAt(home.id)) ctx.applyEffects(s.id, { moodlets: [{ id: 'pests', emotion: 'uncomfortable', label: 'Cockroaches', intensity: -10, durationMinutes: DAY }] }, 'property:pests');
    home.cleanliness = clamp100(home.cleanliness - 1);
  }
  // wear breaks things in run-down homes
  if (res.condition < 40 && ctx.rng.chance(0.02)) {
    const candidates = ctx.query.objectsAt(home.id).filter((o) => !o.state.broken);
    if (candidates.length) {
      const o = ctx.rng.pick(candidates);
      o.state.broken = true;
      ctx.emit({ type: 'property:broken', objectId: o.id, venueId: home.id });
      ctx.emit({ type: 'property:repair_needed', venueId: home.id, objectId: o.id, issue: 'wear' });
      ctx.log({ text: `The ${ctx.content.objects[o.defId]?.name ?? o.defId.replace(/_/g, ' ')} at home stopped working.`, kind: 'alert', importance: 2, venueId: home.id });
    }
  }
  // rent status → eviction ladder
  const head = headOfHousehold(ctx, hh);
  const rent = head?.finance.bills.find((b) => b.id === 'rent');
  if (head && rent && res.tenure === 'rent') {
    const missed = rent.missed;
    const stage = Number(head.flags.eviction_stage ?? 0);
    if (missed >= 3 && stage < 3) evict(ctx, hh, home);
    else if (missed >= 2 && stage < 2) {
      head.flags.eviction_stage = 2;
      ctx.emit({ type: 'money:eviction_warning', simId: head.id, venueId: home.id });
      pushMail(ctx, hh, { from: res.landlordSimId ? 'Your landlord' : 'Property management', subject: 'NOTICE TO PAY OR QUIT', body: `You are ${missed} months behind on rent (${formatMoney(rent.amount * missed)}). Pay the balance within 30 days or eviction proceedings will begin.`, kind: 'notice', amount: rent.amount * missed, actionId: 'phone:bank:pay_bill:rent' });
      if (ctx.query.isControlled(head.id)) ctx.interrupt({ kind: 'event', title: 'Eviction warning', body: `A notice is taped to your door: pay ${formatMoney(rent.amount * missed)} in back rent within 30 days or face eviction.`, simId: head.id, options: [{ label: 'Pay back rent', actionId: 'phone:bank:pay_bill:rent' }] });
      ctx.log({ text: `An eviction warning was posted on your door.`, kind: 'alert', simId: head.id, importance: 3 });
    } else if (missed < 2 && stage > 0) delete head.flags.eviction_stage;
  }
}

function findOrCreateShelter(ctx: Ctx): Venue {
  const existing = ctx.query.venuesByArchetype('shelter')[0];
  if (existing) {
    if (!existing.residence) existing.residence = { ...defaultResidence(ctx, 'room'), tenure: 'shelter', monthlyRent: 0, sqft: 200, condition: 50 };
    if (!existing.rooms.length) existing.rooms.push({ id: 'dorm', name: 'Dorm', objectIds: [] }, { id: 'bathroom', name: 'Bathroom', objectIds: [] });
    return existing;
  }
  const c = ctx.state.region.center;
  const v = makeVenue({ name: 'Community Shelter', archetype: 'shelter', location: { lat: c.lat + 0.01, lng: c.lng - 0.008 }, rng: ctx.rng, rooms: ['Dorm', 'Bathroom', 'Dining Hall'], discovered: true, capacity: 60 });
  v.residence = { ...defaultResidence(ctx, 'room'), tenure: 'shelter', monthlyRent: 0, sqft: 200, condition: 50, petsAllowed: false };
  v.cleanliness = 45;
  v.safety = 40;
  ctx.state.venues[v.id] = v;
  for (const def of ['cot', 'cot', 'cot', 'toilet', 'shower', 'soup_kitchen_counter']) placeObject(ctx.state, makeObject(def, { rng: ctx.rng }), v.id, def === 'cot' ? 'dorm' : def === 'soup_kitchen_counter' ? 'dining_hall' : 'bathroom');
  return v;
}

/** Move a household (sims, pets, vehicles, portable owned objects) to a new home venue. */
export function moveHousehold(ctx: Ctx, hh: Household, to: Venue, reason: string): void {
  const from = ctx.state.venues[hh.homeVenueId];
  const now = ctx.state.time.minute;
  if (!from || from.id === to.id) return;
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s) continue;
    if (s.location.venueId === from.id && !s.travel) {
      s.location = { venueId: to.id, arrivedAt: now };
      ctx.emit({ type: 'sim:moved', simId: s.id, from: from.id, to: to.id });
      ctx.emit({ type: 'sim:arrived', simId: s.id, venueId: to.id });
    }
    // move carried objects' home reference along with the sim (they stay carried)
  }
  for (const pid of hh.petIds) {
    const p = ctx.state.pets[pid];
    if (p && p.location.venueId === from.id) p.location = { venueId: to.id };
  }
  for (const vid of hh.vehicleIds) {
    const v = ctx.state.vehicles[vid];
    if (v && v.location.venueId === from.id) v.location = { venueId: to.id };
  }
  if (reason !== 'evicted') {
    for (const o of ctx.query.objectsAt(from.id)) {
      const def = ctx.content.objects[o.defId];
      if (o.ownerHouseholdId === hh.id && def?.portable) {
        from.objectIds = from.objectIds.filter((x) => x !== o.id);
        for (const r of from.rooms) r.objectIds = r.objectIds.filter((x) => x !== o.id);
        placeObject(ctx.state, o, to.id, roomFor(to, def.rooms?.[0] ?? 'Living Room'));
      }
    }
  }
  if (from.ownerHouseholdId === hh.id && from.residence?.tenure !== 'own') from.ownerHouseholdId = undefined;
  hh.homeVenueId = to.id;
  to.ownerHouseholdId = hh.id;
  to.discovered = true;
  if (!to.regularSimIds.length) to.regularSimIds = [...hh.simIds];
  ensureChores(hh, to.residence);
  for (const id of hh.simIds) {
    const s = ctx.state.sims[id];
    if (!s) continue;
    for (const key of Object.keys(s.flags)) if (key === 'eviction_stage') delete s.flags[key];
  }
  syncHousingBills(ctx, hh);
  ctx.emit({ type: 'property:moved', householdId: hh.id, from: from.id, to: to.id });
  for (const id of hh.simIds) ctx.emit({ type: 'family:moved_in', simId: id, householdId: hh.id });
}

function evict(ctx: Ctx, hh: Household, home: Venue): void {
  const head = headOfHousehold(ctx, hh);
  if (!head) return;
  head.flags.eviction_stage = 3;
  const shelter = findOrCreateShelter(ctx);
  ctx.emit({ type: 'money:evicted', simId: head.id, venueId: home.id });
  ctx.log({ text: `Evicted. The sheriff's deputy changes the locks on ${home.name}. Your furniture stays behind. You end up at ${shelter.name}.`, kind: 'alert', simId: head.id, importance: 3 });
  for (const id of hh.simIds) ctx.applyEffects(id, { moodlets: [{ id: 'evicted', emotion: 'sad', label: 'Evicted', intensity: -25, durationMinutes: 7 * DAY }], stress: 30 }, 'property:evicted');
  dropBill(head, 'rent');
  dropBill(head, 'insurance_renters');
  head.finance.creditScore = clamp(head.finance.creditScore - 60, 300, 850);
  ctx.emit({ type: 'money:credit_score', simId: head.id, score: head.finance.creditScore, delta: -60 });
  if (home.residence) home.residence.tenure = 'rent';
  moveHousehold(ctx, hh, shelter, 'evicted');
  if (ctx.query.isControlled(head.id)) ctx.interrupt({ kind: 'event', title: 'Evicted', body: `You have been evicted from ${home.name}. You're at ${shelter.name} with what you could carry.`, simId: head.id, options: [] });
}

function foreclose(ctx: Ctx, hh: Household, home: Venue): void {
  const head = headOfHousehold(ctx, hh);
  if (!head || !home.residence) return;
  const shelter = findOrCreateShelter(ctx);
  ctx.log({ text: `The bank foreclosed on ${home.name}. You lose the house.`, kind: 'alert', simId: head.id, importance: 3 });
  home.residence.tenure = 'rent';
  home.residence.mortgage = undefined;
  head.finance.creditScore = clamp(head.finance.creditScore - 100, 300, 850);
  ctx.emit({ type: 'money:credit_score', simId: head.id, score: head.finance.creditScore, delta: -100 });
  ctx.emit({ type: 'money:evicted', simId: head.id, venueId: home.id });
  for (const id of hh.simIds) ctx.applyEffects(id, { moodlets: [{ id: 'foreclosed', emotion: 'sad', label: 'Lost the house', intensity: -30, durationMinutes: 14 * DAY }], stress: 35 }, 'property:foreclosed');
  moveHousehold(ctx, hh, shelter, 'evicted');
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------
export interface Listing {
  idx: number;
  kind: Residence['kind'];
  address: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  rent?: number;
  price?: number;
  petsAllowed: boolean;
  yard: boolean;
  garage: boolean;
  hoa?: number;
  lat: number;
  lng: number;
}

const STREETS = ['Oak St', 'Maple Ave', 'Cedar Ln', 'Elm St', 'Pine Dr', 'Washington Blvd', 'Lincoln Ave', 'Park Pl', 'River Rd', 'Hillcrest Dr', 'Sunset Blvd', 'Main St', '5th St', 'Lakeview Dr', 'Magnolia Way'];

/** Deterministic 3–6 listings for the current month. */
export function generateListings(ctx: Ctx): Listing[] {
  const r = ctx.state.region;
  const c = ctx.clock.day;
  const rng = new RNG(`listings:${r.name}:${c.year}-${c.month}`);
  const n = rng.int(3, 6);
  const out: Listing[] = [];
  const density = r.density;
  for (let i = 0; i < n; i++) {
    const forSale = rng.chance(density === 'urban' ? 0.3 : 0.5);
    const kind: Residence['kind'] = forSale ? rng.weighted([{ weight: density === 'urban' ? 2 : 6, value: 'house' as const }, { weight: 3, value: 'condo' as const }, { weight: 2, value: 'townhouse' as const }, { weight: density === 'rural' ? 2 : 0.3, value: 'mobile_home' as const }]) : rng.weighted([{ weight: density === 'urban' ? 7 : 4, value: 'apartment' as const }, { weight: 2, value: 'house' as const }, { weight: 1.5, value: 'townhouse' as const }, { weight: 1.5, value: 'room' as const }]);
    const bedrooms = kind === 'room' ? 1 : kind === 'apartment' ? rng.int(0, 3) : rng.int(2, 4);
    const bathrooms = kind === 'room' ? 1 : Math.max(1, Math.round(bedrooms * rng.range(0.5, 0.9) * 2) / 2);
    const sqft = kind === 'room' ? rng.int(150, 250) : Math.round((bedrooms === 0 ? 450 : 500 + bedrooms * 300) * rng.range(0.85, 1.25));
    const bedFactor = kind === 'room' ? 0.55 : bedrooms === 0 ? 0.8 : 0.8 + bedrooms * 0.28;
    const kindFactor = kind === 'house' ? 1.15 : kind === 'townhouse' ? 1.05 : kind === 'mobile_home' ? 0.55 : kind === 'condo' ? 0.9 : 1;
    const listing: Listing = {
      idx: i,
      kind,
      address: `${rng.int(100, 9800)} ${rng.pick(STREETS)}${kind === 'apartment' ? ` #${rng.int(1, 40)}` : kind === 'room' ? ' (room)' : ''}`,
      bedrooms,
      bathrooms,
      sqft,
      petsAllowed: kind === 'room' ? rng.chance(0.2) : rng.chance(0.6),
      yard: kind === 'house' || (kind === 'townhouse' && rng.chance(0.5)),
      garage: (kind === 'house' && rng.chance(0.7)) || (kind === 'townhouse' && rng.chance(0.5)),
      lat: r.center.lat + rng.range(-0.035, 0.035),
      lng: r.center.lng + rng.range(-0.04, 0.04),
    };
    if (forSale) {
      listing.price = Math.round((r.medianHomePrice * bedFactor * kindFactor * rng.range(0.8, 1.25)) / 1000) * 1000;
      if (kind === 'condo' || kind === 'townhouse') listing.hoa = Math.round(rng.range(180, 420) / 10) * 10;
    } else {
      listing.rent = Math.round((r.medianRent1br * ctx.state.economy.rentIndex * bedFactor * kindFactor * rng.range(0.85, 1.2)) / 5) * 5;
    }
    out.push(listing);
  }
  return out;
}

function listingLabel(l: Listing): string {
  const beds = l.kind === 'room' ? 'Room' : l.bedrooms === 0 ? 'Studio' : `${l.bedrooms}bd/${l.bathrooms}ba`;
  return `${beds} ${l.kind.replace('_', ' ')} · ${l.sqft} sqft · ${l.address}${l.petsAllowed ? ' · pets OK' : ''}${l.yard ? ' · yard' : ''}`;
}

function createHomeFromListing(ctx: Ctx, hh: Household, l: Listing, tenure: 'rent' | 'own', mortgage?: LoanRef): Venue {
  const v = makeVenue({ name: l.address, archetype: 'home', location: { lat: l.lat, lng: l.lng }, rng: ctx.rng, discovered: true, ownerHouseholdId: hh.id, capacity: 12 });
  ensureRooms(v, l.bedrooms, l.bathrooms);
  v.residence = {
    kind: l.kind,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    sqft: l.sqft,
    tenure,
    monthlyRent: tenure === 'rent' ? l.rent : undefined,
    mortgage,
    marketValue: l.price ?? Math.round((l.rent ?? 1000) * 12 * 15),
    condition: 80,
    utilities: [],
    hoaMonthly: l.hoa,
    propertyTaxAnnual: tenure === 'own' && l.price ? round2(l.price * PROPERTY_TAX_RATE) : undefined,
    leaseEndsMinute: tenure === 'rent' ? ctx.state.time.minute + 365 * DAY : undefined,
    furnishingLevel: 10,
    securitySystem: false,
    yard: l.yard,
    garage: l.garage,
    petsAllowed: l.petsAllowed,
  };
  v.cleanliness = 85;
  ctx.state.venues[v.id] = v;
  ensureEssentials(ctx, v, hh);
  return v;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function moneyReq(amount: number): Requirement {
  return { kind: 'money', reason: `Costs ${formatMoney(amount)}`, params: { amount, noCredit: true } };
}
const PHONE_REQ: Requirement = { kind: 'flag', reason: 'Your phone is dead', params: { flag: 'phone_dead', not: true } };

function act(id: string, label: string, category: ActionDef['category'], minutes: number, extra: Partial<ActionDef> = {}): ActionDef {
  return { id, label, category, durationMinutes: minutes, effects: {}, interruptible: true, ...extra };
}

function objectValue(ctx: Ctx, o: { defId: string; purchasePrice?: number; quality: number }): number {
  if (o.purchasePrice) return o.purchasePrice;
  const def = ctx.content.objects[o.defId];
  return def ? def.basePrice * (def.tiers?.[o.quality - 1] ?? 1) : 100;
}

function propertyActions(ctx: Ctx, simId: SimId): ActionDef[] {
  const sim = ctx.query.sim(simId);
  if (sim.lifeStage === 'infant' || sim.lifeStage === 'toddler' || sim.lifeStage === 'child') return [];
  const hh = ctx.query.householdOf(simId);
  const venue = ctx.query.venue(sim.location.venueId);
  const out: ActionDef[] = [];
  const col = ctx.state.region.costOfLiving;
  const home = hh ? ctx.state.venues[hh.homeVenueId] : undefined;
  const atHome = !!home && venue.id === home.id;
  const res = home?.residence;

  if (atHome && home && hh) {
    const g = 'Home';
    for (const o of ctx.query.objectsAt(home.id)) {
      const def = ctx.content.objects[o.defId];
      const name = o.name ?? def?.name ?? o.defId.replace(/_/g, ' ');
      if (o.state.broken) {
        const cost = round2(Math.max(80, (def?.repairCost ?? 120) * col));
        out.push(act(`property:repair_call:${o.id}`, `Call a repair service for the ${name} (${formatMoney(cost)})`, 'chores', 5, { group: g, target: { kind: 'object', id: o.id, name }, requirements: [moneyReq(cost), PHONE_REQ], params: { cost } }));
        out.push(act(`property:repair_self:${o.id}`, `Repair the ${name} yourself`, 'chores', 90, { group: g, target: { kind: 'object', id: o.id, name }, effects: { skills: { handiness: 25 }, needs: { fun: -5, hygiene: -5 } } }));
        if (res?.tenure === 'rent') out.push(act(`property:call_landlord:${o.id}`, `Ask the landlord to fix the ${name}`, 'chores', 5, { group: g, target: { kind: 'object', id: o.id, name }, requirements: [PHONE_REQ] }));
        out.push(act(`property:toss:${o.id}`, `Throw out the broken ${name}`, 'chores', 10, { group: g, target: { kind: 'object', id: o.id, name } }));
      } else if (o.purchasedAtMinute !== undefined && o.ownerHouseholdId === hh.id) {
        const value = round2(objectValue(ctx, o) * 0.5);
        out.push(act(`property:sell_object:${o.id}`, `Sell the ${name} (${formatMoney(value)})`, 'chores', 30, { group: g, target: { kind: 'object', id: o.id, name }, params: { value } }));
      }
    }
    if (home.tags.includes('cockroaches')) {
      const cost = round2(EXTERMINATOR_COST * col);
      out.push(act('property:exterminator', `Call an exterminator (${formatMoney(cost)})`, 'chores', 10, { group: g, requirements: [moneyReq(cost), PHONE_REQ], params: { cost } }));
    }
    for (const c of hh.chores) {
      if (c.dirtiness < 30) continue;
      out.push(act(`property:chore:${c.id}`, c.label, 'chores', c.id === 'laundry' ? 75 : c.id === 'yard' ? 60 : c.id === 'trash' ? 8 : 30, { group: 'Chores', effects: { needs: { fun: -3, comfort: -2 }, perMinute: { energy: -0.05 } }, description: c.dirtiness > 100 ? 'Badly overdue.' : c.dirtiness > 60 ? 'Getting bad.' : 'Could use doing.', autonomyWeight: c.dirtiness / 100 }));
    }
    if (res?.tenure === 'rent' && (res.leaseEndsMinute ?? 0) > ctx.state.time.minute) {
      const fee = round2((res.monthlyRent ?? 0) * 2);
      out.push(act('property:break_lease', `Break the lease (${formatMoney(fee)} fee)`, 'finance', 20, { group: g, requirements: [moneyReq(fee), PHONE_REQ], params: { fee } }));
    }
    if (res?.tenure === 'own' && home.ownerHouseholdId === hh.id && !home.tags.includes('for_sale')) {
      const value = round2(res.marketValue * (0.85 + 0.15 * (res.condition / 100)));
      out.push(act('property:list_for_sale', `List the home for sale (~${formatMoney(value, { cents: false })})`, 'finance', 60, { group: g, requirements: [PHONE_REQ], params: { value } }));
    }
  }

  // listings: at a real-estate office or via the phone
  const canBrowse = venue.archetype === 'real_estate' || !sim.flags.phone_dead;
  if (hh && canBrowse) {
    const g = venue.archetype === 'real_estate' ? 'Real estate' : 'Housing app';
    const reqs: Requirement[] = venue.archetype === 'real_estate' ? [] : [PHONE_REQ];
    out.push(act(venue.archetype === 'real_estate' ? 'property:browse' : 'phone:home:browse', 'Browse housing listings', venue.archetype === 'real_estate' ? 'finance' : 'phone', 15, { group: g, requirements: reqs, icon: 'home' }));
    for (const l of generateListings(ctx)) {
      if (l.rent) {
        const upfront = round2(l.rent * 2);
        out.push(act(`property:sign_lease:${l.idx}`, `Sign lease: ${listingLabel(l)} — ${formatMoney(l.rent, { cents: false })}/mo`, 'finance', 60, { group: g, requirements: [...reqs, moneyReq(upfront)], description: `Deposit + first month: ${formatMoney(upfront)}. Needs credit ≥ ${LEASE_MIN_CREDIT} or a cosigner.`, params: { upfront } }));
      } else if (l.price) {
        const down = round2(l.price * MIN_DOWN_PCT);
        const closing = round2(l.price * CLOSING_COST_PCT);
        out.push(act(`property:buy_home:${l.idx}`, `Buy: ${listingLabel(l)} — ${formatMoney(l.price, { cents: false })}`, 'finance', 120, { group: g, requirements: [...reqs, moneyReq(down + closing)], description: `Min down ${formatMoney(down)} + closing ${formatMoney(closing)}; mortgage at ${(ctx.state.economy.mortgageRate * 100).toFixed(2)}%.${l.hoa ? ` HOA ${formatMoney(l.hoa)}/mo.` : ''}`, params: { downPayment: down } }));
      }
    }
  }
  return out;
}

function executeProperty(ctx: Ctx, simId: SimId, action: ActionDef, params: Record<string, unknown>): { ok: boolean; text?: string; effects?: ActionDef['effects'] } {
  const sim = ctx.query.sim(simId);
  const hh = ctx.query.householdOf(simId);
  if (!hh) return { ok: false, text: 'No household.' };
  const home = ctx.state.venues[hh.homeVenueId];
  const res = home?.residence;
  const now = ctx.state.time.minute;
  const col = ctx.state.region.costOfLiving;
  const parts = action.id.split(':');
  const op = action.id.startsWith('phone:home:') ? parts[2] : parts[1];
  const target = parts.slice(action.id.startsWith('phone:home:') ? 3 : 2).join(':');
  const charge = (amount: number, memo: string): boolean => chargeHousehold(ctx, sim, hh, amount, memo, 'housing');

  switch (op) {
    case 'browse': {
      const list = generateListings(ctx).map((l) => `• ${listingLabel(l)} — ${l.rent ? `${formatMoney(l.rent, { cents: false })}/mo` : formatMoney(l.price ?? 0, { cents: false })}`);
      return { ok: true, text: `Listings this month:\n${list.join('\n')}` };
    }
    case 'repair_call': {
      const o = ctx.state.objects[target as ObjectId];
      if (!o || !o.state.broken) return { ok: false, text: 'Nothing to repair.' };
      const cost = Number(params.cost ?? 120);
      if (!charge(cost, `Repair service (${ctx.content.objects[o.defId]?.name ?? o.defId})`)) return { ok: false, text: `You can't afford ${formatMoney(cost)}.` };
      const days = ctx.rng.int(1, 3);
      ctx.schedule({ inMinutes: days * DAY + ctx.rng.int(-120, 240), kind: '_repair_arrival', label: 'Repair technician', simId, venueId: home?.id, payload: { objectId: o.id } });
      return { ok: true, text: `A technician is scheduled in ${days} day${days > 1 ? 's' : ''}.` };
    }
    case 'call_landlord': {
      const o = ctx.state.objects[target as ObjectId];
      if (!o || !o.state.broken) return { ok: false, text: 'Nothing to repair.' };
      const days = ctx.rng.int(2, 7);
      ctx.schedule({ inMinutes: days * DAY + ctx.rng.int(0, 480), kind: '_landlord_repair', label: 'Landlord repair', simId, venueId: home?.id, payload: { objectId: o.id } });
      return { ok: true, text: `The landlord says they'll "send someone" — realistically ${days} days.` };
    }
    case 'repair_self': {
      const o = ctx.state.objects[target as ObjectId];
      if (!o || !o.state.broken) return { ok: false, text: 'Nothing to repair.' };
      const lvl = sim.skills.handiness?.level ?? 0;
      const roll = ctx.rng.next();
      const pFix = 0.35 + 0.06 * lvl;
      const pWorse = Math.max(0.05, 0.25 - 0.02 * lvl);
      const pInjure = Math.max(0.02, 0.1 - 0.008 * lvl);
      const name = ctx.content.objects[o.defId]?.name ?? o.defId.replace(/_/g, ' ');
      if (roll < pFix) {
        o.state.broken = false;
        o.state.condition = clamp100(Math.max(o.state.condition, 60));
        ctx.emit({ type: 'property:repaired', objectId: o.id });
        return { ok: true, text: `After some cursing, the ${name} works again.`, effects: { moodlets: [{ emotion: 'proud', label: 'Fixed it myself', intensity: 6, durationMinutes: 360 }] } };
      }
      if (roll < pFix + pInjure) {
        return { ok: true, text: `You cut your hand on the ${name}. It's still broken.`, effects: { custom: [{ kind: 'health:injury', payload: { name: 'cut hand', bodyPart: 'hand', severity: 1 } }], health: -3, stress: 5 } };
      }
      if (roll < pFix + pInjure + pWorse) {
        o.state.condition = clamp100(o.state.condition - 15);
        return { ok: true, text: `You made the ${name} worse. Whatever that part was, it's not going back in.`, effects: { stress: 4 } };
      }
      return { ok: true, text: `You poke at the ${name} for a while and get nowhere.`, effects: { stress: 2 } };
    }
    case 'toss': {
      const o = ctx.state.objects[target as ObjectId];
      if (!o) return { ok: false, text: 'Gone already.' };
      removeObject(ctx, o.id);
      return { ok: true, text: 'Out to the curb it goes.' };
    }
    case 'sell_object': {
      const o = ctx.state.objects[target as ObjectId];
      if (!o) return { ok: false, text: 'Gone already.' };
      const value = round2(Number(params.value ?? objectValue(ctx, o) * 0.5));
      removeObject(ctx, o.id);
      ctx.applyEffects(simId, { money: { amount: value, memo: `Sold ${ctx.content.objects[o.defId]?.name ?? o.defId}`, category: 'sale' } }, 'property:sell');
      return { ok: true, text: `Someone from the marketplace app picks it up for ${formatMoney(value)}.` };
    }
    case 'exterminator': {
      const cost = Number(params.cost ?? EXTERMINATOR_COST * col);
      if (!charge(cost, 'Exterminator')) return { ok: false, text: `You can't afford ${formatMoney(cost)}.` };
      ctx.schedule({ inMinutes: 2 * DAY, kind: '_exterminator', label: 'Exterminator visit', simId, venueId: home?.id });
      return { ok: true, text: 'The exterminator comes in two days.' };
    }
    case 'chore': {
      const c = hh.chores.find((x) => x.id === target);
      if (!c) return { ok: false, text: 'Nothing to do.' };
      const amount = Math.min(c.dirtiness, 100);
      c.dirtiness = Math.max(0, c.dirtiness - 100);
      if (home) home.cleanliness = clamp100(home.cleanliness + amount * 0.12);
      if (target === 'trash') ctx.emit({ type: 'custom', kind: 'chore:trash', simId, payload: {} });
      return { ok: true, text: `${c.label}: done.`, effects: { moodlets: [{ emotion: 'relaxed', label: 'Tidy home', intensity: 3, durationMinutes: 240 }] } };
    }
    case 'break_lease': {
      if (!res || res.tenure !== 'rent') return { ok: false, text: "You're not renting." };
      const fee = Number(params.fee ?? (res.monthlyRent ?? 0) * 2);
      if (!charge(fee, 'Lease break fee')) return { ok: false, text: `You can't afford ${formatMoney(fee)}.` };
      res.leaseEndsMinute = now;
      const deposit = Number(sim.flags.security_deposit ?? 0);
      if (deposit > 0) {
        ctx.applyEffects(simId, { money: { amount: round2(deposit * (res.condition > 60 ? 1 : 0.5)), memo: 'Security deposit returned', category: 'housing' } }, 'property');
        delete sim.flags.security_deposit;
      }
      return { ok: true, text: `Lease terminated. You can move whenever you have a new place.` };
    }
    case 'list_for_sale': {
      if (!res || res.tenure !== 'own' || !home) return { ok: false, text: "You don't own this home." };
      home.tags.push('for_sale');
      const days = ctx.rng.int(30, 90);
      ctx.schedule({ inMinutes: days * DAY, kind: '_home_sale', label: 'Home sale closes', simId, venueId: home.id, payload: { value: Number(params.value ?? res.marketValue) } });
      return { ok: true, text: `Listed. Your agent expects an offer to close in about ${Math.round(days / 7)} weeks.` };
    }
    case 'sign_lease': {
      const l = generateListings(ctx).find((x) => x.idx === Number(target));
      if (!l || !l.rent) return { ok: false, text: 'That listing is gone.' };
      if (sim.finance.creditScore < LEASE_MIN_CREDIT && !sim.flags.cosigner) return { ok: false, text: `Application denied: credit score ${sim.finance.creditScore} is below ${LEASE_MIN_CREDIT} and you have no cosigner.` };
      if (hh.petIds.length && !l.petsAllowed) return { ok: false, text: 'No pets allowed there.' };
      let breakFee = 0;
      if (res?.tenure === 'rent' && (res.leaseEndsMinute ?? 0) > now) breakFee = round2((res.monthlyRent ?? 0) * 2);
      const upfront = round2(l.rent * 2 + breakFee);
      if (!charge(upfront, `Lease at ${l.address} (deposit + first month${breakFee ? ' + lease break' : ''})`)) return { ok: false, text: `You need ${formatMoney(upfront)} up front.` };
      sim.flags.security_deposit = l.rent;
      const v = createHomeFromListing(ctx, hh, l, 'rent');
      moveHousehold(ctx, hh, v, 'lease');
      ctx.emit({ type: 'property:lease_signed', householdId: hh.id, venueId: v.id, rent: l.rent });
      ctx.log({ text: `You sign a 12-month lease on ${l.address}: ${formatMoney(l.rent)}/month. Keys in hand.`, kind: 'narrative', simId, importance: 3 });
      return { ok: true, text: `Lease signed at ${l.address}. Rent ${formatMoney(l.rent)}/month, due on the 1st.` };
    }
    case 'buy_home': {
      const l = generateListings(ctx).find((x) => x.idx === Number(target));
      if (!l || !l.price) return { ok: false, text: 'That listing is gone.' };
      const down = Math.max(round2(l.price * MIN_DOWN_PCT), round2(Number(params.downPayment ?? l.price * MIN_DOWN_PCT)));
      if (down > l.price) return { ok: false, text: 'Down payment exceeds price.' };
      if (sim.finance.creditScore < 580) return { ok: false, text: `Mortgage denied: credit score ${sim.finance.creditScore} is below 580.` };
      const closing = round2(l.price * CLOSING_COST_PCT);
      const principal = round2(l.price - down);
      const rate = ctx.state.economy.mortgageRate;
      const payment = round2((principal * (rate / 12)) / (1 - Math.pow(1 + rate / 12, -360)));
      const income = round2(Number(sim.flags.tax_year_income ?? 0) || (sim.career.job?.annualSalary ?? (sim.career.job?.hourlyRate ?? 0) * 2080));
      if (income > 0 && payment * 12 > income * 0.43) return { ok: false, text: `Mortgage denied: ${formatMoney(payment)}/month exceeds 43% of your income.` };
      if (!charge(down + closing, `Home purchase: ${l.address} (down payment + closing)`)) return { ok: false, text: `You need ${formatMoney(down + closing)} for the down payment and closing costs.` };
      const loan: LoanRef = { id: shortId(ctx.rng, 'loan'), kind: 'mortgage', lender: 'Wells Fargo Home Mortgage', principal, balance: principal, apr: rate, monthlyPayment: payment, nextDueAt: now + 30 * DAY, missedPayments: 0, termMonths: 360, startedAt: now, inDefault: false, deferred: false };
      const v = createHomeFromListing(ctx, hh, l, 'own', loan);
      loan.collateralId = v.id;
      sim.finance.loans.push(loan);
      moveHousehold(ctx, hh, v, 'purchase');
      ctx.emit({ type: 'property:purchased', householdId: hh.id, venueId: v.id, price: l.price });
      ctx.log({ text: `You close on ${l.address} for ${formatMoney(l.price, { cents: false })}. Mortgage: ${formatMoney(payment)}/month for 30 years at ${(rate * 100).toFixed(2)}%.`, kind: 'narrative', simId, importance: 3 });
      return { ok: true, text: `Congratulations, homeowner. Mortgage ${formatMoney(payment)}/month.` };
    }
    default:
      return { ok: false, text: `Unknown property action ${op}` };
  }
}

/** Debit a sim's liquid accounts, falling back to household members when finances are shared. */
function chargeHousehold(ctx: Ctx, sim: Sim, hh: Household | undefined, amount: number, memo: string, category: string): boolean {
  amount = round2(amount);
  if (amount <= 0) return true;
  const now = ctx.state.time.minute;
  const tryOne = (s: Sim): boolean => {
    const r = transact(s, -amount, memo, now, { allowCredit: false, category, rng: ctx.rng });
    if (!r.ok) return false;
    ctx.emit({ type: 'money:transaction', simId: s.id, amount: -amount, memo, accountId: r.accountId!, category });
    ctx.state.stats.moneySpent = round2(ctx.state.stats.moneySpent + amount);
    return true;
  };
  if (tryOne(sim)) return true;
  if (hh?.sharedFinances) for (const id of hh.simIds) {
    const other = ctx.state.sims[id];
    if (other && other.id !== sim.id && other.body.alive && tryOne(other)) return true;
  }
  ctx.emit({ type: 'money:insufficient', simId: sim.id, amount, memo });
  return false;
}

function removeObject(ctx: Ctx, objectId: ObjectId): void {
  const o = ctx.state.objects[objectId];
  if (!o) return;
  if (o.venueId) {
    const v = ctx.state.venues[o.venueId];
    if (v) {
      v.objectIds = v.objectIds.filter((x) => x !== objectId);
      for (const r of v.rooms) r.objectIds = r.objectIds.filter((x) => x !== objectId);
    }
  }
  if (o.carriedBy) {
    const s = ctx.state.sims[o.carriedBy];
    if (s) s.inventory.objectIds = s.inventory.objectIds.filter((x) => x !== objectId);
  }
  delete ctx.state.objects[objectId];
}

// ---------------------------------------------------------------------------
// Loss events
// ---------------------------------------------------------------------------
function householdAt(ctx: Ctx, venueId: VenueId): Household | undefined {
  return Object.values(ctx.state.households).find((h) => h.homeVenueId === venueId);
}

function insurancePayout(ctx: Ctx, hh: Household, loss: number, label: string): void {
  const head = headOfHousehold(ctx, hh);
  if (!head) return;
  const payout = round2(Math.max(0, loss - INSURANCE_DEDUCTIBLE));
  if (isInsured(ctx, hh) && payout > 0) {
    ctx.schedule({ inMinutes: 7 * DAY, kind: '_insurance_payout', label: 'Insurance claim payout', simId: head.id, payload: { amount: payout, label } });
    ctx.log({ text: `You file an insurance claim for ${formatMoney(loss)}. After the ${formatMoney(INSURANCE_DEDUCTIBLE)} deductible, ${formatMoney(payout)} should arrive in about a week.`, kind: 'money', simId: head.id, importance: 2 });
  } else if (!isInsured(ctx, hh)) {
    ctx.log({ text: `No insurance. The ${formatMoney(loss)} loss is yours to eat.`, kind: 'money', simId: head.id, importance: 2 });
  }
}

function burglary(ctx: Ctx, venueId: VenueId, lossHint: number): void {
  const hh = householdAt(ctx, venueId);
  const home = ctx.state.venues[venueId];
  if (!hh || !home) return;
  const candidates = ctx.query.objectsAt(venueId).filter((o) => {
    const def = ctx.content.objects[o.defId];
    return def ? def.portable || def.category === 'electronics' : ['tv', 'laptop', 'computer', 'gaming_console', 'bluetooth_speaker', 'guitar', 'safe'].includes(o.defId);
  });
  let loss = 0;
  const stolen: string[] = [];
  for (const o of ctx.rng.pickN(candidates, Math.min(3, candidates.length))) {
    loss += objectValue(ctx, o);
    stolen.push(ctx.content.objects[o.defId]?.name ?? o.defId.replace(/_/g, ' '));
    removeObject(ctx, o.id);
  }
  if (isFiniteNumber(lossHint) && lossHint > 0) loss = Math.max(loss, lossHint);
  if (loss <= 0) loss = 250;
  loss = round2(loss);
  home.safety = clamp100(home.safety - 10);
  const head = headOfHousehold(ctx, hh);
  ctx.log({ text: `Someone broke into ${home.name}.${stolen.length ? ` Gone: ${stolen.join(', ')}.` : ''} Estimated loss ${formatMoney(loss)}.`, kind: 'alert', simId: head?.id, importance: 3, venueId });
  for (const id of hh.simIds) ctx.applyEffects(id, { moodlets: [{ id: 'burgled', emotion: 'scared', label: 'Burgled', intensity: -15, durationMinutes: 5 * DAY }], stress: 15 }, 'property:burglary');
  ctx.emit({ type: 'legal:police_called', venueId, reason: 'burglary', simId: head?.id });
  insurancePayout(ctx, hh, loss, 'burglary');
}

function fire(ctx: Ctx, venueId: VenueId, severityRaw: number): void {
  const hh = householdAt(ctx, venueId);
  const home = ctx.state.venues[venueId];
  const res = home?.residence;
  if (!hh || !home || !res) return;
  const sev = clamp(severityRaw > 1 ? severityRaw / 3 : severityRaw, 0.1, 1);
  res.condition = clamp100(res.condition - 40 * sev);
  let loss = round2(res.marketValue * 0.05 * sev);
  for (const o of ctx.query.objectsAt(venueId)) {
    if (!o.state.broken && ctx.rng.chance(sev * 0.5)) {
      o.state.broken = true;
      o.state.condition = clamp100(o.state.condition - 50);
      loss += objectValue(ctx, o) * 0.6;
      ctx.emit({ type: 'property:broken', objectId: o.id, venueId });
    }
  }
  loss = round2(loss);
  home.cleanliness = clamp100(home.cleanliness - 30 * sev);
  const head = headOfHousehold(ctx, hh);
  ctx.log({ text: `Fire at ${home.name}. Damage estimated at ${formatMoney(loss)}; the place smells of smoke.`, kind: 'alert', simId: head?.id, importance: 3, venueId });
  for (const id of hh.simIds) ctx.applyEffects(id, { moodlets: [{ id: 'house_fire', emotion: 'scared', label: 'House fire', intensity: -20, durationMinutes: 7 * DAY }], stress: 25 }, 'property:fire');
  insurancePayout(ctx, hh, loss, 'fire');
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const propertySystem: System = {
  id: 'property',
  intervalMinutes: 60,

  onInit(ctx) {
    for (const hh of Object.values(ctx.state.households)) ensureHome(ctx, hh);
  },

  onTick() {
    /* hourly work is event-driven; daily upkeep runs on time:day */
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'time:day':
        for (const hh of activeHouseholds(ctx)) dailyUpkeep(ctx, hh);
        break;
      case 'time:month':
        for (const hh of activeHouseholds(ctx)) {
          syncHousingBills(ctx, hh);
          const res = ctx.state.venues[hh.homeVenueId]?.residence;
          if (res?.tenure === 'rent' && res.monthlyRent) ctx.emit({ type: 'property:rent_due', householdId: hh.id, amount: res.monthlyRent });
          if (res?.tenure === 'own') res.marketValue = round2(res.marketValue * (1 + ctx.rng.normal(0.003, 0.006)));
        }
        break;
      case 'money:bill_missed': {
        if (event.billId !== 'rent') break;
        const sim = ctx.state.sims[event.simId];
        const hh = sim && ctx.query.householdOf(sim.id);
        if (sim && hh) {
          ctx.log({ text: `Rent is now ${sim.finance.bills.find((b) => b.id === 'rent')?.missed ?? 1} month(s) behind.`, kind: 'alert', simId: sim.id, importance: 2 });
          dailyUpkeep(ctx, hh);
        }
        break;
      }
      case 'money:bill_paid': {
        if (event.billId !== 'rent') break;
        const sim = ctx.state.sims[event.simId];
        const bill = sim?.finance.bills.find((b) => b.id === 'rent');
        if (sim && bill && bill.missed > 0 && Number(sim.flags['bill_arrears:rent'] ?? 0) <= 0) {
          bill.missed = 0;
          delete sim.flags.eviction_stage;
        }
        break;
      }
      case 'property:burglary':
        burglary(ctx, event.venueId, event.loss);
        break;
      case 'property:fire':
        fire(ctx, event.venueId, event.severity);
        break;
      case 'property:broken': {
        if (!event.venueId) break;
        const hh = householdAt(ctx, event.venueId);
        const head = hh && headOfHousehold(ctx, hh);
        if (head && ctx.query.isControlled(head.id)) {
          const o = ctx.state.objects[event.objectId];
          notify(ctx, head, 'Something broke', `The ${ctx.content.objects[o?.defId ?? '']?.name ?? o?.defId ?? 'appliance'} at home is broken.`);
        }
        break;
      }
      case 'shop:object_purchased': {
        const o = ctx.state.objects[event.objectId];
        const hh = ctx.query.householdOf(event.simId);
        if (!o || !hh) break;
        const home = ctx.state.venues[hh.homeVenueId];
        if (!home) break;
        if (!o.venueId || o.venueId === home.id) {
          const def = ctx.content.objects[o.defId];
          if (!home.objectIds.includes(o.id) || !o.roomId) placeObject(ctx.state, o, home.id, roomFor(home, def?.rooms?.[0] ?? 'Living Room'));
          o.ownerHouseholdId = hh.id;
          if (home.residence) home.residence.furnishingLevel = clamp100(home.residence.furnishingLevel + 2);
        }
        break;
      }
      case 'property:moved': {
        const hh = ctx.state.households[event.householdId as Household['id']];
        if (hh) ensureHome(ctx, hh);
        break;
      }
      case 'family:moved_in':
      case 'family:moved_out': {
        const hh = ctx.state.households[event.householdId as Household['id']];
        if (hh) syncHousingBills(ctx, hh);
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        const p = ev.payload ?? {};
        if (ev.kind === '_repair_arrival' || ev.kind === '_landlord_repair') {
          const o = ctx.state.objects[String(p.objectId) as ObjectId];
          if (o && o.state.broken) {
            o.state.broken = false;
            o.state.condition = clamp100(Math.max(o.state.condition, ev.kind === '_repair_arrival' ? 90 : 75));
            ctx.emit({ type: 'property:repaired', objectId: o.id });
            ctx.log({ text: `${ev.kind === '_repair_arrival' ? 'The repair tech' : "The landlord's handyman"} fixed the ${ctx.content.objects[o.defId]?.name ?? o.defId.replace(/_/g, ' ')}.`, kind: 'event', simId: ev.simId, importance: 1, venueId: ev.venueId });
          }
        } else if (ev.kind === '_exterminator' && ev.venueId) {
          const v = ctx.state.venues[ev.venueId];
          if (v) {
            v.tags = v.tags.filter((t) => t !== 'cockroaches');
            ctx.log({ text: 'The exterminator sprays everything. No more roaches, for now.', kind: 'event', simId: ev.simId, importance: 1, venueId: v.id });
          }
        } else if (ev.kind === '_insurance_payout' && ev.simId) {
          const amount = Number(p.amount ?? 0);
          if (amount > 0) ctx.applyEffects(ev.simId, { money: { amount, memo: `Insurance payout (${String(p.label ?? 'claim')})`, category: 'insurance' } }, 'property:insurance');
        } else if (ev.kind === '_home_sale' && ev.venueId && ev.simId) {
          const v = ctx.state.venues[ev.venueId];
          const sim = ctx.state.sims[ev.simId];
          const hh = sim && ctx.query.householdOf(sim.id);
          if (!v?.residence || !sim || !hh) break;
          const value = round2(Number(p.value ?? v.residence.marketValue) * ctx.rng.range(0.94, 1.03));
          const mortgage = sim.finance.loans.find((l) => l.kind === 'mortgage' && (l.collateralId === v.id || !l.collateralId));
          const payoff = mortgage?.balance ?? 0;
          const commission = round2(value * 0.05);
          const proceeds = round2(value - payoff - commission);
          if (mortgage) sim.finance.loans = sim.finance.loans.filter((l) => l.id !== mortgage.id);
          v.tags = v.tags.filter((t) => t !== 'for_sale');
          if (proceeds > 0) ctx.applyEffects(sim.id, { money: { amount: proceeds, memo: `Home sale proceeds (${v.name})`, category: 'sale', account: 'checking' } }, 'property:sale');
          v.residence.mortgage = undefined;
          if (hh.homeVenueId === v.id) {
            // still living there: the buyer rents it back at market rate
            v.residence.tenure = 'rent';
            v.residence.monthlyRent = round2(ctx.state.region.medianRent1br * ctx.state.economy.rentIndex * (0.8 + 0.28 * v.residence.bedrooms));
            v.residence.leaseEndsMinute = ctx.state.time.minute + 180 * DAY;
            syncHousingBills(ctx, hh);
          }
          ctx.log({ text: `${v.name} sold for ${formatMoney(value, { cents: false })}. After paying off ${formatMoney(payoff, { cents: false })} and ${formatMoney(commission, { cents: false })} in commission you net ${formatMoney(proceeds)}.${hh.homeVenueId === v.id ? ` You're renting it back at ${formatMoney(v.residence.monthlyRent)}/month until you move.` : ''}`, kind: 'money', simId: sim.id, importance: 3 });
        }
        break;
      }
      case 'custom': {
        const sim = event.simId ? ctx.state.sims[event.simId] : undefined;
        const p = event.payload ?? {};
        if (event.kind === 'chore:clean') {
          const hh = sim && ctx.query.householdOf(sim.id);
          const home = hh && ctx.state.venues[hh.homeVenueId];
          const amount = isFiniteNumber(p.amount) ? Number(p.amount) : 10;
          const venue = sim ? ctx.state.venues[sim.location.venueId] : home;
          if (venue) venue.cleanliness = clamp100(venue.cleanliness + amount);
          if (hh && venue?.id === home?.id) for (const c of hh.chores) if (c.id !== 'trash' && c.id !== 'laundry' && c.id !== 'yard') c.dirtiness = Math.max(0, c.dirtiness - amount * 2);
        } else if (event.kind === 'chore:laundry' || event.kind === 'chore:dishes') {
          const hh = sim && ctx.query.householdOf(sim.id);
          const c = hh?.chores.find((x) => x.id === (event.kind === 'chore:laundry' ? 'laundry' : 'dishes'));
          if (c) c.dirtiness = 0;
          const home = hh && ctx.state.venues[hh.homeVenueId];
          if (home) home.cleanliness = clamp100(home.cleanliness + 4);
        } else if (event.kind === 'property:foreclose') {
          const venueId = String(p.venueId ?? '') as VenueId;
          const hh = householdAt(ctx, venueId) ?? (sim && ctx.query.householdOf(sim.id));
          const home = hh && ctx.state.venues[hh.homeVenueId];
          if (hh && home) foreclose(ctx, hh, home);
        } else if (event.kind === 'property:damage') {
          const o = p.objectId ? ctx.state.objects[String(p.objectId) as ObjectId] : undefined;
          if (o) {
            o.state.condition = clamp100(o.state.condition - (isFiniteNumber(p.amount) ? Number(p.amount) : 20));
            if (o.state.condition <= 0) {
              o.state.broken = true;
              ctx.emit({ type: 'property:broken', objectId: o.id, venueId: o.venueId });
            }
          }
        }
        break;
      }
      default:
        break;
    }
  },

  actions: propertyActions,
  handles: (id) => id.startsWith('property:') || id.startsWith('phone:home:'),
  execute: (ctx, simId, action, params) => executeProperty(ctx, simId, action, params),
};
