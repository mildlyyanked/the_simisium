/**
 * World generation: turn a region + a Places provider + a household spec into a living WorldState.
 *
 *  1. run the search plan against Google (or the mock city) and build venues with real data
 *  2. furnish every venue from its archetype (objects, rooms) and hire its staff
 *  3. build the neighborhood: apartment buildings + residents, neighbors, institutions
 *  4. build the player household: home, furnishings, pantry, bills, members, pets, vehicle,
 *     off-screen family, a few friends, a job with a boss and coworkers
 *  5. write the opening narration
 */
import { CONTENT } from '../content';
import type { ContentCatalog } from '../content/types';
import { makeHousehold, makeObject, makeSim, makeVenue, makeEmptyWorld, placeObject } from '../core/factories';
import { newHouseholdId, newPetId, newVehicleId, newVenueId, shortId } from '../core/ids';
import type { LLMService } from '../core/llmTypes';
import { RNG } from '../core/rng';
import type { GooglePlaceData, Household, HouseholdId, LatLng, Pet, PetSpecies, Region, Residence, Sim, SimId, Vehicle, Venue, VenueArchetype, VenueId, WorldState } from '../core/types';
import { clamp, haversineKm, round2 } from '../core/util';
import { archetypeForTypes } from '../places/archetypes';
import { SEARCH_PLAN } from '../places/archetypeSearch';
import type { PlacesProvider } from '../places/types';
import { annualIncomeOf, generateFamilyFor, generateNpc, generatePlayerSim, link, makeJobFor, type GenCtx, type PlayerSimSpec } from './simgen';

const BUILDING_NAMES = ['The Meridian', 'Oak Hollow Apartments', 'Riverbend Lofts', 'Parkside Commons', 'The Wexford', 'Cedar Court', 'Maple Terrace', 'The Landon', 'Sunset Ridge Apartments', 'Brookstone Flats'];

export interface NewGameOptions {
  seed: string;
  epoch: string;
  name: string;
  region: Region;
  places: PlacesProvider;
  household: {
    name: string;
    members: PlayerSimSpec[];
    residence: 'apartment' | 'house' | 'room' | 'family_home';
    startingCash: number;
    pets?: { species: PetSpecies | string; name: string }[];
    vehicle?: 'none' | 'used_car' | 'bicycle' | 'new_car';
  };
  llm?: LLMService;
  onProgress?: (message: string, fraction: number) => void;
  maxVenues?: number;
  content?: ContentCatalog;
}

const PRICE_LEVEL_MULT = [0.6, 0.8, 1, 1.4, 2];
const ESSENTIAL_DISCOVERED: VenueArchetype[] = ['grocery', 'convenience', 'cafe', 'restaurant', 'gym', 'park', 'pharmacy', 'bank', 'library', 'hospital', 'clinic', 'gas_station', 'transit_stop', 'bar', 'fast_food', 'retail'];

function jitter(rng: RNG, c: LatLng, km: number): LatLng {
  const dLat = (rng.range(-km, km)) / 111;
  const dLng = (rng.range(-km, km)) / (111 * Math.cos((c.lat * Math.PI) / 180));
  return { lat: c.lat + dLat, lng: c.lng + dLng };
}

function furnish(state: WorldState, content: ContentCatalog, rng: RNG, venue: Venue): void {
  const arch = content.archetypes[venue.archetype];
  const defs = arch?.objects?.length ? arch.objects : [{ defId: 'park_bench', count: 1 }, { defId: 'public_restroom', count: 1 }];
  if (!venue.rooms.length) venue.rooms = (arch?.rooms ?? ['Main floor']).map((n) => ({ id: n.toLowerCase().replace(/\s+/g, '_'), name: n, objectIds: [] }));
  for (const o of defs) {
    if (!content.objects[o.defId]) continue;
    const def = content.objects[o.defId];
    const roomName = def.rooms?.[0];
    const room = venue.rooms.find((r) => roomName && (r.id === roomName || r.name.toLowerCase() === roomName)) ?? venue.rooms[0];
    for (let i = 0; i < o.count; i++) {
      const obj = makeObject(o.defId, { rng, venueId: venue.id, roomId: room?.id, quality: clamp(Math.round(venue.quality * 5), 1, 5) });
      obj.state.condition = rng.int(55, 100);
      obj.state.dirty = rng.int(0, 30);
      placeObject(state, obj, venue.id, room?.id);
    }
  }
}

function hireStaff(ctx: GenCtx, venue: Venue, cap: number): Sim[] {
  const arch = ctx.content.archetypes[venue.archetype];
  const out: Sim[] = [];
  const roles = arch?.staff?.length ? arch.staff : venue.archetype === 'home' || venue.archetype === 'apartment_building' ? [] : [{ role: 'staff', careerId: 'retail_associate', count: 1 }];
  const remaining = roles.filter((r) => ctx.content.careers[r.careerId]).map((r) => ({ ...r, left: Math.min(r.count, 3) }));
  let budget = cap;
  // one of each role before a second of any: a two-person club gets a bartender and a bouncer, not two barbacks
  while (budget > 0 && remaining.some((r) => r.left > 0)) {
    for (const r of remaining) {
      if (budget <= 0 || r.left <= 0) continue;
      const npc = generateNpc(ctx, { role: r.role, careerId: r.careerId, venueId: venue.id, employerVenueId: venue.id, ageRange: [19, 62], lod: 'far' });
      ctx.state.sims[npc.id] = npc;
      if (!venue.staffSimIds.includes(npc.id)) venue.staffSimIds.push(npc.id);
      out.push(npc);
      r.left--;
      budget--;
    }
  }
  return out;
}

function makeResidence(kind: Residence['kind'], tenure: Residence['tenure'], region: Region, rng: RNG, bedrooms: number): Residence {
  const rent = Math.round(region.medianRent1br * (bedrooms === 0 ? 0.6 : bedrooms === 1 ? rng.range(0.95, 1.2) : bedrooms === 2 ? rng.range(1.25, 1.55) : rng.range(1.6, 2.1)) / 5) * 5;
  const value = Math.round(region.medianHomePrice * (bedrooms <= 1 ? 0.55 : bedrooms === 2 ? 0.8 : 1.05) / 1000) * 1000;
  return {
    kind,
    bedrooms,
    bathrooms: Math.max(1, Math.ceil(bedrooms / 2)),
    sqft: bedrooms === 0 ? 420 : 550 + bedrooms * 380,
    tenure,
    monthlyRent: tenure === 'rent' ? rent : undefined,
    marketValue: value,
    condition: rng.int(60, 92),
    utilities: [],
    propertyTaxAnnual: tenure === 'own' ? Math.round(value * 0.018) : undefined,
    leaseEndsMinute: tenure === 'rent' ? 365 * 1440 : undefined,
    furnishingLevel: 40,
    securitySystem: false,
    yard: kind === 'house',
    garage: kind === 'house' && rng.chance(0.7),
    petsAllowed: kind === 'house' || rng.chance(0.6),
  };
}

const HOME_FURNITURE: Record<'apartment' | 'house' | 'room', [string, number, string][]> = {
  room: [['bed_single', 1, 'Bedroom'], ['desk', 1, 'Bedroom'], ['closet', 1, 'Bedroom'], ['lamp', 1, 'Bedroom'], ['bathroom_sink', 1, 'Bathroom'], ['toilet', 1, 'Bathroom'], ['shower', 1, 'Bathroom'], ['fridge', 1, 'Kitchen'], ['microwave', 1, 'Kitchen'], ['kitchen_sink', 1, 'Kitchen'], ['trash_can', 1, 'Kitchen'], ['laptop', 1, 'Bedroom']],
  apartment: [['bed_double', 1, 'Bedroom'], ['nightstand', 1, 'Bedroom'], ['closet', 1, 'Bedroom'], ['dresser', 1, 'Bedroom'], ['sofa', 1, 'Living Room'], ['coffee_table', 1, 'Living Room'], ['tv', 1, 'Living Room'], ['bookshelf', 1, 'Living Room'], ['dining_table', 1, 'Kitchen'], ['fridge', 1, 'Kitchen'], ['stove', 1, 'Kitchen'], ['microwave', 1, 'Kitchen'], ['coffee_maker', 1, 'Kitchen'], ['kitchen_sink', 1, 'Kitchen'], ['pantry_shelf', 1, 'Kitchen'], ['trash_can', 1, 'Kitchen'], ['bathroom_sink', 1, 'Bathroom'], ['toilet', 1, 'Bathroom'], ['shower', 1, 'Bathroom'], ['laundry_basket', 1, 'Bathroom'], ['laptop', 1, 'Living Room'], ['smoke_detector', 1, 'Living Room'], ['thermostat', 1, 'Living Room'], ['houseplant', 1, 'Living Room']],
  house: [['bed_double', 1, 'Bedroom'], ['nightstand', 2, 'Bedroom'], ['closet', 1, 'Bedroom'], ['dresser', 1, 'Bedroom'], ['sofa', 1, 'Living Room'], ['armchair', 1, 'Living Room'], ['coffee_table', 1, 'Living Room'], ['tv', 1, 'Living Room'], ['bookshelf', 1, 'Living Room'], ['rug', 1, 'Living Room'], ['dining_table', 1, 'Kitchen'], ['fridge', 1, 'Kitchen'], ['stove', 1, 'Kitchen'], ['oven', 1, 'Kitchen'], ['microwave', 1, 'Kitchen'], ['dishwasher', 1, 'Kitchen'], ['coffee_maker', 1, 'Kitchen'], ['kitchen_sink', 1, 'Kitchen'], ['pantry_shelf', 1, 'Kitchen'], ['trash_can', 1, 'Kitchen'], ['recycling_bin', 1, 'Kitchen'], ['bathroom_sink', 1, 'Bathroom'], ['toilet', 1, 'Bathroom'], ['bathtub', 1, 'Bathroom'], ['washer', 1, 'Laundry'], ['dryer', 1, 'Laundry'], ['laptop', 1, 'Living Room'], ['desk', 1, 'Bedroom'], ['smoke_detector', 1, 'Living Room'], ['thermostat', 1, 'Living Room'], ['vacuum', 1, 'Laundry'], ['mailbox', 1, 'Yard'], ['garden_bed', 1, 'Yard'], ['grill', 1, 'Yard'], ['patio_set', 1, 'Yard']],
};

const HOBBY_OBJECTS: Record<string, string> = { guitar: 'guitar', piano: 'keyboard', painting: 'easel', gaming: 'gaming_console', yoga: 'yoga_mat', gym: 'dumbbells', running: 'yoga_mat', reading: 'bookshelf', cooking: 'air_fryer', baking: 'oven', gardening: 'planter', board_games: 'board_games', chess: 'chess_set', photography: 'computer', writing: 'desk', woodworking: 'workbench', knitting: 'sewing_machine', cycling: 'bike_rack', music: 'record_player', podcasting: 'computer', streaming: 'computer' };

const STARTER_PANTRY: [string, number][] = [['eggs', 1], ['milk', 1], ['bread', 1], ['rice', 1], ['pasta', 2], ['chicken', 1], ['vegetables', 2], ['fruit', 2], ['cheese', 1], ['butter', 1], ['coffee_beans', 1], ['cereal', 1], ['snacks', 2], ['water_bottle', 4], ['toilet_paper', 4], ['soap', 1], ['toothpaste', 1], ['shampoo', 1], ['dish_soap', 1], ['laundry_detergent', 1], ['trash_bags', 1], ['painkillers', 1]];

/** The venue already built from this Google place, if any. */
export function venueForPlace(state: WorldState, placeId: string): Venue | undefined {
  return Object.values(state.venues).find((v) => v.google?.placeId === placeId);
}

/**
 * Add one real place to a running world (a search result the player looked up): built the same way
 * the seeded venues are, furnished from its archetype, with a skeleton staff so it is not empty.
 */
export function addVenueFromPlace(state: WorldState, content: ContentCatalog, rng: RNG, place: GooglePlaceData, opts: { discovered?: boolean; staff?: number } = {}): Venue {
  const existing = venueForPlace(state, place.placeId);
  if (existing) {
    if (opts.discovered) existing.discovered = true;
    return existing;
  }
  const region = state.region;
  const arch0 = archetypeForTypes(place.types, place.primaryType);
  const archetype: VenueArchetype = arch0 === 'unknown' ? 'retail' : arch0;
  const pl = place.priceLevel ?? 2;
  const venue = makeVenue({
    id: newVenueId(rng),
    name: place.displayName,
    archetype,
    location: place.location,
    google: place,
    rng,
    priceMultiplier: round2(PRICE_LEVEL_MULT[clamp(pl, 0, 4)] * region.costOfLiving),
    capacity: content.archetypes[archetype]?.capacity ?? 40,
    rooms: content.archetypes[archetype]?.rooms ?? ['Main floor'],
    tags: [...(content.archetypes[archetype]?.tags ?? []), 'looked_up'],
    discovered: opts.discovered ?? true,
  });
  venue.safety = clamp(Math.round((content.archetypes[archetype]?.safety ?? 75) - region.crimeIndex * 20 + rng.int(-8, 8)), 10, 99);
  venue.quality = clamp(place.rating ? place.rating / 5 : 0.6, 0.2, 1);
  venue.cleanliness = clamp(Math.round(55 + venue.quality * 40 + rng.int(-10, 10)), 20, 100);
  state.venues[venue.id] = venue;
  state.placesCache[place.placeId] = place;
  furnish(state, content, rng, venue);
  hireStaff({ state, rng, content }, venue, opts.staff ?? 2);
  return venue;
}

// ---------------------------------------------------------------------------
export async function generateWorld(opts: NewGameOptions): Promise<WorldState> {
  const content = opts.content ?? CONTENT;
  const progress = (m: string, f: number) => opts.onProgress?.(m, f);
  const state = makeEmptyWorld({ seed: opts.seed, epoch: opts.epoch, region: opts.region, name: opts.name });
  state.region = opts.region;
  state.economy.gasPrice = round2(3.29 * opts.region.costOfLiving);
  const rng = new RNG(`${opts.seed}:world`);
  const ctx: GenCtx = { state, rng, content };
  const center = opts.region.center;
  const maxVenues = opts.maxVenues ?? 120;

  // ------------------------------------------------------------------ 1. places
  progress(`Mapping ${opts.region.name}…`, 0.03);
  const seen = new Set<string>();
  const found: { data: GooglePlaceData; archetype: VenueArchetype }[] = [];
  let i = 0;
  for (const plan of SEARCH_PLAN) {
    i++;
    if (found.length >= maxVenues) break;
    try {
      let results: GooglePlaceData[] = [];
      if (plan.includedTypes.length) results = await opts.places.searchNearby(center, plan.radiusM, plan.includedTypes, plan.maxResults);
      if (!results.length && plan.textQuery) results = await opts.places.searchText(plan.textQuery, center, plan.radiusM, plan.maxResults);
      for (const r of results.slice(0, plan.maxResults)) {
        if (seen.has(r.placeId)) continue;
        seen.add(r.placeId);
        const arch = archetypeForTypes(r.types, r.primaryType);
        found.push({ data: r, archetype: arch === 'unknown' ? plan.archetype : arch });
      }
    } catch (err) {
      state.log.push({ id: shortId(rng, 'log'), at: 0, text: `Search for ${plan.archetype} failed: ${(err as Error).message}`, kind: 'system', importance: 0 });
    }
    if (i % 8 === 0) progress(`Found ${found.length} places…`, 0.03 + 0.25 * (i / SEARCH_PLAN.length));
  }
  // details for the closest, most important places
  const important = found
    .filter((f) => ESSENTIAL_DISCOVERED.includes(f.archetype) || ['school', 'police', 'courthouse', 'dmv', 'college'].includes(f.archetype))
    .sort((a, b) => haversineKm(center, a.data.location) - haversineKm(center, b.data.location))
    .slice(0, 30);
  let d = 0;
  for (const f of important) {
    d++;
    try {
      const det = await opts.places.details(f.data.placeId);
      f.data = { ...f.data, ...det };
    } catch {
      /* keep summary data */
    }
    if (d % 6 === 0) progress(`Reading reviews and hours…`, 0.28 + 0.12 * (d / important.length));
  }
  progress('Building the city…', 0.42);
  const byArch = new Map<VenueArchetype, Venue[]>();
  for (const f of found) {
    const pl = f.data.priceLevel ?? 2;
    const venue = makeVenue({
      id: newVenueId(rng),
      name: f.data.displayName,
      archetype: f.archetype,
      location: f.data.location,
      google: f.data,
      rng,
      priceMultiplier: round2(PRICE_LEVEL_MULT[clamp(pl, 0, 4)] * opts.region.costOfLiving),
      capacity: content.archetypes[f.archetype]?.capacity ?? 40,
      rooms: content.archetypes[f.archetype]?.rooms ?? ['Main floor'],
      tags: [...(content.archetypes[f.archetype]?.tags ?? [])],
    });
    venue.safety = clamp(Math.round((content.archetypes[f.archetype]?.safety ?? 75) - opts.region.crimeIndex * 20 + rng.int(-8, 8)), 10, 99);
    venue.quality = clamp(f.data.rating ? f.data.rating / 5 : 0.6, 0.2, 1);
    venue.cleanliness = clamp(Math.round(55 + venue.quality * 40 + rng.int(-10, 10)), 20, 100);
    state.venues[venue.id] = venue;
    state.placesCache[f.data.placeId] = f.data;
    (byArch.get(f.archetype) ?? byArch.set(f.archetype, []).get(f.archetype)!).push(venue);
  }
  // make sure the essentials exist even if the provider came up short
  for (const arch of ['grocery', 'cafe', 'restaurant', 'park', 'hospital', 'police', 'courthouse', 'dmv', 'school', 'bank', 'gym', 'pharmacy', 'bar', 'library', 'transit_stop', 'gas_station', 'jail', 'apartment_building'] as VenueArchetype[]) {
    if (byArch.get(arch)?.length) continue;
    const def = content.archetypes[arch];
    const v = makeVenue({ id: newVenueId(rng), name: arch === 'apartment_building' ? rng.pick(BUILDING_NAMES) : `${opts.region.name} ${def?.name ?? arch}`, archetype: arch, location: jitter(rng, center, 4), rng, priceMultiplier: opts.region.costOfLiving, rooms: def?.rooms ?? ['Main floor'], tags: ['generated'] });
    state.venues[v.id] = v;
    byArch.set(arch, [v]);
  }
  // discovery: the nearest of each essential type
  for (const arch of ESSENTIAL_DISCOVERED) {
    const list = (byArch.get(arch) ?? []).sort((a, b) => haversineKm(center, a.location) - haversineKm(center, b.location));
    list.slice(0, arch === 'restaurant' || arch === 'cafe' ? 2 : 1).forEach((v) => (v.discovered = true));
  }

  // ------------------------------------------------------------------ 2. furnish & staff
  progress('Stocking shelves and hiring staff…', 0.5);
  const venues = Object.values(state.venues);
  let staffBudget = 130;
  for (const v of venues) {
    furnish(state, content, rng, v);
    if (staffBudget > 0 && v.archetype !== 'home' && v.archetype !== 'apartment_building') {
      const essential = ESSENTIAL_DISCOVERED.includes(v.archetype) || ['school', 'police', 'hospital', 'clinic', 'college', 'courthouse', 'dmv'].includes(v.archetype);
      const cap = essential ? 4 : v.discovered ? 3 : 1;
      staffBudget -= hireStaff(ctx, v, Math.min(cap, staffBudget)).length;
    }
  }
  // staff live somewhere: attach them to apartment buildings as residents/regulars
  const buildings = byArch.get('apartment_building') ?? [];
  if (!buildings.length) {
    for (let b = 0; b < 3; b++) {
      const v = makeVenue({ id: newVenueId(rng), name: rng.pick(BUILDING_NAMES), archetype: 'apartment_building', location: jitter(rng, center, 2.5), rng, rooms: content.archetypes.apartment_building?.rooms ?? ['Lobby'], tags: ['generated'] });
      state.venues[v.id] = v;
      furnish(state, content, rng, v);
      buildings.push(v);
    }
    byArch.set('apartment_building', buildings);
  }
  for (const sim of Object.values(state.sims)) {
    if (sim.householdId) continue;
    const b = rng.pick(buildings);
    b.regularSimIds.push(sim.id);
    const sleep = sim.schedule.find((s) => s.kind === 'sleep');
    if (sleep) sleep.venueId = b.id;
    sim.location = { venueId: b.id, arrivedAt: 0 };
  }

  // ------------------------------------------------------------------ 3. neighborhood
  progress('Moving in the neighbors…', 0.6);
  const homeLoc = jitter(rng, center, 1.2);
  const nearestBuilding = [...buildings].sort((a, b) => haversineKm(homeLoc, a.location) - haversineKm(homeLoc, b.location))[0];
  const residentCareers = Object.values(content.careers).filter((c) => c.sector !== 'criminal');
  const residents: Sim[] = [];
  for (let r = 0; r < 28; r++) {
    const b = r < 8 ? nearestBuilding : rng.pick(buildings);
    const employed = rng.chance(0.78);
    const career = employed && residentCareers.length ? rng.pick(residentCareers) : undefined;
    const employerPool = career ? venues.filter((v) => career.venues.includes(v.archetype)) : [];
    const employer = employerPool.length ? rng.pick(employerPool) : undefined;
    const npc = generateNpc(ctx, { venueId: b.id, homeVenueId: b.id, careerId: career?.id, employerVenueId: employer?.id, ageRange: [19, 74], lod: r < 8 ? 'near' : 'far' });
    state.sims[npc.id] = npc;
    b.regularSimIds.push(npc.id);
    residents.push(npc);
  }
  // a few NPC couples
  for (let c = 0; c < 6; c++) {
    const [a, b] = rng.pickN(residents, 2);
    if (!a || !b || a.relationships[b.id]) continue;
    link(state, a, b, ['married'], ['married'], { friendship: 55, romance: 50, trust: 60, familiarity: 100 }, 0);
  }

  // ------------------------------------------------------------------ 4. player household
  progress('Building your home…', 0.7);
  const hh = opts.household;
  const homeKind = hh.residence === 'family_home' ? 'house' : hh.residence;
  const home = makeVenue({
    id: newVenueId(rng),
    name: hh.residence === 'room' ? `${nearestBuilding.name}, room` : hh.residence === 'apartment' ? `${nearestBuilding.name} #${rng.int(101, 812)}` : `${hh.name} home`,
    archetype: 'home',
    location: hh.residence === 'apartment' || hh.residence === 'room' ? nearestBuilding.location : homeLoc,
    rng,
    rooms: homeKind === 'house' ? ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Laundry', 'Yard'] : homeKind === 'room' ? ['Bedroom', 'Kitchen', 'Bathroom'] : ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'],
    discovered: true,
    tags: ['player_home'],
  });
  const adults = hh.members.filter((m) => m.age >= 18).length || 1;
  const bedrooms = hh.residence === 'room' ? 0 : clamp(Math.ceil(hh.members.length / 2), 1, 4);
  home.residence = makeResidence(homeKind === 'room' ? 'room' : homeKind === 'house' ? 'house' : 'apartment', hh.residence === 'family_home' ? 'family' : hh.residence === 'house' && hh.startingCash >= 50000 ? 'own' : 'rent', opts.region, rng, bedrooms);
  if (home.residence.tenure === 'own') {
    const price = home.residence.marketValue;
    const down = Math.min(hh.startingCash * 0.5, price * 0.2);
    home.residence.mortgage = { id: shortId(rng, 'loan'), kind: 'mortgage', lender: 'Wells Fargo Home Mortgage', principal: price - down, balance: price - down, apr: state.economy.mortgageRate, monthlyPayment: round2(((price - down) * (state.economy.mortgageRate / 12)) / (1 - Math.pow(1 + state.economy.mortgageRate / 12, -360))), nextDueAt: 30 * 1440, missedPayments: 0, termMonths: 360, startedAt: 0, collateralId: home.id, inDefault: false, deferred: false };
  }
  state.venues[home.id] = home;
  const household: Household = makeHousehold({ id: newHouseholdId(rng), name: hh.name, simIds: [], homeVenueId: home.id, rng });
  home.ownerHouseholdId = household.id;
  state.households[household.id] = household;
  household.pantry = Object.fromEntries(STARTER_PANTRY.filter(([id]) => content.items[id]));

  // furnishings
  const furniture = [...HOME_FURNITURE[homeKind]];
  for (let m = 1; m < hh.members.length; m++) furniture.push([hh.members[m].age < 4 ? 'crib' : homeKind === 'room' ? 'bed_single' : 'bed_single', 1, 'Bedroom']);
  for (const m of hh.members) for (const h of m.hobbies ?? []) if (HOBBY_OBJECTS[h] && content.objects[HOBBY_OBJECTS[h]]) furniture.push([HOBBY_OBJECTS[h], 1, 'Living Room']);
  for (const [defId, count, roomName] of furniture) {
    if (!content.objects[defId]) continue;
    const room = home.rooms.find((r) => r.name === roomName) ?? home.rooms[0];
    for (let n = 0; n < count; n++) {
      const obj = makeObject(defId, { rng, venueId: home.id, roomId: room.id, ownerHouseholdId: household.id, quality: hh.startingCash >= 12000 ? 3 : 2 });
      obj.state.condition = rng.int(70, 100);
      placeObject(state, obj, home.id, room.id);
    }
  }
  home.residence.furnishingLevel = clamp(40 + furniture.length, 0, 100);

  // members
  progress('Bringing your household to life…', 0.78);
  const members: Sim[] = [];
  for (const spec of hh.members) {
    const sim = generatePlayerSim(ctx, spec, home.id, household.id);
    state.sims[sim.id] = sim;
    household.simIds.push(sim.id);
    members.push(sim);
  }
  // money split: adults share
  const perAdult = round2(hh.startingCash / adults);
  for (const sim of members) {
    const isAdult = new Date(state.epoch).getUTCFullYear() - new Date(sim.identity.birthDate).getUTCFullYear() >= 18;
    const cash = isAdult ? perAdult : 25;
    for (const a of sim.finance.accounts) {
      if (a.kind === 'cash') a.balance = Math.min(cash, 120);
      if (a.kind === 'checking') a.balance = round2(Math.max(0, cash - 120));
    }
    if (isAdult && cash >= 5000) sim.finance.accounts.push({ id: shortId(rng, 'acc'), kind: 'savings', bankName: 'First National', balance: round2(cash * 0.35), apy: 0.04, openedAt: 0, overdraftFeesThisMonth: 0, frozen: false });
    if (isAdult && cash >= 5000) {
      const checking = sim.finance.accounts.find((a) => a.kind === 'checking')!;
      checking.balance = round2(checking.balance - cash * 0.35);
    }
    if (isAdult && sim.finance.creditScore >= 620) sim.finance.accounts.push({ id: shortId(rng, 'acc'), kind: 'credit_card', bankName: rng.pick(['Chase', 'Capital One', 'Discover']), balance: 0, creditLimit: Math.round(clamp(annualIncomeOf(sim.career.job) * 0.1 || 1500, 500, 12000) / 100) * 100, apr: 0.249, openedAt: 0, overdraftFeesThisMonth: 0, frozen: false });
    sim.phone.plan = { provider: rng.pick(['Verizon', 'AT&T', 'T-Mobile', 'Mint Mobile']), monthly: isAdult ? rng.pick([35, 55, 70]) : 0, active: true };
  }
  // relationships inside the household
  const head = members[0];
  for (let m = 1; m < members.length; m++) {
    const other = members[m];
    const rel = hh.members[m].relationship ?? (hh.members[m].age < 18 && hh.members[0].age >= hh.members[m].age + 16 ? 'child' : Math.abs(hh.members[m].age - hh.members[0].age) <= 12 ? 'roommate' : 'sibling');
    switch (rel) {
      case 'spouse': link(state, head, other, ['married'], ['married'], { friendship: 70, romance: 65, trust: 75, familiarity: 100 }, 0); break;
      case 'partner': link(state, head, other, ['partner'], ['partner'], { friendship: 65, romance: 60, trust: 65, familiarity: 95 }, 0); break;
      case 'child': link(state, head, other, ['child'], ['parent'], { friendship: 60, trust: 70, familiarity: 100 }, 0); break;
      case 'parent': link(state, head, other, ['parent'], ['child'], { friendship: 55, trust: 65, familiarity: 100 }, 0); break;
      case 'sibling': link(state, head, other, ['sibling'], ['sibling'], { friendship: 45, trust: 55, familiarity: 100 }, 0); break;
      default: link(state, head, other, ['roommate'], ['roommate'], { friendship: 35, trust: 40, familiarity: 70 }, 0);
    }
    // siblings among children
    for (let k = 1; k < m; k++) {
      const a = members[k];
      const ra = hh.members[k].relationship;
      const rb = hh.members[m].relationship;
      if (ra === 'child' && rb === 'child') link(state, a, other, ['sibling'], ['sibling'], { friendship: 45, trust: 50, familiarity: 100 }, 0);
      if ((ra === 'spouse' || ra === 'partner') && rb === 'child') link(state, a, other, ['child'], ['parent'], { friendship: 60, trust: 70, familiarity: 100 }, 0);
    }
  }
  state.player = { householdId: household.id, activeSimId: head.id, controlledSimIds: members.map((m) => m.id), favorites: [], tutorial: {} };

  // pets
  for (const p of hh.pets ?? []) {
    const breeds = content.petBreeds.filter((b) => b.species === p.species);
    const breed = breeds.length ? rng.pick(breeds) : content.petBreeds[0];
    if (!breed) continue;
    const pet: Pet = {
      id: newPetId(rng), name: p.name, species: breed.species, breed: breed.breed, birthDate: `${new Date(state.epoch).getUTCFullYear() - rng.int(1, Math.max(1, Math.floor(breed.lifespanYears / 2)))}-06-01`, gender: rng.pick(['male', 'female']),
      needs: { hunger: 80, thirst: 80, energy: 80, bladder: 80, hygiene: 70, play: 70, affection: 70 }, health: 90, weight: breed.size === 'large' ? 30 : breed.size === 'medium' ? 14 : breed.size === 'small' ? 6 : 1,
      training: rng.int(20, 60), temperament: rng.pick(breed.temperaments), bonds: Object.fromEntries(members.map((m) => [m.id, rng.int(50, 85)])), householdId: household.id, location: { venueId: home.id }, illnesses: [], vaccinated: true, spayedNeutered: rng.chance(0.8), microchipped: rng.chance(0.6), licensed: false, alive: true, adoptedAt: 0, monthlyCost: breed.monthlyCost, quirks: rng.pickN(['sheds everywhere', 'afraid of the vacuum', 'steals socks', 'sleeps on your pillow', 'barks at the mail carrier', 'begs shamelessly'], 2),
    };
    state.pets[pet.id] = pet;
    household.petIds.push(pet.id);
    if (content.items.dog_food && pet.species === 'dog') household.pantry.dog_food = 3;
    if (content.items.cat_food && pet.species === 'cat') { household.pantry.cat_food = 3; household.pantry.cat_litter = 1; }
  }
  // vehicle
  if (hh.vehicle && hh.vehicle !== 'none') {
    const year = new Date(state.epoch).getUTCFullYear();
    const pool = content.vehicles.filter((v) => hh.vehicle === 'bicycle' ? v.kind === 'bicycle' || v.kind === 'ebike' : v.kind === 'car' || v.kind === 'suv' || v.kind === 'truck');
    const def = pool.length ? rng.pick(pool) : undefined;
    if (def) {
      const age = hh.vehicle === 'new_car' ? 0 : rng.int(5, 12);
      const value = hh.vehicle === 'bicycle' ? def.basePriceNew : Math.round(def.basePriceNew * Math.pow(0.86, age));
      const vehicle: Vehicle = { id: newVehicleId(rng), kind: def.kind, make: def.make, model: def.model, year: year - age, color: rng.pick(['white', 'silver', 'black', 'gray', 'blue', 'red', 'green']), ownerHouseholdId: household.id, value, mileage: age * rng.int(9000, 14000), fuel: rng.int(30, 90), fuelType: def.fuelType, tankGallons: def.tankGallons, mpg: def.mpg, condition: clamp(100 - age * 5 + rng.int(-8, 8), 30, 100), registrationExpiresAt: rng.int(60, 360) * 1440, insurance: def.kind === 'bicycle' ? undefined : { provider: rng.pick(['State Farm', 'GEICO', 'Progressive']), monthly: def.insuranceMonthly, active: true, coverage: age > 8 ? 'liability' : 'full' }, location: { venueId: home.id }, seats: def.seats, issues: [], parkedIllegally: false };
      if (hh.vehicle !== 'bicycle' && value > hh.startingCash * 0.6 && hh.vehicle !== 'new_car') {
        vehicle.loan = { id: shortId(rng, 'loan'), kind: 'auto', lender: 'Credit union', principal: value * 0.8, balance: value * 0.6, apr: 0.079, monthlyPayment: round2((value * 0.8) / 60 * 1.2), nextDueAt: 20 * 1440, missedPayments: 0, termMonths: 60, startedAt: -365 * 1440, collateralId: vehicle.id, inDefault: false, deferred: false };
        head.finance.loans.push(vehicle.loan);
      }
      if (hh.vehicle === 'new_car') head.finance.loans.push({ id: shortId(rng, 'loan'), kind: 'auto', lender: 'Dealer financing', principal: value, balance: value * 0.95, apr: 0.069, monthlyPayment: round2((value / 72) * 1.2), nextDueAt: 25 * 1440, missedPayments: 0, termMonths: 72, startedAt: -30 * 1440, collateralId: vehicle.id, inDefault: false, deferred: false });
      state.vehicles[vehicle.id] = vehicle;
      household.vehicleIds.push(vehicle.id);
    }
  }

  // ------------------------------------------------------------------ 5. social graph
  progress('Remembering old friends…', 0.86);
  for (const sim of members) {
    const age = new Date(state.epoch).getUTCFullYear() - new Date(sim.identity.birthDate).getUTCFullYear();
    if (hh.residence !== 'family_home' && age >= 16) generateFamilyFor(ctx, sim, { center });
    if (age >= 16) {
      const pool = residents.filter((r) => Math.abs(new Date(state.epoch).getUTCFullYear() - new Date(r.identity.birthDate).getUTCFullYear() - age) <= 10 && !r.relationships[sim.id]);
      for (const f of rng.pickN(pool, Math.min(pool.length, rng.int(2, 3)))) {
        f.lod = 'near';
        link(state, sim, f, ['friend'], ['friend'], { friendship: rng.int(30, 62), trust: rng.int(25, 55), familiarity: rng.int(35, 65) }, 0);
      }
    }
    // neighbors
    for (const nId of nearestBuilding.regularSimIds.slice(0, 3)) {
      const n = state.sims[nId];
      if (n && !n.relationships[sim.id]) link(state, sim, n, ['neighbor'], ['neighbor'], { friendship: rng.int(0, 15), trust: 5, familiarity: rng.int(4, 12) }, 0);
    }
    // job: boss & coworkers
    const job = sim.career.job;
    if (job?.employerVenueId) {
      const venue = state.venues[job.employerVenueId];
      const career = content.careers[job.careerId];
      if (venue && career) {
        if (!venue.staffSimIds.includes(sim.id)) venue.staffSimIds.push(sim.id);
        if (!job.bossSimId) {
          const boss = generateNpc(ctx, { role: 'manager', careerId: career.id, careerLevel: Math.min(career.levels.length - 1, job.level + 2), venueId: venue.id, employerVenueId: venue.id, ageRange: [30, 60], lod: 'near' });
          state.sims[boss.id] = boss;
          venue.staffSimIds.push(boss.id);
          job.bossSimId = boss.id;
          link(state, sim, boss, ['boss'], ['employee'], { friendship: rng.int(5, 30), trust: rng.int(10, 40), familiarity: rng.int(30, 55) }, 0);
        }
        const coworkers = venue.staffSimIds.filter((id) => id !== sim.id && id !== job.bossSimId).slice(0, 5);
        job.coworkerSimIds = coworkers;
        for (const cId of coworkers) {
          const c = state.sims[cId];
          if (c && !c.relationships[sim.id]) {
            c.lod = 'near';
            link(state, sim, c, ['coworker'], ['coworker'], { friendship: rng.int(5, 40), trust: rng.int(5, 35), familiarity: rng.int(25, 60) }, 0);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ 6. opening
  progress('Writing the first page…', 0.94);
  const w = state.weather.current;
  const hour = Math.floor(state.time.minute / 60) % 24;
  const intro = [
    `${opts.region.name}, ${opts.region.state}. ${opts.region.culture}`,
    `${hh.residence === 'room' ? 'A rented room' : hh.residence === 'house' ? 'A house' : hh.residence === 'family_home' ? 'The family home' : 'An apartment'} — ${home.name}. ${home.residence.tenure === 'rent' ? `Rent is $${home.residence.monthlyRent?.toLocaleString()} a month, due on the 1st.` : home.residence.tenure === 'own' ? 'The mortgage is yours now.' : 'No rent, and no privacy.'}`,
    `${hour < 12 ? 'Morning' : 'Afternoon'}. ${w.condition.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}, ${Math.round(w.tempF)}°F. ${members.length > 1 ? `${members.map((m) => m.identity.firstName).join(', ')} are home.` : `${head.identity.firstName} is home.`} ${head.career.job ? `Work at ${head.career.job.employerName} as a ${head.career.job.title.toLowerCase()}.` : 'No job yet.'} $${hh.startingCash.toLocaleString()} to your name.`,
  ];
  intro.forEach((t, k) => state.log.push({ id: shortId(rng, 'log'), at: state.time.minute, text: t, kind: 'narrative', simId: head.id, venueId: home.id, importance: k === 2 ? 2 : 1 }));
  state.stats.placesVisited = 1;
  state.stats.simsMet = Object.keys(head.relationships).length;
  if (opts.llm) {
    try {
      home.description = await opts.llm.describeVenue(state, home);
    } catch {
      /* optional */
    }
  }
  progress('Done.', 1);
  state.rngState = rng.getState();
  return state;
}

export { type PlayerSimSpec } from './simgen';
