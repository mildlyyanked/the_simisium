/**
 * Sim generation: NPCs with coherent names, personalities, skills, jobs, finances and
 * schedules; player sims from a creation spec; and off-screen family for anyone who needs one.
 */
import type { ContentCatalog, CareerDef } from '../content/types';
import { NAME_POOLS, NONBINARY_FIRST_NAMES, poolForLastName, poolForRoll } from '../content/names';
import { birthDateForAge } from '../core/clock';
import { ensureRelationship } from '../core/effects';
import { defaultAvatar, defaultPersonality, lifeStageForAge, makeSim, makeVenue } from '../core/factories';
import { newSimId, newVenueId, shortId } from '../core/ids';
import type { RNG } from '../core/rng';
import type { EducationLevel, Gender, HouseholdId, Identity, Job, LatLng, Personality, RelationshipFlag, RoutineBlock, ShiftBlock, Sim, SimId, SimLOD, TraitId, Venue, VenueId, WorldState } from '../core/types';
import { clamp, round2 } from '../core/util';

export interface GenCtx {
  state: WorldState;
  rng: RNG;
  content: ContentCatalog;
}

export interface PlayerSimSpec {
  firstName: string;
  lastName: string;
  gender: Gender;
  age: number;
  traits: TraitId[];
  hobbies?: string[];
  careerId?: string | 'unemployed' | 'student';
  educationLevel?: EducationLevel;
  startingCash?: number;
  appearance?: Partial<Identity['appearance']>;
  personality?: Partial<Personality>;
  background?: string;
  aspiration?: string;
  relationship?: 'spouse' | 'partner' | 'child' | 'parent' | 'sibling' | 'roommate';
  pronouns?: string;
}

export interface NpcOpts {
  role?: string;
  careerId?: string;
  careerLevel?: number;
  venueId: VenueId;
  /** venue where the NPC works, if a job is created */
  employerVenueId?: VenueId;
  householdId?: HouseholdId;
  ageRange?: [number, number];
  gender?: Gender;
  lastName?: string;
  /** name pool id to keep families coherent */
  poolId?: string;
  lod?: SimLOD;
  homeVenueId?: VenueId;
}

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------
export function pickName(rng: RNG, gender: Gender, opts: { lastName?: string; poolId?: string } = {}): { first: string; last: string; heritage: string; poolId: string } {
  let pool = opts.poolId ? NAME_POOLS.find((p) => p.id === opts.poolId) : undefined;
  if (!pool && opts.lastName) pool = poolForLastName(opts.lastName);
  if (!pool) pool = poolForRoll(rng.next());
  const firstList = gender === 'nonbinary' ? NONBINARY_FIRST_NAMES : gender === 'male' ? pool.male : pool.female;
  const first = rng.pick(firstList.length ? firstList : ['Alex']);
  const last = opts.lastName ?? rng.pick(pool.last.length ? pool.last : ['Smith']);
  const heritage = rng.pick(pool.heritages.length ? pool.heritages : ['American']);
  return { first, last, heritage, poolId: pool.id };
}

// ---------------------------------------------------------------------------
// personality & traits
// ---------------------------------------------------------------------------
export function pickTraits(rng: RNG, content: ContentCatalog, count: number, forced: TraitId[] = []): TraitId[] {
  const all = Object.keys(content.traits);
  const out: TraitId[] = forced.filter((t) => content.traits[t]);
  const conflicts = (t: TraitId) => content.traits[t]?.conflicts ?? [];
  const tries = all.length * 3;
  for (let i = 0; i < tries && out.length < count && all.length; i++) {
    const t = rng.pick(all);
    if (out.includes(t)) continue;
    if (out.some((o) => conflicts(o).includes(t) || conflicts(t).includes(o))) continue;
    out.push(t);
  }
  return out;
}

const TRAIT_PERSONALITY: Record<string, Partial<Record<'openness' | 'conscientiousness' | 'extraversion' | 'agreeableness' | 'neuroticism' | 'ambition' | 'humor' | 'honesty' | 'riskTolerance' | 'libido', number>>> = {
  ambitious: { ambition: 0.35, conscientiousness: 0.15 },
  lazy: { conscientiousness: -0.3, ambition: -0.25 },
  cheerful: { neuroticism: -0.25, extraversion: 0.1 },
  gloomy: { neuroticism: 0.3, extraversion: -0.1 },
  hot_headed: { agreeableness: -0.3, neuroticism: 0.2 },
  outgoing: { extraversion: 0.35 },
  loner: { extraversion: -0.35 },
  romantic: { libido: 0.2, openness: 0.1 },
  kind: { agreeableness: 0.3 },
  mean: { agreeableness: -0.35, honesty: -0.1 },
  creative: { openness: 0.35 },
  genius: { openness: 0.2, conscientiousness: 0.1 },
  neat: { conscientiousness: 0.3 },
  slob: { conscientiousness: -0.3 },
  adventurous: { openness: 0.25, riskTolerance: 0.3 },
  thrill_seeker: { riskTolerance: 0.4, neuroticism: -0.1 },
  coward: { riskTolerance: -0.35, neuroticism: 0.15 },
  brave: { riskTolerance: 0.25, neuroticism: -0.15 },
  anxious: { neuroticism: 0.35 },
  stoic: { neuroticism: -0.3, extraversion: -0.1 },
  workaholic: { conscientiousness: 0.25, ambition: 0.25 },
  party_animal: { extraversion: 0.3, riskTolerance: 0.15 },
  perfectionist: { conscientiousness: 0.3, neuroticism: 0.15 },
  gossip: { extraversion: 0.15, honesty: -0.15 },
  honest: { honesty: 0.3 },
  kleptomaniac: { honesty: -0.3, riskTolerance: 0.2 },
  self_assured: { neuroticism: -0.2, extraversion: 0.15 },
  empathetic: { agreeableness: 0.3 },
  childish: { humor: 0.2, conscientiousness: -0.15 },
  hopeless_romantic: { libido: 0.15, agreeableness: 0.1 },
  commitment_issues: { libido: 0.1, agreeableness: -0.1 },
};

export function applyTraits(p: Personality, traits: TraitId[]): Personality {
  const out = { ...p, values: { ...p.values }, traits: [...traits] };
  for (const t of traits) {
    const adj = TRAIT_PERSONALITY[t];
    if (!adj) continue;
    for (const [k, v] of Object.entries(adj)) {
      const key = k as keyof typeof adj;
      (out as unknown as Record<string, number>)[key] = clamp((out as unknown as Record<string, number>)[key] + (v ?? 0), 0.02, 0.98);
    }
  }
  if (traits.includes('family_oriented')) out.values.family = clamp(out.values.family + 0.3, 0, 1);
  if (traits.includes('materialistic')) out.values.wealth = clamp(out.values.wealth + 0.3, 0, 1);
  if (traits.includes('spiritual')) out.values.faith = clamp(out.values.faith + 0.4, 0, 1);
  if (traits.includes('bookworm') || traits.includes('genius')) out.values.knowledge = clamp(out.values.knowledge + 0.25, 0, 1);
  if (traits.includes('active')) out.values.health = clamp(out.values.health + 0.25, 0, 1);
  if (traits.includes('creative')) out.values.creativity = clamp(out.values.creativity + 0.3, 0, 1);
  return out;
}

const SPEECH_STYLES = ['plain, everyday American English', 'quick and wry, deflects with jokes', 'warm, asks a lot of questions', 'dry, few words, precise', 'chatty, tangents, laughs at own stories', 'careful and polite, rarely swears', 'blunt, swears casually', 'earnest, a little formal', 'soft-spoken, trails off', 'upbeat, lots of "honestly" and "literally"', 'gruff but kind underneath', 'deadpan'];
const VOICES = ['even, unremarkable', 'low and slow', 'bright and quick', 'raspy', 'warm with a slight drawl', 'clipped and fast', 'soft, hard to hear in a crowd', 'booming, carries across a room', 'nasal, a bit flat', 'musical'];
const HAIR = ['black, cropped short', 'dark brown, shoulder length', 'brown, curly', 'blond, tied back', 'auburn, wavy', 'gray at the temples', 'buzzed', 'long locs', 'box braids', 'silver, cut short', 'dyed a fading blue', 'thinning on top', 'thick and dark, pushed back', 'a tight bun', 'shaggy and overdue for a cut'];
const EYES = ['brown', 'dark brown', 'hazel', 'green', 'blue', 'gray', 'amber'];
const BUILD = ['slight', 'wiry', 'average', 'sturdy', 'broad', 'soft', 'tall and lean', 'short and solid', 'athletic', 'heavyset'];
const STYLE = ['jeans and a hoodie', 'scrubs, most days', 'business casual with sneakers', 'thrifted everything', 'athleisure', 'work boots and a company polo', 'blazer over a band tee', 'sundresses and cardigans', 'all black', 'cargo shorts year round', 'a uniform they change out of in the car', 'pressed shirts, always'];
const DISTINGUISHING = ['a gap-toothed smile', 'reading glasses on a chain', 'a sleeve of tattoos', 'a small scar through one eyebrow', 'a septum ring', 'freckles', 'a laugh you hear before you see them', 'a hearing aid', 'a wedding ring worn on a chain', 'chewed nails', 'a limp from an old injury', 'a lanyard they forget to take off', 'expensive sneakers', 'a hat, always', 'very white teeth', 'an old smartwatch', 'paint under the fingernails'];
const HOMETOWNS = ['El Paso', 'Fresno', 'Toledo', 'a suburb of Atlanta', 'rural Iowa', 'the Bronx', 'Baton Rouge', 'Tucson', 'Spokane', 'a farm outside Omaha', 'Dayton', 'Jacksonville', 'Bakersfield', 'the Rio Grande Valley', 'Long Island', 'a Navy base in Virginia', 'Chattanooga', 'Detroit', 'Salt Lake City', 'Oakland', 'Lubbock', 'Albuquerque', 'Sacramento', 'Providence', 'Boise'];

function describeAppearance(rng: RNG, age: number, gender: Gender): Identity['appearance'] {
  const hair = age >= 60 ? rng.pick(['silver, cut short', 'gray at the temples', 'thinning on top', 'white, neatly combed']) : rng.pick(HAIR);
  return { hair, eyes: rng.pick(EYES), build: rng.pick(BUILD), style: rng.pick(STYLE), distinguishing: rng.pickN(DISTINGUISHING, rng.int(1, 2)), avatar: defaultAvatar(rng, gender) };
}

// ---------------------------------------------------------------------------
// education, skills, money
// ---------------------------------------------------------------------------
const EDU_ORDER: EducationLevel[] = ['none', 'elementary', 'middle', 'high_school', 'ged', 'some_college', 'associate', 'bachelor', 'master', 'professional', 'doctorate'];

function educationForAge(rng: RNG, age: number, career?: CareerDef): EducationLevel {
  if (age < 6) return 'none';
  if (age < 11) return 'elementary';
  if (age < 14) return 'middle';
  if (age < 18) return 'middle';
  const required = career?.educationRequired ?? 'high_school';
  const roll = rng.next();
  let level: EducationLevel = roll < 0.1 ? 'ged' : roll < 0.38 ? 'high_school' : roll < 0.55 ? 'some_college' : roll < 0.65 ? 'associate' : roll < 0.88 ? 'bachelor' : roll < 0.96 ? 'master' : 'doctorate';
  if (EDU_ORDER.indexOf(level) < EDU_ORDER.indexOf(required)) level = required;
  if (age < 22 && EDU_ORDER.indexOf(level) > EDU_ORDER.indexOf('some_college')) level = 'some_college';
  return level;
}

function seedSkills(rng: RNG, content: ContentCatalog, sim: Sim, age: number, career?: CareerDef, hobbies: string[] = []): void {
  const give = (id: string, level: number) => {
    if (!content.skills[id] || level <= 0) return;
    const cur = sim.skills[id]?.level ?? 0;
    sim.skills[id] = { level: Math.max(cur, clamp(Math.round(level), 0, 10)), xp: 0 };
  };
  const yrs = Math.max(0, age - 18);
  for (const s of career?.skills ?? []) give(s, rng.normalClamped(3 + Math.min(4, yrs / 6), 1.2, 1, 9));
  for (const h of hobbies) {
    const def = content.hobbies[h];
    if (def?.skillId) give(def.skillId, rng.normalClamped(2 + yrs / 12, 1.2, 1, 8));
  }
  // everybody has a little of the basics
  give('cooking', rng.normalClamped(1.5 + yrs / 15, 1.2, 0, 7));
  give('driving', age >= 16 ? rng.normalClamped(3 + yrs / 12, 1, 1, 8) : 0);
  give('charisma', rng.normalClamped(2 + sim.personality.extraversion * 3, 1.3, 0, 8));
  give('fitness', rng.normalClamped(sim.body.fitness / 18, 1, 0, 8));
  give('logic', rng.normalClamped(1.5 + EDU_ORDER.indexOf(sim.education.highestLevel) * 0.4, 1.2, 0, 8));
}

function seedFinances(rng: RNG, sim: Sim, annualIncome: number, age: number): void {
  const wealthy = rng.next();
  const savings = annualIncome > 0 ? round2(Math.max(0, rng.normal(annualIncome * (wealthy < 0.5 ? 0.05 : wealthy < 0.85 ? 0.25 : 0.9), annualIncome * 0.15))) : round2(rng.range(0, 800));
  const checking = round2(Math.max(20, rng.normal(annualIncome / 24, annualIncome / 40)));
  for (const a of sim.finance.accounts) {
    if (a.kind === 'checking') a.balance = checking;
    if (a.kind === 'cash') a.balance = round2(rng.range(5, 90));
  }
  if (savings > 200 && age >= 20) sim.finance.accounts.push({ id: shortId(rng, 'acc'), kind: 'savings', bankName: 'First National', balance: savings, apy: 0.04, openedAt: 0, overdraftFeesThisMonth: 0, frozen: false });
  if (age >= 21 && rng.chance(0.65)) {
    const limit = Math.round(clamp(annualIncome * 0.12, 500, 15000) / 100) * 100;
    sim.finance.accounts.push({ id: shortId(rng, 'acc'), kind: 'credit_card', bankName: rng.pick(['Chase', 'Capital One', 'Discover', 'Citi']), balance: round2(limit * rng.range(0, 0.6)), creditLimit: limit, apr: rng.range(0.19, 0.29), openedAt: 0, overdraftFeesThisMonth: 0, frozen: false });
  }
  if (age >= 24 && EDU_ORDER.indexOf(sim.education.highestLevel) >= EDU_ORDER.indexOf('associate') && rng.chance(0.55)) {
    const bal = round2(rng.range(6000, 48000));
    sim.finance.loans.push({ id: shortId(rng, 'loan'), kind: 'student', lender: 'Federal Student Aid', principal: bal * 1.2, balance: bal, apr: 0.055, monthlyPayment: round2(bal / 100), nextDueAt: 15 * 1440, missedPayments: 0, termMonths: 120, startedAt: 0, inDefault: false, deferred: false });
  }
  sim.finance.creditScore = Math.round(rng.normalClamped(690 + (annualIncome > 60000 ? 30 : 0) - (age < 25 ? 30 : 0), 55, 480, 830));
}

// ---------------------------------------------------------------------------
// jobs (mirrors career.ts makeJob without a SystemContext)
// ---------------------------------------------------------------------------
export function buildShiftsFor(level: CareerDef['levels'][number], rng: RNG): ShiftBlock[] {
  const len = Math.max(1, (level.shift.end - level.shift.start) / 60);
  const n = clamp(Math.round(level.hoursPerWeek / len), 1, level.shift.days.length);
  const days = rng.pickN(level.shift.days, n).sort((a, b) => a - b);
  return days.map((day) => ({ day, start: level.shift.start, end: level.shift.end }));
}

export function makeJobFor(ctx: GenCtx, sim: Sim, career: CareerDef, levelIdx: number, venue?: Venue, remote = false): Job {
  const level = career.levels[clamp(levelIdx, 0, career.levels.length - 1)];
  const col = ctx.state.region.costOfLiving;
  const hourly = level.hourly !== undefined;
  const benefits = level.hoursPerWeek >= 30 && career.sector !== 'criminal' && career.sector !== 'gig';
  const staff = venue ? venue.staffSimIds.filter((id) => id !== sim.id) : [];
  return {
    id: shortId(ctx.rng, 'job'),
    careerId: career.id,
    title: level.title,
    level: clamp(levelIdx, 0, career.levels.length - 1),
    employerName: venue?.name ?? (career.sector === 'criminal' ? 'the street' : `${career.name} (self-employed)`),
    employerVenueId: venue?.id,
    bossSimId: staff[0],
    coworkerSimIds: staff.slice(1, 8),
    payType: career.sector === 'gig' ? 'gig' : hourly ? 'hourly' : 'salary',
    hourlyRate: hourly ? round2(Math.max(ctx.state.region.minimumWage, (level.hourly ?? 15) * col)) : undefined,
    annualSalary: hourly ? undefined : Math.round((level.salary * col) / 100) * 100,
    shifts: buildShiftsFor(level, ctx.rng),
    remote,
    startedAt: ctx.state.time.minute - ctx.rng.int(30, 2000) * 1440,
    performance: Math.round(ctx.rng.normalClamped(62, 12, 25, 95)),
    promotionProgress: ctx.rng.int(0, 60),
    warnings: 0,
    ptoHoursBalance: benefits ? ctx.rng.int(0, 60) : 0,
    sickHoursBalance: benefits ? ctx.rng.int(0, 24) : 0,
    benefits: { health: benefits, retirement401k: benefits && !hourly, matchPct: benefits && !hourly ? 3 : 0, dental: benefits && !hourly },
    hoursWorkedThisPeriod: 0,
    lastPaidAt: ctx.state.time.minute,
    payFrequency: career.sector === 'criminal' ? 'weekly' : hourly ? 'biweekly' : 'semimonthly',
    status: 'active',
  };
}

export function annualIncomeOf(job?: Job): number {
  if (!job) return 0;
  if (job.annualSalary) return job.annualSalary;
  const hours = job.shifts.reduce((s, sh) => s + (sh.end - sh.start) / 60, 0);
  return (job.hourlyRate ?? 0) * hours * 52;
}

function workBlocks(job: Job): RoutineBlock[] {
  return job.shifts.map((s) => ({ day: s.day, start: s.start, end: s.end, kind: 'work' as const, venueId: job.remote ? undefined : job.employerVenueId, label: job.title }));
}

function levelForAge(rng: RNG, career: CareerDef, age: number): number {
  const max = career.levels.length - 1;
  const yrs = Math.max(0, age - 20);
  const target = clamp(Math.round(rng.normal(yrs / 7, 1)), 0, max);
  return target;
}

/** Sleep blocks that cross midnight are stored as two same-day spans (the schedule matcher is per-day). */
export function pushSleep(sim: Sim, start: number, end: number, venueId: VenueId): void {
  if (start < end) sim.schedule.push({ day: 'daily', start, end, kind: 'sleep', venueId, label: 'Sleep' });
  else {
    sim.schedule.push({ day: 'daily', start, end: 1440, kind: 'sleep', venueId, label: 'Sleep' });
    sim.schedule.push({ day: 'daily', start: 0, end, kind: 'sleep', venueId, label: 'Sleep' });
  }
}

// ---------------------------------------------------------------------------
// NPC
// ---------------------------------------------------------------------------
export function generateNpc(ctx: GenCtx, opts: NpcOpts): Sim {
  const { rng, content, state } = ctx;
  const gender: Gender = opts.gender ?? rng.weighted([{ weight: 49, value: 'male' as const }, { weight: 49, value: 'female' as const }, { weight: 2, value: 'nonbinary' as const }]);
  const [lo, hi] = opts.ageRange ?? [19, 68];
  const age = rng.int(lo, hi);
  const name = pickName(rng, gender, { lastName: opts.lastName, poolId: opts.poolId });
  const career = opts.careerId ? content.careers[opts.careerId] : undefined;
  const sim = makeSim({
    id: newSimId(rng),
    firstName: name.first,
    lastName: name.last,
    gender,
    age,
    epoch: state.epoch,
    rng,
    venueId: opts.venueId,
    householdId: opts.householdId,
    lod: opts.lod ?? 'far',
    role: opts.role ? { role: opts.role, venueId: opts.employerVenueId, title: career?.levels[0]?.title } : undefined,
    startingCash: 0,
    createdAt: state.time.minute,
    identity: { heritage: name.heritage, appearance: describeAppearance(rng, age, gender), voice: rng.pick(VOICES), hometown: rng.chance(0.6) ? state.region.name : rng.pick(HOMETOWNS) },
  });
  const traitCount = age < 13 ? 2 : rng.int(2, 4);
  const traits = pickTraits(rng, content, traitCount);
  sim.personality = applyTraits({ ...defaultPersonality(rng), speechStyle: rng.pick(SPEECH_STYLES) }, traits);
  const hobbyIds = Object.keys(content.hobbies);
  sim.hobbies = hobbyIds.length ? rng.pickN(hobbyIds, age < 6 ? 0 : rng.int(1, 3)) : [];
  sim.education.highestLevel = educationForAge(rng, age, career);
  if (age >= 5 && age < 18) sim.education.grade = clamp(age - 5, 0, 12);
  sim.bio.seed = `${name.first}-${name.last}-${age}-${rng.nextU32()}`;

  if (career && age >= 16 && age < 70) {
    const venue = opts.employerVenueId ? state.venues[opts.employerVenueId] : undefined;
    const level = opts.careerLevel ?? levelForAge(rng, career, age);
    const remote = career.levels[level]?.remoteEligible && rng.chance(0.35);
    const job = makeJobFor(ctx, sim, career, level, venue, !!remote);
    sim.career.job = job;
    sim.career.history.push({ title: job.title, employer: job.employerName, from: job.startedAt });
    sim.schedule.push(...workBlocks(job));
    sim.flags.career_review_year = Math.floor((state.time.minute - job.startedAt) / (365 * 1440));
    if (venue && !venue.staffSimIds.includes(sim.id)) venue.staffSimIds.push(sim.id);
  } else if (age >= 65) {
    sim.career.retired = true;
    sim.finance.benefits.socialSecurity = round2(rng.range(1400, 2900));
  }
  seedSkills(rng, content, sim, age, career, sim.hobbies);
  seedFinances(rng, sim, annualIncomeOf(sim.career.job) || (sim.career.retired ? 30000 : 0), age);
  sim.body.fitness = clamp(Math.round(rng.normal(50 - Math.max(0, age - 40) * 0.5 + (traits.includes('active') ? 15 : 0) - (traits.includes('couch_potato') ? 12 : 0), 14)), 8, 95);
  sim.body.insurance = sim.career.job?.benefits.health ? { kind: 'employer', monthlyPremium: 135, deductible: 1800, deductibleMet: 0, copay: 30, coinsurance: 0.2 } : age >= 65 ? { kind: 'medicare', monthlyPremium: 175, deductible: 250, deductibleMet: 0, copay: 20, coinsurance: 0.2 } : sim.body.insurance;
  sim.reputation = Math.round(rng.normalClamped(5, 15, -40, 60));
  // sleep block so autonomy knows when they are home
  const nightOwl = traits.includes('night_owl');
  const early = traits.includes('early_bird');
  pushSleep(sim, nightOwl ? 60 : early ? 21 * 60 + 30 : 23 * 60, nightOwl ? 9 * 60 : early ? 5 * 60 + 30 : 7 * 60, opts.homeVenueId ?? opts.venueId);
  return sim;
}

// ---------------------------------------------------------------------------
// player sim
// ---------------------------------------------------------------------------
export function generatePlayerSim(ctx: GenCtx, spec: PlayerSimSpec, venueId: VenueId, householdId: HouseholdId): Sim {
  const { rng, content, state } = ctx;
  const career = spec.careerId && spec.careerId !== 'unemployed' && spec.careerId !== 'student' ? content.careers[spec.careerId] : undefined;
  const pool = poolForLastName(spec.lastName);
  const sim = makeSim({
    id: newSimId(rng),
    firstName: spec.firstName,
    lastName: spec.lastName,
    gender: spec.gender,
    age: spec.age,
    epoch: state.epoch,
    rng,
    venueId,
    householdId,
    isPlayerControlled: true,
    lod: 'full',
    startingCash: 0,
    createdAt: state.time.minute,
    identity: {
      heritage: pool ? rng.pick(pool.heritages) : 'American',
      appearance: { ...describeAppearance(rng, spec.age, spec.gender), ...(spec.appearance ?? {}) },
      voice: rng.pick(VOICES),
      hometown: rng.chance(0.5) ? state.region.name : rng.pick(HOMETOWNS),
      ...(spec.pronouns ? { pronouns: spec.pronouns } : {}),
    },
  });
  const traits = pickTraits(rng, content, Math.max(2, spec.traits.length), spec.traits);
  sim.personality = applyTraits({ ...defaultPersonality(rng), speechStyle: rng.pick(SPEECH_STYLES), ...(spec.personality ?? {}) }, traits);
  sim.hobbies = (spec.hobbies ?? []).filter((h) => content.hobbies[h]).slice(0, 6);
  if (!sim.hobbies.length && Object.keys(content.hobbies).length) sim.hobbies = rng.pickN(Object.keys(content.hobbies), 2);
  sim.education.highestLevel = spec.educationLevel ?? educationForAge(rng, spec.age, career);
  if (spec.age >= 5 && spec.age < 18) sim.education.grade = clamp(spec.age - 5, 0, 12);
  if (career && spec.age >= 16) {
    const venues = Object.values(state.venues).filter((v) => career.venues.includes(v.archetype));
    const venue = venues.length ? rng.pick(venues) : undefined;
    const level = clamp(levelForAge(rng, career, spec.age) - 1, 0, career.levels.length - 1);
    const job = makeJobFor(ctx, sim, career, level, venue, career.levels[level]?.remoteEligible && rng.chance(0.3));
    job.performance = 55;
    job.startedAt = state.time.minute - rng.int(60, 700) * 1440;
    sim.career.job = job;
    sim.career.history.push({ title: job.title, employer: job.employerName, from: job.startedAt });
    sim.schedule.push(...workBlocks(job));
    if (venue && !venue.staffSimIds.includes(sim.id)) venue.staffSimIds.push(sim.id);
  }
  seedSkills(rng, content, sim, spec.age, career, sim.hobbies);
  // player money is set explicitly by worldgen; keep accounts clean here
  for (const a of sim.finance.accounts) a.balance = 0;
  sim.finance.creditScore = Math.round(rng.normalClamped(spec.age < 25 ? 640 : 690, 40, 520, 800));
  sim.body.insurance = sim.career.job?.benefits.health ? { kind: 'employer', monthlyPremium: 135, deductible: 1800, deductibleMet: 0, copay: 30, coinsurance: 0.2 } : sim.body.insurance;
  // the player's own story is ground truth for the LLM
  const facts = [
    { category: 'origin' as const, text: `${spec.firstName} is ${spec.age} and lives in ${state.region.name}, ${state.region.state}.`, secret: false, depth: 0 },
    ...(spec.background ? [{ category: 'daily_life' as const, text: spec.background.trim(), secret: false, depth: 10 }] : []),
    ...(career ? [{ category: 'career' as const, text: `${spec.firstName} works as a ${career.levels[sim.career.job?.level ?? 0]?.title.toLowerCase() ?? career.name.toLowerCase()}.`, secret: false, depth: 5 }] : []),
    ...(spec.careerId === 'student' ? [{ category: 'education' as const, text: `${spec.firstName} is a student.`, secret: false, depth: 5 }] : []),
    ...traits.slice(0, 3).map((t) => ({ category: 'quirk' as const, text: content.traits[t]?.llmHint ?? t, secret: false, depth: 15 })),
    ...(spec.aspiration ? [{ category: 'dream' as const, text: `${spec.firstName} wants, more than anything, to ${spec.aspiration.replace(/^to\s+/i, '')}.`, secret: false, depth: 30 }] : []),
  ];
  sim.bio = { summary: spec.background?.trim() || `${spec.firstName} ${spec.lastName}, ${spec.age}, of ${state.region.name}.`, facts: facts.map((f, i) => ({ id: `pf_${i}`, ...f, revealedTo: [] })), generated: true, generatedBy: 'fallback', seed: `${spec.firstName}-${spec.lastName}-${spec.age}` };
  if (spec.aspiration) sim.aspirations.push({ id: shortId(rng, 'asp'), text: spec.aspiration, category: 'adventure', progress: 0, completed: false, milestones: [{ text: 'Take the first step', done: false }, { text: 'Keep at it', done: false }, { text: 'Get there', done: false }] });
  pushSleep(sim, 23 * 60, 7 * 60, venueId);
  return sim;
}

// ---------------------------------------------------------------------------
// relationships & family
// ---------------------------------------------------------------------------
export function link(state: WorldState, a: Sim, b: Sim, flagsAB: RelationshipFlag[], flagsBA: RelationshipFlag[], axes: { friendship?: number; romance?: number; trust?: number; familiarity?: number }, now: number): void {
  const ra = ensureRelationship(a, b.id, now);
  const rb = ensureRelationship(b, a.id, now);
  for (const r of [ra, rb]) {
    r.friendship = axes.friendship ?? r.friendship;
    r.romance = axes.romance ?? r.romance;
    r.trust = axes.trust ?? r.trust;
    r.familiarity = axes.familiarity ?? r.familiarity;
    r.decayRate = 0.05;
    r.interactionsCount = Math.max(r.interactionsCount, 50);
    r.firstMetAt = Math.min(r.firstMetAt ?? now, now - 3000 * 1440);
  }
  for (const f of flagsAB) if (!ra.flags.includes(f)) ra.flags.push(f);
  for (const f of flagsBA) if (!rb.flags.includes(f)) rb.flags.push(f);
  if (!a.phone.contacts.includes(b.id)) a.phone.contacts.push(b.id);
  if (!b.phone.contacts.includes(a.id)) b.phone.contacts.push(a.id);
  void state;
}

/** Off-screen parents and a sibling for a sim, living at a "family home" venue far from the player. */
export function generateFamilyFor(ctx: GenCtx, sim: Sim, opts: { farAway?: boolean; center?: LatLng } = {}): Sim[] {
  const { rng, state } = ctx;
  const age = Math.max(0, new Date(state.epoch).getUTCFullYear() - new Date(sim.identity.birthDate).getUTCFullYear());
  const far = opts.farAway ?? rng.chance(0.55);
  const c = opts.center ?? state.region.center;
  const spread = far ? 1.8 : 0.06;
  const home = makeVenue({ id: newVenueId(rng), name: `${sim.identity.lastName} family home`, archetype: 'home', location: { lat: c.lat + rng.range(-spread, spread), lng: c.lng + rng.range(-spread, spread) }, rng, rooms: ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'], discovered: !far, tags: far ? ['out_of_town'] : ['family'] });
  home.residence = { kind: 'house', bedrooms: 3, bathrooms: 2, sqft: 1700, tenure: 'own', marketValue: state.region.medianHomePrice * 0.8, condition: 70, utilities: [], furnishingLevel: 70, securitySystem: false, yard: true, garage: true, petsAllowed: true };
  state.venues[home.id] = home;
  const pool = poolForLastName(sim.identity.lastName)?.id;
  const out: Sim[] = [];
  const now = state.time.minute;
  const parentAge = (a: number) => clamp(age + rng.int(24, 36), a + 18, 92);
  const mother = age < 60 ? generateNpc(ctx, { venueId: home.id, homeVenueId: home.id, gender: 'female', ageRange: [parentAge(age), parentAge(age)], lastName: sim.identity.lastName, poolId: pool, role: 'parent', lod: 'near' }) : undefined;
  const father = age < 60 && rng.chance(0.8) ? generateNpc(ctx, { venueId: home.id, homeVenueId: home.id, gender: 'male', ageRange: [parentAge(age) + 1, parentAge(age) + 2], lastName: sim.identity.lastName, poolId: pool, role: 'parent', lod: 'near' }) : undefined;
  for (const p of [mother, father]) {
    if (!p) continue;
    state.sims[p.id] = p;
    link(state, sim, p, ['parent'], ['child'], { friendship: rng.int(25, 75), trust: rng.int(30, 80), familiarity: 95 }, now);
    out.push(p);
  }
  if (mother && father) link(state, mother, father, ['married'], ['married'], { friendship: 60, romance: 55, trust: 70, familiarity: 100 }, now);
  if (rng.chance(0.7)) {
    const sib = generateNpc(ctx, { venueId: home.id, homeVenueId: home.id, ageRange: [Math.max(1, age - 6), age + 6], lastName: sim.identity.lastName, poolId: pool, role: 'sibling', lod: 'near' });
    state.sims[sib.id] = sib;
    link(state, sim, sib, ['sibling'], ['sibling'], { friendship: rng.int(10, 70), trust: rng.int(20, 70), familiarity: 90 }, now);
    for (const p of out) link(state, sib, p, ['parent'], ['child'], { friendship: 45, trust: 55, familiarity: 95 }, now);
    out.push(sib);
  }
  return out;
}

/** Helpers exported for worldgen and tests. */
export const SIMGEN = { pickName, pickTraits, applyTraits, describeAppearance, educationForAge, seedSkills, seedFinances, lifeStageForAge, birthDateForAge };
