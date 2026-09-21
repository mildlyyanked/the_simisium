/**
 * Health system: illnesses (onset, contagion, progression, treatment, recovery, death),
 * injuries, fitness & weight, immune drift, pregnancy progression, addictions, mental health,
 * medical actions with US-style insurance billing.
 *
 * Flag keys owned by this system (on `sim.flags`):
 *   health:last              minute of last hourly tick (LOD catch-up)
 *   health:dayAt             minute of last daily rollup
 *   health:warned:<illId>    severity interrupt already fired for this illness
 *   health:tx:<illId>        effectiveness of the treatment applied to this illness
 *   health:rx                number of prescriptions waiting to be filled at a pharmacy
 *   health:lastDentalAt      minute of last dental cleaning
 *   health:lastPhysicalAt    minute of last annual physical
 *   health:fluShotYear       year of the last flu shot
 *   health:vitaminsDay       day index vitamins were last taken
 *   health:therapyAt         minute of last therapy session
 *   health:highStressDays    consecutive days with stress > 85
 *   health:lowMoodDays       consecutive days with mood < −30
 *   health:dryHours          consecutive hours with thirst < 5 (dehydration)
 *   health:nauseaRolled      pregnancy nausea already rolled for this pregnancy
 *   addict:last:<kind>       minute of last use of an addictive substance/behaviour
 *   fitness_last_at          minute of last exercise (any effect bundle with fitness > 0)
 * Reads (written by needs): calories_yesterday, tdee.
 *
 * Custom event kinds handled:
 *   health:injury {name, bodyPart, severity, days}   health:checkup {venue?}   health:medicate {itemId}
 *   health:pregnancy_test   health:therapy_session   health:exposure_sti {protected?}
 *   health:nicotine {units}   health:cannabis {units, intoxication?}   health:gambled {amount, lost?}
 *   health:contract {defId, severity?}   needs:drank {alcoholUnits}
 * Custom event kinds emitted: health:bill {sticker, patient, insurer, kind, venueId}
 * Action id prefix handled: `health:`
 */
import { addMoodlet, transact } from '../core/effects';
import { newsEffects } from './story';
import type { GameEvent } from '../core/events';
import { shortId } from '../core/ids';
import type { ActionResult, System, SystemContext } from '../core/systems';
import type { ActionDef, Illness, Injury, InsurancePlan, MentalCondition, Sim, SimId, Venue, VenueArchetype } from '../core/types';
import { clamp, clamp100, DAY, HOUR, round2 } from '../core/util';
import type { IllnessDef } from '../content/types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const OUTDOOR: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['park', 'trail', 'beach', 'playground', 'sports_field', 'golf', 'farmers_market', 'cemetery', 'zoo', 'amusement_park', 'parking', 'transit_stop', 'pool']);
const MEDICAL: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['clinic', 'hospital', 'pharmacy', 'dentist']);

const START_SEVERITY: Record<string, number> = { heart_attack: 60, appendicitis: 30, migraine: 50, hangover: 45, food_poisoning: 40, heat_exhaustion: 45, hypothermia: 45, dehydration: 40, stomach_bug: 30, sunburn: 35 };
const OBVIOUS: ReadonlySet<string> = new Set(['hangover', 'sunburn', 'migraine', 'seasonal_allergies', 'sprained_ankle', 'broken_arm', 'food_poisoning', 'stomach_bug', 'common_cold', 'back_pain', 'tooth_decay', 'heat_exhaustion', 'hypothermia', 'dehydration', 'pregnancy_nausea']);
const MENTAL_MAP: Record<string, MentalCondition> = { depression: 'depression', anxiety: 'anxiety_disorder', insomnia: 'insomnia', burnout: 'burnout' };
const PAIN_ILLS = ['migraine', 'back_pain', 'sprained_ankle', 'broken_arm', 'tooth_decay', 'hangover', 'sunburn', 'ear_infection', 'concussion'];
const COLD_ILLS = ['common_cold', 'flu', 'covid', 'bronchitis'];
const STOMACH_ILLS = ['stomach_bug', 'food_poisoning', 'acid_reflux'];
const BACTERIAL = ['strep_throat', 'uti', 'ear_infection', 'bronchitis', 'pneumonia', 'sti'];

/** sticker prices (US, cost-of-living 1.0) */
const PRICE = { doctor: 200, urgentCare: 150, er: 1200, rx: 30, dental: 120, filling: 250, fluShot: 25, therapy: 150, physical: 250 };

export type BillKind = 'office' | 'er' | 'rx' | 'preventive' | 'dental' | 'therapy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const you = (ctx: SystemContext, sim: Sim): boolean => ctx.query.isControlled(sim.id);
const name = (sim: Sim): string => sim.identity.firstName;
const hasTrait = (sim: Sim, t: string): boolean => sim.personality.traits.includes(t);
const bmiOf = (sim: Sim): number => sim.body.weight / Math.pow(Math.max(0.5, sim.body.heightCm / 100), 2);
const hasIllness = (sim: Sim, defId: string): boolean => sim.body.illnesses.some((i) => i.defId === defId);
const removeMoodlet = (sim: Sim, id: string): void => {
  if (sim.mind.moodlets.some((m) => m.id === id)) sim.mind.moodlets = sim.mind.moodlets.filter((m) => m.id !== id);
};

function isKnownToPlayer(ctx: SystemContext, sim: Sim): boolean {
  if (you(ctx, sim)) return true;
  return ctx.query.controlledSims().some((c) => !!c.relationships[sim.id]);
}

function stressMult(ctx: SystemContext, sim: Sim): number {
  let m = 1;
  for (const t of sim.personality.traits) {
    const v = ctx.content.traits[t]?.stressMult;
    if (typeof v === 'number' && v > 0) m *= v;
  }
  return m;
}

/** What the patient pays for a sticker price under their plan. Mutates nothing. */
export function patientShare(plan: InsurancePlan, sticker: number, kind: BillKind): { patient: number; insurer: number; deductibleUsed: number } {
  sticker = round2(sticker);
  if (sticker <= 0) return { patient: 0, insurer: 0, deductibleUsed: 0 };
  const full = { patient: sticker, insurer: 0, deductibleUsed: 0 };
  switch (plan.kind) {
    case 'none':
      return full;
    case 'medicaid': {
      const copay = kind === 'preventive' || kind === 'therapy' ? 0 : kind === 'er' ? 8 : kind === 'rx' ? 4 : kind === 'dental' ? 25 : 3;
      const p = Math.min(sticker, copay);
      return { patient: p, insurer: round2(sticker - p), deductibleUsed: 0 };
    }
    case 'medicare': {
      if (kind === 'preventive') return { patient: 0, insurer: sticker, deductibleUsed: 0 };
      if (kind === 'dental') return full; // original Medicare does not cover dental
      const remaining = Math.max(0, plan.deductible - plan.deductibleMet);
      const ded = Math.min(remaining, sticker);
      const rest = sticker - ded;
      const p = round2(ded + rest * 0.2);
      return { patient: p, insurer: round2(sticker - p), deductibleUsed: ded };
    }
    default: {
      // employer / marketplace / parent
      if (kind === 'preventive') return { patient: 0, insurer: sticker, deductibleUsed: 0 };
      if (kind === 'office' || kind === 'therapy') {
        const p = Math.min(sticker, plan.copay);
        return { patient: p, insurer: round2(sticker - p), deductibleUsed: 0 };
      }
      if (kind === 'rx') {
        const p = Math.min(sticker, Math.max(10, Math.round(plan.copay / 3)));
        return { patient: p, insurer: round2(sticker - p), deductibleUsed: 0 };
      }
      if (kind === 'dental') {
        const p = round2(sticker * 0.5);
        return { patient: p, insurer: round2(sticker - p), deductibleUsed: 0 };
      }
      const remaining = Math.max(0, plan.deductible - plan.deductibleMet);
      const ded = Math.min(remaining, sticker);
      const rest = sticker - ded;
      const p = round2(ded + rest * clamp(plan.coinsurance, 0, 1));
      return { patient: p, insurer: round2(sticker - p), deductibleUsed: ded };
    }
  }
}

/** Bill a sim: applies insurance, charges (or creates medical debt), logs and emits. Returns patient amount. */
function bill(ctx: SystemContext, sim: Sim, sticker: number, kind: BillKind, memo: string, venue?: Venue): number {
  const now = ctx.state.time.minute;
  sticker = round2(sticker * ctx.state.region.costOfLiving);
  const share = patientShare(sim.body.insurance, sticker, kind);
  sim.body.insurance.deductibleMet = round2(sim.body.insurance.deductibleMet + share.deductibleUsed);
  const counterparty = venue?.name ?? 'Medical provider';
  if (share.patient > 0) {
    const tx = transact(sim, -share.patient, memo, now, { category: 'medical', counterparty, venueId: venue?.id, rng: ctx.rng });
    if (tx.ok) {
      ctx.emit({ type: 'money:transaction', simId: sim.id, amount: -share.patient, memo, accountId: tx.accountId!, category: 'medical' });
      ctx.state.stats.moneySpent = round2(ctx.state.stats.moneySpent + share.patient);
    } else {
      ctx.emit({ type: 'money:insufficient', simId: sim.id, amount: share.patient, memo });
      sim.finance.loans.push({
        id: shortId(ctx.rng, 'loan'),
        kind: 'medical',
        lender: counterparty,
        principal: share.patient,
        balance: share.patient,
        apr: 0,
        monthlyPayment: round2(Math.max(25, share.patient / 24)),
        nextDueAt: now + 30 * DAY,
        missedPayments: 0,
        termMonths: 24,
        startedAt: now,
        inDefault: false,
        deferred: false,
      });
      ctx.log({ text: you(ctx, sim) ? `You can't cover the $${share.patient.toFixed(2)} bill. ${counterparty} puts you on a payment plan.` : `${name(sim)} couldn't pay a $${share.patient.toFixed(2)} medical bill.`, kind: 'money', simId: sim.id, importance: 2 });
    }
  }
  const insured = sim.body.insurance.kind !== 'none';
  const text = insured
    ? `${memo}: billed $${sticker.toFixed(2)} · insurance paid $${share.insurer.toFixed(2)} · ${you(ctx, sim) ? 'you' : name(sim)} paid $${share.patient.toFixed(2)}.`
    : `${memo}: $${sticker.toFixed(2)}, no insurance.`;
  ctx.log({ text, kind: 'money', simId: sim.id, venueId: venue?.id, importance: share.patient >= 500 ? 2 : 1 });
  ctx.emit({ type: 'custom', kind: 'health:bill', simId: sim.id, payload: { sticker, patient: share.patient, insurer: share.insurer, kind, venueId: venue?.id } });
  return share.patient;
}

// ---------------------------------------------------------------------------
// Illness lifecycle
// ---------------------------------------------------------------------------
function sickMoodlet(ctx: SystemContext, sim: Sim, ill: Illness): void {
  const now = ctx.state.time.minute;
  const id = `ill:${ill.id}`;
  const existing = sim.mind.moodlets.find((m) => m.id === id);
  const intensity = -Math.round(5 + ill.severity / 4);
  if (!existing || existing.intensity !== intensity || existing.expiresAt - now < 2 * HOUR) addMoodlet(sim, { id, emotion: 'sick', label: ill.name, intensity, durationMinutes: DAY, source: 'health' }, now, ctx.rng);
}

export function contract(ctx: SystemContext, sim: Sim, def: IllnessDef, opts: { severity?: number; source?: string; quiet?: boolean } = {}): Illness | undefined {
  if (!sim.body.alive) return undefined;
  if (hasIllness(sim, def.id)) return undefined;
  const now = ctx.state.time.minute;
  const ill: Illness = {
    id: shortId(ctx.rng, 'ill'),
    name: def.name,
    defId: def.id,
    severity: clamp100(opts.severity ?? START_SEVERITY[def.id] ?? 20),
    startedAt: now,
    contagious: def.contagious,
    chronic: def.chronic,
    treated: false,
    diagnosed: OBVIOUS.has(def.id) || def.kind === 'injury',
  };
  sim.body.illnesses.push(ill);
  const cond = MENTAL_MAP[def.id];
  if (cond && !sim.mind.conditions.includes(cond)) sim.mind.conditions.push(cond);
  sickMoodlet(ctx, sim, ill);
  ctx.emit({ type: 'sim:sick', simId: sim.id, illnessId: ill.id, name: def.name });
  const controlled = you(ctx, sim);
  const symptoms = def.symptoms.slice(0, 3).join(', ');
  if (!opts.quiet) {
    ctx.log({
      text: controlled ? `You're coming down with something: ${symptoms}.${ill.diagnosed ? ` Looks like ${def.name.toLowerCase()}.` : ''}` : `${name(sim)} isn't feeling well (${symptoms}).`,
      kind: 'alert',
      simId: sim.id,
      venueId: sim.location.venueId,
      importance: controlled ? (ill.severity >= 40 ? 3 : 2) : sim.lod === 'far' ? 0 : 1,
    });
  }
  if (controlled && ill.severity >= 40) {
    sim.flags[`health:warned:${ill.id}`] = true;
    ctx.interrupt({ kind: 'emergency', title: ill.diagnosed ? def.name : 'Something is wrong', body: `${symptoms}. ${def.lethal ? 'This could be serious — get to a clinic or the ER.' : 'You should rest, or see someone about it.'}`, simId: sim.id, options: [{ label: 'Check symptoms online', actionId: 'health:check_symptoms' }] });
  }
  return ill;
}

function recover(ctx: SystemContext, sim: Sim, ill: Illness): void {
  const now = ctx.state.time.minute;
  sim.body.illnesses = sim.body.illnesses.filter((i) => i.id !== ill.id);
  removeMoodlet(sim, `ill:${ill.id}`);
  delete sim.flags[`health:warned:${ill.id}`];
  delete sim.flags[`health:tx:${ill.id}`];
  const cond = MENTAL_MAP[ill.defId];
  if (cond) sim.mind.conditions = sim.mind.conditions.filter((c) => c !== cond);
  addMoodlet(sim, { id: 'health:better', emotion: 'relaxed', label: 'Feeling better', intensity: 8, durationMinutes: 4 * HOUR, source: 'health' }, now, ctx.rng);
  sim.body.immune = clamp100(sim.body.immune + 1);
  ctx.emit({ type: 'sim:recovered', simId: sim.id, illnessId: ill.id });
  ctx.log({ text: you(ctx, sim) ? `You're over the ${ill.name.toLowerCase()}.` : `${name(sim)} is over the ${ill.name.toLowerCase()}.`, kind: 'narrative', simId: sim.id, importance: you(ctx, sim) ? 1 : 0 });
}

export function die(ctx: SystemContext, sim: Sim, cause: string): void {
  if (!sim.body.alive) return;
  const now = ctx.state.time.minute;
  sim.body.alive = false;
  sim.body.deathCause = cause;
  sim.body.diedAt = now;
  if (sim.currentAction) {
    ctx.emit({ type: 'action:interrupted', simId: sim.id, actionId: sim.currentAction.actionId, reason: 'death' });
    sim.currentAction = undefined;
  }
  ctx.state.stats.deaths += 1;
  const controlled = you(ctx, sim);
  const full = `${sim.identity.firstName} ${sim.identity.lastName}`;
  ctx.log({ text: controlled ? `You died of ${cause.toLowerCase()}.` : `${full} died of ${cause.toLowerCase()}.`, kind: 'alert', simId: sim.id, venueId: sim.location.venueId, importance: 3 });
  ctx.emit({ type: 'sim:died', simId: sim.id, cause });
  if (isKnownToPlayer(ctx, sim)) {
    ctx.interrupt({ kind: 'death', title: controlled ? 'You died' : `${full} has died`, body: controlled ? `Cause of death: ${cause.toLowerCase()}.` : `${full} died of ${cause.toLowerCase()}.`, simId: sim.id, options: [] });
  }
}

function ageMult(ctx: SystemContext, sim: Sim): number {
  const age = ctx.query.ageOf(sim);
  if (age >= 75) return 1.6;
  if (age >= 65) return 1.4;
  if (age < 5) return 1.3;
  if (age < 13) return 1.1;
  return 1;
}

function tickIllnesses(ctx: SystemContext, sim: Sim, minutes: number): void {
  if (!sim.body.illnesses.length) return;
  const now = ctx.state.time.minute;
  const days = minutes / DAY;
  const controlled = you(ctx, sim);
  const immuneFactor = 1.4 - (sim.body.immune / 100) * 0.8; // 0.6 (strong) .. 1.4 (weak)
  const stressed = sim.mind.stress > 80 ? 1.3 : 1;
  const am = ageMult(ctx, sim);
  for (const ill of [...sim.body.illnesses]) {
    const def = ctx.content.illnesses[ill.defId];
    if (!def) {
      sim.body.illnesses = sim.body.illnesses.filter((i) => i.id !== ill.id);
      continue;
    }
    if (def.id === 'pregnancy_nausea' && !sim.body.pregnancy) {
      recover(ctx, sim, ill);
      continue;
    }
    const daysSince = (now - ill.startedAt) / DAY;
    const eff = num(sim.flags[`health:tx:${ill.id}`], 0.5);
    if (def.chronic) {
      if (ill.treated) ill.severity += (15 - ill.severity) * Math.min(1, 0.08 * days);
      else ill.severity += def.progression * days * am;
    } else if (ill.treated) {
      ill.severity -= (100 / def.baseDurationDays) * (1 + 2 * eff) * days;
    } else if (daysSince < def.baseDurationDays / 2) {
      ill.severity += def.progression * days * am * (def.kind === 'infection' ? immuneFactor : 1) * stressed;
    } else {
      ill.severity -= (100 / def.baseDurationDays) * days * (2 - immuneFactor);
    }
    ill.severity = clamp(ill.severity, 0, 100);

    // per-hour effects
    const scale = (0.5 + ill.severity / 100) * days;
    const e = def.effects;
    const needs: Partial<Record<'energy' | 'comfort' | 'fun' | 'hunger', number>> = {};
    if (e.energy) needs.energy = e.energy * scale;
    if (e.comfort) needs.comfort = e.comfort * scale;
    if (e.fun) needs.fun = e.fun * scale;
    if (e.hunger) needs.hunger = e.hunger * scale;
    const bundle: Parameters<typeof ctx.applyEffects>[1] = { needs };
    if (e.stress) bundle.stress = e.stress * scale * stressMult(ctx, sim);
    if (e.health) bundle.health = e.health * scale * (ill.treated ? 0.5 : 1);
    ctx.applyEffects(sim.id, bundle, 'health:illness');
    sickMoodlet(ctx, sim, ill);

    if (controlled && ill.severity >= 40 && !sim.flags[`health:warned:${ill.id}`]) {
      sim.flags[`health:warned:${ill.id}`] = true;
      ctx.log({ text: `The ${ill.name.toLowerCase()} is getting worse: ${def.symptoms.slice(0, 3).join(', ')}.`, kind: 'alert', simId: sim.id, importance: 2 });
      ctx.interrupt({ kind: 'emergency', title: `${ill.name} getting worse`, body: `${def.symptoms.slice(0, 3).join(', ')}. ${def.lethal ? 'This can be dangerous if you ignore it.' : 'You should see someone or rest.'}`, simId: sim.id, options: [{ label: 'Check symptoms online', actionId: 'health:check_symptoms' }] });
    }
    if (ill.severity >= 100 && def.lethal) {
      die(ctx, sim, def.name);
      return;
    }
    if (ill.severity <= 0 && !def.chronic) recover(ctx, sim, ill);
  }
}

// ---------------------------------------------------------------------------
// Onset
// ---------------------------------------------------------------------------
function onsetMultiplier(ctx: SystemContext, sim: Sim, def: IllnessDef): number {
  const b = sim.body;
  const age = ctx.query.ageOf(sim);
  const bmi = bmiOf(sim);
  const season = ctx.clock.season;
  let m = 1;
  if (def.seasonal) m *= def.seasonal.includes(season) ? 2.2 : 0.35;
  m *= 1.5 - b.immune / 100;
  if (sim.mind.stress > 80) m *= 1.5;
  if (b.sleepDebtHours > 10) m *= 1.3;
  if (def.kind === 'infection') {
    if (sim.needs.hygiene < 25) m *= 1.5;
    if (age >= 65) m *= 1.5;
    if (age < 13) m *= 1.3;
    if (b.pregnancy) m *= 1.2;
  }
  if (hasTrait(sim, 'hypochondriac')) m *= 0.9; // they actually wash their hands
  switch (def.id) {
    case 'diabetes_t2':
      m *= bmi > 30 ? 5 : bmi > 27 ? 2 : bmi < 25 ? 0.2 : 1;
      m *= age < 30 ? 0.2 : age > 50 ? 1.6 : 1;
      if (b.fitness < 30) m *= 1.5;
      break;
    case 'hypertension':
      m *= age < 30 ? 0.1 : age > 45 ? 2 : 1;
      if (bmi > 30) m *= 2;
      if (sim.mind.stress > 60) m *= 1.5;
      if ((b.addictions.nicotine ?? 0) > 30) m *= 1.5;
      break;
    case 'high_cholesterol':
      m *= age < 30 ? 0.2 : age > 40 ? 2 : 1;
      if (bmi > 30) m *= 2;
      break;
    case 'heart_attack':
      m *= age < 40 ? 0.05 : age < 55 ? 0.5 : age > 70 ? 4 : 2;
      if (b.fitness < 30) m *= 2;
      if (hasIllness(sim, 'hypertension')) m *= 3;
      if (hasIllness(sim, 'diabetes_t2')) m *= 2;
      if (sim.mind.stress > 80) m *= 2;
      if ((b.addictions.nicotine ?? 0) > 30) m *= 2;
      if (bmi > 35) m *= 1.5;
      break;
    case 'cancer':
      m *= age < 30 ? 0.2 : age > 50 ? 3 : 1;
      if ((b.addictions.nicotine ?? 0) > 30) m *= 2.5;
      if ((b.addictions.alcohol ?? 0) > 50) m *= 1.4;
      break;
    case 'depression':
      m *= sim.mind.mood < -30 ? 4 : sim.mind.mood < 0 ? 1.5 : 0.3;
      if (hasTrait(sim, 'gloomy')) m *= 2;
      if (sim.mind.therapy) m *= 0.4;
      break;
    case 'anxiety':
      if (sim.personality.neuroticism > 0.7) m *= 3;
      if (hasTrait(sim, 'anxious')) m *= 3;
      if (sim.mind.stress > 70) m *= 2;
      if (sim.mind.therapy) m *= 0.4;
      break;
    case 'insomnia':
      if (hasTrait(sim, 'insomniac')) m *= 4;
      if (b.sleepDebtHours > 10) m *= 3;
      if (sim.mind.stress > 70) m *= 2;
      if (b.caffeine > 200) m *= 1.5;
      break;
    case 'flu':
      if (num(sim.flags['health:fluShotYear']) === ctx.clock.day.year) m *= 0.4;
      break;
    case 'tooth_decay':
      if (sim.needs.hygiene < 40) m *= 2;
      if (ctx.state.time.minute - num(sim.flags['health:lastDentalAt'], -365 * DAY) > 365 * DAY) m *= 2;
      break;
    case 'acid_reflux':
      if (bmi > 30) m *= 2;
      if ((b.addictions.alcohol ?? 0) > 30) m *= 1.5;
      break;
    case 'back_pain':
      if (age > 35) m *= 2;
      if (b.fitness < 30) m *= 2;
      if (bmi > 30) m *= 1.5;
      break;
    case 'migraine':
      if (sim.mind.stress > 70) m *= 2;
      if (b.sleepDebtHours > 8) m *= 1.5;
      break;
    case 'uti':
      if (sim.identity.gender === 'female') m *= 3;
      if (sim.needs.thirst < 30) m *= 1.5;
      break;
    case 'asthma':
      if (age > 40) m *= 0.3;
      break;
    case 'covid':
    case 'common_cold':
    case 'strep_throat':
    case 'stomach_bug':
      if (sim.lifeStage === 'child' || sim.lifeStage === 'toddler') m *= 1.5;
      break;
    default:
      break;
  }
  if (age >= 65 && def.kind === 'chronic') m *= 1.5;
  return m;
}

function tickOnset(ctx: SystemContext, sim: Sim, minutes: number): void {
  const frac = minutes / DAY;
  for (const def of Object.values(ctx.content.illnesses)) {
    if (def.incidence <= 0) continue;
    if (hasIllness(sim, def.id)) continue;
    const p = def.incidence * frac * onsetMultiplier(ctx, sim, def);
    if (p > 0 && ctx.rng.chance(Math.min(0.5, p))) {
      contract(ctx, sim, def);
      if (!sim.body.alive) return;
    }
  }
}

function tickEnvironment(ctx: SystemContext, sim: Sim, minutes: number): void {
  const hours = minutes / HOUR;
  const w = ctx.state.weather.current;
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const outdoors = !!sim.travel ? sim.travel.mode === 'walk' || sim.travel.mode === 'bike' : !!venue && OUTDOOR.has(venue.archetype);
  const sleeping = sim.flags.sleeping === true || /\b(sleep|nap)/i.test(sim.currentAction?.label ?? '');
  const ills = ctx.content.illnesses;
  if (outdoors && !sleeping) {
    if (w.tempF >= 98 && ills.heat_exhaustion && !hasIllness(sim, 'heat_exhaustion')) {
      const p = 0.08 * hours * (sim.needs.thirst < 40 ? 2 : 1) * (sim.lifeStage === 'senior' ? 1.5 : 1);
      if (ctx.rng.chance(Math.min(0.5, p))) contract(ctx, sim, ills.heat_exhaustion);
    }
    if (w.tempF <= 20 && ills.hypothermia && !hasIllness(sim, 'hypothermia')) {
      const coat = sim.inventory.wearing.some((x) => /coat|parka|winter/i.test(x)) ? 0.2 : 1;
      if (ctx.rng.chance(Math.min(0.5, 0.06 * hours * coat))) contract(ctx, sim, ills.hypothermia);
    }
    if (w.uv >= 8 && ctx.clock.isDaylight && ills.sunburn && !hasIllness(sim, 'sunburn')) {
      const spf = (sim.inventory.consumables.sunscreen ?? 0) > 0 ? 0.2 : 1;
      if (ctx.rng.chance(Math.min(0.5, 0.05 * hours * spf))) contract(ctx, sim, ills.sunburn);
    }
  }
  if (sim.needs.thirst < 5) {
    sim.flags['health:dryHours'] = num(sim.flags['health:dryHours']) + hours;
    if (num(sim.flags['health:dryHours']) >= 3 && ills.dehydration && !hasIllness(sim, 'dehydration')) contract(ctx, sim, ills.dehydration);
  } else if (sim.flags['health:dryHours'] !== undefined) {
    delete sim.flags['health:dryHours'];
    const d = sim.body.illnesses.find((i) => i.defId === 'dehydration');
    if (d && sim.needs.thirst > 40) {
      d.treated = true;
      sim.flags[`health:tx:${d.id}`] = 0.7;
    }
  }
}

function tickContagion(ctx: SystemContext, minutes: number): void {
  const hours = minutes / HOUR;
  const byVenue = new Map<string, Sim[]>();
  for (const s of ctx.query.simulatedSims()) {
    if (s.travel) continue;
    const list = byVenue.get(s.location.venueId) ?? [];
    list.push(s);
    byVenue.set(s.location.venueId, list);
  }
  for (const sims of byVenue.values()) {
    if (sims.length < 2) continue;
    const crowd = clamp(0.8 + sims.length / 10, 0.8, 2);
    for (const carrier of sims) {
      for (const ill of carrier.body.illnesses) {
        if (!ill.contagious || ill.severity < 10) continue;
        const def = ctx.content.illnesses[ill.defId];
        if (!def) continue;
        for (const other of sims) {
          if (other === carrier || hasIllness(other, ill.defId)) continue;
          if (ill.defId === 'flu' && num(other.flags['health:fluShotYear']) === ctx.clock.day.year && ctx.rng.chance(0.6)) continue;
          let p = 0.012 * (newsEffects(ctx.state).contagionMultiplier ?? 1) * (0.3 + ill.severity / 100) * (1.5 - other.body.immune / 100) * crowd * hours;
          if (carrier.needs.hygiene < 25) p *= 1.3;
          if (carrier.householdId && carrier.householdId === other.householdId) p *= 1.5;
          if (ctx.rng.chance(Math.min(0.5, p))) contract(ctx, other, def);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------------
function addInjury(ctx: SystemContext, sim: Sim, spec: { name: string; bodyPart: string; severity: number; days: number }): Injury {
  const now = ctx.state.time.minute;
  const severity = clamp100(spec.severity);
  const inj: Injury = { id: shortId(ctx.rng, 'inj'), name: spec.name, bodyPart: spec.bodyPart, severity, startedAt: now, healsAt: now + Math.max(1, spec.days) * DAY, treated: false };
  sim.body.injuries.push(inj);
  addMoodlet(sim, { id: `inj:${inj.id}`, emotion: 'uncomfortable', label: `${spec.name} (${spec.bodyPart})`, intensity: -Math.round(5 + severity / 5), durationMinutes: inj.healsAt - now, source: 'health' }, now, ctx.rng);
  if (severity >= 25) ctx.applyEffects(sim.id, { health: -severity / 10, stress: 5 }, 'health:injury');
  ctx.emit({ type: 'sim:injured', simId: sim.id, injuryId: inj.id, name: spec.name });
  const controlled = you(ctx, sim);
  ctx.log({ text: controlled ? `You've hurt your ${spec.bodyPart}: ${spec.name.toLowerCase()}.` : `${name(sim)} hurt their ${spec.bodyPart} (${spec.name.toLowerCase()}).`, kind: 'alert', simId: sim.id, importance: severity >= 40 ? 2 : 1 });
  if (controlled && severity >= 40) ctx.interrupt({ kind: 'accident', title: spec.name, body: `Your ${spec.bodyPart} is badly hurt. You should get it looked at.`, simId: sim.id, options: [] });
  return inj;
}

function tickInjuries(ctx: SystemContext, sim: Sim, minutes: number): void {
  if (!sim.body.injuries.length) return;
  const now = ctx.state.time.minute;
  const hours = minutes / HOUR;
  for (const inj of [...sim.body.injuries]) {
    if (now >= inj.healsAt) {
      sim.body.injuries = sim.body.injuries.filter((i) => i.id !== inj.id);
      removeMoodlet(sim, `inj:${inj.id}`);
      ctx.log({ text: you(ctx, sim) ? `Your ${inj.bodyPart} has healed.` : `${name(sim)}'s ${inj.bodyPart} has healed.`, kind: 'narrative', simId: sim.id, importance: you(ctx, sim) ? 1 : 0 });
      continue;
    }
    const s = inj.severity / 100;
    const bundle: Parameters<typeof ctx.applyEffects>[1] = { needs: { comfort: -0.6 * s * hours } };
    if (inj.severity > 50) bundle.needs!.energy = -0.3 * hours;
    if (inj.severity >= 60 && !inj.treated) bundle.health = -0.05 * hours;
    ctx.applyEffects(sim.id, bundle, 'health:injury');
  }
}

// ---------------------------------------------------------------------------
// Daily rollup: fitness, weight, immune, addictions, mental, aging
// ---------------------------------------------------------------------------
function dailyRollup(ctx: SystemContext, sim: Sim, days: number): void {
  const now = ctx.state.time.minute;
  const b = sim.body;
  const age = ctx.query.ageOf(sim);
  const senior = age >= 65;
  const controlled = you(ctx, sim);

  // fitness
  const exercised = now - num(sim.flags.fitness_last_at, -Infinity) < 2 * DAY;
  if (!exercised) b.fitness = clamp100(b.fitness - (senior ? 0.15 : 0.1) * days);

  // weight (kcal balance vs TDEE; needs system tracks intake for full sims)
  const tdee = num(sim.flags.tdee, 2000);
  if (sim.lod === 'full' && sim.flags.calories_yesterday !== undefined) {
    let intake = num(sim.flags.calories_yesterday);
    if (intake <= 0 && sim.needs.hunger > 30) intake = tdee * 0.9; // ate through means that did not report calories
    const net = intake - tdee;
    b.weight = round2(Math.max(35, b.weight + (net / 7700) * days));
  } else if (sim.lod !== 'full') {
    b.weight = round2(Math.max(35, b.weight + ctx.rng.range(-0.05, 0.05) * days));
  }

  // health drift
  const bmi = bmiOf(sim);
  let dh = 0;
  const sick = b.illnesses.length > 0;
  if (!sick && sim.needs.hunger > 30 && sim.needs.energy > 30) dh += senior ? 0.25 : 0.5;
  if (bmi >= 35) dh -= 0.15;
  else if (bmi >= 30) dh -= 0.05;
  if (bmi < 17) dh -= 0.2;
  if (b.sleepDebtHours > 20) dh -= 0.1;
  if (senior) dh -= 0.05;
  if (age >= 80) dh -= 0.1;
  if ((b.addictions.nicotine ?? 0) > 40) dh -= 0.05;
  if ((b.addictions.alcohol ?? 0) > 60) dh -= 0.08;
  if (dh) b.health = clamp100(b.health + dh * days);

  // immune
  const vitamins = now - num(sim.flags['health:vitaminsDay'], -Infinity) * DAY < 2 * DAY ? 5 : 0;
  let immuneTarget = 70 + b.fitness / 10 - (senior ? 15 : 0) + vitamins - (bmi > 35 ? 5 : 0);
  if (sim.mind.stress > 80) immuneTarget -= 10;
  if (b.sleepDebtHours > 10) immuneTarget -= 10;
  b.immune = clamp100(b.immune + (clamp100(immuneTarget) - b.immune) * Math.min(1, 0.1 * days));

  // addictions
  if (b.caffeine > 50) {
    b.addictions.caffeine = clamp100((b.addictions.caffeine ?? 0) + 0.5 * days);
    sim.flags['addict:last:caffeine'] = now;
  }
  for (const [kind, depRaw] of Object.entries(b.addictions) as [keyof typeof b.addictions, number | undefined][]) {
    const dep = num(depRaw);
    if (dep < 3) {
      delete b.addictions[kind];
      removeMoodlet(sim, `addict:${kind}`);
      continue;
    }
    const last = num(sim.flags[`addict:last:${kind}`], -Infinity);
    const window = kind === 'gambling' ? 3 * DAY : DAY;
    if (dep >= 20 && now - last > window) {
      const labels: Record<string, string> = { nicotine: 'Nicotine withdrawal', alcohol: 'Craving a drink', caffeine: 'Caffeine headache', cannabis: 'Craving a smoke', gambling: 'Itching to gamble', gaming: 'Itching to play', opioids: 'Withdrawal' };
      const m = sim.mind.moodlets.find((x) => x.id === `addict:${kind}`);
      if (!m || m.expiresAt - now < 2 * HOUR) addMoodlet(sim, { id: `addict:${kind}`, emotion: 'anxious', label: labels[kind] ?? 'Withdrawal', intensity: -Math.round(dep / 5), durationMinutes: 2 * DAY, source: 'health' }, now, ctx.rng);
      sim.mind.stress = clamp100(sim.mind.stress + (dep / 20) * days);
      b.addictions[kind] = clamp100(dep - 0.7 * days);
    } else if (now - last <= window) {
      removeMoodlet(sim, `addict:${kind}`);
    } else {
      removeMoodlet(sim, `addict:${kind}`);
      b.addictions[kind] = clamp100(dep - 0.7 * days);
    }
  }

  // mental health
  const hs = sim.mind.stress > 85 ? num(sim.flags['health:highStressDays']) + days : sim.mind.stress < 70 ? 0 : num(sim.flags['health:highStressDays']);
  sim.flags['health:highStressDays'] = hs;
  if (hs >= 7 && ctx.content.illnesses.burnout && !hasIllness(sim, 'burnout')) {
    contract(ctx, sim, ctx.content.illnesses.burnout, { quiet: true });
    ctx.log({ text: controlled ? "Weeks of stress with no break have caught up with you. You're burned out." : `${name(sim)} is burned out.`, kind: 'alert', simId: sim.id, importance: controlled ? 2 : 1 });
  }
  const lm = sim.mind.mood < -30 ? num(sim.flags['health:lowMoodDays']) + days : Math.max(0, num(sim.flags['health:lowMoodDays']) - days);
  sim.flags['health:lowMoodDays'] = lm;
  if (lm >= 14 && ctx.content.illnesses.depression && !hasIllness(sim, 'depression')) {
    contract(ctx, sim, ctx.content.illnesses.depression, { quiet: true });
    ctx.log({ text: controlled ? "Nothing has felt worth doing for weeks. This is more than a bad mood." : `${name(sim)} has been down for weeks.`, kind: 'alert', simId: sim.id, importance: controlled ? 2 : 1 });
  }
  if (sim.mind.therapy && now - num(sim.flags['health:therapyAt'], -Infinity) > 30 * DAY) sim.mind.therapy = false;

  if (b.health <= 0) die(ctx, sim, senior ? 'Natural causes' : 'Poor health');
}

// ---------------------------------------------------------------------------
// Pregnancy
// ---------------------------------------------------------------------------
function tickPregnancy(ctx: SystemContext, sim: Sim, minutes: number): void {
  const p = sim.body.pregnancy;
  if (!p) {
    if (sim.flags['health:nauseaRolled'] !== undefined) delete sim.flags['health:nauseaRolled'];
    removeMoodlet(sim, 'preg:tri');
    return;
  }
  const now = ctx.state.time.minute;
  const weeks = (now - p.conceivedAt) / (7 * DAY);
  const controlled = you(ctx, sim);
  if (!p.known && weeks >= 5) {
    p.known = true;
    ctx.log({ text: controlled ? "You've missed a period and you feel different. You're pregnant." : `${name(sim)} is pregnant.`, kind: 'alert', simId: sim.id, importance: controlled ? 3 : 1 });
    addMoodlet(sim, { id: 'preg:news', emotion: sim.personality.values.family > 0.5 ? 'hopeful' : 'anxious', label: 'Pregnant', intensity: sim.personality.values.family > 0.5 ? 10 : -8, durationMinutes: 3 * DAY, source: 'health' }, now, ctx.rng);
  }
  if (weeks >= 4 && weeks < 14 && !sim.flags['health:nauseaRolled']) {
    sim.flags['health:nauseaRolled'] = true;
    if (ctx.content.illnesses.pregnancy_nausea && ctx.rng.chance(0.7)) contract(ctx, sim, ctx.content.illnesses.pregnancy_nausea, { quiet: !p.known });
  }
  if (p.known) {
    const hours = minutes / HOUR;
    const tri = weeks < 13 ? 1 : weeks < 27 ? 2 : 3;
    const spec = tri === 1 ? { emotion: 'tired' as const, label: 'First trimester', intensity: -5 } : tri === 2 ? { emotion: 'happy' as const, label: 'Second trimester glow', intensity: 8 } : { emotion: 'uncomfortable' as const, label: 'Third trimester', intensity: -10 };
    const m = sim.mind.moodlets.find((x) => x.id === 'preg:tri');
    if (!m || m.label !== spec.label || m.expiresAt - now < 2 * HOUR) addMoodlet(sim, { id: 'preg:tri', ...spec, durationMinutes: DAY, source: 'health' }, now, ctx.rng);
    if (tri === 3) ctx.applyEffects(sim.id, { needs: { comfort: -1 * hours, energy: -0.5 * hours } }, 'health:pregnancy');
    if (p.complications > 50) ctx.applyEffects(sim.id, { stress: 0.3 * hours, health: -0.02 * hours }, 'health:pregnancy');
  }
}

// ---------------------------------------------------------------------------
// Treatment helpers
// ---------------------------------------------------------------------------
function treatIllness(ctx: SystemContext, sim: Sim, ill: Illness, effectiveness: number, immediate = 10): void {
  ill.treated = true;
  ill.diagnosed = true;
  const prev = num(sim.flags[`health:tx:${ill.id}`], 0);
  sim.flags[`health:tx:${ill.id}`] = Math.max(prev, clamp(effectiveness, 0, 1));
  ill.severity = clamp100(ill.severity - immediate * effectiveness);
}

function treatInjuries(sim: Sim, factor: number): number {
  let n = 0;
  for (const inj of sim.body.injuries) {
    if (inj.treated) continue;
    inj.treated = true;
    inj.healsAt = inj.startedAt + Math.round((inj.healsAt - inj.startedAt) * factor);
    inj.severity = clamp100(inj.severity - 10);
    n++;
  }
  return n;
}

/** Doctor / urgent care / ER logic. Returns narrative + extra sticker cost for procedures. */
function clinicalVisit(ctx: SystemContext, sim: Sim, level: 'clinic' | 'hospital', quality: number): { text: string; extraCost: number } {
  const lines: string[] = [];
  let extra = 0;
  let rx = 0;
  const diagnosed: string[] = [];
  const referred: string[] = [];
  for (const ill of sim.body.illnesses) {
    const def = ctx.content.illnesses[ill.defId];
    if (!def) continue;
    if (!ill.diagnosed) diagnosed.push(def.name);
    ill.diagnosed = true;
    const opts = def.treatments;
    const here = opts.find((t) => t.venue === level) ?? (level === 'hospital' ? opts.find((t) => t.venue === 'clinic') : undefined);
    const pharmacy = opts.find((t) => t.venue === 'pharmacy');
    if (here) {
      treatIllness(ctx, sim, ill, here.effectiveness * quality, 12);
      if (level === 'hospital' && here.venue === 'hospital' && here.cost > 2000) extra += here.cost;
      lines.push(`${def.name}: ${here.label.toLowerCase()}.`);
    } else if (pharmacy) {
      rx++;
      treatIllness(ctx, sim, ill, pharmacy.effectiveness * 0.5 * quality, 4);
      lines.push(`${def.name}: prescription written.`);
    } else if (opts.some((t) => t.venue === 'hospital')) {
      referred.push(def.name);
    } else {
      const home = opts.find((t) => t.venue === 'home');
      if (home) {
        treatIllness(ctx, sim, ill, home.effectiveness * 0.6, 4);
        lines.push(`${def.name}: ${home.label.toLowerCase()}.`);
      }
    }
    if (pharmacy && here) rx++; // treated here and sent off with a script to fill
  }
  const injuries = treatInjuries(sim, level === 'hospital' ? 0.55 : 0.7);
  if (injuries) lines.push(`${injuries} injur${injuries === 1 ? 'y' : 'ies'} treated.`);
  if (rx) sim.flags['health:rx'] = num(sim.flags['health:rx']) + rx;
  const pre: string[] = [];
  if (diagnosed.length) pre.push(`Diagnosis: ${diagnosed.join(', ')}.`);
  if (referred.length) pre.push(`${referred.join(', ')} — ${level === 'hospital' ? 'admitted for treatment' : 'sent straight to the ER'}.`);
  if (!sim.body.illnesses.length && !injuries) pre.push(you(ctx, sim) ? 'Nothing wrong with you that the doctor can find.' : 'Nothing found.');
  if (rx) pre.push(`${rx} prescription${rx > 1 ? 's' : ''} to fill at a pharmacy.`);
  return { text: [...pre, ...lines].join(' '), extraCost: extra };
}

function medicate(ctx: SystemContext, sim: Sim, itemId: string): string {
  const now = ctx.state.time.minute;
  const ills = sim.body.illnesses;
  const apply = (ids: string[], eff: number, immediate: number): number => {
    let n = 0;
    for (const ill of ills) if (ids.includes(ill.defId)) {
      treatIllness(ctx, sim, ill, eff, immediate);
      n++;
    }
    return n;
  };
  switch (itemId) {
    case 'painkillers': {
      const n = apply(PAIN_ILLS, 0.4, 10);
      const inj = treatInjuries(sim, 0.9);
      ctx.applyEffects(sim.id, { needs: { comfort: 15 }, moodlets: [{ id: 'health:pain_relief', emotion: 'relaxed', label: 'Pain relief', intensity: 5, durationMinutes: 3 * HOUR }] }, 'health:medicate');
      const recent = num(sim.flags['health:painkillersAt'], -Infinity);
      if (now - recent < 4 * HOUR) ctx.applyEffects(sim.id, { health: -1 }, 'health:medicate');
      sim.flags['health:painkillersAt'] = now;
      return n || inj ? 'The painkillers take the edge off.' : 'You take some painkillers. Nothing really hurt, but it feels responsible.';
    }
    case 'cold_medicine': {
      const n = apply(COLD_ILLS, 0.3, 8);
      ctx.applyEffects(sim.id, { needs: { comfort: 10, energy: 5 } }, 'health:medicate');
      return n ? 'The cold medicine clears your head for a few hours.' : 'You take cold medicine you did not need. Drowsy now.';
    }
    case 'vitamins': {
      const day = Math.floor(now / DAY);
      if (num(sim.flags['health:vitaminsDay'], -1) !== day) {
        sim.flags['health:vitaminsDay'] = day;
        sim.body.immune = Math.min(95, sim.body.immune + 2);
      }
      return 'You take your vitamins.';
    }
    case 'allergy_meds': {
      const n = apply(['seasonal_allergies'], 0.6, 15);
      ctx.applyEffects(sim.id, { needs: { comfort: 6 } }, 'health:medicate');
      return n ? 'The antihistamine kicks in and your eyes stop itching.' : 'You take an allergy pill. Slightly drowsy.';
    }
    case 'antacid': {
      const n = apply(STOMACH_ILLS, 0.4, 10);
      ctx.applyEffects(sim.id, { needs: { comfort: 10 } }, 'health:medicate');
      return n ? 'Your stomach settles.' : 'Chalky, but fine.';
    }
    case 'antibiotics': {
      const n = apply(BACTERIAL, 0.8, 8);
      if (!n) ctx.applyEffects(sim.id, { health: -0.5 }, 'health:medicate');
      return n ? 'You start the antibiotics. Give it a couple of days.' : 'Antibiotics do nothing for what you have.';
    }
    case 'prescription_meds': {
      let n = 0;
      for (const ill of ills) {
        const def = ctx.content.illnesses[ill.defId];
        const rx = def?.treatments.find((t) => t.itemId === 'prescription_meds');
        if (rx) {
          treatIllness(ctx, sim, ill, rx.effectiveness, 6);
          n++;
        }
      }
      return n ? 'You take your prescription.' : 'You take the prescription meds. Nothing to treat right now.';
    }
    case 'first_aid_kit': {
      const inj = treatInjuries(sim, 0.7);
      return inj ? 'You clean and bandage the injury properly.' : 'Nothing to patch up.';
    }
    case 'pregnancy_test':
      return pregnancyTest(ctx, sim);
    default:
      return 'Nothing happens.';
  }
}

function pregnancyTest(ctx: SystemContext, sim: Sim): string {
  const now = ctx.state.time.minute;
  const p = sim.body.pregnancy;
  const controlled = you(ctx, sim);
  if (p && now - p.conceivedAt >= 10 * DAY) {
    const first = !p.known;
    p.known = true;
    if (first) {
      ctx.log({ text: controlled ? 'Two lines. You\'re pregnant.' : `${name(sim)} took a pregnancy test: positive.`, kind: 'alert', simId: sim.id, importance: controlled ? 3 : 1 });
      addMoodlet(sim, { id: 'preg:news', emotion: sim.personality.values.family > 0.5 ? 'hopeful' : 'anxious', label: 'Pregnant', intensity: sim.personality.values.family > 0.5 ? 10 : -8, durationMinutes: 3 * DAY, source: 'health' }, now, ctx.rng);
    }
    return 'Positive.';
  }
  ctx.log({ text: controlled ? 'One line. Not pregnant.' : `${name(sim)} took a pregnancy test: negative.`, kind: 'narrative', simId: sim.id, importance: 1 });
  return 'Negative.';
}

function therapySession(ctx: SystemContext, sim: Sim): string {
  const now = ctx.state.time.minute;
  sim.mind.therapy = true;
  sim.flags['health:therapyAt'] = now;
  let n = 0;
  for (const ill of sim.body.illnesses) {
    if (MENTAL_MAP[ill.defId]) {
      treatIllness(ctx, sim, ill, 0.6, 8);
      n++;
    }
  }
  ctx.applyEffects(sim.id, { stress: -15, moodlets: [{ id: 'health:therapy', emotion: 'hopeful', label: 'Talked it through', intensity: 8, durationMinutes: 8 * HOUR }] }, 'health:therapy');
  return n ? 'Fifty minutes of hard, useful talking. It helps.' : 'You talk through the week. You leave a little lighter.';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
const ITEM_ACTIONS: { itemId: string; label: string; icon: string; minutes: number; when?: (sim: Sim) => boolean }[] = [
  { itemId: 'painkillers', label: 'Take painkillers', icon: 'pill', minutes: 2 },
  { itemId: 'cold_medicine', label: 'Take cold medicine', icon: 'pill', minutes: 2 },
  { itemId: 'vitamins', label: 'Take vitamins', icon: 'pill', minutes: 1 },
  { itemId: 'allergy_meds', label: 'Take allergy meds', icon: 'pill', minutes: 1 },
  { itemId: 'antacid', label: 'Take an antacid', icon: 'pill', minutes: 1 },
  { itemId: 'antibiotics', label: 'Take antibiotics', icon: 'pill', minutes: 1 },
  { itemId: 'prescription_meds', label: 'Take prescription meds', icon: 'pill', minutes: 1 },
  { itemId: 'first_aid_kit', label: 'Use first aid kit', icon: 'bandage', minutes: 10, when: (s) => s.body.injuries.some((i) => !i.treated) },
  { itemId: 'pregnancy_test', label: 'Take a pregnancy test', icon: 'test-tube', minutes: 5, when: (s) => s.identity.gender !== 'male' && s.lifeStage !== 'child' && s.lifeStage !== 'toddler' && s.lifeStage !== 'infant' },
];

function actionsFor(ctx: SystemContext, simId: SimId): ActionDef[] {
  const sim = ctx.query.simMaybe(simId);
  if (!sim || !sim.body.alive) return [];
  const now = ctx.state.time.minute;
  const out: ActionDef[] = [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const plan = sim.body.insurance;
  const col = ctx.state.region.costOfLiving;

  for (const ia of ITEM_ACTIONS) {
    if ((sim.inventory.consumables[ia.itemId] ?? 0) <= 0) continue;
    if (ia.when && !ia.when(sim)) continue;
    out.push({
      id: `health:item:${ia.itemId}`,
      label: ia.label,
      category: 'health',
      icon: ia.icon,
      durationMinutes: ia.minutes,
      effects: { items: [{ op: 'lose', itemId: ia.itemId, qty: 1 }] },
      requirements: [{ kind: 'item', reason: `No ${ia.itemId.replace(/_/g, ' ')}`, params: { itemId: ia.itemId, qty: 1 } }],
      interruptible: false,
      group: 'Health',
      params: { itemId: ia.itemId },
    });
  }

  const undiagnosed = sim.body.illnesses.some((i) => !i.diagnosed) || sim.body.injuries.length > 0;
  if (undiagnosed || hasTrait(sim, 'hypochondriac') || sim.body.illnesses.length) {
    out.push({ id: 'health:check_symptoms', label: 'Check symptoms online', description: 'Ten minutes on your phone with a search engine and a growing sense of dread.', category: 'health', icon: 'search', durationMinutes: 10, effects: {}, interruptible: true, group: 'Health' });
  }

  if (venue && MEDICAL.has(venue.archetype)) {
    const arch = venue.archetype;
    const open: ActionDef['requirements'] = [{ kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } }];
    const priced = (id: string, label: string, sticker: number, kind: BillKind, minutes: number, description: string, extraReqs: ActionDef['requirements'] = []): ActionDef => {
      const share = patientShare(plan, round2(sticker * col), kind);
      const reqs = [...open, ...extraReqs];
      if (share.patient > 0) reqs.push({ kind: 'money', reason: `Costs $${share.patient.toFixed(2)}${plan.kind !== 'none' ? ' (after insurance)' : ''}`, params: { amount: share.patient } });
      // the engine charges `cost` up front (copay / patient share); the insurer's part is only logged
      const cost = share.patient > 0 ? { amount: share.patient, memo: `${label} at ${venue.name}`, category: 'medical', counterparty: venue.name } : undefined;
      return { id, label, description, category: 'health', icon: 'stethoscope', durationMinutes: minutes, cost, effects: {}, requirements: reqs, interruptible: false, group: venue.name, target: { kind: 'venue', id: venue.id, name: venue.name }, params: { sticker: round2(sticker * col), kind } };
    };
    if (arch === 'clinic' || arch === 'hospital') {
      out.push(priced('health:see_doctor', 'See a doctor', PRICE.doctor, 'office', 45, `Office visit ($${PRICE.doctor} sticker). Diagnoses and treats what can be treated here.`));
      out.push(priced('health:annual_physical', 'Annual physical', PRICE.physical, 'preventive', 45, 'Bloodwork, blood pressure, the whole checkup. Usually free with insurance.', now - num(sim.flags['health:lastPhysicalAt'], -Infinity) < 365 * DAY ? [{ kind: 'flag', reason: 'Already had a physical this year', params: { flag: 'health:__never' } }] : []));
      out.push(priced('health:therapy', 'Therapy session', PRICE.therapy, 'therapy', 50, 'Fifty minutes with a licensed therapist.'));
    }
    if (arch === 'clinic') out.push(priced('health:urgent_care', 'Urgent care visit', PRICE.urgentCare, 'office', 60, 'Walk-in care for things that cannot wait for an appointment but are not an emergency.'));
    if (arch === 'hospital') {
      // The ER treats everyone; the bill comes later (see execute → bill()).
      out.push({ id: 'health:er', label: 'ER visit', description: `Emergency room. Starts at $${PRICE.er.toLocaleString()} before insurance; treatment and surgery cost more. They treat you first and bill you later.`, category: 'health', icon: 'ambulance', durationMinutes: 180, effects: {}, interruptible: false, group: venue.name, target: { kind: 'venue', id: venue.id, name: venue.name } });
    }
    if (arch === 'pharmacy' || arch === 'clinic') {
      const season = ctx.clock.season;
      if ((season === 'fall' || season === 'winter') && num(sim.flags['health:fluShotYear']) !== ctx.clock.day.year) out.push(priced('health:flu_shot', 'Get a flu shot', PRICE.fluShot, 'preventive', 15, 'Seasonal flu vaccine. Cuts flu risk by about 60%.'));
    }
    if (arch === 'pharmacy') {
      const rx = num(sim.flags['health:rx']);
      if (rx > 0) out.push(priced('health:fill_rx', `Fill prescription${rx > 1 ? 's' : ''} (${rx})`, PRICE.rx * rx, 'rx', 15, 'Pick up what the doctor prescribed.'));
    }
    if (arch === 'dentist') {
      const lastDental = num(sim.flags['health:lastDentalAt'], -Infinity);
      const decay = hasIllness(sim, 'tooth_decay');
      if (now - lastDental >= 182 * DAY || decay) out.push(priced('health:dental', decay ? 'Dental cleaning & filling' : 'Dental cleaning', PRICE.dental + (decay ? PRICE.filling : 0), 'dental', 45, decay ? 'Cleaning plus a filling for that tooth.' : 'Six-month cleaning and checkup.'));
    }
  }
  return out;
}

function execute(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult {
  const sim = ctx.query.sim(simId);
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const now = ctx.state.time.minute;
  const id = action.id;
  if (id.startsWith('health:item:')) {
    const itemId = String(params.itemId ?? id.slice('health:item:'.length));
    const text = medicate(ctx, sim, itemId);
    return { ok: true, text };
  }
  switch (id) {
    case 'health:check_symptoms': {
      const research = sim.skills.research?.level ?? 0;
      const hits: string[] = [];
      let scare = false;
      for (const ill of sim.body.illnesses) {
        const def = ctx.content.illnesses[ill.defId];
        if (!def) continue;
        if (ill.diagnosed) {
          hits.push(def.name);
          continue;
        }
        if (ctx.rng.chance(0.5 + research * 0.05)) {
          ill.diagnosed = true;
          hits.push(`${def.name} (probably)`);
        } else scare = true;
      }
      if (!sim.body.illnesses.length && hasTrait(sim, 'hypochondriac')) scare = ctx.rng.chance(0.6);
      if (scare) ctx.applyEffects(simId, { moodlets: [{ id: 'health:scare', emotion: 'anxious', label: 'Health scare (internet)', intensity: hasTrait(sim, 'hypochondriac') ? -14 : -7, durationMinutes: 6 * HOUR }], stress: hasTrait(sim, 'hypochondriac') ? 8 : 3 }, 'health:check_symptoms');
      const text = hits.length ? `Best guess: ${hits.join(', ')}.${scare ? ' Also, according to the internet, possibly something terrible.' : ''}` : scare ? 'The internet is sure it is either nothing or fatal.' : "Symptoms don't match anything serious. Probably fine.";
      ctx.log({ text, kind: 'narrative', simId, importance: 1 });
      return { ok: true, text };
    }
    case 'health:see_doctor':
    case 'health:urgent_care': {
      const visit = clinicalVisit(ctx, sim, 'clinic', id === 'health:see_doctor' ? 1 : 0.9);
      const sticker = num(params.sticker, PRICE.doctor);
      const share = patientShare(sim.body.insurance, sticker, 'office');
      sim.body.insurance.deductibleMet = round2(sim.body.insurance.deductibleMet + share.deductibleUsed);
      ctx.log({ text: `${id === 'health:see_doctor' ? 'Doctor visit' : 'Urgent care'}: billed $${sticker.toFixed(2)}${share.insurer > 0 ? `, insurance covered $${share.insurer.toFixed(2)}` : ''}.`, kind: 'money', simId, venueId: venue?.id, importance: 1 });
      ctx.emit({ type: 'custom', kind: 'health:bill', simId, payload: { sticker, patient: share.patient, insurer: share.insurer, kind: 'office', venueId: venue?.id } });
      ctx.applyEffects(simId, { stress: -3 }, id);
      return { ok: true, text: visit.text };
    }
    case 'health:er': {
      const worst = Math.max(0, ...sim.body.illnesses.map((i) => i.severity), ...sim.body.injuries.map((i) => i.severity));
      const visit = clinicalVisit(ctx, sim, 'hospital', 1);
      let sticker = PRICE.er + (worst >= 60 ? 2500 : worst >= 30 ? 800 : 0) + visit.extraCost;
      sticker = round2(sticker);
      bill(ctx, sim, sticker, 'er', 'Emergency room', venue);
      ctx.applyEffects(simId, { needs: { comfort: 10 }, stress: 4 }, id);
      return { ok: true, text: `Three hours in the ER. ${visit.text}` };
    }
    case 'health:annual_physical': {
      sim.flags['health:lastPhysicalAt'] = now;
      const found: string[] = [];
      for (const ill of sim.body.illnesses) {
        if (!ill.diagnosed) found.push(ill.name);
        ill.diagnosed = true;
        const def = ctx.content.illnesses[ill.defId];
        if (def?.chronic && !ill.treated) treatIllness(ctx, sim, ill, 0.5, 5);
      }
      ctx.applyEffects(simId, { health: 2, moodlets: [{ id: 'health:physical', emotion: 'relaxed', label: 'Peace of mind', intensity: 6, durationMinutes: 2 * DAY }] }, id);
      const bmi = bmiOf(sim);
      const notes = [bmi >= 30 ? 'The doctor brings up your weight.' : bmi < 18.5 ? 'The doctor wants you to eat more.' : 'Numbers look fine.', sim.body.fitness < 30 ? 'More exercise, they say.' : ''].filter(Boolean).join(' ');
      return { ok: true, text: found.length ? `The physical turns something up: ${found.join(', ')}. ${notes}` : `Clean bill of health. ${notes}` };
    }
    case 'health:therapy': {
      const text = therapySession(ctx, sim);
      return { ok: true, text };
    }
    case 'health:flu_shot': {
      sim.flags['health:fluShotYear'] = ctx.clock.day.year;
      ctx.applyEffects(simId, { moodlets: [{ id: 'health:sore_arm', emotion: 'uncomfortable', label: 'Sore arm', intensity: -2, durationMinutes: DAY }] }, id);
      return { ok: true, text: 'Quick jab. Your arm will be sore tomorrow.' };
    }
    case 'health:fill_rx': {
      const rx = num(sim.flags['health:rx']);
      if (rx <= 0) return { ok: false, text: 'Nothing to fill.' };
      delete sim.flags['health:rx'];
      return { ok: true, text: `You pick up ${rx} prescription${rx > 1 ? 's' : ''}.`, effects: { items: [{ op: 'gain', itemId: 'prescription_meds', qty: rx * 30 }] } };
    }
    case 'health:dental': {
      sim.flags['health:lastDentalAt'] = now;
      const decay = sim.body.illnesses.find((i) => i.defId === 'tooth_decay');
      if (decay) treatIllness(ctx, sim, decay, 0.9, 40);
      ctx.applyEffects(simId, { needs: { comfort: 10, hygiene: 8 }, moodlets: [{ id: 'health:dental', emotion: 'confident', label: 'Fresh smile', intensity: 5, durationMinutes: DAY }] }, id);
      return { ok: true, text: decay ? 'Cleaning, then the drill. The tooth is fixed.' : 'Scraped, polished, flossed. No cavities.' };
    }
    default:
      return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function onEvent(ctx: SystemContext, e: GameEvent): void {
  const now = ctx.state.time.minute;
  if (e.type === 'effects:applied') {
    if (typeof e.bundle.fitness === 'number' && e.bundle.fitness > 0) {
      const sim = ctx.query.simMaybe(e.simId);
      if (sim) sim.flags.fitness_last_at = now;
    }
    return;
  }
  if (e.type === 'action:started') {
    if (e.action.category === 'fitness') {
      const sim = ctx.query.simMaybe(e.simId);
      if (sim) sim.flags.fitness_last_at = now;
    }
    return;
  }
  if (e.type !== 'custom' || !e.simId) return;
  const sim = ctx.query.simMaybe(e.simId);
  if (!sim || !sim.body.alive) return;
  const p = e.payload ?? {};
  const b = sim.body;
  switch (e.kind) {
    case 'health:injury':
      addInjury(ctx, sim, { name: String(p.name ?? 'Injury'), bodyPart: String(p.bodyPart ?? 'arm'), severity: num(p.severity, 20), days: num(p.days, 7) });
      break;
    case 'health:contract': {
      const def = ctx.content.illnesses[String(p.defId)];
      if (def) contract(ctx, sim, def, { severity: p.severity !== undefined ? num(p.severity) : undefined });
      break;
    }
    case 'health:checkup': {
      const visit = clinicalVisit(ctx, sim, p.venue === 'hospital' ? 'hospital' : 'clinic', 1);
      ctx.log({ text: visit.text, kind: 'narrative', simId: sim.id, importance: 1 });
      break;
    }
    case 'health:medicate': {
      const text = medicate(ctx, sim, String(p.itemId ?? ''));
      ctx.log({ text, kind: 'narrative', simId: sim.id, importance: 0 });
      break;
    }
    case 'health:pregnancy_test':
      pregnancyTest(ctx, sim);
      break;
    case 'health:therapy_session':
      therapySession(ctx, sim);
      break;
    case 'health:exposure_sti': {
      if (p.protected === true) break;
      const partner = typeof p.otherId === 'string' ? ctx.query.simMaybe(p.otherId as SimId) : undefined;
      const partnerHas = !!partner && hasIllness(partner, 'sti');
      const chance = partnerHas ? 0.35 : 0.03;
      if (ctx.content.illnesses.sti && ctx.rng.chance(chance)) contract(ctx, sim, ctx.content.illnesses.sti, { quiet: true });
      break;
    }
    case 'health:nicotine': {
      const units = clamp(num(p.units, 1), 0, 40);
      b.addictions.nicotine = clamp100((b.addictions.nicotine ?? 0) + 1.5 * units);
      sim.flags['addict:last:nicotine'] = now;
      removeMoodlet(sim, 'addict:nicotine');
      ctx.applyEffects(sim.id, { stress: -2 * Math.min(units, 3), needs: { hygiene: -2 * units } }, 'health:nicotine');
      break;
    }
    case 'health:cannabis': {
      const units = clamp(num(p.units, 1), 0, 10);
      b.addictions.cannabis = clamp100((b.addictions.cannabis ?? 0) + 1.2 * units);
      sim.flags['addict:last:cannabis'] = now;
      removeMoodlet(sim, 'addict:cannabis');
      if (p.intoxication !== undefined) b.cannabis = clamp100(b.cannabis + num(p.intoxication));
      break;
    }
    case 'health:gambled': {
      const amount = Math.abs(num(p.amount));
      const lost = p.lost === true || num(p.won) < 0;
      b.addictions.gambling = clamp100((b.addictions.gambling ?? 0) + 1.5 + (amount > 200 ? 2 : 0) + (lost ? 1 : 0));
      sim.flags['addict:last:gambling'] = now;
      removeMoodlet(sim, 'addict:gambling');
      break;
    }
    case 'needs:drank': {
      const units = clamp(num(p.alcoholUnits), 0, 20);
      if (units > 0) {
        b.addictions.alcohol = clamp100((b.addictions.alcohol ?? 0) + 0.6 * units);
        sim.flags['addict:last:alcohol'] = now;
        removeMoodlet(sim, 'addict:alcohol');
      }
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const healthSystem: System = {
  id: 'health',
  intervalMinutes: 60,

  onInit(ctx) {
    const now = ctx.state.time.minute;
    for (const sim of Object.values(ctx.state.sims)) {
      if (sim.flags['health:last'] === undefined) sim.flags['health:last'] = now;
      if (sim.flags['health:dayAt'] === undefined) sim.flags['health:dayAt'] = now;
    }
  },

  onTick(ctx, dt) {
    const now = ctx.state.time.minute;
    for (const sim of Object.values(ctx.state.sims)) {
      if (!sim.body.alive) continue;
      const interval = sim.lod === 'far' ? DAY : HOUR;
      const last = num(sim.flags['health:last'], now - dt);
      const elapsed = now - last;
      if (elapsed < interval) continue;
      sim.flags['health:last'] = now;
      const minutes = clamp(elapsed, 1, 7 * DAY);
      tickIllnesses(ctx, sim, minutes);
      if (!sim.body.alive) continue;
      tickInjuries(ctx, sim, minutes);
      tickOnset(ctx, sim, minutes);
      if (!sim.body.alive) continue;
      if (sim.lod !== 'far') tickEnvironment(ctx, sim, minutes);
      tickPregnancy(ctx, sim, minutes);
      const dayAt = num(sim.flags['health:dayAt'], now - minutes);
      if (now - dayAt >= DAY) {
        sim.flags['health:dayAt'] = now;
        dailyRollup(ctx, sim, clamp((now - dayAt) / DAY, 1, 7));
      }
      if (sim.body.alive && sim.body.health <= 0) die(ctx, sim, sim.body.illnesses[0]?.name ?? 'Poor health');
    }
    tickContagion(ctx, dt);
  },

  onEvent,
  actions: actionsFor,
  handles: (id) => id.startsWith('health:'),
  execute,
};
