/**
 * Factories that produce complete, valid records with sensible defaults.
 * Used by worldgen, simgen, tests, and any system that spawns entities.
 */
import { birthDateForAge } from './clock';
import { newHouseholdId, newObjectId, newSimId, newVenueId, shortId } from './ids';
import type { RNG } from './rng';
import type {
  Account,
  AvatarParams,
  Body,
  Career,
  Education,
  Finance,
  Gender,
  Household,
  HouseholdId,
  Identity,
  LatLng,
  LegalRecord,
  LifeStage,
  Mind,
  Needs,
  ObjectInstance,
  Personality,
  PhoneState,
  Region,
  Sim,
  SimId,
  Venue,
  VenueArchetype,
  VenueId,
  WorldState,
} from './types';

export function lifeStageForAge(age: number): LifeStage {
  if (age < 1) return 'infant';
  if (age < 4) return 'toddler';
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'young_adult';
  if (age < 45) return 'adult';
  if (age < 65) return 'middle_aged';
  return 'senior';
}

export function defaultNeeds(): Needs {
  return { hunger: 80, thirst: 80, energy: 85, bladder: 85, hygiene: 80, social: 70, fun: 70, comfort: 75 };
}

export function defaultBody(age: number, gender: Gender, rng?: RNG): Body {
  const heightCm = gender === 'male' ? 176 : gender === 'female' ? 163 : 170;
  const bmi = rng ? rng.normalClamped(26, 4, 18, 40) : 25;
  const h = age < 18 ? heightCm * (0.5 + 0.5 * Math.min(1, age / 17)) : heightCm;
  return {
    health: 90,
    fitness: rng ? rng.normalClamped(45, 15, 10, 90) : 50,
    weight: Math.round(bmi * (h / 100) ** 2),
    heightCm: Math.round(h),
    illnesses: [],
    injuries: [],
    disabilities: [],
    addictions: {},
    bloodAlcohol: 0,
    caffeine: 0,
    cannabis: 0,
    sleepDebtHours: 0,
    immune: 70,
    lastAteAt: 0,
    lastSleptAt: 0,
    insurance: { kind: age < 26 ? 'parent' : 'none', monthlyPremium: 0, deductible: 3000, deductibleMet: 0, copay: 30, coinsurance: 0.2 },
    medications: [],
    fertility: age >= 15 && age <= 50 ? 0.7 : 0,
    alive: true,
  };
}

export function defaultMind(): Mind {
  return { stress: 20, mood: 10, moodlets: [], conditions: [], therapy: false, satisfaction: 55, dominantEmotion: 'happy' };
}

export function defaultPersonality(rng?: RNG): Personality {
  const r = (m = 0.5, sd = 0.18) => (rng ? rng.normalClamped(m, sd, 0.02, 0.98) : m);
  return {
    openness: r(),
    conscientiousness: r(),
    extraversion: r(),
    agreeableness: r(),
    neuroticism: r(),
    traits: [],
    values: { family: r(), career: r(), wealth: r(), adventure: r(), community: r(), faith: r(0.35, 0.25), creativity: r(), health: r(), knowledge: r(), pleasure: r() },
    speechStyle: 'plain, everyday American English',
    humor: r(),
    honesty: r(0.7, 0.15),
    ambition: r(),
    libido: r(),
    riskTolerance: r(0.4, 0.2),
    politics: rng ? rng.pick(['left', 'center-left', 'center', 'center-right', 'right', 'apolitical'] as const) : 'center',
    sexuality: rng ? rng.weighted([{ weight: 86, value: 'straight' as const }, { weight: 4, value: 'gay' as const }, { weight: 6, value: 'bi' as const }, { weight: 1, value: 'ace' as const }, { weight: 2, value: 'pan' as const }, { weight: 1, value: 'questioning' as const }]) : 'straight',
  };
}

export function defaultAvatar(rng?: RNG, gender: Gender = 'nonbinary'): AvatarParams {
  const skins = ['#F6D5B8', '#EFC3A0', '#D9A579', '#C68B59', '#A46B3C', '#7A4A24', '#5A3419'];
  const hairs = ['#1E1B18', '#3B2A20', '#6A4A2F', '#A5713C', '#D9B26A', '#B8B8B8', '#7F2F22', '#E0D7C6'];
  const eyes = ['#3A2A1D', '#5B3E2B', '#2E5C8A', '#3F7A4E', '#7A7A7A', '#6C4B2B'];
  const clothing = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#64748B', '#0EA5E9', '#F97316'];
  return {
    skin: rng ? rng.pick(skins) : skins[2],
    hair: rng ? rng.pick(hairs) : hairs[1],
    hairStyle: rng ? rng.int(0, 7) : 1,
    eye: rng ? rng.pick(eyes) : eyes[0],
    faceShape: rng ? rng.int(0, 3) : 0,
    accessory: rng ? rng.int(0, 4) : 0,
    clothing: rng ? rng.pick(clothing) : clothing[0],
    facialHair: gender === 'male' && rng ? rng.int(0, 3) : 0,
    glasses: rng ? rng.chance(0.3) : false,
  };
}

export function defaultAccounts(startingCash: number, rng?: RNG): Account[] {
  const now = 0;
  return [
    { id: shortId(rng, 'acc'), kind: 'cash', bankName: 'Wallet', balance: Math.min(startingCash, 120), openedAt: now, overdraftFeesThisMonth: 0, frozen: false },
    { id: shortId(rng, 'acc'), kind: 'checking', bankName: 'First National', balance: Math.max(0, startingCash - 120), openedAt: now, overdraftFeesThisMonth: 0, frozen: false, apy: 0.0001 },
  ];
}

export function defaultFinance(startingCash: number, rng?: RNG): Finance {
  return {
    accounts: defaultAccounts(startingCash, rng),
    loans: [],
    bills: [],
    creditScore: rng ? Math.round(rng.normalClamped(680, 60, 450, 820)) : 680,
    transactions: [],
    taxes: { ytdIncome: 0, ytdWithheld: 0, filedYears: [], owed: 0, refundPending: 0 },
    budget: {},
    netWorthHistory: [],
    benefits: { snap: 0, unemployment: false, socialSecurity: 0, disability: 0 },
  };
}

export function defaultLegal(age: number): LegalRecord {
  return {
    charges: [],
    warrants: [],
    license: { status: age >= 16 ? 'valid' : 'none', points: 0 },
    tickets: [],
    heat: 0,
    civil: { lawsuits: [] },
  };
}

export function defaultEducation(age: number): Education {
  const highest = age < 6 ? 'none' : age < 11 ? 'elementary' : age < 14 ? 'middle' : age < 18 ? 'middle' : 'high_school';
  return { highestLevel: highest, degrees: [], certifications: [], grade: age >= 5 && age < 18 ? Math.min(12, age - 5) : undefined };
}

export function defaultCareer(): Career {
  return { history: [], applications: [], gig: { platformsJoined: [], rating: 5, completed: 0 }, reputation: 50, retired: false };
}

export function defaultPhone(rng?: RNG): PhoneState {
  const n = rng ? `${rng.int(200, 989)}-${rng.int(200, 999)}-${rng.int(1000, 9999)}` : '512-555-0100';
  return { number: n, contacts: [], threads: {}, missedCalls: [], notifications: [], apps: ['messages', 'phone', 'bank', 'maps', 'jobs', 'shop', 'social', 'calendar', 'rideshare', 'delivery'], socialMedia: [], battery: 90, plan: { provider: 'Verizon', monthly: 55, active: true }, dataUsed: 0 };
}

export interface MakeSimOpts {
  id?: SimId;
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  epoch: string;
  rng?: RNG;
  venueId: VenueId;
  householdId?: HouseholdId;
  isPlayerControlled?: boolean;
  startingCash?: number;
  lod?: Sim['lod'];
  role?: Sim['role'];
  identity?: Partial<Identity>;
  personality?: Partial<Personality>;
  createdAt?: number;
}

export function makeSim(o: MakeSimOpts): Sim {
  const rng = o.rng;
  const pronouns = o.gender === 'male' ? 'he/him' : o.gender === 'female' ? 'she/her' : 'they/them';
  const identity: Identity = {
    firstName: o.firstName,
    lastName: o.lastName,
    gender: o.gender,
    pronouns,
    birthDate: birthDateForAge(o.epoch, o.age, rng ? rng.next() : 0.5),
    heritage: 'American',
    appearance: { hair: 'brown', eyes: 'brown', build: 'average', style: 'casual', distinguishing: [], avatar: defaultAvatar(rng, o.gender) },
    voice: 'even, unremarkable',
    hometown: 'here',
    ...(o.identity ?? {}),
  };
  const sim: Sim = {
    id: o.id ?? newSimId(rng),
    identity,
    lifeStage: lifeStageForAge(o.age),
    personality: { ...defaultPersonality(rng), ...(o.personality ?? {}) },
    needs: defaultNeeds(),
    body: defaultBody(o.age, o.gender, rng),
    mind: defaultMind(),
    skills: {},
    education: defaultEducation(o.age),
    career: defaultCareer(),
    finance: defaultFinance(o.startingCash ?? (o.age < 16 ? 20 : 1500), rng),
    legal: defaultLegal(o.age),
    relationships: {},
    memory: [],
    bio: { summary: '', facts: [], generated: false, seed: `${o.firstName}-${o.lastName}-${o.age}-${rng ? rng.nextU32() : 0}` },
    schedule: [],
    inventory: { objectIds: [], consumables: {}, wearing: ['casual clothes'] },
    location: { venueId: o.venueId, arrivedAt: o.createdAt ?? 0 },
    householdId: o.householdId,
    isPlayerControlled: o.isPlayerControlled ?? false,
    lod: o.lod ?? (o.isPlayerControlled ? 'full' : 'far'),
    role: o.role,
    hobbies: [],
    phone: defaultPhone(rng),
    flags: {},
    aspirations: [],
    createdAt: o.createdAt ?? 0,
    lastSimulatedAt: o.createdAt ?? 0,
    reputation: 0,
  };
  return sim;
}

export interface MakeVenueOpts {
  id?: VenueId;
  name: string;
  archetype: VenueArchetype;
  location: LatLng;
  rng?: RNG;
  address?: string;
  google?: Venue['google'];
  priceMultiplier?: number;
  capacity?: number;
  residence?: Venue['residence'];
  ownerHouseholdId?: HouseholdId;
  tags?: string[];
  discovered?: boolean;
  rooms?: string[];
}

export function makeVenue(o: MakeVenueOpts): Venue {
  return {
    id: o.id ?? newVenueId(o.rng),
    name: o.name,
    archetype: o.archetype,
    google: o.google,
    location: o.location,
    address: o.address ?? o.google?.formattedAddress,
    ownerHouseholdId: o.ownerHouseholdId,
    rooms: (o.rooms ?? []).map((n) => ({ id: n.toLowerCase().replace(/\s+/g, '_'), name: n, objectIds: [] })),
    objectIds: [],
    staffSimIds: [],
    regularSimIds: [],
    capacity: o.capacity ?? 30,
    priceMultiplier: o.priceMultiplier ?? 1,
    quality: o.google?.rating ? Math.min(1, Math.max(0.2, o.google.rating / 5)) : 0.6,
    cleanliness: 75,
    safety: 75,
    noise: 20,
    residence: o.residence,
    tags: o.tags ?? [],
    discovered: o.discovered ?? false,
  };
}

export function makeObject(defId: string, opts: { rng?: RNG; venueId?: VenueId; roomId?: string; ownerHouseholdId?: HouseholdId; quality?: number; carriedBy?: SimId; name?: string; price?: number; now?: number } = {}): ObjectInstance {
  return {
    id: newObjectId(opts.rng),
    defId,
    name: opts.name,
    venueId: opts.venueId,
    roomId: opts.roomId,
    carriedBy: opts.carriedBy,
    ownerHouseholdId: opts.ownerHouseholdId,
    state: { condition: 100, dirty: 0, broken: false, on: false },
    purchasedAtMinute: opts.now,
    purchasePrice: opts.price,
    quality: opts.quality ?? 2,
  };
}

export function makeHousehold(o: { id?: HouseholdId; name: string; simIds: SimId[]; homeVenueId: VenueId; rng?: RNG; now?: number }): Household {
  return {
    id: o.id ?? newHouseholdId(o.rng),
    name: o.name,
    simIds: o.simIds,
    homeVenueId: o.homeVenueId,
    petIds: [],
    vehicleIds: [],
    sharedFinances: true,
    pantry: {},
    chores: [],
    createdAt: o.now ?? 0,
    mail: [],
    packages: [],
  };
}

export function defaultRegion(partial: Partial<Region> = {}): Region {
  return {
    name: 'Austin',
    state: 'Texas',
    stateCode: 'TX',
    center: { lat: 30.2672, lng: -97.7431 },
    timezone: 'America/Chicago',
    costOfLiving: 1.03,
    climate: 'humid_subtropical',
    salesTax: 0.0825,
    stateIncomeTax: 0,
    population: 980000,
    density: 'urban',
    transitQuality: 0.35,
    walkability: 0.45,
    crimeIndex: 0.4,
    medianRent1br: 1450,
    medianHomePrice: 480000,
    minimumWage: 7.25,
    culture: 'Live music, tacos, tech workers, college town energy, "Keep Austin Weird".',
    ...partial,
  };
}

export function makeEmptyWorld(o: { seed: string; epoch: string; region?: Partial<Region>; name?: string }): WorldState {
  const region = defaultRegion(o.region);
  const nowIso = new Date().toISOString();
  return {
    meta: { saveId: shortId(undefined, 'save'), version: 1, seed: o.seed, createdAt: nowIso, updatedAt: nowIso, name: o.name ?? 'New Life', llmCalls: 0, llmCostUsd: 0, llmTokens: 0 },
    time: { minute: 8 * 60 },
    epoch: o.epoch,
    region,
    venues: {},
    sims: {},
    households: {},
    pets: {},
    objects: {},
    vehicles: {},
    player: { householdId: 'hh_none', activeSimId: 'sim_none', controlledSimIds: [], favorites: [], tutorial: {} },
    weather: { current: { condition: 'clear', tempF: 78, humidity: 50, windMph: 5, precipChance: 0.1, uv: 6, sunriseMinute: 420, sunsetMinute: 1140 }, forecast: [] },
    economy: { gasPrice: 3.29, inflationIndex: 1, primeRate: 0.075, mortgageRate: 0.065, savingsApy: 0.04, jobMarketHeat: 0.55, stockIndex: 100, rentIndex: 1, unemploymentRate: 0.042 },
    scheduled: [],
    log: [],
    conversations: {},
    layouts: {},
    rngState: [],
    stats: { daysPlayed: 0, actionsTaken: 0, moneyEarned: 0, moneySpent: 0, conversations: 0, simsMet: 0, placesVisited: 0, arrests: 0, promotions: 0, births: 0, deaths: 0 },
    placesCache: {},
    flags: {},
    pendingInterrupts: [],
  };
}

/** Attach an object to a venue (and room if given). */
export function placeObject(state: WorldState, obj: ObjectInstance, venueId: VenueId, roomId?: string): void {
  obj.venueId = venueId;
  obj.roomId = roomId;
  obj.carriedBy = undefined;
  state.objects[obj.id] = obj;
  const v = state.venues[venueId];
  if (!v) return;
  if (!v.objectIds.includes(obj.id)) v.objectIds.push(obj.id);
  if (roomId) {
    const r = v.rooms.find((x) => x.id === roomId);
    if (r && !r.objectIds.includes(obj.id)) r.objectIds.push(obj.id);
  }
}
