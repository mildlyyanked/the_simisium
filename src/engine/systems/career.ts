/**
 * Career system — job search, interviews, offers, shifts, paychecks, promotions,
 * firing/quitting, gig work, unemployment and retirement.
 *
 * State it owns: `sim.career.*`, `sim.schedule` blocks of kind 'work', and a handful of
 * `sim.flags` prefixed `career_` (per-day shift tracking, cooldowns).
 *
 * Contracts with other systems (events only — no imports of other systems):
 *  - emits `money:paycheck {simId, gross, net}` after depositing net pay (finance tracks YTD).
 *  - emits `career:*` events from core/events.ts; `custom career:unemployment_started`.
 *  - consumes `custom` kinds `career:clock_in` (objects), `career:incarcerated` (law),
 *    `legal:arrested`, `sim:died`, `scheduled:fired` for `_job_response`, `interview`, `_notice_end`.
 */
import type { CareerDef, CareerLevel } from '../content/types';
import { dayIndex, minuteOfDay, weekdayAt } from '../core/clock';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import { RNG } from '../core/rng';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, Job, JobApplication, Requirement, ShiftBlock, Sim, SimId, Venue, VenueId, Weekday } from '../core/types';
import { clamp, clamp100, DAY, formatMoney, HOUR, round2, WEEK } from '../core/util';

// ---------------------------------------------------------------------------
// Tunables (mutable so tests can accelerate / make outcomes deterministic)
// ---------------------------------------------------------------------------
export const CAREER_CONFIG = {
  responseDaysMin: 1,
  responseDaysMax: 5,
  interviewDaysMin: 2,
  interviewDaysMax: 5,
  /** interview & offer rolls are clamped to [min, max] */
  minChance: 0.05,
  maxChance: 0.95,
  lateGraceMinutes: 15,
  /** minutes after shift start with no work → absent */
  absentAfterMinutes: 180,
  warningsToFire: 3,
  lowPerformanceDays: 14,
  lowPerformanceThreshold: 20,
  promotionThreshold: 100,
  annualRaisePct: 0.03,
  unemploymentWeeks: 26,
  unemploymentMaxWeekly: 600,
  /** 2026 federal single-filer brackets */
  federalBrackets: [
    [12400, 0.1],
    [50400, 0.12],
    [105700, 0.22],
    [201775, 0.24],
    [256225, 0.32],
    [640600, 0.35],
    [Number.POSITIVE_INFINITY, 0.37],
  ] as [number, number][],
  standardDeduction: 16100,
  ficaRate: 0.0765,
  healthPremiumMonthly: 135,
  retirementContribPct: 0.05,
  /** hour of the day paychecks land */
  payHour: 9,
};

const PERIOD_MINUTES: Record<Job['payFrequency'], number> = { weekly: WEEK, biweekly: WEEK * 2, semimonthly: DAY * 15, monthly: DAY * 30 };
const PERIODS_PER_YEAR: Record<Job['payFrequency'], number> = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

const WALK_IN_ARCHETYPES = new Set<Venue['archetype']>(['retail', 'grocery', 'convenience', 'restaurant', 'fast_food', 'cafe', 'bar', 'clothing', 'gas_station', 'bakery', 'mall', 'thrift_store', 'liquor_store', 'hardware', 'pet_store', 'bookstore']);
const WORK_ACTION_IDS = new Set(['career:work_shift', 'career:work_hard', 'career:slack_off', 'career:take_break', 'career:chat_coworkers']);

// ---------------------------------------------------------------------------
// Pay math (exported for finance/tests)
// ---------------------------------------------------------------------------
export interface PaycheckBreakdown {
  gross: number;
  federal: number;
  fica: number;
  state: number;
  health: number;
  retirement: number;
  net: number;
}

export function federalTaxAnnual(taxable: number): number {
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of CAREER_CONFIG.federalBrackets) {
    if (taxable <= lower) break;
    const slice = Math.min(taxable, upper) - lower;
    tax += slice * rate;
    lower = upper;
  }
  return tax;
}

export function computePaycheck(gross: number, periodsPerYear: number, opts: { stateRate: number; health: boolean; retirement401k: boolean }): PaycheckBreakdown {
  gross = round2(gross);
  const retirement = opts.retirement401k ? round2(gross * CAREER_CONFIG.retirementContribPct) : 0;
  const health = opts.health ? round2((CAREER_CONFIG.healthPremiumMonthly * 12) / periodsPerYear) : 0;
  const preTax = Math.max(0, gross - retirement - health);
  const annualized = preTax * periodsPerYear;
  const taxable = Math.max(0, annualized - CAREER_CONFIG.standardDeduction);
  const federal = round2(federalTaxAnnual(taxable) / periodsPerYear);
  const fica = round2(gross * CAREER_CONFIG.ficaRate);
  const state = round2(preTax * opts.stateRate);
  const net = round2(gross - retirement - health - federal - fica - state);
  return { gross, federal, fica, state, health, retirement, net: Math.max(0, net) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const EDU_ORDER = ['none', 'elementary', 'middle', 'high_school', 'ged', 'some_college', 'associate', 'bachelor', 'master', 'professional', 'doctorate'];
const eduRank = (l: string) => Math.max(0, EDU_ORDER.indexOf(l));
export function meetsEducation(sim: Sim, career: CareerDef): boolean {
  return eduRank(sim.education.highestLevel) >= eduRank(career.educationRequired);
}
function skillLevel(sim: Sim, id: string): number {
  return sim.skills[id]?.level ?? 0;
}
function meetsSkills(sim: Sim, level: CareerLevel): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const [k, v] of Object.entries(level.requiredSkills)) if (skillLevel(sim, k) < (v ?? 0)) missing.push(`${k} ${v}`);
  return { ok: missing.length === 0, missing };
}
function hasFelony(sim: Sim): boolean {
  return sim.legal.charges.some((c) => c.severity === 'felony' && (c.status === 'convicted' || c.status === 'plea'));
}
function convictions(sim: Sim): number {
  return sim.legal.charges.filter((c) => c.status === 'convicted' || c.status === 'plea').length;
}
function weekIndex(now: number): number {
  return Math.floor(now / WEEK);
}
function flagNum(sim: Sim, key: string, def = 0): number {
  const v = sim.flags[key];
  return typeof v === 'number' ? v : def;
}
function flagStr(sim: Sim, key: string, def = ''): string {
  const v = sim.flags[key];
  return typeof v === 'string' ? v : def;
}
function isYou(ctx: SystemContext, sim: Sim): boolean {
  return ctx.query.isControlled(sim.id);
}
function name(ctx: SystemContext, sim: Sim): string {
  return isYou(ctx, sim) ? 'You' : sim.identity.firstName;
}
function verb(ctx: SystemContext, sim: Sim, you: string, they: string): string {
  return isYou(ctx, sim) ? you : they;
}
function shiftToday(job: Job, wd: Weekday): ShiftBlock | undefined {
  return job.shifts.find((s) => s.day === wd);
}
function homeVenueId(ctx: SystemContext, sim: Sim): VenueId | undefined {
  return ctx.query.householdOf(sim.id)?.homeVenueId;
}
function internetActive(ctx: SystemContext, venueId: VenueId | undefined): boolean {
  if (!venueId) return false;
  const v = ctx.query.venueMaybe(venueId);
  const util = v?.residence?.utilities.find((u) => u.kind === 'internet');
  return util ? util.active : true;
}
export function canWorkRemote(ctx: SystemContext, sim: Sim, job: Job): boolean {
  if (!job.remote) return false;
  const home = homeVenueId(ctx, sim);
  if (!home || sim.location.venueId !== home) return false;
  const hasComputer = !!ctx.query.findObject(home, 'computer') || !!ctx.query.findObject(home, 'laptop') || ctx.query.objectsOf(sim).some((o) => o.defId === 'laptop');
  return hasComputer && internetActive(ctx, home);
}
function atWorkplace(ctx: SystemContext, sim: Sim, job: Job): boolean {
  if (job.employerVenueId && sim.location.venueId === job.employerVenueId && !sim.travel) return true;
  return canWorkRemote(ctx, sim, job);
}
function isIncarcerated(ctx: SystemContext, sim: Sim): boolean {
  return !!sim.legal.incarceratedUntil && sim.legal.incarceratedUntil > ctx.state.time.minute;
}
function moodFactor(sim: Sim): number {
  return clamp(1 + sim.mind.mood / 200, 0.6, 1.4);
}
function skillFactor(sim: Sim, career: CareerDef): number {
  if (!career.skills.length) return 1;
  const avg = career.skills.reduce((s, k) => s + skillLevel(sim, k), 0) / career.skills.length;
  return clamp(0.7 + avg * 0.08, 0.7, 1.5);
}
function levelDef(ctx: SystemContext, job: Job): { career: CareerDef; level: CareerLevel } | undefined {
  const career = ctx.content.careers[job.careerId];
  const level = career?.levels[job.level];
  return career && level ? { career, level } : undefined;
}
function payLabel(job: Job): string {
  return job.payType === 'hourly' ? `${formatMoney(job.hourlyRate ?? 0)}/h` : `${formatMoney(job.annualSalary ?? 0, { cents: false })}/yr`;
}

/** Pick concrete shift days for a level: round(hours / shiftLength) days from the pool. */
export function buildShifts(level: CareerLevel, rng: RNG): ShiftBlock[] {
  const len = Math.max(1, (level.shift.end - level.shift.start) / HOUR);
  const n = clamp(Math.round(level.hoursPerWeek / len), 1, level.shift.days.length);
  const days = rng.pickN(level.shift.days, n).sort((a, b) => a - b);
  return days.map((day) => ({ day, start: level.shift.start, end: level.shift.end }));
}

function setWorkSchedule(sim: Sim, job: Job | undefined): void {
  sim.schedule = sim.schedule.filter((b) => b.kind !== 'work');
  if (!job) return;
  for (const s of job.shifts) sim.schedule.push({ day: s.day, start: s.start, end: s.end, kind: 'work', venueId: job.remote ? undefined : job.employerVenueId, label: job.title });
}

function scaledPay(ctx: SystemContext, level: CareerLevel, factor = 1): { hourlyRate?: number; annualSalary?: number } {
  const col = ctx.state.region.costOfLiving;
  if (level.hourly !== undefined) return { hourlyRate: round2(Math.max(ctx.state.region.minimumWage, level.hourly * col * factor)) };
  return { annualSalary: Math.round((level.salary * col * factor) / 100) * 100 };
}

function makeJob(ctx: SystemContext, sim: Sim, career: CareerDef, levelIdx: number, venue: Venue | undefined, pay: { hourlyRate?: number; annualSalary?: number }, remote: boolean): Job {
  const level = career.levels[levelIdx];
  const now = ctx.state.time.minute;
  const staff = venue ? venue.staffSimIds.filter((id) => id !== sim.id && ctx.state.sims[id]) : [];
  const boss = staff[0];
  const hourly = pay.hourlyRate !== undefined;
  const benefits = level.hoursPerWeek >= 30 && career.sector !== 'criminal' && career.sector !== 'gig';
  return {
    id: shortId(ctx.rng, 'job'),
    careerId: career.id,
    title: level.title,
    level: levelIdx,
    employerName: venue?.name ?? (career.sector === 'criminal' ? 'the street' : `${career.name} (self-employed)`),
    employerVenueId: venue?.id,
    bossSimId: boss,
    coworkerSimIds: staff.slice(1, 8),
    payType: career.sector === 'gig' ? 'gig' : hourly ? 'hourly' : 'salary',
    hourlyRate: pay.hourlyRate,
    annualSalary: pay.annualSalary,
    shifts: buildShifts(level, ctx.rng),
    remote,
    startedAt: now,
    performance: 55,
    promotionProgress: 0,
    warnings: 0,
    ptoHoursBalance: benefits ? 40 : 0,
    sickHoursBalance: benefits ? 24 : 0,
    benefits: { health: benefits, retirement401k: benefits && !hourly, matchPct: benefits && !hourly ? 3 : 0, dental: benefits && !hourly },
    hoursWorkedThisPeriod: 0,
    lastPaidAt: now,
    payFrequency: career.sector === 'criminal' ? 'weekly' : hourly ? 'biweekly' : 'semimonthly',
    status: 'active',
  };
}

// ---------------------------------------------------------------------------
// Job market (deterministic per week)
// ---------------------------------------------------------------------------
export interface JobOpening {
  careerId: string;
  level: number;
  title: string;
  employerVenueId?: VenueId;
  employerName: string;
  pay: string;
}

export function jobListings(ctx: SystemContext, sim: Sim): JobOpening[] {
  const week = weekIndex(ctx.state.time.minute);
  const rng = new RNG(`${ctx.state.meta.seed}:jobs:${week}:${sim.id}`);
  const venues = Object.values(ctx.state.venues);
  const byArch = new Map<string, Venue[]>();
  for (const v of venues) {
    if (v.archetype === 'home' || v.archetype === 'apartment_building') continue;
    const arr = byArch.get(v.archetype) ?? [];
    arr.push(v);
    byArch.set(v.archetype, arr);
  }
  const candidates: { career: CareerDef; venue: Venue }[] = [];
  for (const career of Object.values(ctx.content.careers)) {
    if (career.sector === 'criminal') continue;
    for (const arch of career.venues) {
      const vs = byArch.get(arch);
      if (vs?.length) candidates.push({ career, venue: rng.pick(vs) });
    }
  }
  if (!candidates.length) return [];
  const heat = ctx.state.economy.jobMarketHeat;
  const n = clamp(Math.round(5 + heat * 4 + rng.range(-1, 1)), 5, 8);
  const picked = rng.shuffle(candidates).slice(0, Math.min(n, candidates.length));
  return picked.map(({ career, venue }) => {
    let level = rng.chance(0.75) ? 0 : 1;
    if (career.levels.length > 2 && meetsEducation(sim, career) && rng.chance(0.25)) {
      const higher = career.levels.findIndex((l, i) => i >= 2 && meetsSkills(sim, l).ok);
      if (higher > 0) level = higher;
    }
    level = Math.min(level, career.levels.length - 1);
    const lv = career.levels[level];
    const pay = scaledPay(ctx, lv);
    return { careerId: career.id, level, title: lv.title, employerVenueId: venue.id, employerName: venue.name, pay: pay.hourlyRate !== undefined ? `${formatMoney(pay.hourlyRate)}/h` : `${formatMoney(pay.annualSalary ?? 0, { cents: false })}/yr` };
  });
}

// ---------------------------------------------------------------------------
// Hiring pipeline
// ---------------------------------------------------------------------------
function applyForJob(ctx: SystemContext, sim: Sim, careerId: string, employerVenueId: VenueId | undefined, level: number): ActionResult {
  const career = ctx.content.careers[careerId];
  if (!career) return { ok: false, text: 'That job no longer exists.' };
  const venue = employerVenueId ? ctx.query.venueMaybe(employerVenueId) : undefined;
  const dup = sim.career.applications.find((a) => a.careerId === careerId && a.employerVenueId === employerVenueId && (a.status === 'applied' || a.status === 'interview' || a.status === 'offer'));
  if (dup) return { ok: false, text: `You already applied to ${venue?.name ?? career.name}.` };
  const app: JobApplication = {
    id: shortId(ctx.rng, 'app'),
    careerId,
    employerName: venue?.name ?? career.name,
    employerVenueId,
    level: Math.min(level, career.levels.length - 1),
    appliedAt: ctx.state.time.minute,
    status: 'applied',
  };
  sim.career.applications.push(app);
  if (sim.career.applications.length > 30) sim.career.applications.splice(0, sim.career.applications.length - 30);
  const days = ctx.rng.range(CAREER_CONFIG.responseDaysMin, CAREER_CONFIG.responseDaysMax);
  ctx.schedule({ inMinutes: Math.round(days * DAY), kind: '_job_response', label: 'Job application response', simId: sim.id, payload: { applicationId: app.id } });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'apply', 'applies')} for the ${career.levels[app.level].title} position at ${app.employerName}.`, kind: 'narrative', simId: sim.id, importance: 1 });
  return { ok: true, text: `Application sent to ${app.employerName}. They usually respond within a few days.`, data: { applicationId: app.id } };
}

function interviewChance(ctx: SystemContext, sim: Sim, app: JobApplication, career: CareerDef): number {
  const level = career.levels[app.level];
  let score = 0.45 + ctx.state.economy.jobMarketHeat * 0.3;
  if (!meetsEducation(sim, career)) score -= 0.5;
  for (const [k, v] of Object.entries(level.requiredSkills)) score -= Math.max(0, (v ?? 0) - skillLevel(sim, k)) * 0.08;
  if (career.backgroundCheck && hasFelony(sim)) return 0;
  if (career.backgroundCheck && convictions(sim) > 0) score -= 0.15;
  if (career.drugTest && ((sim.body.addictions.cannabis ?? 0) > 30 || sim.body.cannabis > 0 || (sim.body.addictions.opioids ?? 0) > 20)) score -= 0.3;
  score += (sim.career.reputation - 50) / 200;
  if (sim.career.history.some((h) => h.title === level.title || h.employer === app.employerName)) score += 0.1;
  const age = ctx.query.ageOf(sim);
  if (age < 16) return 0;
  if (age < 18 && !career.tags.includes('teen_ok') && career.educationRequired !== 'none') score -= 0.4;
  return clamp(score, CAREER_CONFIG.minChance, CAREER_CONFIG.maxChance);
}

function handleJobResponse(ctx: SystemContext, sim: Sim, applicationId: string): void {
  const app = sim.career.applications.find((a) => a.id === applicationId);
  if (!app || app.status !== 'applied') return;
  const career = ctx.content.careers[app.careerId];
  if (!career) {
    app.status = 'rejected';
    return;
  }
  const p = interviewChance(ctx, sim, app, career);
  if (!ctx.rng.chance(p)) {
    app.status = 'rejected';
    const why = career.backgroundCheck && hasFelony(sim) ? ' The background check did not go your way.' : '';
    ctx.log({ text: `${app.employerName} passed on ${isYou(ctx, sim) ? 'your' : `${sim.identity.firstName}'s`} application for ${career.levels[app.level].title}.${why}`, kind: 'phone', simId: sim.id, importance: 1 });
    ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'jobs', title: app.employerName, body: `Thank you for your interest. We have decided to move forward with other candidates.` });
    return;
  }
  // schedule interview on a business day at 10:00 (or 14:00)
  const now = ctx.state.time.minute;
  let at = dayIndex(now) * DAY + Math.round(ctx.rng.range(CAREER_CONFIG.interviewDaysMin, CAREER_CONFIG.interviewDaysMax)) * DAY + (ctx.rng.chance(0.6) ? 10 : 14) * HOUR;
  for (let i = 0; i < 3; i++) {
    const wd = weekdayAt(ctx.state.epoch, at);
    if (wd === 0 || wd === 6) at += DAY;
  }
  app.status = 'interview';
  app.interviewAt = at;
  ctx.schedule({ atMinute: at, kind: 'interview', label: `Interview — ${career.levels[app.level].title} at ${app.employerName}`, simId: sim.id, venueId: app.employerVenueId, payload: { applicationId: app.id } });
  ctx.emit({ type: 'career:interview', simId: sim.id, applicationId: app.id });
  ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'jobs', title: app.employerName, body: `We'd like to interview you for ${career.levels[app.level].title}. See your calendar for the time.` });
  ctx.log({ text: `${app.employerName} wants to interview ${isYou(ctx, sim) ? 'you' : sim.identity.firstName} for ${career.levels[app.level].title}.`, kind: 'phone', simId: sim.id, importance: 2 });
}

function interviewWindow(app: JobApplication, now: number): 'early' | 'open' | 'late' | 'missed' {
  if (app.interviewAt === undefined) return 'missed';
  const d = now - app.interviewAt;
  if (d < -20) return 'early';
  if (d <= CAREER_CONFIG.lateGraceMinutes) return 'open';
  if (d <= 90) return 'late';
  return 'missed';
}

function runInterview(ctx: SystemContext, sim: Sim, app: JobApplication): ActionResult {
  const career = ctx.content.careers[app.careerId];
  if (!career) return { ok: false, text: 'The position was withdrawn.' };
  const level = career.levels[app.level];
  const window = interviewWindow(app, ctx.state.time.minute);
  if (window === 'early') return { ok: false, text: 'Too early — the interview has not started yet.' };
  if (window === 'missed') {
    app.status = 'rejected';
    return { ok: false, text: 'You missed the interview window.' };
  }
  const skills = Object.keys(level.requiredSkills).length ? Object.keys(level.requiredSkills) : career.skills;
  const avgSkill = skills.length ? skills.reduce((s, k) => s + skillLevel(sim, k), 0) / skills.length : 0;
  let score = 0.35 + skillLevel(sim, 'charisma') * 0.05 + avgSkill * 0.04 + sim.mind.mood / 400;
  if ((sim.inventory.consumables['outfit_business'] ?? 0) > 0 || sim.inventory.wearing.some((w) => /business|suit|blazer/i.test(w))) score += 0.1;
  score += window === 'open' ? 0.05 : -0.15;
  if (sim.needs.hygiene < 40) score -= 0.1;
  if (sim.body.bloodAlcohol > 0.02) score -= 0.2;
  const p = clamp(score, CAREER_CONFIG.minChance, CAREER_CONFIG.maxChance);
  const success = ctx.rng.chance(p);
  const effects: ActionDef['effects'] = { needs: { social: 4, fun: -3 }, stress: 4, skills: { charisma: 10 } };
  if (!success) {
    app.status = 'rejected';
    ctx.log({ text: `The interview at ${app.employerName} ${window === 'late' ? 'started badly — you were late — and ' : ''}went nowhere. They went with another candidate.`, kind: 'narrative', simId: sim.id, importance: 2 });
    return { ok: true, text: `The interview did not go well. ${app.employerName} passes.`, outcomeLabel: 'Rejected', effects: { ...effects, moodlets: [{ emotion: 'sad', label: 'Bombed the interview', intensity: -8, durationMinutes: DAY }] } };
  }
  const pay = scaledPay(ctx, level, ctx.rng.range(0.95, 1.08));
  const startAt = dayIndex(ctx.state.time.minute) * DAY + Math.round(ctx.rng.range(2, 8)) * DAY;
  app.status = 'offer';
  app.offer = { ...pay, startAt };
  ctx.emit({ type: 'career:offer', simId: sim.id, applicationId: app.id });
  const payText = pay.hourlyRate !== undefined ? `${formatMoney(pay.hourlyRate)}/h` : `${formatMoney(pay.annualSalary ?? 0, { cents: false })}/yr`;
  ctx.log({ text: `${app.employerName} offers ${isYou(ctx, sim) ? 'you' : sim.identity.firstName} the ${level.title} job at ${payText}.`, kind: 'narrative', simId: sim.id, importance: 2 });
  return { ok: true, text: `It went well. ${app.employerName} offers you the ${level.title} position at ${payText}.`, outcomeLabel: 'Offer', effects: { ...effects, moodlets: [{ emotion: 'confident', label: 'Nailed the interview', intensity: 10, durationMinutes: DAY }] } };
}

function negotiateOffer(ctx: SystemContext, sim: Sim, app: JobApplication): ActionResult {
  if (app.status !== 'offer' || !app.offer) return { ok: false, text: 'No offer to negotiate.' };
  if (sim.flags[`career_negotiated_${app.id}`]) return { ok: false, text: 'You already negotiated this offer.' };
  sim.flags[`career_negotiated_${app.id}`] = true;
  const p = clamp(0.3 + skillLevel(sim, 'negotiation') * 0.07 + skillLevel(sim, 'charisma') * 0.02, 0.1, 0.9);
  if (ctx.rng.chance(p)) {
    const bump = 1 + ctx.rng.range(0.04, 0.12);
    if (app.offer.hourlyRate !== undefined) app.offer.hourlyRate = round2(app.offer.hourlyRate * bump);
    if (app.offer.annualSalary !== undefined) app.offer.annualSalary = Math.round((app.offer.annualSalary * bump) / 100) * 100;
    const payText = app.offer.hourlyRate !== undefined ? `${formatMoney(app.offer.hourlyRate)}/h` : `${formatMoney(app.offer.annualSalary ?? 0, { cents: false })}/yr`;
    ctx.log({ text: `You negotiate ${app.employerName} up to ${payText}.`, kind: 'narrative', simId: sim.id, importance: 2 });
    return { ok: true, text: `They came up to ${payText}.`, outcomeLabel: 'Raised', effects: { skills: { negotiation: 15 }, moodlets: [{ emotion: 'proud', label: 'Negotiated a raise', intensity: 6, durationMinutes: DAY }] } };
  }
  if (ctx.rng.chance(0.1)) {
    app.status = 'rejected';
    ctx.log({ text: `${app.employerName} rescinds the offer after you push on pay.`, kind: 'narrative', simId: sim.id, importance: 2 });
    return { ok: true, text: 'They pull the offer. Ouch.', outcomeLabel: 'Rescinded', effects: { moodlets: [{ emotion: 'embarrassed', label: 'Overplayed my hand', intensity: -8, durationMinutes: DAY }] } };
  }
  return { ok: true, text: 'They hold firm: the offer stands as-is.', outcomeLabel: 'Held', effects: { skills: { negotiation: 6 } } };
}

export function hireSim(ctx: SystemContext, sim: Sim, career: CareerDef, levelIdx: number, venue: Venue | undefined, pay: { hourlyRate?: number; annualSalary?: number }, remote = false): Job {
  const now = ctx.state.time.minute;
  if (sim.career.job) endJob(ctx, sim, 'left for another job', false);
  const job = makeJob(ctx, sim, career, levelIdx, venue, pay, remote);
  sim.career.job = job;
  sim.career.history.push({ title: job.title, employer: job.employerName, from: now });
  sim.flags.career_best_salary = Math.max(flagNum(sim, 'career_best_salary'), job.annualSalary ?? (job.hourlyRate ?? 0) * weeklyHours(job) * 52);
  sim.career.unemployment = undefined;
  sim.finance.benefits.unemployment = false;
  setWorkSchedule(sim, job);
  if (venue && !venue.staffSimIds.includes(sim.id)) venue.staffSimIds.push(sim.id);
  if (job.bossSimId) ctx.applyEffects(sim.id, { relationships: [{ simId: job.bossSimId, familiarity: 5, flags: [{ flag: 'boss', op: 'add' }] }] }, 'career:hired');
  for (const c of job.coworkerSimIds) ctx.applyEffects(sim.id, { relationships: [{ simId: c, familiarity: 3, flags: [{ flag: 'coworker', op: 'add' }], mutual: true }] }, 'career:hired');
  if (job.benefits.health && sim.body.insurance.kind === 'none') sim.body.insurance = { kind: 'employer', monthlyPremium: CAREER_CONFIG.healthPremiumMonthly, deductible: 2000, deductibleMet: 0, copay: 30, coinsurance: 0.2 };
  ctx.emit({ type: 'career:hired', simId: sim.id, careerId: career.id, title: job.title, employer: job.employerName });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'start', 'starts')} a new job as ${job.title} at ${job.employerName} (${payLabel(job)}).`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'New job!', intensity: 12, durationMinutes: DAY * 2 }] }, 'career:hired');
  return job;
}

function acceptOffer(ctx: SystemContext, sim: Sim, app: JobApplication): ActionResult {
  if (app.status !== 'offer' || !app.offer) return { ok: false, text: 'No open offer.' };
  const career = ctx.content.careers[app.careerId];
  if (!career) return { ok: false, text: 'Position withdrawn.' };
  const venue = app.employerVenueId ? ctx.query.venueMaybe(app.employerVenueId) : undefined;
  const level = career.levels[app.level];
  const remote = level.remoteEligible && ctx.rng.chance(0.5);
  app.status = 'accepted';
  for (const other of sim.career.applications) if (other !== app && (other.status === 'applied' || other.status === 'interview' || other.status === 'offer')) other.status = 'withdrawn';
  const job = hireSim(ctx, sim, career, app.level, venue, { hourlyRate: app.offer.hourlyRate, annualSalary: app.offer.annualSalary }, remote);
  const shiftText = job.shifts.map((s) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.day]} ${fmtH(s.start)}–${fmtH(s.end)}`).join(', ');
  return { ok: true, text: `You accept. Schedule: ${shiftText}.${remote ? ' The role is remote — you can work from home with a computer.' : ''}`, data: { jobId: job.id } };
}

function fmtH(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}

function walkIn(ctx: SystemContext, sim: Sim, venue: Venue): ActionResult {
  const week = weekIndex(ctx.state.time.minute);
  const key = `career_walkin_${venue.id}`;
  if (flagNum(sim, key, -1) === week) return { ok: false, text: 'You already asked here this week.' };
  sim.flags[key] = week;
  const careers = Object.values(ctx.content.careers).filter((c) => c.venues.includes(venue.archetype) && c.sector !== 'criminal' && c.educationRequired === 'none');
  if (!careers.length) return { ok: true, text: `${venue.name} isn't hiring for anything you could walk into.` };
  const career = ctx.rng.pick(careers);
  const p = clamp(0.3 + ctx.state.economy.jobMarketHeat * 0.3 + skillLevel(sim, 'charisma') * 0.04 + (sim.needs.hygiene < 40 ? -0.15 : 0) - (career.backgroundCheck && hasFelony(sim) ? 0.5 : 0), CAREER_CONFIG.minChance, CAREER_CONFIG.maxChance);
  if (!ctx.rng.chance(p)) return { ok: true, text: `The manager at ${venue.name} says they're not hiring right now, but to check back.`, outcomeLabel: 'Not hiring', effects: { needs: { social: 2 } } };
  const pay = scaledPay(ctx, career.levels[0], ctx.rng.range(0.97, 1.03));
  const app: JobApplication = { id: shortId(ctx.rng, 'app'), careerId: career.id, employerName: venue.name, employerVenueId: venue.id, level: 0, appliedAt: ctx.state.time.minute, status: 'offer', offer: { ...pay, startAt: ctx.state.time.minute + DAY } };
  sim.career.applications.push(app);
  ctx.emit({ type: 'career:offer', simId: sim.id, applicationId: app.id });
  const payText = pay.hourlyRate !== undefined ? `${formatMoney(pay.hourlyRate)}/h` : `${formatMoney(pay.annualSalary ?? 0, { cents: false })}/yr`;
  ctx.log({ text: `The manager at ${venue.name} offers you a ${career.levels[0].title} job on the spot at ${payText}.`, kind: 'narrative', simId: sim.id, importance: 2 });
  return { ok: true, text: `They're short-staffed. ${career.levels[0].title}, ${payText} — you can accept from the job menu.`, outcomeLabel: 'Offer', effects: { needs: { social: 3 } } };
}

// ---------------------------------------------------------------------------
// Leaving a job
// ---------------------------------------------------------------------------
function endJob(ctx: SystemContext, sim: Sim, reason: string, eligibleForUnemployment: boolean): void {
  const job = sim.career.job;
  if (!job) return;
  const now = ctx.state.time.minute;
  const h = sim.career.history.find((x) => x.title === job.title && x.employer === job.employerName && x.to === undefined);
  if (h) {
    h.to = now;
    h.reason = reason;
  }
  const venue = job.employerVenueId ? ctx.query.venueMaybe(job.employerVenueId) : undefined;
  if (venue) venue.staffSimIds = venue.staffSimIds.filter((id) => id !== sim.id);
  if (job.bossSimId && sim.relationships[job.bossSimId]) sim.relationships[job.bossSimId].flags = sim.relationships[job.bossSimId].flags.filter((f) => f !== 'boss');
  for (const c of job.coworkerSimIds) if (sim.relationships[c]) sim.relationships[c].flags = sim.relationships[c].flags.filter((f) => f !== 'coworker');
  if (sim.body.insurance.kind === 'employer') sim.body.insurance = { ...sim.body.insurance, kind: 'none', monthlyPremium: 0 };
  sim.career.job = undefined;
  setWorkSchedule(sim, undefined);
  delete sim.flags.career_shift;
  if (eligibleForUnemployment && job.payType !== 'gig' && ctx.content.careers[job.careerId]?.sector !== 'criminal') {
    const weekly = job.payType === 'hourly' ? (job.hourlyRate ?? 0) * Math.max(20, weeklyHours(job)) : (job.annualSalary ?? 0) / 52;
    const benefit = round2(Math.min(CAREER_CONFIG.unemploymentMaxWeekly, weekly * 0.5));
    sim.career.unemployment = { weeklyBenefit: benefit, weeksLeft: CAREER_CONFIG.unemploymentWeeks, lastPaidAt: now };
    sim.finance.benefits.unemployment = true;
    sim.flags.career_ui_eligible = true;
    sim.flags.career_ui_weekly = benefit;
    ctx.emit({ type: 'custom', kind: 'career:unemployment_started', simId: sim.id, payload: { weeklyBenefit: benefit } });
    ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'qualify', 'qualifies')} for unemployment: ${formatMoney(benefit)}/week for up to ${CAREER_CONFIG.unemploymentWeeks} weeks.`, kind: 'money', simId: sim.id, importance: 2 });
  } else {
    sim.flags.career_ui_eligible = false;
  }
}

function weeklyHours(job: Job): number {
  return job.shifts.reduce((s, b) => s + (b.end - b.start) / HOUR, 0);
}

export function fireSim(ctx: SystemContext, sim: Sim, reason: string, forCause: boolean): void {
  const job = sim.career.job;
  if (!job) return;
  ctx.emit({ type: 'career:fired', simId: sim.id, reason });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'have', 'has')} been fired from ${job.employerName}: ${reason}.`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'sad', label: 'Fired', intensity: -15, durationMinutes: DAY * 3 }], stress: 15 }, 'career:fired');
  sim.career.reputation = clamp100(sim.career.reputation - (forCause ? 12 : 4));
  if (job.bossSimId) ctx.applyEffects(sim.id, { relationships: [{ simId: job.bossSimId, friendship: -10, trust: -10 }] }, 'career:fired');
  endJob(ctx, sim, `fired (${reason})`, !forCause);
}

function quitJob(ctx: SystemContext, sim: Sim, immediate: boolean): ActionResult {
  const job = sim.career.job;
  if (!job) return { ok: false, text: 'You have no job to quit.' };
  if (immediate) {
    ctx.emit({ type: 'career:quit', simId: sim.id });
    ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'quit', 'quits')} ${job.employerName} on the spot.`, kind: 'event', simId: sim.id, importance: 3 });
    sim.career.reputation = clamp100(sim.career.reputation - 8);
    endJob(ctx, sim, 'quit without notice', false);
    return { ok: true, text: 'You walk out. No notice, no reference.', effects: { moodlets: [{ emotion: 'relaxed', label: 'Free at last', intensity: 6, durationMinutes: DAY }] } };
  }
  if (job.status === 'notice') return { ok: false, text: 'You already gave notice.' };
  job.status = 'notice';
  ctx.schedule({ inMinutes: DAY * 14, kind: '_notice_end', label: 'Last day at work', simId: sim.id, payload: { jobId: job.id } });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'give', 'gives')} two weeks' notice at ${job.employerName}.`, kind: 'event', simId: sim.id, importance: 2 });
  return { ok: true, text: 'You give two weeks’ notice. Finish your shifts and leave on good terms.' };
}

function retire(ctx: SystemContext, sim: Sim): ActionResult {
  const age = ctx.query.ageOf(sim);
  if (age < 62) return { ok: false, text: 'You can claim Social Security at 62.' };
  if (sim.career.retired) return { ok: false, text: 'Already retired.' };
  const job = sim.career.job;
  const current = job ? (job.annualSalary ?? (job.hourlyRate ?? 0) * weeklyHours(job) * 52) : 0;
  const best = Math.max(current, flagNum(sim, 'career_best_salary'));
  const ageFactor = clamp(0.7 + (age - 62) * 0.06, 0.7, 1.24);
  const monthly = round2(clamp(best > 0 ? (best / 12) * 0.4 : 1100, 1000, 3900) * ageFactor);
  if (job) {
    ctx.emit({ type: 'career:quit', simId: sim.id });
    endJob(ctx, sim, 'retired', false);
    sim.career.unemployment = undefined;
    sim.finance.benefits.unemployment = false;
  }
  sim.career.retired = true;
  sim.finance.benefits.socialSecurity = monthly;
  if (age >= 65 && sim.body.insurance.kind !== 'medicare') sim.body.insurance = { kind: 'medicare', monthlyPremium: 185, deductible: 257, deductibleMet: 0, copay: 20, coinsurance: 0.2 };
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'retire', 'retires')}. Social Security will pay ${formatMoney(monthly)} a month.`, kind: 'event', simId: sim.id, importance: 3 });
  return { ok: true, text: `You're retired. Social Security: ${formatMoney(monthly)}/month, paid on the 3rd.`, effects: { moodlets: [{ emotion: 'relaxed', label: 'Retired', intensity: 12, durationMinutes: DAY * 7 }] } };
}

// ---------------------------------------------------------------------------
// Paychecks
// ---------------------------------------------------------------------------
export function payJob(ctx: SystemContext, sim: Sim, job: Job): PaycheckBreakdown | undefined {
  const now = ctx.state.time.minute;
  const periodsPerYear = PERIODS_PER_YEAR[job.payFrequency];
  const gross = job.payType === 'hourly' || job.payType === 'gig' ? round2(job.hoursWorkedThisPeriod * (job.hourlyRate ?? 0)) : round2((job.annualSalary ?? 0) / periodsPerYear);
  job.lastPaidAt = now;
  job.hoursWorkedThisPeriod = 0;
  if (gross <= 0) return undefined;
  const career = ctx.content.careers[job.careerId];
  if (career?.sector === 'criminal') {
    ctx.applyEffects(sim.id, { money: { amount: gross, account: 'cash', memo: 'Cash', category: 'income', counterparty: 'unknown' }, legal: [{ kind: 'heat', delta: 2 }] }, 'career:paycheck');
    ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'count', 'counts')} ${formatMoney(gross)} in cash from the week.`, kind: 'money', simId: sim.id, importance: 1 });
    return { gross, federal: 0, fica: 0, state: 0, health: 0, retirement: 0, net: gross };
  }
  const pc = computePaycheck(gross, periodsPerYear, { stateRate: ctx.state.region.stateIncomeTax, health: job.benefits.health, retirement401k: job.benefits.retirement401k });
  ctx.applyEffects(sim.id, { money: { amount: pc.net, memo: `Paycheck — ${job.employerName}`, category: 'income', counterparty: job.employerName } }, 'career:paycheck');
  if (pc.retirement > 0) {
    const ret = sim.finance.accounts.find((a) => a.kind === 'retirement');
    if (ret) ret.balance = round2(ret.balance + pc.retirement * (1 + job.benefits.matchPct / 100));
    else sim.finance.accounts.push({ id: shortId(ctx.rng, 'acc'), kind: 'retirement', bankName: `${job.employerName} 401(k)`, balance: round2(pc.retirement * (1 + job.benefits.matchPct / 100)), openedAt: now, overdraftFeesThisMonth: 0, frozen: false, apy: 0.06 });
  }
  ctx.emit({ type: 'money:paycheck', simId: sim.id, gross: pc.gross, net: pc.net });
  ctx.log({ text: `Paycheck from ${job.employerName}: ${formatMoney(pc.net)} net (${formatMoney(pc.gross)} gross, ${formatMoney(pc.federal + pc.fica + pc.state)} taxes${pc.health ? `, ${formatMoney(pc.health)} health` : ''}${pc.retirement ? `, ${formatMoney(pc.retirement)} 401k` : ''}).`, kind: 'money', simId: sim.id, importance: 1 });
  return pc;
}

function paydayDue(now: number, job: Job): boolean {
  return now - job.lastPaidAt >= PERIOD_MINUTES[job.payFrequency];
}

function payUnemployment(ctx: SystemContext, sim: Sim): void {
  const u = sim.career.unemployment;
  if (!u) return;
  const now = ctx.state.time.minute;
  if (now - u.lastPaidAt < WEEK) return;
  u.lastPaidAt = now;
  u.weeksLeft -= 1;
  ctx.applyEffects(sim.id, { money: { amount: u.weeklyBenefit, memo: 'Unemployment benefit', category: 'income', counterparty: `${ctx.state.region.state} Workforce Commission` } }, 'career:unemployment');
  ctx.log({ text: `Unemployment benefit deposited: ${formatMoney(u.weeklyBenefit)} (${u.weeksLeft} weeks left).`, kind: 'money', simId: sim.id, importance: 1 });
  if (u.weeksLeft <= 0) {
    sim.career.unemployment = undefined;
    sim.finance.benefits.unemployment = false;
    ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'have', 'has')} exhausted unemployment benefits.`, kind: 'money', simId: sim.id, importance: 2 });
  }
}

function paySocialSecurity(ctx: SystemContext, sim: Sim): void {
  const amt = sim.finance.benefits.socialSecurity;
  if (!amt || amt <= 0) return;
  const key = `${ctx.clock.day.year}-${ctx.clock.day.month}`;
  if (ctx.clock.day.day < 3 || sim.flags.career_ss_month === key) return;
  sim.flags.career_ss_month = key;
  ctx.applyEffects(sim.id, { money: { amount: amt, memo: 'Social Security', category: 'income', counterparty: 'Social Security Administration' } }, 'career:social_security');
  ctx.log({ text: `Social Security deposited: ${formatMoney(amt)}.`, kind: 'money', simId: sim.id, importance: 1 });
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------
type ShiftState = 'pending' | 'working' | 'done' | 'absent' | 'excused' | 'left' | 'off';

function shiftState(sim: Sim): ShiftState {
  return (flagStr(sim, 'career_shift', 'off') as ShiftState) ?? 'off';
}

function resetShiftDay(ctx: SystemContext, sim: Sim, job: Job, today: number): void {
  sim.flags.career_day = today;
  sim.flags.career_hours_today = 0;
  sim.flags.career_last_work_at = 0;
  const wd = weekdayAt(ctx.state.epoch, today * DAY);
  const block = shiftToday(job, wd);
  const excused = flagStr(sim, 'career_excused_days').split(',').includes(String(today));
  if (!block || job.status === 'suspended') sim.flags.career_shift = 'off';
  else if (excused) sim.flags.career_shift = 'excused';
  else sim.flags.career_shift = 'pending';
}

function markAbsent(ctx: SystemContext, sim: Sim, job: Job, why: string): void {
  sim.flags.career_shift = 'absent';
  job.warnings += 1;
  job.performance = clamp100(job.performance - 10);
  ctx.emit({ type: 'career:absent', simId: sim.id });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'miss', 'misses')} ${verb(ctx, sim, 'your', 'their')} shift at ${job.employerName} (${why}). Warning ${job.warnings}/${CAREER_CONFIG.warningsToFire}.`, kind: 'alert', simId: sim.id, importance: 2 });
  if (job.bossSimId) ctx.applyEffects(sim.id, { relationships: [{ simId: job.bossSimId, friendship: -4, trust: -6 }] }, 'career:absent');
  if (job.warnings >= CAREER_CONFIG.warningsToFire) fireSim(ctx, sim, 'too many missed shifts', true);
}

function startWorking(ctx: SystemContext, sim: Sim, job: Job, block: ShiftBlock): void {
  const now = ctx.state.time.minute;
  const mod = minuteOfDay(now);
  const wasPending = shiftState(sim) === 'pending';
  sim.flags.career_shift = 'working';
  sim.flags.career_last_work_at = now;
  if (wasPending) {
    const late = mod - block.start;
    if (late > CAREER_CONFIG.lateGraceMinutes) {
      job.performance = clamp100(job.performance - Math.min(8, late / 30));
      ctx.emit({ type: 'career:late', simId: sim.id, minutes: late });
      ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'are', 'is')} ${Math.round(late)} minutes late for ${verb(ctx, sim, 'your', 'their')} shift.`, kind: 'alert', simId: sim.id, importance: 1 });
      if (late > 60 && job.bossSimId) ctx.applyEffects(sim.id, { relationships: [{ simId: job.bossSimId, trust: -2 }] }, 'career:late');
    }
  }
}

function finishShift(ctx: SystemContext, sim: Sim, job: Job, early: boolean): void {
  const def = levelDef(ctx, job);
  const hours = round2(flagNum(sim, 'career_hours_today'));
  sim.flags.career_shift = early ? 'left' : 'done';
  if (early) job.performance = clamp100(job.performance - 3);
  ctx.emit({ type: 'career:shift_end', simId: sim.id, hours });
  if (def) ctx.applyEffects(sim.id, { stress: def.career.stress, fitness: def.career.physical >= 7 ? 0.2 : 0, moodlets: def.career.physical >= 6 ? [{ emotion: 'tired', label: 'Long shift', intensity: -4, durationMinutes: 6 * HOUR }] : [] }, 'career:shift_end');
  const task = def ? ctx.rng.pick(def.level.tasks) : undefined;
  ctx.log({ text: `${name(ctx, sim)} ${early ? verb(ctx, sim, 'leave', 'leaves') + ' work early after' : verb(ctx, sim, 'finish', 'finishes') + ' a'} ${hours.toFixed(1)}-hour shift at ${job.employerName}.${task ? ` Today: ${task.toLowerCase()}.` : ''}`, kind: 'narrative', simId: sim.id, importance: early ? 2 : 1 });
}

function accrueWork(ctx: SystemContext, sim: Sim, job: Job, minutes: number, intensity: number): void {
  const def = levelDef(ctx, job);
  const hours = minutes / HOUR;
  job.hoursWorkedThisPeriod = round2(job.hoursWorkedThisPeriod + hours);
  sim.flags.career_hours_today = round2(flagNum(sim, 'career_hours_today') + hours);
  sim.flags.career_last_work_at = ctx.state.time.minute;
  if (!def) return;
  const shiftMinutes = Math.max(60, def.level.shift.end - def.level.shift.start);
  const gain = def.level.dailyPerformanceGain * moodFactor(sim) * skillFactor(sim, def.career) * intensity * (minutes / shiftMinutes);
  job.performance = clamp100(job.performance + gain);
  const xp: Record<string, number> = {};
  for (const s of def.career.skills.slice(0, 3)) xp[s] = round2(0.35 * minutes * intensity);
  if (Object.keys(xp).length) ctx.applyEffects(sim.id, { skills: xp }, 'career:work');
}

function isWorkingNow(ctx: SystemContext, sim: Sim, job: Job): boolean {
  const a = sim.currentAction;
  if (!a) return false;
  if (WORK_ACTION_IDS.has(a.actionId)) return true;
  // objects' own "Work" interactions count while on the clock at the employer venue
  return a.actionId.startsWith('obj:') && shiftState(sim) === 'working' && atWorkplace(ctx, sim, job);
}

function processShift(ctx: SystemContext, sim: Sim, job: Job, dt: number): void {
  const now = ctx.state.time.minute;
  const today = dayIndex(now);
  if (flagNum(sim, 'career_day', -1) !== today) resetShiftDay(ctx, sim, job, today);
  const block = shiftToday(job, ctx.clock.weekday);
  if (!block) return;
  const mod = minuteOfDay(now);
  const state = shiftState(sim);
  // a controlled sim running on autonomy is treated like an NPC: presence at work is clocking in
  const controlled = isYou(ctx, sim) && sim.flags.autonomy !== true;
  if (state === 'pending') {
    if (mod >= block.start && mod < block.start + dt) ctx.emit({ type: 'career:shift_start', simId: sim.id });
    if (mod < block.start) return;
    if (isIncarcerated(ctx, sim)) {
      if (mod >= block.start + CAREER_CONFIG.absentAfterMinutes || mod >= block.end) markAbsent(ctx, sim, job, 'in custody');
      return;
    }
    if (controlled) {
      if (mod >= Math.min(block.end, block.start + CAREER_CONFIG.absentAfterMinutes)) markAbsent(ctx, sim, job, 'no-show');
      return;
    }
    // NPC: if npcAI got them to work, clock them in; otherwise autopilot at shift end
    if (atWorkplace(ctx, sim, job) && (!sim.currentAction || sim.currentAction.actionId.startsWith('npc:'))) {
      startWorking(ctx, sim, job, block);
      sim.currentAction = { actionId: 'career:work_shift', label: `Working (${job.title})`, startedAt: now, endsAt: today * DAY + block.end, interruptible: true };
      return;
    }
    if (mod >= block.end) {
      // autopilot rollup for NPCs we don't move (near/far or no AI): assume they worked
      sim.flags.career_shift = 'working';
      accrueWork(ctx, sim, job, block.end - block.start, 0.85);
      sim.flags.career_shift = 'done';
      ctx.emit({ type: 'career:shift_end', simId: sim.id, hours: (block.end - block.start) / HOUR });
    }
    return;
  }
  if (state === 'working') {
    if (isWorkingNow(ctx, sim, job)) {
      const a = sim.currentAction!;
      const intensity = a.actionId === 'career:work_hard' ? 1.6 : a.actionId === 'career:slack_off' ? -0.4 : a.actionId === 'career:take_break' || a.actionId === 'career:chat_coworkers' ? 0.15 : 1;
      accrueWork(ctx, sim, job, dt, intensity);
    } else if (mod >= block.end - 5) {
      finishShift(ctx, sim, job, false);
      if (!controlled && sim.currentAction?.actionId === 'career:work_shift') sim.currentAction = undefined;
    } else if (now - flagNum(sim, 'career_last_work_at') > 45 && controlled && !atWorkplace(ctx, sim, job)) {
      finishShift(ctx, sim, job, true);
    } else if (!controlled && !atWorkplace(ctx, sim, job) && now - flagNum(sim, 'career_last_work_at') > 45) {
      // NPC wandered off (npcAI); finish quietly
      finishShift(ctx, sim, job, true);
    }
    if (mod >= block.end - 5 && shiftState(sim) === 'working') finishShift(ctx, sim, job, false);
  }
}

// ---------------------------------------------------------------------------
// Daily: promotions, reviews, performance drift, layoffs
// ---------------------------------------------------------------------------
function dailyCareer(ctx: SystemContext, sim: Sim): void {
  const job = sim.career.job;
  if (!job) return;
  const def = levelDef(ctx, job);
  if (!def) return;
  const now = ctx.state.time.minute;
  // drift toward 50 slowly so performance must be earned
  if (job.performance > 50) job.performance = round2(job.performance - 0.3);
  // promotion progress
  if (job.performance > 70) job.promotionProgress = clamp100(job.promotionProgress + ((job.performance - 70) / 30) * 5);
  // low performance tracking
  if (job.performance < CAREER_CONFIG.lowPerformanceThreshold) sim.flags.career_low_days = flagNum(sim, 'career_low_days') + 1;
  else sim.flags.career_low_days = 0;
  if (flagNum(sim, 'career_low_days') >= CAREER_CONFIG.lowPerformanceDays) {
    sim.flags.career_low_days = 0;
    if (job.level > 0) demote(ctx, sim, job, def.career);
    else fireSim(ctx, sim, 'poor performance', false);
    return;
  }
  // promotion
  if (job.promotionProgress >= CAREER_CONFIG.promotionThreshold) {
    const next = def.career.levels[job.level + 1];
    if (!next) {
      job.promotionProgress = 100;
    } else {
      const check = meetsSkills(sim, next);
      if (check.ok) promote(ctx, sim, job, def.career);
      else if (sim.flags.career_promo_hint !== job.level) {
        sim.flags.career_promo_hint = job.level;
        ctx.log({ text: `${verb(ctx, sim, 'Your', `${sim.identity.firstName}'s`)} boss hints that a promotion to ${next.title} is on the table — if ${verb(ctx, sim, 'you', 'they')} sharpen ${check.missing.join(', ')}.`, kind: 'narrative', simId: sim.id, importance: 2 });
      }
    }
  }
  // annual review at each anniversary
  const yearsIn = Math.floor((now - job.startedAt) / (DAY * 365));
  if (yearsIn >= 1 && flagNum(sim, 'career_review_year') < yearsIn) {
    sim.flags.career_review_year = yearsIn;
    const score = Math.round(job.performance);
    ctx.emit({ type: 'career:performance_review', simId: sim.id, score });
    const pct = score >= 80 ? CAREER_CONFIG.annualRaisePct + 0.02 : score >= 40 ? CAREER_CONFIG.annualRaisePct : 0;
    if (pct > 0) {
      if (job.hourlyRate !== undefined) job.hourlyRate = round2(job.hourlyRate * (1 + pct));
      if (job.annualSalary !== undefined) job.annualSalary = Math.round((job.annualSalary * (1 + pct)) / 100) * 100;
    }
    ctx.log({ text: `Annual review at ${job.employerName}: ${score}/100.${pct ? ` ${name(ctx, sim)} ${verb(ctx, sim, 'get', 'gets')} a ${Math.round(pct * 100)}% raise (${payLabel(job)}).` : ' No raise this year.'}`, kind: 'event', simId: sim.id, importance: 2 });
  }
  // rare layoffs in a cold market
  if (ctx.state.economy.jobMarketHeat < 0.3 && def.career.sector !== 'public' && ctx.rng.chance(0.0006)) {
    ctx.log({ text: `${job.employerName} is cutting staff.`, kind: 'alert', simId: sim.id, importance: 2 });
    fireSim(ctx, sim, 'laid off', false);
  }
}

function promote(ctx: SystemContext, sim: Sim, job: Job, career: CareerDef): void {
  const idx = job.level + 1;
  const level = career.levels[idx];
  if (!level) return;
  const pay = scaledPay(ctx, level, ctx.rng.range(1, 1.05));
  const oldHourly = job.hourlyRate;
  job.level = idx;
  job.title = level.title;
  job.hourlyRate = pay.hourlyRate !== undefined ? Math.max(pay.hourlyRate, oldHourly !== undefined ? round2(oldHourly * 1.05) : 0) : undefined;
  job.annualSalary = pay.annualSalary !== undefined ? Math.max(pay.annualSalary, job.annualSalary !== undefined ? Math.round((job.annualSalary * 1.05) / 100) * 100 : 0) : undefined;
  job.payType = job.hourlyRate !== undefined ? 'hourly' : 'salary';
  if (job.payType === 'salary' && job.payFrequency === 'biweekly') job.payFrequency = 'semimonthly';
  job.promotionProgress = 0;
  job.performance = clamp100(job.performance - 15);
  job.shifts = buildShifts(level, ctx.rng);
  job.remote = job.remote && level.remoteEligible;
  if (!job.benefits.health && level.hoursPerWeek >= 30) job.benefits = { health: true, retirement401k: job.payType === 'salary', matchPct: job.payType === 'salary' ? 3 : 0, dental: job.payType === 'salary' };
  setWorkSchedule(sim, job);
  ctx.state.stats.promotions += 1;
  ctx.emit({ type: 'career:promoted', simId: sim.id, title: level.title, level: idx });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'have', 'has')} been promoted to ${level.title} at ${job.employerName} (${payLabel(job)}).`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'proud', label: 'Promoted!', intensity: 15, durationMinutes: DAY * 3 }] }, 'career:promoted');
}

function demote(ctx: SystemContext, sim: Sim, job: Job, career: CareerDef): void {
  const idx = job.level - 1;
  const level = career.levels[idx];
  if (!level) return;
  const pay = scaledPay(ctx, level);
  job.level = idx;
  job.title = level.title;
  job.hourlyRate = pay.hourlyRate;
  job.annualSalary = pay.annualSalary;
  job.payType = job.hourlyRate !== undefined ? 'hourly' : 'salary';
  job.performance = 45;
  job.promotionProgress = 0;
  job.shifts = buildShifts(level, ctx.rng);
  setWorkSchedule(sim, job);
  ctx.emit({ type: 'career:demoted', simId: sim.id, title: level.title });
  ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'have', 'has')} been demoted to ${level.title} at ${job.employerName}.`, kind: 'event', simId: sim.id, importance: 3 });
  ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'embarrassed', label: 'Demoted', intensity: -12, durationMinutes: DAY * 3 }] }, 'career:demoted');
}

// ---------------------------------------------------------------------------
// Gig work
// ---------------------------------------------------------------------------
function gigDeliveries(ctx: SystemContext, sim: Sim): ActionResult {
  const hh = ctx.query.householdOf(sim.id);
  const vehicle = hh?.vehicleIds.map((v) => ctx.state.vehicles[v]).find((v) => v && v.location.venueId === sim.location.venueId);
  const hours = ctx.rng.range(2, 4);
  const rate = ctx.rng.range(14, 22) * clamp(sim.career.gig.rating / 5, 0.7, 1.05);
  const gross = round2(hours * rate);
  const isCar = vehicle && vehicle.fuelType !== 'none';
  const miles = hours * 12;
  const gas = isCar && vehicle ? round2((miles / Math.max(15, vehicle.mpg)) * ctx.state.economy.gasPrice) : 0;
  const net = round2(gross - gas);
  if (!sim.career.gig.platformsJoined.includes('deliveries')) sim.career.gig.platformsJoined.push('deliveries');
  sim.career.gig.completed += Math.round(hours * 3);
  const roll = ctx.rng.next();
  let ratingText = '';
  if (roll < 0.1) {
    sim.career.gig.rating = round2(Math.max(3, sim.career.gig.rating - 0.1));
    ratingText = ' One customer left a one-star review over a cold order.';
  } else if (roll > 0.85) {
    sim.career.gig.rating = round2(Math.min(5, sim.career.gig.rating + 0.05));
    ratingText = ' A customer tipped big and rated five stars.';
  }
  if (vehicle && isCar) {
    vehicle.fuel = Math.max(0, vehicle.fuel - (miles / Math.max(15, vehicle.mpg) / Math.max(1, vehicle.tankGallons)) * 100);
    vehicle.mileage += Math.round(miles);
  }
  ctx.emit({ type: 'money:paycheck', simId: sim.id, gross, net });
  return { ok: true, text: `You run deliveries for ${hours.toFixed(1)} hours and clear ${formatMoney(net)}${gas ? ` after ${formatMoney(gas)} in gas` : ''}.${ratingText}`, durationMinutes: Math.round(hours * 60), effects: { money: { amount: net, memo: 'Gig deliveries', category: 'income', counterparty: 'DoorDash' }, needs: { fun: -8, energy: -12, hunger: -10 }, skills: { driving: 20 }, stress: 3 } };
}

function gigTask(ctx: SystemContext, sim: Sim): ActionResult {
  const h = skillLevel(sim, 'handiness');
  const pay = round2(ctx.rng.range(40, 120) * (1 + h * 0.06));
  const success = ctx.rng.chance(clamp(0.6 + h * 0.06, 0.4, 0.97));
  if (!sim.career.gig.platformsJoined.includes('tasks')) sim.career.gig.platformsJoined.push('tasks');
  sim.career.gig.completed += 1;
  if (!success) {
    sim.career.gig.rating = round2(Math.max(3, sim.career.gig.rating - 0.15));
    return { ok: true, text: 'The furniture went together wrong and the client refused to pay. Rating dinged.', outcomeLabel: 'Botched', effects: { needs: { fun: -10, energy: -15 }, stress: 8, skills: { handiness: 15 } } };
  }
  ctx.emit({ type: 'money:paycheck', simId: sim.id, gross: pay, net: pay });
  return { ok: true, text: `You mount a TV and assemble a dresser for a stranger. ${formatMoney(pay)}, paid through the app.`, outcomeLabel: 'Done', effects: { money: { amount: pay, memo: 'Gig task', category: 'income', counterparty: 'TaskRabbit' }, needs: { energy: -15, hygiene: -8, social: 4 }, skills: { handiness: 25 } } };
}

function sellCrafts(ctx: SystemContext, sim: Sim): ActionResult {
  const s = Math.max(skillLevel(sim, 'crafting'), skillLevel(sim, 'painting'), skillLevel(sim, 'creativity'));
  const sold = ctx.rng.chance(clamp(0.4 + s * 0.08, 0.3, 0.95));
  if (!sold) return { ok: true, text: 'You list a few pieces online. No bites today.', outcomeLabel: 'No sale', effects: { needs: { fun: 3 }, skills: { crafting: 5 } } };
  const pay = round2(ctx.rng.range(20, 80) * (1 + s * 0.1));
  ctx.emit({ type: 'money:paycheck', simId: sim.id, gross: pay, net: pay });
  return { ok: true, text: `A piece sells online for ${formatMoney(pay)}.`, outcomeLabel: 'Sold', effects: { money: { amount: pay, memo: 'Craft sale', category: 'income', counterparty: 'Etsy' }, needs: { fun: 5 }, skills: { crafting: 10 }, moodlets: [{ emotion: 'proud', label: 'Made a sale', intensity: 4, durationMinutes: 6 * HOUR }] } };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const notJailed: Requirement = { kind: 'not_incarcerated', reason: 'You are in custody' };

function jobActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const now = ctx.state.time.minute;
  const age = ctx.query.ageOf(sim);
  const job = sim.career.job;
  if (age >= 15 && !sim.career.retired) {
    out.push({ id: 'phone:jobs:browse', label: 'Browse job listings', description: 'See who is hiring this week.', category: 'phone', icon: 'briefcase', durationMinutes: 10, effects: { needs: { fun: -1 } }, group: 'Jobs', requirements: [notJailed] });
    if (flagNum(sim, 'career_jobs_week', -1) === weekIndex(now)) {
      for (const o of jobListings(ctx, sim)) {
        const alreadyHere = job && job.employerVenueId === o.employerVenueId && job.careerId === o.careerId;
        if (alreadyHere) continue;
        out.push({ id: `phone:jobs:apply:${o.careerId}:${o.employerVenueId ?? 'none'}`, label: `Apply: ${o.title} at ${o.employerName} (${o.pay})`, category: 'phone', icon: 'paper-plane', durationMinutes: 20, effects: { needs: { fun: -2 } }, group: 'Jobs', params: { careerId: o.careerId, employerVenueId: o.employerVenueId, level: o.level }, requirements: [notJailed] });
      }
    }
  }
  // applications: interviews & offers
  for (const app of sim.career.applications) {
    if (app.status === 'interview' && app.interviewAt !== undefined) {
      const w = interviewWindow(app, now);
      if (w === 'early' && app.interviewAt - now > 6 * HOUR) continue;
      if (w === 'missed') continue;
      const career = ctx.content.careers[app.careerId];
      const remote = career?.levels[app.level]?.remoteEligible && app.employerVenueId === undefined;
      const here = app.employerVenueId ? sim.location.venueId === app.employerVenueId : true;
      if (!here && !remote) continue;
      out.push({ id: `career:interview:${app.id}`, label: `Attend interview (${app.employerName})`, description: w === 'early' ? 'Wait for the interview to start.' : 'Make your case.', category: 'work', icon: 'handshake', durationMinutes: 45, effects: {}, group: 'Jobs', requirements: [notJailed, { kind: 'time_window', reason: 'Not interview time yet', params: { start: minuteOfDay(app.interviewAt) - 20, end: Math.min(1439, minuteOfDay(app.interviewAt) + 90) } }] });
    }
    if (app.status === 'offer') {
      out.push({ id: `career:accept:${app.id}`, label: `Accept offer: ${app.employerName}`, category: 'work', icon: 'check', durationMinutes: 5, effects: {}, group: 'Jobs', requirements: [notJailed] });
      if (!sim.flags[`career_negotiated_${app.id}`]) out.push({ id: `career:negotiate:${app.id}`, label: `Negotiate pay (${app.employerName})`, category: 'work', icon: 'comments-dollar', durationMinutes: 15, effects: {}, group: 'Jobs', requirements: [notJailed] });
      out.push({ id: `career:decline:${app.id}`, label: `Decline offer: ${app.employerName}`, category: 'work', icon: 'times', durationMinutes: 2, effects: {}, group: 'Jobs' });
    }
  }
  // walk-in
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (venue && WALK_IN_ARCHETYPES.has(venue.archetype) && age >= 15 && (!job || job.employerVenueId !== venue.id) && flagNum(sim, `career_walkin_${venue.id}`, -1) !== weekIndex(now)) {
    out.push({ id: `career:walk_in:${venue.id}`, label: 'Ask about job openings', category: 'work', icon: 'door-open', durationMinutes: 15, effects: {}, group: 'Jobs', requirements: [notJailed, { kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } }] });
  }
  return out;
}

function shiftActions(ctx: SystemContext, sim: Sim, job: Job): ActionDef[] {
  const out: ActionDef[] = [];
  const now = ctx.state.time.minute;
  const mod = minuteOfDay(now);
  const block = shiftToday(job, ctx.clock.weekday);
  const state = shiftState(sim);
  const def = levelDef(ctx, job);
  const here = atWorkplace(ctx, sim, job);
  const remoteBlocked = job.remote && !job.employerVenueId && !here;
  if (block && here && mod >= block.start - 30 && mod < block.end && (state === 'pending' || state === 'working')) {
    const remaining = Math.max(15, block.end - mod);
    const perMinute = { energy: -0.08, fun: -0.05, hunger: -0.07, social: job.coworkerSimIds.length ? 0.02 : 0, comfort: def && def.career.physical >= 6 ? -0.05 : -0.02 };
    const task = def ? def.level.tasks[Math.floor(dayIndex(now) % def.level.tasks.length)] : undefined;
    out.push({ id: 'career:work_shift', label: state === 'working' ? 'Get back to work' : 'Work shift', description: task ?? 'Put in the hours.', category: 'work', icon: 'briefcase', durationMinutes: remaining, effects: { perMinute }, group: 'Work', satisfies: [], interruptible: true, requirements: [notJailed] });
    out.push({ id: 'career:work_hard', label: 'Work hard', description: 'Push for an hour: more performance, more fatigue.', category: 'work', icon: 'fire', durationMinutes: Math.min(60, remaining), effects: { perMinute: { ...perMinute, energy: -0.13, fun: -0.08 }, stress: 4 }, group: 'Work', requirements: [notJailed] });
    if (state === 'working') {
      out.push({ id: 'career:slack_off', label: 'Slack off', description: 'Scroll your phone for an hour. Might get noticed.', category: 'work', icon: 'mobile', durationMinutes: Math.min(60, remaining), effects: { perMinute: { fun: 0.15, energy: -0.02 } }, group: 'Work' });
      out.push({ id: 'career:take_break', label: 'Take a break', category: 'work', icon: 'coffee', durationMinutes: 15, effects: { needs: { energy: 4, comfort: 6, fun: 3 }, stress: -3 }, group: 'Work' });
      const coworkersHere = job.coworkerSimIds.filter((c) => ctx.state.sims[c]?.location.venueId === sim.location.venueId);
      if (coworkersHere.length || (job.employerVenueId && ctx.query.simsAt(job.employerVenueId).some((s) => s.id !== sim.id && ctx.query.venue(job.employerVenueId!).staffSimIds.includes(s.id)))) {
        out.push({ id: 'career:chat_coworkers', label: 'Chat with coworkers', category: 'social', icon: 'comments', durationMinutes: 20, effects: { needs: { social: 12, fun: 5 }, stress: -2 }, group: 'Work' });
      }
      if (mod < block.end - 30) out.push({ id: 'career:leave_early', label: 'Leave early', description: 'Clock out before the shift ends. Performance takes a hit.', category: 'work', icon: 'sign-out', durationMinutes: 5, effects: {}, group: 'Work' });
    }
  }
  if (block && state === 'pending' && mod < block.start + 60) {
    out.push({ id: 'career:call_in_sick', label: 'Call in sick', description: job.sickHoursBalance >= 8 ? 'Use paid sick time.' : 'Unpaid — and the boss may not love it.', category: 'phone', icon: 'phone', durationMinutes: 5, effects: {}, group: 'Work' });
  }
  if (remoteBlocked && block && state === 'pending' && mod >= block.start && mod < block.end) {
    out.push({ id: 'career:work_shift', label: 'Work shift (need a computer at home)', category: 'work', icon: 'laptop', durationMinutes: 15, effects: {}, group: 'Work', requirements: [{ kind: 'custom', reason: 'You need a computer and internet at home', params: { fn: () => false } }] });
  }
  if (job.ptoHoursBalance >= 8) out.push({ id: 'career:request_pto', label: 'Request a day off (PTO)', description: `Take your next shift off. ${job.ptoHoursBalance}h PTO left.`, category: 'phone', icon: 'calendar', durationMinutes: 5, effects: {}, group: 'Work' });
  if (job.status !== 'notice') out.push({ id: 'career:quit_notice', label: 'Give two weeks’ notice', category: 'work', icon: 'file-signature', durationMinutes: 10, effects: {}, group: 'Work' });
  out.push({ id: 'career:quit', label: 'Quit on the spot', category: 'work', icon: 'door-open', durationMinutes: 5, effects: {}, group: 'Work' });
  return out;
}

function gigActions(ctx: SystemContext, sim: Sim): ActionDef[] {
  const out: ActionDef[] = [];
  const home = homeVenueId(ctx, sim);
  const age = ctx.query.ageOf(sim);
  if (!home || sim.location.venueId !== home || age < 18) return out;
  out.push({ id: 'phone:gigs:deliveries', label: 'Do gig deliveries', description: 'Drive or bike for a delivery app for a few hours.', category: 'work', icon: 'motorcycle', durationMinutes: 180, effects: {}, group: 'Gig work', requirements: [notJailed, { kind: 'vehicle', reason: 'You need a car, bike or scooter here' }, { kind: 'energy', reason: 'Too tired', params: { min: 20 } }] });
  out.push({ id: 'phone:gigs:task', label: 'Do a TaskRabbit-style task', description: 'Assemble furniture, mount a TV, haul junk.', category: 'work', icon: 'toolbox', durationMinutes: 120, effects: {}, group: 'Gig work', requirements: [notJailed, { kind: 'energy', reason: 'Too tired', params: { min: 25 } }] });
  if (Math.max(skillLevel(sim, 'crafting'), skillLevel(sim, 'painting'), skillLevel(sim, 'creativity')) >= 1) out.push({ id: 'phone:gigs:sell_crafts', label: 'Sell crafts online', category: 'work', icon: 'store', durationMinutes: 60, effects: {}, group: 'Gig work', requirements: [notJailed] });
  return out;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const careerSystem: System = {
  id: 'career',
  intervalMinutes: 15,

  onInit(ctx) {
    for (const sim of ctx.query.aliveSims()) if (sim.career.job) setWorkSchedule(sim, sim.career.job);
  },

  onTick(ctx, dt) {
    const now = ctx.state.time.minute;
    const seen = new Set<SimId>();
    const sims = [...ctx.query.controlledSims(), ...ctx.query.simulatedSims()];
    for (const sim of sims) {
      if (seen.has(sim.id) || !sim.body.alive) continue;
      seen.add(sim.id);
      const job = sim.career.job;
      if (job) processShift(ctx, sim, job, dt);
    }
    // paydays: check once per day around payHour for everyone (cheap, daily)
    const mod = minuteOfDay(now);
    const payStart = CAREER_CONFIG.payHour * HOUR;
    if (mod >= payStart && mod < payStart + dt) {
      for (const sim of ctx.query.aliveSims()) {
        const job = sim.career.job;
        if (job && paydayDue(now, job)) payJob(ctx, sim, job);
        if (sim.career.secondJob && paydayDue(now, sim.career.secondJob)) payJob(ctx, sim, sim.career.secondJob);
        if (sim.career.unemployment) payUnemployment(ctx, sim);
        if (sim.career.retired) paySocialSecurity(ctx, sim);
      }
    }
  },

  onEvent(ctx, event: GameEvent) {
    switch (event.type) {
      case 'time:day': {
        for (const sim of ctx.query.aliveSims()) {
          if (sim.career.job) dailyCareer(ctx, sim);
          // far sims: daily shift rollup happens in processShift for near/full; far sims just get paid & drift
          if (sim.lod === 'far' && sim.career.job) {
            const job = sim.career.job;
            const wd = weekdayAt(ctx.state.epoch, event.minute - 1);
            const block = shiftToday(job, wd);
            if (block && !isIncarcerated(ctx, sim)) job.hoursWorkedThisPeriod = round2(job.hoursWorkedThisPeriod + (block.end - block.start) / HOUR);
          }
        }
        break;
      }
      case 'scheduled:fired': {
        const ev = event.event;
        const sim = ev.simId ? ctx.state.sims[ev.simId] : undefined;
        if (!sim) break;
        if (ev.kind === '_job_response') handleJobResponse(ctx, sim, String(ev.payload?.applicationId));
        else if (ev.kind === 'interview') {
          const app = sim.career.applications.find((a) => a.id === ev.payload?.applicationId);
          if (app?.status === 'interview' && isYou(ctx, sim)) {
            const here = app.employerVenueId ? sim.location.venueId === app.employerVenueId : true;
            ctx.log({ text: `Your interview at ${app.employerName} is starting${here ? '.' : ' — and you are not there.'}`, kind: 'alert', simId: sim.id, importance: 2 });
            ctx.emit({ type: 'phone:notification', simId: sim.id, app: 'calendar', title: 'Interview now', body: `${app.employerName} — ${ctx.content.careers[app.careerId]?.levels[app.level]?.title ?? 'interview'}` });
          }
        } else if (ev.kind === '_notice_end') {
          const job = sim.career.job;
          if (job && job.id === ev.payload?.jobId && job.status === 'notice') {
            ctx.emit({ type: 'career:quit', simId: sim.id });
            sim.career.reputation = clamp100(sim.career.reputation + 3);
            ctx.log({ text: `${name(ctx, sim)} ${verb(ctx, sim, 'work', 'works')} ${verb(ctx, sim, 'your', 'their')} last day at ${job.employerName}.`, kind: 'event', simId: sim.id, importance: 3 });
            endJob(ctx, sim, 'resigned', false);
          }
        }
        break;
      }
      case 'action:completed': {
        const sim = ctx.state.sims[event.simId];
        const job = sim?.career.job;
        if (!sim || !job) break;
        if (WORK_ACTION_IDS.has(event.actionId)) {
          const block = shiftToday(job, ctx.clock.weekday);
          const mod = minuteOfDay(ctx.state.time.minute);
          if (event.actionId === 'career:slack_off' && ctx.rng.chance(0.2)) {
            job.warnings += 1;
            job.performance = clamp100(job.performance - 5);
            ctx.log({ text: `Your boss catches you slacking off. Warning ${job.warnings}/${CAREER_CONFIG.warningsToFire}.`, kind: 'alert', simId: sim.id, importance: 2 });
            if (job.bossSimId) ctx.applyEffects(sim.id, { relationships: [{ simId: job.bossSimId, trust: -5 }] }, 'career:slack');
            if (job.warnings >= CAREER_CONFIG.warningsToFire) fireSim(ctx, sim, 'repeated warnings', true);
          }
          if (event.actionId === 'career:chat_coworkers') {
            const here = job.coworkerSimIds.filter((c) => ctx.state.sims[c]?.location.venueId === sim.location.venueId).slice(0, 3);
            for (const c of here) ctx.applyEffects(sim.id, { relationships: [{ simId: c, friendship: 3, familiarity: 3, mutual: true }] }, 'career:chat');
          }
          if (block && shiftState(sim) === 'working' && mod >= block.end - 15) finishShift(ctx, sim, job, false);
        }
        break;
      }
      case 'action:started': {
        const sim = ctx.state.sims[event.simId];
        const job = sim?.career.job;
        if (!sim || !job || !WORK_ACTION_IDS.has(event.action.id)) break;
        const block = shiftToday(job, ctx.clock.weekday);
        if (block && (shiftState(sim) === 'pending' || shiftState(sim) === 'working')) startWorking(ctx, sim, job, block);
        break;
      }
      case 'action:interrupted': {
        const sim = ctx.state.sims[event.simId];
        const job = sim?.career.job;
        if (!sim || !job || !WORK_ACTION_IDS.has(event.actionId)) break;
        // player switched to something else mid-shift; the tick will decide if they left
        sim.flags.career_last_work_at = ctx.state.time.minute;
        break;
      }
      case 'custom': {
        if (!event.simId) break;
        const sim = ctx.state.sims[event.simId];
        if (!sim) break;
        if (event.kind === 'career:clock_in' && sim.career.job) {
          const block = shiftToday(sim.career.job, ctx.clock.weekday);
          if (block && shiftState(sim) === 'pending' && atWorkplace(ctx, sim, sim.career.job)) startWorking(ctx, sim, sim.career.job, block);
        } else if (event.kind === 'career:incarcerated' && sim.career.job) {
          const days = Number(event.payload?.days ?? 0);
          if (days >= 30) fireSim(ctx, sim, 'incarcerated', true);
        }
        break;
      }
      case 'sim:died': {
        const sim = ctx.state.sims[event.simId];
        if (sim?.career.job) endJob(ctx, sim, 'deceased', false);
        break;
      }
      default:
        break;
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.sim(simId);
    if (!sim.body.alive) return [];
    const out: ActionDef[] = [...jobActions(ctx, sim), ...gigActions(ctx, sim)];
    if (sim.career.job) out.push(...shiftActions(ctx, sim, sim.career.job));
    if (!sim.career.retired && ctx.query.ageOf(sim) >= 62) out.push({ id: 'career:retire', label: 'Retire', description: 'Claim Social Security and stop working.', category: 'work', icon: 'umbrella-beach', durationMinutes: 10, effects: {}, group: 'Work' });
    return out;
  },

  handles(actionId) {
    return actionId.startsWith('career:') || actionId.startsWith('phone:jobs:') || actionId.startsWith('phone:gigs:');
  },

  execute(ctx, simId, action, params): ActionResult {
    const sim = ctx.query.sim(simId);
    const id = action.id;
    if (id === 'phone:jobs:browse') {
      sim.flags.career_jobs_week = weekIndex(ctx.state.time.minute);
      const list = jobListings(ctx, sim);
      const text = list.length ? `This week's openings:\n${list.map((o) => `• ${o.title} — ${o.employerName} (${o.pay})`).join('\n')}` : 'Nothing is hiring nearby this week.';
      return { ok: true, text, data: { openings: list } };
    }
    if (id.startsWith('phone:jobs:apply:')) {
      const careerId = String(params.careerId ?? id.split(':')[3]);
      const venueId = params.employerVenueId as VenueId | undefined;
      return applyForJob(ctx, sim, careerId, venueId, Number(params.level ?? 0));
    }
    if (id === 'phone:gigs:deliveries') return gigDeliveries(ctx, sim);
    if (id === 'phone:gigs:task') return gigTask(ctx, sim);
    if (id === 'phone:gigs:sell_crafts') return sellCrafts(ctx, sim);
    if (id.startsWith('career:interview:')) {
      const app = sim.career.applications.find((a) => a.id === id.slice('career:interview:'.length));
      return app ? runInterview(ctx, sim, app) : { ok: false, text: 'No such interview.' };
    }
    if (id.startsWith('career:negotiate:')) {
      const app = sim.career.applications.find((a) => a.id === id.slice('career:negotiate:'.length));
      return app ? negotiateOffer(ctx, sim, app) : { ok: false, text: 'No such offer.' };
    }
    if (id.startsWith('career:accept:')) {
      const app = sim.career.applications.find((a) => a.id === id.slice('career:accept:'.length));
      return app ? acceptOffer(ctx, sim, app) : { ok: false, text: 'No such offer.' };
    }
    if (id.startsWith('career:decline:')) {
      const app = sim.career.applications.find((a) => a.id === id.slice('career:decline:'.length));
      if (!app) return { ok: false, text: 'No such offer.' };
      app.status = 'withdrawn';
      return { ok: true, text: `You decline ${app.employerName}.` };
    }
    if (id.startsWith('career:walk_in:')) {
      const venue = ctx.query.venueMaybe(id.slice('career:walk_in:'.length) as VenueId);
      return venue ? walkIn(ctx, sim, venue) : { ok: false, text: 'Unknown venue.' };
    }
    const job = sim.career.job;
    if (id === 'career:retire') return retire(ctx, sim);
    if (!job) return { ok: false, text: 'You have no job.' };
    switch (id) {
      case 'career:work_shift':
      case 'career:work_hard': {
        const block = shiftToday(job, ctx.clock.weekday);
        if (!block) return { ok: false, text: 'No shift today.' };
        if (!atWorkplace(ctx, sim, job)) return { ok: false, text: job.remote ? 'You need a computer and internet at home to work remotely.' : `You need to be at ${job.employerName}.` };
        if (shiftState(sim) === 'absent') return { ok: false, text: 'You were already marked absent today.' };
        if (shiftState(sim) === 'done' || shiftState(sim) === 'left') return { ok: false, text: 'Your shift is over for today.' };
        return { ok: true, text: id === 'career:work_hard' ? 'You put your head down and grind.' : `You clock in at ${job.employerName}.` };
      }
      case 'career:slack_off':
        return { ok: true, text: 'You find a quiet corner and your phone.' };
      case 'career:take_break':
        return { ok: true, text: 'You step away for fifteen minutes.' };
      case 'career:chat_coworkers':
        return { ok: true, text: 'You catch up with coworkers by the break room.' };
      case 'career:leave_early': {
        finishShift(ctx, sim, job, true);
        return { ok: true, text: 'You clock out early.' };
      }
      case 'career:call_in_sick': {
        const today = dayIndex(ctx.state.time.minute);
        const paid = job.sickHoursBalance >= 8;
        if (paid) job.sickHoursBalance -= 8;
        sim.flags.career_shift = 'excused';
        const reallySick = sim.body.illnesses.length > 0 || sim.body.health < 50;
        if (!reallySick && ctx.rng.chance(0.15)) {
          job.warnings += 1;
          job.performance = clamp100(job.performance - 6);
          ctx.log({ text: `Your boss saw your post from the lake. Warning ${job.warnings}/${CAREER_CONFIG.warningsToFire}.`, kind: 'alert', simId: sim.id, importance: 2 });
          if (job.warnings >= CAREER_CONFIG.warningsToFire) fireSim(ctx, sim, 'dishonesty', true);
        }
        void today;
        return { ok: true, text: paid ? 'You call in sick and use 8 hours of sick time.' : 'You call in sick (unpaid).', effects: paid ? { money: { amount: round2((job.hourlyRate ?? (job.annualSalary ?? 0) / 2080) * 8), memo: `Sick pay — ${job.employerName}`, category: 'income', counterparty: job.employerName } } : undefined };
      }
      case 'career:request_pto': {
        if (job.ptoHoursBalance < 8) return { ok: false, text: 'Not enough PTO.' };
        const today = dayIndex(ctx.state.time.minute);
        for (let d = 1; d <= 14; d++) {
          const day = today + d;
          const wd = weekdayAt(ctx.state.epoch, day * DAY);
          if (shiftToday(job, wd)) {
            const days = flagStr(sim, 'career_excused_days').split(',').filter(Boolean);
            if (days.includes(String(day))) continue;
            days.push(String(day));
            sim.flags.career_excused_days = days.join(',');
            job.ptoHoursBalance -= 8;
            ctx.schedule({ atMinute: day * DAY + 8 * HOUR, kind: 'reminder', label: `Day off (PTO) — ${job.employerName}`, simId: sim.id });
            return { ok: true, text: `PTO approved for ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]} (${d} day${d > 1 ? 's' : ''} from now).` };
          }
        }
        return { ok: false, text: 'No upcoming shift to take off.' };
      }
      case 'career:quit_notice':
        return quitJob(ctx, sim, false);
      case 'career:quit':
        return quitJob(ctx, sim, true);
      default:
        return { ok: false, text: 'Unknown career action.' };
    }
  },
};
