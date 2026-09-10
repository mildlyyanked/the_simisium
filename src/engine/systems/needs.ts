/**
 * Needs system: per-minute need decay (LOD-batched), thresholds → moodlets / events / interrupts,
 * failure states (accidents, passing out, starvation), mood & dominant emotion, stress drift,
 * sleep debt, and body chemistry (blood alcohol, caffeine, cannabis).
 *
 * Flag keys owned by this system (on `sim.flags`):
 *   needs:last            minute of last needs tick for this sim (LOD catch-up)
 *   needwarn:<need>       true while a need is in its critical band (cleared at ≥ 60)
 *   needs:moodAt          minute of last mood computation
 *   needs:sleepStart      minute a Sleep/Nap action started (cleared when it ends)
 *   needs:hungerZeroSince minute hunger first hit 0 (starvation timer)
 *   needs:starveWarnDay   day index of last starvation interrupt
 *   needs:alcoholWarned   true once the alcohol-poisoning interrupt fired for this binge
 *   needs:peakBac         peak BAC of the current drinking session (hangover trigger)
 *   sleeping              true while passed out / asleep (other systems may also set it)
 *   drunk, high, smelly   booleans other systems read (social/charisma penalties)
 *   calories_today        kcal eaten since midnight (from custom `needs:ate`)
 *   calories_yesterday    previous day's kcal (health system reads this to drift weight)
 *   tdee                  estimated daily energy expenditure in kcal (recomputed daily)
 *
 * Custom event kinds handled: needs:slept {hours}, needs:ate {calories, healthy, hungerRestored, meat?}, needs:drank {alcoholUnits}
 * Custom event kinds emitted: health:injury (drunken falls), health:contract {defId:'hangover'}
 * Action id prefix handled: `needs:`
 */
import { addMoodlet } from '../core/effects';
import type { GameEvent } from '../core/events';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, EmotionId, NeedId, Sim, SimId, Venue, VenueArchetype } from '../core/types';
import { NEED_IDS } from '../core/types';
import { clamp, clamp100, DAY, HOUR, round2 } from '../core/util';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
/** base loss per minute (positive numbers = need drops) */
export const BASE_DECAY: Record<NeedId, number> = {
  hunger: 0.07,
  thirst: 0.1,
  energy: 0.06,
  bladder: 0.09,
  hygiene: 0.05,
  social: 0.04,
  fun: 0.05,
  comfort: 0.03,
};

const CRITICAL = 25;
const SEVERE = 10;
const RESTORED = 60;
const PASS_OUT_MINUTES = 120;
const STARVATION_AFTER = 2 * DAY;
const AWAKE_LIMIT = 17 * HOUR;

const LOD_INTERVAL: Record<Sim['lod'], number> = { full: 1, near: 15, far: DAY };

const OUTDOOR: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['park', 'trail', 'beach', 'playground', 'sports_field', 'golf', 'farmers_market', 'cemetery', 'zoo', 'amusement_park', 'parking', 'transit_stop', 'pool']);
/** places where you mostly stand around */
const STANDING: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['grocery', 'convenience', 'retail', 'clothing', 'electronics', 'furniture', 'hardware', 'mall', 'dmv', 'post_office', 'bank', 'transit_stop', 'bus_station', 'train_station', 'airport', 'warehouse', 'factory', 'liquor_store', 'thrift_store', 'pharmacy', 'gas_station', 'car_wash', 'parking', 'jail']);
/** places that sell bottled water */
const COMMERCIAL: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['grocery', 'convenience', 'restaurant', 'fast_food', 'cafe', 'bar', 'nightclub', 'gym', 'pharmacy', 'retail', 'mall', 'liquor_store', 'cinema', 'theater', 'concert_hall', 'stadium', 'arena', 'museum', 'zoo', 'aquarium', 'amusement_park', 'bowling', 'arcade', 'casino', 'gas_station', 'airport', 'train_station', 'bus_station', 'hotel', 'bakery', 'farmers_market', 'thrift_store', 'bookstore', 'hospital', 'clinic', 'college', 'library', 'coworking', 'office', 'car_dealer', 'golf', 'pool', 'ice_rink', 'climbing_gym', 'spa', 'salon', 'laundromat']);
/** no restrooms to be found */
const NO_RESTROOM: ReadonlySet<VenueArchetype> = new Set<VenueArchetype>(['park', 'trail', 'beach', 'playground', 'sports_field', 'cemetery', 'parking', 'transit_stop', 'atm', 'ev_charger', 'unknown']);

interface NeedMoodletSpec {
  emotion: EmotionId;
  mild: [string, number];
  severe: [string, number];
}
const NEED_MOODLETS: Record<NeedId, NeedMoodletSpec> = {
  hunger: { emotion: 'uncomfortable', mild: ['Hungry', -10], severe: ['Starving', -25] },
  thirst: { emotion: 'uncomfortable', mild: ['Thirsty', -8], severe: ['Parched', -20] },
  energy: { emotion: 'tired', mild: ['Tired', -10], severe: ['Exhausted', -25] },
  bladder: { emotion: 'uncomfortable', mild: ['Need a bathroom', -12], severe: ['Bursting', -25] },
  hygiene: { emotion: 'embarrassed', mild: ['Smelly', -10], severe: ['Filthy', -20] },
  social: { emotion: 'lonely', mild: ['Lonely', -10], severe: ['Desperately lonely', -20] },
  fun: { emotion: 'bored', mild: ['Bored', -10], severe: ['Bored stiff', -20] },
  comfort: { emotion: 'uncomfortable', mild: ['Uncomfortable', -8], severe: ['Aching all over', -18] },
};

const NEED_HINT_LABEL: Record<NeedId, string> = {
  hunger: 'Where can I eat?',
  thirst: 'Where can I get a drink?',
  energy: 'Where can I sleep?',
  bladder: 'Where is a bathroom?',
  hygiene: 'Where can I clean up?',
  social: 'Who can I talk to?',
  fun: 'What is there to do?',
  comfort: 'Where can I sit down?',
};

const NEED_VENUES: Record<NeedId, VenueArchetype[]> = {
  hunger: ['restaurant', 'fast_food', 'grocery', 'cafe', 'convenience'],
  thirst: ['cafe', 'convenience', 'grocery', 'gas_station'],
  energy: ['home', 'hotel'],
  bladder: ['cafe', 'fast_food', 'gas_station', 'library'],
  hygiene: ['home', 'gym', 'hotel'],
  social: ['bar', 'cafe', 'park', 'community_center'],
  fun: ['cinema', 'park', 'bar', 'arcade', 'bowling'],
  comfort: ['home', 'cafe', 'library'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function isSleeping(sim: Sim): boolean {
  if (sim.flags.sleeping === true) return true;
  const label = sim.currentAction?.label ?? '';
  return /\b(sleep|sleeping|nap|napping)\b/i.test(label);
}

function traitNeedMult(ctx: SystemContext, sim: Sim, need: NeedId): number {
  let m = 1;
  for (const t of sim.personality.traits) {
    const v = ctx.content.traits[t]?.needDecay?.[need];
    if (typeof v === 'number' && v > 0) m *= v;
  }
  return m;
}

export function traitStressMult(ctx: SystemContext, sim: Sim): number {
  let m = 1;
  for (const t of sim.personality.traits) {
    const v = ctx.content.traits[t]?.stressMult;
    if (typeof v === 'number' && v > 0) m *= v;
  }
  return m;
}

function isAtHome(ctx: SystemContext, sim: Sim, venue: Venue | undefined): boolean {
  if (!venue) return false;
  const home = ctx.query.homeOf(sim.id);
  if (home && home.id === venue.id) return true;
  return venue.archetype === 'home' && venue.ownerHouseholdId === sim.householdId;
}

function ambientComfort(ctx: SystemContext, venue: Venue): number {
  let c = 0;
  for (const o of ctx.query.objectsAt(venue.id)) {
    const def = ctx.content.objects[o.defId];
    if (def?.ambient?.comfort && !o.state.broken) c += def.ambient.comfort;
  }
  return c;
}

/** Mifflin–St Jeor resting rate × activity factor from fitness. kcal/day. */
export function estimateTdee(sim: Sim, age: number): number {
  const w = sim.body.weight;
  const h = sim.body.heightCm;
  const base = 10 * w + 6.25 * h - 5 * age + (sim.identity.gender === 'male' ? 5 : sim.identity.gender === 'female' ? -161 : -78);
  const activity = 1.2 + (sim.body.fitness / 100) * 0.5;
  return Math.round(Math.max(1000, base * activity));
}

function you(ctx: SystemContext, sim: Sim): boolean {
  return ctx.query.isControlled(sim.id);
}

function name(sim: Sim): string {
  return sim.identity.firstName;
}

function removeMoodlet(sim: Sim, id: string): void {
  if (sim.mind.moodlets.some((m) => m.id === id)) sim.mind.moodlets = sim.mind.moodlets.filter((m) => m.id !== id);
}

function hasMoodlet(sim: Sim, id: string): boolean {
  return sim.mind.moodlets.some((m) => m.id === id);
}

// ---------------------------------------------------------------------------
// Decay
// ---------------------------------------------------------------------------
export function decayRates(ctx: SystemContext, sim: Sim): Record<NeedId, number> {
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const home = isAtHome(ctx, sim, venue);
  const sleeping = isSleeping(sim);
  const arch = venue?.archetype ?? 'unknown';
  const temp = ctx.state.weather.current.tempF;
  const young = sim.lifeStage === 'child' || sim.lifeStage === 'teen' || sim.lifeStage === 'toddler';
  const rates = { ...BASE_DECAY };

  if (young) {
    rates.hunger *= 1.3;
    rates.fun *= 1.4;
  }
  if (sim.lifeStage === 'senior') rates.energy *= 1.1;
  if (sim.body.pregnancy) {
    rates.hunger *= 1.2;
    rates.bladder *= 1.3;
    rates.energy *= 1.15;
  }

  // social: extraversion scales ±50%
  rates.social *= 0.5 + clamp(sim.personality.extraversion, 0, 1);

  // hygiene: heat & sweat
  if (temp > 90) rates.hygiene *= OUTDOOR.has(arch) || sim.travel ? 2 : 1.3;
  if (sim.body.bloodAlcohol > 0.1) rates.hygiene *= 1.5;

  // comfort depends on where they are
  if (home) {
    const amb = ambientComfort(ctx, venue!);
    rates.comfort = Math.max(-0.02, 0.015 - amb * 0.004);
  } else if (STANDING.has(arch) || sim.travel) rates.comfort = 0.06;
  else if (venue && venue.quality > 0.75) rates.comfort = 0.02;

  // body chemistry
  if (sim.body.caffeine > 200) rates.energy *= 0.5;
  if (sim.body.cannabis > 30) rates.hunger *= 2;

  // traits
  for (const k of NEED_IDS) rates[k] *= traitNeedMult(ctx, sim, k);

  if (sleeping) {
    rates.hunger *= 0.4;
    rates.thirst *= 0.5;
    rates.energy = 0;
    rates.hygiene *= 0.5;
    rates.social = 0;
    rates.fun = 0;
    rates.comfort = 0;
  }
  return rates;
}

function applyDecay(ctx: SystemContext, sim: Sim, dt: number): void {
  const rates = decayRates(ctx, sim);
  for (const k of NEED_IDS) {
    const r = rates[k];
    if (!r) continue;
    sim.needs[k] = clamp100(sim.needs[k] - r * dt);
  }
  // slow, passive fun gain from being drunk/high
  if (sim.body.bloodAlcohol > 0.05 && sim.body.bloodAlcohol < 0.2) sim.needs.fun = clamp100(sim.needs.fun + 0.02 * dt);
  if (sim.body.cannabis > 30) sim.needs.fun = clamp100(sim.needs.fun + 0.03 * dt);
}

// ---------------------------------------------------------------------------
// Thresholds & failure states
// ---------------------------------------------------------------------------
function criticalText(sim: Sim, need: NeedId, controlled: boolean): string {
  const n = name(sim);
  const t: Record<NeedId, [string, string]> = {
    hunger: ["You're getting seriously hungry.", `${n} looks hungry.`],
    thirst: ["Your mouth is dry — you need something to drink.", `${n} is parched.`],
    energy: ["You can barely keep your eyes open.", `${n} is running on empty.`],
    bladder: ['You really need a bathroom.', `${n} is looking for a bathroom.`],
    hygiene: ["You could use a shower. People are noticing.", `${n} could use a shower.`],
    social: ["You haven't talked to anyone in a while and it's getting to you.", `${n} seems lonely.`],
    fun: ["You're bored out of your mind.", `${n} looks bored.`],
    comfort: ['Your back aches. You need to sit down somewhere decent.', `${n} looks uncomfortable.`],
  };
  return controlled ? t[need][0] : t[need][1];
}

function checkThresholds(ctx: SystemContext, sim: Sim, dt: number): boolean {
  const now = ctx.state.time.minute;
  const controlled = you(ctx, sim);
  let anyCritical = false;
  for (const k of NEED_IDS) {
    const v = sim.needs[k];
    const flag = `needwarn:${k}`;
    const mid = `need:${k}`;
    if (v < CRITICAL) {
      anyCritical = true;
      const spec = NEED_MOODLETS[k];
      const [label, intensity] = v < SEVERE ? spec.severe : spec.mild;
      const existing = sim.mind.moodlets.find((m) => m.id === mid);
      if (!existing || existing.label !== label || existing.expiresAt - now < HOUR) addMoodlet(sim, { id: mid, emotion: spec.emotion, label, intensity, durationMinutes: 6 * HOUR, source: 'needs' }, now, ctx.rng);
      if (!sim.flags[flag]) {
        sim.flags[flag] = true;
        ctx.emit({ type: 'need:critical', simId: sim.id, need: k, value: v });
        ctx.log({ text: criticalText(sim, k, controlled), kind: 'need', simId: sim.id, venueId: sim.location.venueId, importance: controlled ? 1 : 0 });
        if (controlled && !isSleeping(sim)) {
          ctx.interrupt({
            kind: 'need_critical',
            title: NEED_MOODLETS[k].mild[0],
            body: criticalText(sim, k, true),
            simId: sim.id,
            options: [{ label: NEED_HINT_LABEL[k], actionId: `needs:suggest_${k}` }],
          });
        }
      }
    } else {
      if (hasMoodlet(sim, mid)) removeMoodlet(sim, mid);
      if (v >= RESTORED && sim.flags[flag]) {
        delete sim.flags[flag];
        ctx.emit({ type: 'need:restored', simId: sim.id, need: k });
      }
    }
  }
  sim.flags.smelly = sim.needs.hygiene < CRITICAL;
  if (!sim.flags.smelly) delete sim.flags.smelly;

  // --- failure states ---------------------------------------------------
  // bladder: accident
  if (sim.needs.bladder <= 0) {
    sim.needs.bladder = 100;
    ctx.applyEffects(sim.id, { needs: { hygiene: -60 }, moodlets: [{ id: 'needs:accident', emotion: 'embarrassed', label: 'Had an accident', intensity: -20, durationMinutes: 4 * HOUR }], stress: 5 }, 'needs:accident');
    ctx.log({ text: controlled ? "You couldn't hold it. You've had an accident — you need to clean up, now." : `${name(sim)} had an accident.`, kind: 'need', simId: sim.id, venueId: sim.location.venueId, importance: controlled ? 2 : 0 });
  }

  // energy: pass out
  if (sim.needs.energy <= 0 && !isSleeping(sim)) {
    if (sim.currentAction) ctx.emit({ type: 'action:interrupted', simId: sim.id, actionId: sim.currentAction.actionId, reason: 'passed out' });
    sim.currentAction = { actionId: 'needs:passed_out', label: 'Passed out (Sleeping)', startedAt: now, endsAt: now + PASS_OUT_MINUTES, interruptible: false, perMinute: { energy: 0.3, comfort: -0.2 } };
    sim.flags.sleeping = true;
    sim.mind.stress = clamp100(sim.mind.stress + 5);
    addMoodlet(sim, { id: 'needs:passed_out', emotion: 'embarrassed', label: 'Passed out', intensity: -15, durationMinutes: 6 * HOUR, source: 'needs' }, now, ctx.rng);
    ctx.emit({ type: 'sim:passed_out', simId: sim.id, reason: 'exhaustion' });
    ctx.log({ text: controlled ? 'Everything goes grey. You pass out from exhaustion where you stand.' : `${name(sim)} passed out from exhaustion.`, kind: 'alert', simId: sim.id, venueId: sim.location.venueId, importance: 2 });
    if (controlled) ctx.interrupt({ kind: 'emergency', title: 'Passed out', body: "You collapsed from exhaustion. You'll be out for a couple of hours.", simId: sim.id, options: [] });
  }

  // hunger: starvation
  if (sim.needs.hunger <= 0) {
    const since = num(sim.flags['needs:hungerZeroSince'], -1);
    if (since < 0) sim.flags['needs:hungerZeroSince'] = now;
    else if (now - since > STARVATION_AFTER) {
      ctx.applyEffects(sim.id, { health: -2 * (dt / HOUR) }, 'needs:starvation');
      const day = Math.floor(now / DAY);
      if (num(sim.flags['needs:starveWarnDay'], -1) !== day) {
        sim.flags['needs:starveWarnDay'] = day;
        ctx.log({ text: controlled ? "You haven't eaten in days. Your body is starting to give out." : `${name(sim)} hasn't eaten in days and is getting weak.`, kind: 'alert', simId: sim.id, importance: 2 });
        if (controlled) {
          if (sim.currentAction && sim.currentAction.interruptible) ctx.applyEffects(sim.id, { interrupt: [sim.id] }, 'needs:starvation');
          ctx.interrupt({ kind: 'emergency', title: 'Starving', body: "You haven't eaten in over two days. You need food, or you will die.", simId: sim.id, options: [{ label: NEED_HINT_LABEL.hunger, actionId: 'needs:suggest_hunger' }] });
        }
      }
    }
  } else if (sim.flags['needs:hungerZeroSince'] !== undefined) delete sim.flags['needs:hungerZeroSince'];

  return anyCritical;
}

// ---------------------------------------------------------------------------
// Stress, sleep debt, chemistry
// ---------------------------------------------------------------------------
function tickStress(ctx: SystemContext, sim: Sim, dt: number, anyCritical: boolean): void {
  const now = ctx.state.time.minute;
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const home = isAtHome(ctx, sim, venue);
  let delta = 0;
  if (anyCritical) delta += (0.3 / HOUR) * dt * traitStressMult(ctx, sim);
  else if (home) delta -= (0.5 / HOUR) * dt;
  if (isSleeping(sim)) delta -= (0.3 / HOUR) * dt;
  if (delta) sim.mind.stress = clamp100(sim.mind.stress + delta);
  if (sim.mind.stress > 80) {
    const m = sim.mind.moodlets.find((x) => x.id === 'needs:stressed');
    if (!m || m.expiresAt - now < HOUR) addMoodlet(sim, { id: 'needs:stressed', emotion: 'stressed', label: 'Stressed out', intensity: -15, durationMinutes: 4 * HOUR, source: 'needs' }, now, ctx.rng);
  } else if (sim.mind.stress < 70) removeMoodlet(sim, 'needs:stressed');
}

function tickSleepDebt(ctx: SystemContext, sim: Sim, dt: number): void {
  const now = ctx.state.time.minute;
  if (isSleeping(sim)) {
    sim.body.lastSleptAt = now;
    sim.body.sleepDebtHours = Math.max(0, sim.body.sleepDebtHours - (dt / HOUR) * 0.5);
  } else if (now - sim.body.lastSleptAt > AWAKE_LIMIT) {
    sim.body.sleepDebtHours = Math.min(72, sim.body.sleepDebtHours + dt / HOUR);
  }
  if (sim.body.sleepDebtHours > 12) {
    const m = sim.mind.moodlets.find((x) => x.id === 'needs:sleep_deprived');
    if (!m || m.expiresAt - now < HOUR) addMoodlet(sim, { id: 'needs:sleep_deprived', emotion: 'tired', label: 'Sleep deprived', intensity: -8, durationMinutes: 6 * HOUR, source: 'needs' }, now, ctx.rng);
  } else removeMoodlet(sim, 'needs:sleep_deprived');
}

function tickChemistry(ctx: SystemContext, sim: Sim, dt: number): void {
  const now = ctx.state.time.minute;
  const b = sim.body;
  const controlled = you(ctx, sim);

  // --- alcohol ---
  if (b.bloodAlcohol > 0) {
    // 5-decimal precision: the per-minute step (0.00025) must not round away
    b.bloodAlcohol = Math.max(0, Math.round((b.bloodAlcohol - (0.015 / HOUR) * dt) * 100000) / 100000);
    if (b.bloodAlcohol > num(sim.flags['needs:peakBac'])) sim.flags['needs:peakBac'] = b.bloodAlcohol;
  }
  const bac = b.bloodAlcohol;
  if (bac > 0.25) {
    if (!hasMoodlet(sim, 'needs:alcohol_poisoning') || sim.mind.moodlets.find((m) => m.id === 'needs:alcohol_poisoning')!.expiresAt - now < HOUR)
      addMoodlet(sim, { id: 'needs:alcohol_poisoning', emotion: 'sick', label: 'Alcohol poisoning', intensity: -25, durationMinutes: 4 * HOUR, source: 'needs' }, now, ctx.rng);
    ctx.applyEffects(sim.id, { health: -1 * (dt / HOUR) }, 'needs:alcohol_poisoning');
    if (!sim.flags['needs:alcoholWarned']) {
      sim.flags['needs:alcoholWarned'] = true;
      ctx.log({ text: controlled ? "You've had far too much. You're vomiting and can't stand — this is alcohol poisoning." : `${name(sim)} has alcohol poisoning.`, kind: 'alert', simId: sim.id, importance: 2 });
      if (controlled) ctx.interrupt({ kind: 'emergency', title: 'Alcohol poisoning', body: "You can't stand up and you can't stop throwing up. Someone should get you to an ER.", simId: sim.id, options: [] });
    }
  } else removeMoodlet(sim, 'needs:alcohol_poisoning');
  if (bac > 0.1) {
    removeMoodlet(sim, 'needs:tipsy');
    if (!hasMoodlet(sim, 'needs:drunk')) addMoodlet(sim, { id: 'needs:drunk', emotion: 'playful', label: 'Drunk', intensity: 3, durationMinutes: 3 * HOUR, source: 'needs' }, now, ctx.rng);
    sim.flags.drunk = true;
    // small chance of a drunken fall per hour (clumsy doubles)
    const clumsy = sim.personality.traits.includes('clumsy') ? 2 : 1;
    if (ctx.rng.chance(0.004 * clumsy * (dt / HOUR))) {
      ctx.log({ text: controlled ? 'You stumble and go down hard.' : `${name(sim)} stumbled and fell.`, kind: 'alert', simId: sim.id, importance: 1 });
      ctx.emit({ type: 'custom', kind: 'health:injury', simId: sim.id, payload: { name: 'Drunken fall', bodyPart: ctx.rng.pick(['knee', 'wrist', 'face', 'hip']), severity: 15 + ctx.rng.int(0, 20), days: 4 + ctx.rng.int(0, 6) } });
    }
  } else if (bac > 0.05) {
    removeMoodlet(sim, 'needs:drunk');
    delete sim.flags.drunk;
    if (!hasMoodlet(sim, 'needs:tipsy')) addMoodlet(sim, { id: 'needs:tipsy', emotion: 'playful', label: 'Tipsy', intensity: 8, durationMinutes: 3 * HOUR, source: 'needs' }, now, ctx.rng);
  } else {
    removeMoodlet(sim, 'needs:tipsy');
    removeMoodlet(sim, 'needs:drunk');
    delete sim.flags.drunk;
    if (bac === 0) {
      delete sim.flags['needs:alcoholWarned'];
      if (num(sim.flags['needs:peakBac']) >= 0.12) {
        ctx.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'hangover' } });
      }
      if (sim.flags['needs:peakBac'] !== undefined) delete sim.flags['needs:peakBac'];
    }
  }

  // --- caffeine (half-life 5h) ---
  if (b.caffeine > 0) {
    b.caffeine = b.caffeine * Math.pow(0.5, dt / (5 * HOUR));
    if (b.caffeine < 1) b.caffeine = 0;
    else b.caffeine = Math.round(b.caffeine * 10) / 10;
  }
  if (b.caffeine > 400) {
    if (!hasMoodlet(sim, 'needs:jittery')) addMoodlet(sim, { id: 'needs:jittery', emotion: 'anxious', label: 'Jittery', intensity: -5, durationMinutes: 3 * HOUR, source: 'needs' }, now, ctx.rng);
  } else removeMoodlet(sim, 'needs:jittery');

  // --- cannabis ---
  if (b.cannabis > 0) b.cannabis = Math.max(0, Math.round((b.cannabis - (15 / HOUR) * dt) * 100) / 100);
  if (b.cannabis > 30) {
    if (!hasMoodlet(sim, 'needs:high')) addMoodlet(sim, { id: 'needs:high', emotion: 'relaxed', label: 'High', intensity: 10, durationMinutes: 3 * HOUR, source: 'needs' }, now, ctx.rng);
    sim.flags.high = true;
  } else {
    removeMoodlet(sim, 'needs:high');
    delete sim.flags.high;
  }
}

// ---------------------------------------------------------------------------
// Mood
// ---------------------------------------------------------------------------
export function computeMood(ctx: SystemContext, sim: Sim): void {
  const now = ctx.state.time.minute;
  sim.mind.moodlets = sim.mind.moodlets.filter((m) => m.expiresAt > now && Number.isFinite(m.intensity));
  let mood = 0;
  let moodletSum = 0;
  let strongest: { emotion: EmotionId; abs: number } | undefined;
  for (const m of sim.mind.moodlets) {
    moodletSum += m.intensity;
    const abs = Math.abs(m.intensity);
    if (!strongest || abs > strongest.abs) strongest = { emotion: m.emotion, abs };
  }
  // many small moodlets stack, but with diminishing returns so one bad week doesn't pin mood to -100
  mood += 45 * Math.tanh(moodletSum / 45);
  for (const k of NEED_IDS) {
    const v = sim.needs[k];
    if (v < 50) mood -= (50 - v) / 5;
    else if (v > 80) mood += (v - 80) / 10;
  }
  mood -= sim.mind.stress / 4;
  const p = sim.personality;
  mood += 5 - p.neuroticism * 10;
  mood += (p.extraversion - 0.5) * 4 + ((sim.needs.social - 50) / 25) * (p.extraversion - 0.5);
  if (sim.mind.conditions.includes('depression')) mood -= 10;
  if (!Number.isFinite(mood)) mood = 0;
  sim.mind.mood = clamp(Math.round(mood * 10) / 10, -100, 100);

  let dominant: EmotionId;
  if (strongest && strongest.abs >= 8) dominant = strongest.emotion;
  else if (sim.mind.stress > 70) dominant = 'stressed';
  else if (sim.needs.energy < CRITICAL) dominant = 'tired';
  else if (sim.needs.fun < CRITICAL) dominant = 'bored';
  else if (sim.needs.social < CRITICAL) dominant = 'lonely';
  else if (sim.mind.mood > 10) dominant = 'happy';
  else if (sim.mind.mood < -10) dominant = 'sad';
  else dominant = 'relaxed';
  if (dominant !== sim.mind.dominantEmotion) {
    sim.mind.dominantEmotion = dominant;
    ctx.emit({ type: 'sim:mood_changed', simId: sim.id, mood: sim.mind.mood, dominant });
  }
  sim.flags['needs:moodAt'] = now;
}

// ---------------------------------------------------------------------------
// Per-sim processing by LOD
// ---------------------------------------------------------------------------
function processFar(ctx: SystemContext, sim: Sim): void {
  // background sims live their lives off-screen: needs drift toward a lived-in baseline
  for (const k of NEED_IDS) {
    const target = 70 + ctx.rng.range(-12, 12);
    sim.needs[k] = clamp100(sim.needs[k] + (target - sim.needs[k]) * 0.6);
  }
  sim.mind.stress = clamp100(sim.mind.stress + (25 - sim.mind.stress) * 0.2);
  sim.body.sleepDebtHours = Math.max(0, sim.body.sleepDebtHours - 4);
  sim.body.lastSleptAt = ctx.state.time.minute - 8 * HOUR;
  sim.body.lastAteAt = ctx.state.time.minute - 3 * HOUR;
  sim.body.bloodAlcohol = 0;
  sim.body.caffeine = 0;
  sim.body.cannabis = 0;
  for (const k of NEED_IDS) {
    delete sim.flags[`needwarn:${k}`];
    removeMoodlet(sim, `need:${k}`);
  }
  computeMood(ctx, sim);
}

function processSim(ctx: SystemContext, sim: Sim, dt: number): void {
  const now = ctx.state.time.minute;
  applyDecay(ctx, sim, dt);
  tickChemistry(ctx, sim, dt);
  const anyCritical = checkThresholds(ctx, sim, dt);
  tickStress(ctx, sim, dt, anyCritical);
  tickSleepDebt(ctx, sim, dt);
  const moodDue = sim.lod !== 'full' || now - num(sim.flags['needs:moodAt'], -Infinity) >= 5;
  if (moodDue) computeMood(ctx, sim);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function hintFor(ctx: SystemContext, sim: Sim, need: NeedId): string {
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  const here: string[] = [];
  if (venue) {
    for (const o of ctx.query.objectsAt(venue.id)) {
      const def = ctx.content.objects[o.defId];
      if (!def || o.state.broken) continue;
      if (def.interactions.some((i) => i.satisfies?.includes(need))) here.push(o.name ?? def.name);
    }
    if (need === 'bladder' && !ctx.query.findObject(venue.id, 'toilet') && !ctx.query.findObject(venue.id, 'public_restroom') && !NO_RESTROOM.has(venue.archetype) && venue.archetype !== 'home') here.push('a restroom somewhere in the building (Find a restroom)');
    if (need === 'thirst' && (isAtHome(ctx, sim, venue) || ctx.query.findObject(venue.id, 'kitchen_sink') || ctx.query.findObject(venue.id, 'water_cooler'))) here.push('tap water (Drink water)');
    if (need === 'comfort' || need === 'energy') here.push('somewhere to sit (Rest)');
  }
  const unique = [...new Set(here)].slice(0, 5);
  const parts: string[] = [];
  if (unique.length) parts.push(`Right here: ${unique.join(', ')}.`);
  const nearby: string[] = [];
  if (venue) {
    for (const arch of NEED_VENUES[need]) {
      if (arch === 'home') {
        const home = ctx.query.homeOf(sim.id);
        if (home && home.id !== venue.id) nearby.push(`home (${ctx.query.distanceKm(venue.id, home.id).toFixed(1)} km away)`);
        continue;
      }
      const v = ctx.query.nearestVenue(venue.id, arch);
      if (v && v.id !== venue.id) nearby.push(`${v.name} (${arch.replace(/_/g, ' ')}, ${ctx.query.distanceKm(venue.id, v.id).toFixed(1)} km)`);
      if (nearby.length >= 3) break;
    }
  }
  if (nearby.length) parts.push(`Nearby: ${nearby.join('; ')}.`);
  if (!parts.length) parts.push("Nothing obvious around here. You'll have to go somewhere else.");
  if (sim.inventory.consumables && need === 'hunger') {
    const food = Object.keys(sim.inventory.consumables).filter((id) => ctx.content.items[id]?.category === 'food');
    if (food.length) parts.push(`In your bag: ${food.map((f) => f.replace(/_/g, ' ')).join(', ')}.`);
  }
  if (need === 'thirst' && (sim.inventory.consumables.water_bottle ?? 0) > 0) parts.push('You have a water bottle on you.');
  return parts.join(' ');
}

function actionsFor(ctx: SystemContext, simId: SimId): ActionDef[] {
  const sim = ctx.query.simMaybe(simId);
  if (!sim || !sim.body.alive) return [];
  const venue = ctx.query.venueMaybe(sim.location.venueId);
  if (!venue) return [];
  const home = isAtHome(ctx, sim, venue);
  const arch = venue.archetype;
  const out: ActionDef[] = [];
  const sleeping = isSleeping(sim);

  if (!sleeping) {
    out.push({
      id: 'needs:rest',
      label: 'Rest',
      description: 'Sit or lie down wherever you are and take a load off.',
      category: 'needs',
      icon: 'armchair',
      durationMinutes: 30,
      effects: { perMinute: { energy: 0.1, comfort: 0.3 } },
      satisfies: ['comfort', 'energy'],
      autonomyWeight: 0.4,
      interruptible: true,
      group: 'Body',
    });
  }

  const hasToilet = !!ctx.query.findObject(venue.id, 'toilet') || !!ctx.query.findObject(venue.id, 'public_restroom');
  if (!hasToilet && arch !== 'home' && arch !== 'apartment_building' && !NO_RESTROOM.has(arch)) {
    out.push({
      id: 'needs:find_restroom',
      label: 'Find a restroom',
      description: 'Track down a bathroom somewhere in the building.',
      category: 'needs',
      icon: 'toilet',
      durationMinutes: 10,
      effects: { needs: { bladder: 60, hygiene: 3 } },
      satisfies: ['bladder'],
      autonomyWeight: 0.8,
      interruptible: true,
      group: 'Body',
    });
  }

  if (home || ctx.query.findObject(venue.id, 'kitchen_sink') || ctx.query.findObject(venue.id, 'water_cooler')) {
    out.push({
      id: 'needs:drink_water',
      label: 'Drink water',
      description: 'A glass of tap water. Free.',
      category: 'needs',
      icon: 'glass-water',
      durationMinutes: 2,
      effects: { needs: { thirst: 40, bladder: -4 } },
      satisfies: ['thirst'],
      autonomyWeight: 0.7,
      interruptible: true,
      group: 'Body',
    });
  }

  if (COMMERCIAL.has(arch)) {
    const price = round2(2 * venue.priceMultiplier * ctx.state.region.costOfLiving);
    out.push({
      id: 'needs:buy_water',
      label: 'Buy bottled water',
      description: `A bottle of water for $${price.toFixed(2)}.`,
      category: 'needs',
      icon: 'bottle',
      durationMinutes: 3,
      cost: { amount: price, memo: `Bottled water at ${venue.name}`, category: 'food', counterparty: venue.name },
      requirements: [
        { kind: 'money', reason: `Costs $${price.toFixed(2)}`, params: { amount: price } },
        { kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } },
      ],
      effects: { needs: { thirst: 45, bladder: -5 } },
      satisfies: ['thirst'],
      autonomyWeight: 0.5,
      interruptible: true,
      group: 'Body',
    });
  }

  for (const k of NEED_IDS) {
    if (sim.needs[k] < CRITICAL) {
      out.push({
        id: `needs:suggest_${k}`,
        label: NEED_HINT_LABEL[k],
        description: 'Take a second to think about where you could take care of this.',
        category: 'needs',
        icon: 'help-circle',
        durationMinutes: 0,
        effects: {},
        interruptible: true,
        group: 'Body',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
const SLEEP_RE = /\b(sleep|sleeping|nap|napping)\b/i;

function onEvent(ctx: SystemContext, e: GameEvent): void {
  const now = ctx.state.time.minute;
  switch (e.type) {
    case 'action:started': {
      if (SLEEP_RE.test(e.action.label)) {
        const sim = ctx.query.simMaybe(e.simId);
        if (sim) sim.flags['needs:sleepStart'] = now;
      }
      break;
    }
    case 'action:completed':
    case 'action:interrupted': {
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) break;
      if (e.actionId === 'needs:passed_out') {
        delete sim.flags.sleeping;
        sim.body.lastSleptAt = now;
        removeMoodlet(sim, 'needs:passed_out');
        ctx.log({ text: you(ctx, sim) ? 'You come to on the floor, stiff and groggy.' : `${name(sim)} came to.`, kind: 'need', simId: sim.id, importance: 1 });
        break;
      }
      const start = sim.flags['needs:sleepStart'];
      const isSleepAction = e.type === 'action:completed' ? SLEEP_RE.test(e.label) : typeof start === 'number';
      if (isSleepAction && typeof start === 'number') {
        const hours = Math.max(0, (now - start) / HOUR);
        sim.body.lastSleptAt = now;
        delete sim.flags['needs:sleepStart'];
        if (hours >= 0.25) ctx.log({ text: you(ctx, sim) ? `You slept about ${hours.toFixed(1)} hours.` : `${name(sim)} slept about ${hours.toFixed(1)} hours.`, kind: 'need', simId: sim.id, importance: 0 });
      }
      break;
    }
    case 'time:day': {
      for (const sim of ctx.query.simulatedSims()) {
        if (sim.flags.calories_today !== undefined || you(ctx, sim)) {
          sim.flags.calories_yesterday = num(sim.flags.calories_today);
          sim.flags.calories_today = 0;
        }
        sim.flags.tdee = estimateTdee(sim, ctx.query.ageOf(sim));
      }
      break;
    }
    case 'custom': {
      if (!e.simId) break;
      const sim = ctx.query.simMaybe(e.simId);
      if (!sim) break;
      const p = e.payload ?? {};
      if (e.kind === 'needs:slept') {
        const hours = clamp(num(p.hours), 0, 24);
        sim.body.lastSleptAt = now;
        sim.body.sleepDebtHours = Math.max(0, sim.body.sleepDebtHours - hours * 0.5);
        if (p.restore !== false) sim.needs.energy = clamp100(sim.needs.energy + hours * 10);
      } else if (e.kind === 'needs:ate') {
        const calories = clamp(num(p.calories), 0, 5000);
        const healthy = clamp(num(p.healthy), -1, 1);
        const restored = num(p.hungerRestored);
        sim.body.lastAteAt = now;
        sim.flags.calories_today = num(sim.flags.calories_today) + calories;
        if (sim.flags.tdee === undefined) sim.flags.tdee = estimateTdee(sim, ctx.query.ageOf(sim));
        if (restored >= 20 && healthy >= 0.3) addMoodlet(sim, { id: 'needs:well_fed', emotion: 'grateful', label: 'Well fed', intensity: 5, durationMinutes: 3 * HOUR, source: 'needs' }, now, ctx.rng);
        else if (restored >= 20 && healthy <= -0.5) addMoodlet(sim, { id: 'needs:greasy', emotion: 'uncomfortable', label: 'Greasy regret', intensity: -3, durationMinutes: 2 * HOUR, source: 'needs' }, now, ctx.rng);
        if (p.meat === true && sim.personality.traits.includes('vegetarian')) addMoodlet(sim, { id: 'needs:ate_meat', emotion: 'guilty', label: 'Ate meat', intensity: -12, durationMinutes: 6 * HOUR, source: 'needs' }, now, ctx.rng);
        if (sim.flags['needs:hungerZeroSince'] !== undefined) delete sim.flags['needs:hungerZeroSince'];
      } else if (e.kind === 'needs:drank') {
        const units = clamp(num(p.alcoholUnits), 0, 20);
        if (units > 0) {
          const w = Math.max(40, sim.body.weight);
          const sex = sim.identity.gender === 'female' ? 1.2 : 1;
          const delta = units * 0.023 * (75 / w) * sex;
          sim.body.bloodAlcohol = Math.round((sim.body.bloodAlcohol + delta) * 1000) / 1000;
          if (sim.body.bloodAlcohol > num(sim.flags['needs:peakBac'])) sim.flags['needs:peakBac'] = sim.body.bloodAlcohol;
          sim.needs.thirst = clamp100(sim.needs.thirst + units * 3);
          sim.needs.bladder = clamp100(sim.needs.bladder - units * 4);
        }
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
export const needsSystem: System = {
  id: 'needs',
  intervalMinutes: 1,

  onInit(ctx) {
    const now = ctx.state.time.minute;
    for (const sim of Object.values(ctx.state.sims)) {
      if (sim.flags['needs:last'] === undefined) sim.flags['needs:last'] = now;
      if (sim.flags.tdee === undefined) sim.flags.tdee = estimateTdee(sim, ctx.query.ageOf(sim));
      if (you(ctx, sim) && sim.flags.calories_today === undefined) sim.flags.calories_today = 0;
    }
  },

  onTick(ctx, dt) {
    const now = ctx.state.time.minute;
    for (const sim of Object.values(ctx.state.sims)) {
      if (!sim.body.alive) continue;
      const interval = LOD_INTERVAL[sim.lod] ?? DAY;
      const last = num(sim.flags['needs:last'], now - dt);
      const elapsed = now - last;
      if (elapsed < interval) continue;
      sim.flags['needs:last'] = now;
      if (sim.lod === 'far') processFar(ctx, sim);
      else {
        // a sim that just came into focus (far → near/full) must not pay days of decay at once
        const cap = sim.lod === 'full' ? 30 : 3 * HOUR;
        processSim(ctx, sim, clamp(elapsed, 1, cap));
      }
    }
  },

  onEvent,

  actions: actionsFor,

  handles: (id) => id.startsWith('needs:'),

  execute(ctx, simId, action) {
    const sim = ctx.query.sim(simId);
    if (action.id.startsWith('needs:suggest_')) {
      const need = action.id.slice('needs:suggest_'.length) as NeedId;
      if (!NEED_IDS.includes(need)) return { ok: false, text: 'Nothing comes to mind.' };
      const text = hintFor(ctx, sim, need);
      ctx.log({ text, kind: 'need', simId, importance: 0 });
      return { ok: true, text, data: { need, hint: text } };
    }
    switch (action.id) {
      case 'needs:rest':
        return { ok: true, text: you(ctx, sim) ? 'You find somewhere to sit and let your body catch up.' : `${name(sim)} sits down for a while.` };
      case 'needs:find_restroom':
        return { ok: true, text: 'You find a restroom, eventually.' };
      case 'needs:drink_water':
        return { ok: true, text: 'You drink a glass of water.' };
      case 'needs:buy_water':
        return { ok: true, text: 'You buy a bottle of water and drink most of it on the spot.' };
      default:
        return { ok: true };
    }
  },
};
