import { describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import type { GameEvent } from '../core/events';
import { makeEmptyWorld, makeHousehold, makeSim, makeVenue } from '../core/factories';
import { RNG } from '../core/rng';
import type { System } from '../core/systems';
import type { ActionDef, Sim, WorldState } from '../core/types';
import { NEED_IDS } from '../core/types';
import { DAY, HOUR } from '../core/util';
import type { ContentCatalog } from '../content/types';
import { HOBBIES } from '../content/hobbies';
import { ILLNESSES } from '../content/illnesses';
import { SKILLS } from '../content/skills';
import { TRAITS } from '../content/traits';
import { computeMood, decayRates, estimateTdee, needsSystem } from './needs';

/** Isolated catalog: only the slices this builder owns, everything else empty (other builders' files may be mid-edit). */
const content: ContentCatalog = {
  objects: {},
  items: {},
  recipes: {},
  skills: SKILLS,
  hobbies: HOBBIES,
  traits: TRAITS,
  careers: {},
  programs: {},
  illnesses: ILLNESSES,
  crimes: {},
  holidays: {},
  festivals: {},
  archetypes: {} as ContentCatalog['archetypes'],
  petBreeds: [],
  vehicles: [],
  bioTemplates: [],
  names: { first: { male: [], female: [], nonbinary: [] }, last: [] },
};

function world(opts: { age?: number; traits?: string[] } = {}) {
  const rng = new RNG('needs-test');
  const state = makeEmptyWorld({ seed: 'needs-test', epoch: '2026-09-10' });
  const home = makeVenue({ name: 'Home', archetype: 'home', location: state.region.center, rng, rooms: ['Kitchen', 'Bedroom'] });
  const grocery = makeVenue({ name: 'H-E-B', archetype: 'grocery', location: { lat: state.region.center.lat + 0.01, lng: state.region.center.lng }, rng, priceMultiplier: 1 });
  const park = makeVenue({ name: 'Zilker Park', archetype: 'park', location: { lat: state.region.center.lat + 0.02, lng: state.region.center.lng }, rng });
  const diner = makeVenue({ name: "Kerbey Lane", archetype: 'restaurant', location: { lat: state.region.center.lat + 0.005, lng: state.region.center.lng }, rng });
  for (const v of [home, grocery, park, diner]) state.venues[v.id] = v;
  const sim = makeSim({ firstName: 'Ada', lastName: 'Lee', gender: 'female', age: opts.age ?? 28, epoch: state.epoch, rng, venueId: home.id, isPlayerControlled: true, startingCash: 1000, personality: { traits: opts.traits ?? [] } });
  state.sims[sim.id] = sim;
  const hh = makeHousehold({ name: 'Lee', simIds: [sim.id], homeVenueId: home.id, rng });
  state.households[hh.id] = hh;
  sim.householdId = hh.id;
  home.ownerHouseholdId = hh.id;
  state.player = { householdId: hh.id, activeSimId: sim.id, controlledSimIds: [sim.id], favorites: [], tutorial: {} };
  return { state, sim, home, grocery, park, diner, hh, rng };
}

function spy(events: GameEvent[]): System {
  return { id: 'story', intervalMinutes: 60, onEvent: (_c, e) => events.push(e) };
}

function engine(state: WorldState, extra: System[] = [], events: GameEvent[] = []) {
  const eng = new Engine(state, { content, systems: [needsSystem, ...extra, spy(events)], holidayResolver: () => [] });
  eng.init(true);
  return eng;
}

function assertSane(sim: Sim) {
  for (const k of NEED_IDS) {
    expect(Number.isFinite(sim.needs[k])).toBe(true);
    expect(sim.needs[k]).toBeGreaterThanOrEqual(0);
    expect(sim.needs[k]).toBeLessThanOrEqual(100);
  }
  expect(Number.isFinite(sim.mind.mood)).toBe(true);
  expect(sim.mind.mood).toBeGreaterThanOrEqual(-100);
  expect(sim.mind.mood).toBeLessThanOrEqual(100);
  expect(Number.isFinite(sim.mind.stress)).toBe(true);
  expect(sim.mind.stress).toBeGreaterThanOrEqual(0);
  expect(sim.mind.stress).toBeLessThanOrEqual(100);
  for (const k of ['health', 'fitness', 'weight', 'bloodAlcohol', 'caffeine', 'cannabis', 'sleepDebtHours', 'immune'] as const) expect(Number.isFinite(sim.body[k])).toBe(true);
  for (const m of sim.mind.moodlets) expect(Number.isFinite(m.intensity)).toBe(true);
}

describe('needs system', () => {
  it('7 idle days: needs decay to critical, events fire, mood stays bounded, no NaN', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [], events);
    for (let d = 0; d < 7; d++) {
      eng.advance(DAY, { allowInterrupt: false });
      assertSane(sim);
    }
    const types = new Set(events.map((e) => e.type));
    expect(types.has('need:critical')).toBe(true);
    expect(types.has('sim:passed_out')).toBe(true);
    expect(types.has('sim:mood_changed')).toBe(true);
    const criticalNeeds = new Set(events.filter((e): e is Extract<GameEvent, { type: 'need:critical' }> => e.type === 'need:critical').map((e) => e.need));
    for (const k of ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'fun', 'social'] as const) expect(criticalNeeds.has(k)).toBe(true);
    // interrupts surfaced for the controlled sim, but not spammed: one per need crossing
    expect(state.pendingInterrupts.length).toBeGreaterThan(0);
    const hungerCriticals = events.filter((e) => e.type === 'need:critical' && e.need === 'hunger').length;
    expect(hungerCriticals).toBe(1);
    // starving after >2 days without food costs health
    expect(sim.needs.hunger).toBe(0);
    expect(sim.body.health).toBeLessThan(90);
    expect(sim.body.health).toBeGreaterThanOrEqual(0);
    expect(sim.mind.mood).toBeLessThan(0);
    expect(sim.mind.moodlets.some((m) => m.label === 'Starving')).toBe(true);
    expect(sim.flags['needwarn:hunger']).toBe(true);
    expect(sim.body.sleepDebtHours).toBeGreaterThan(0);
  });

  it('sleeping via an ad-hoc action restores energy and records sleep', () => {
    const { state, sim } = world();
    const eng = engine(state);
    for (const k of NEED_IDS) sim.needs[k] = 100;
    sim.needs.energy = 30;
    const sleep: ActionDef = { id: 'test:sleep', label: 'Sleep', category: 'needs', durationMinutes: 8 * HOUR, effects: { perMinute: { energy: 0.25 } } };
    const start = state.time.minute;
    const res = eng.perform(sim.id, sleep.id, {}, sleep);
    expect(res.ok).toBe(true);
    expect(res.minutes).toBe(8 * HOUR);
    expect(sim.needs.energy).toBeGreaterThan(95); // no awake decay while asleep
    expect(sim.body.lastSleptAt).toBe(start + 8 * HOUR);
    expect(sim.flags['needs:sleepStart']).toBeUndefined();
    // hunger decays slower asleep than awake
    const hungerLossAsleep = 100 - sim.needs.hunger;
    sim.needs.hunger = 100;
    eng.advance(8 * HOUR, { allowInterrupt: false });
    const hungerLossAwake = 100 - sim.needs.hunger;
    expect(hungerLossAsleep).toBeLessThan(hungerLossAwake * 0.6);
  });

  it('decay rates respect traits, life stage and substances', () => {
    const base = world();
    const eBase = engine(base.state);
    const adult = decayRates(eBase.ctx(), base.sim);
    expect(adult.hunger).toBeCloseTo(0.07, 5);

    const kid = world({ age: 9 });
    const eKid = engine(kid.state);
    const child = decayRates(eKid.ctx(), kid.sim);
    expect(child.hunger).toBeGreaterThan(adult.hunger);
    expect(child.fun).toBeGreaterThan(adult.fun);

    const slob = world({ traits: ['slob', 'loner'] });
    const eSlob = engine(slob.state);
    const s = decayRates(eSlob.ctx(), slob.sim);
    expect(s.hygiene).toBeLessThan(adult.hygiene);
    expect(s.social).toBeLessThan(adult.social);

    base.sim.body.caffeine = 300;
    expect(decayRates(eBase.ctx(), base.sim).energy).toBeCloseTo(adult.energy / 2, 5);
    base.sim.body.caffeine = 0;
    base.sim.body.cannabis = 50;
    expect(decayRates(eBase.ctx(), base.sim).hunger).toBeCloseTo(adult.hunger * 2, 5);
  });

  it('mood sums moodlets and needs, emits sim:mood_changed only on dominant change', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [], events);
    for (const k of NEED_IDS) sim.needs[k] = 95;
    sim.mind.stress = 0;
    sim.mind.moodlets = [];
    computeMood(eng.ctx(), sim);
    const happy = sim.mind.mood;
    expect(happy).toBeGreaterThan(0);
    for (const k of NEED_IDS) sim.needs[k] = 15;
    sim.mind.stress = 90;
    computeMood(eng.ctx(), sim);
    expect(sim.mind.mood).toBeLessThan(happy);
    expect(sim.mind.mood).toBeGreaterThanOrEqual(-100);
    eng.addMoodlet(sim.id, { emotion: 'grieving', label: 'Loss', intensity: -30, durationMinutes: 60 });
    const before = events.filter((e) => e.type === 'sim:mood_changed').length;
    computeMood(eng.ctx(), sim);
    expect(sim.mind.dominantEmotion).toBe('grieving');
    computeMood(eng.ctx(), sim);
    computeMood(eng.ctx(), sim);
    const after = events.filter((e) => e.type === 'sim:mood_changed').length;
    expect(after - before).toBe(1);
    // expired moodlets are dropped
    state.time.minute += 120;
    computeMood(eng.ctx(), sim);
    expect(sim.mind.moodlets.some((m) => m.label === 'Loss')).toBe(false);
  });

  it('contributes body actions in context and executes them', () => {
    const { state, sim, grocery, park } = world();
    const eng = engine(state);
    const ids = () => eng.actionsFor(sim.id).map((a) => a.action.id);
    expect(ids()).toContain('needs:rest');
    expect(ids()).toContain('needs:drink_water');
    expect(ids()).not.toContain('needs:buy_water');
    expect(ids()).not.toContain('needs:find_restroom');
    sim.needs.thirst = 40;
    const res = eng.perform(sim.id, 'needs:drink_water');
    expect(res.ok).toBe(true);
    expect(sim.needs.thirst).toBeGreaterThan(75);

    eng.teleport(sim.id, grocery.id);
    expect(ids()).toContain('needs:buy_water');
    expect(ids()).toContain('needs:find_restroom');
    expect(ids()).not.toContain('needs:drink_water');
    const water = eng.findAction(sim.id, 'needs:buy_water')!;
    expect(water.cost?.amount).toBeCloseTo(2 * state.region.costOfLiving, 2);
    const cashBefore = eng.ctx().query.liquidCash(sim);
    sim.needs.thirst = 30;
    sim.needs.bladder = 40; // stays above the critical band so no interrupt cuts the actions short
    expect(eng.perform(sim.id, 'needs:buy_water').ok).toBe(true);
    expect(eng.ctx().query.liquidCash(sim)).toBeCloseTo(cashBefore - water.cost!.amount, 2);
    expect(eng.perform(sim.id, 'needs:find_restroom').ok).toBe(true);
    expect(sim.needs.bladder).toBeGreaterThan(90);

    eng.teleport(sim.id, park.id);
    expect(ids()).not.toContain('needs:buy_water');
    expect(ids()).not.toContain('needs:find_restroom');
    expect(ids()).toContain('needs:rest');
  });

  it('offers hint actions for critical needs and answers with what is around', () => {
    const { state, sim } = world();
    const eng = engine(state);
    expect(eng.actionsFor(sim.id).some((a) => a.action.id === 'needs:suggest_hunger')).toBe(false);
    sim.needs.hunger = 10;
    eng.advance(1, { allowInterrupt: false });
    expect(eng.actionsFor(sim.id).some((a) => a.action.id === 'needs:suggest_hunger')).toBe(true);
    const interrupt = state.pendingInterrupts.find((i) => i.kind === 'need_critical');
    expect(interrupt?.options[0]?.actionId).toBe('needs:suggest_hunger');
    const res = eng.perform(sim.id, 'needs:suggest_hunger');
    expect(res.ok).toBe(true);
    expect(res.text).toMatch(/Kerbey Lane|H-E-B/);
    expect(res.minutes).toBe(0);
  });

  it('handles failure states: accidents, passing out', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [], events);
    for (const k of NEED_IDS) sim.needs[k] = 90;
    sim.needs.bladder = 0.5;
    eng.advance(10, { allowInterrupt: false });
    expect(sim.needs.bladder).toBeGreaterThan(90);
    expect(sim.needs.hygiene).toBeLessThan(40);
    expect(sim.mind.moodlets.some((m) => m.label === 'Had an accident')).toBe(true);

    for (const k of NEED_IDS) sim.needs[k] = 90;
    sim.needs.energy = 0.5;
    eng.advance(15, { allowInterrupt: false });
    expect(events.some((e) => e.type === 'sim:passed_out')).toBe(true);
    expect(sim.currentAction?.actionId).toBe('needs:passed_out');
    expect(sim.flags.sleeping).toBe(true);
    eng.advance(130, { allowInterrupt: false });
    expect(sim.currentAction).toBeUndefined();
    expect(sim.flags.sleeping).toBeUndefined();
    expect(sim.needs.energy).toBeGreaterThan(20);
  });

  it('metabolizes alcohol, caffeine and cannabis with the expected effects', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [], events);
    for (const k of NEED_IDS) sim.needs[k] = 90;
    eng.bus.emit({ type: 'custom', kind: 'needs:drank', simId: sim.id, payload: { alcoholUnits: 6 } });
    expect(sim.body.bloodAlcohol).toBeGreaterThan(0.12); // a real night out → hangover territory
    const bac0 = sim.body.bloodAlcohol;
    eng.advance(5, { allowInterrupt: false });
    expect(sim.mind.moodlets.some((m) => m.label === 'Tipsy' || m.label === 'Drunk')).toBe(true);
    eng.advance(2 * HOUR, { allowInterrupt: false });
    expect(sim.body.bloodAlcohol).toBeLessThan(bac0);
    expect(sim.body.bloodAlcohol).toBeCloseTo(Math.max(0, bac0 - 0.015 * 2), 2);
    eng.advance(12 * HOUR, { allowInterrupt: false });
    expect(sim.body.bloodAlcohol).toBe(0);
    expect(sim.mind.moodlets.some((m) => m.label === 'Tipsy' || m.label === 'Drunk')).toBe(false);
    expect(events.some((e) => e.type === 'custom' && e.kind === 'health:contract' && e.payload?.defId === 'hangover')).toBe(true);

    sim.body.caffeine = 400;
    eng.advance(5 * HOUR, { allowInterrupt: false });
    expect(sim.body.caffeine).toBeCloseTo(200, 0);

    sim.body.cannabis = 60;
    eng.advance(1, { allowInterrupt: false });
    expect(sim.mind.moodlets.some((m) => m.label === 'High')).toBe(true);
    expect(sim.flags.high).toBe(true);
    eng.advance(3 * HOUR, { allowInterrupt: false });
    expect(sim.body.cannabis).toBeLessThan(20);
    expect(sim.flags.high).toBeUndefined();
  });

  it('tracks calories and TDEE for the health system', () => {
    const { state, sim } = world();
    const eng = engine(state);
    const tdee = estimateTdee(sim, 28);
    expect(tdee).toBeGreaterThan(1300);
    expect(tdee).toBeLessThan(4000);
    expect(sim.flags.tdee).toBe(tdee);
    eng.bus.emit({ type: 'custom', kind: 'needs:ate', simId: sim.id, payload: { calories: 650, healthy: 0.5, hungerRestored: 40 } });
    eng.bus.emit({ type: 'custom', kind: 'needs:ate', simId: sim.id, payload: { calories: 900, healthy: -0.8, hungerRestored: 45 } });
    expect(sim.flags.calories_today).toBe(1550);
    expect(sim.body.lastAteAt).toBe(state.time.minute);
    expect(sim.mind.moodlets.some((m) => m.label === 'Well fed')).toBe(true);
    eng.advance(DAY, { allowInterrupt: false }); // crosses midnight
    expect(sim.flags.calories_yesterday).toBe(1550);
    expect(sim.flags.calories_today).toBe(0);
  });

  it('batches by LOD: near sims every 15 minutes, far sims daily drift', () => {
    const { state, home, rng } = world();
    const near = makeSim({ firstName: 'Ben', lastName: 'Ng', gender: 'male', age: 40, epoch: state.epoch, rng, venueId: home.id, lod: 'near' });
    const far = makeSim({ firstName: 'Cy', lastName: 'Oh', gender: 'nonbinary', age: 33, epoch: state.epoch, rng, venueId: home.id, lod: 'far' });
    state.sims[near.id] = near;
    state.sims[far.id] = far;
    const eng = engine(state);
    const t0 = state.time.minute;
    eng.advance(14, { allowInterrupt: false });
    expect(near.flags['needs:last']).toBe(t0);
    expect(near.needs.hunger).toBe(80);
    eng.advance(1, { allowInterrupt: false });
    expect(near.flags['needs:last']).toBe(t0 + 15);
    expect(near.needs.hunger).toBeCloseTo(80 - 0.07 * 15, 3);
    for (let d = 0; d < 3; d++) eng.advance(DAY, { allowInterrupt: false });
    for (const k of NEED_IDS) {
      expect(far.needs[k]).toBeGreaterThan(40);
      expect(far.needs[k]).toBeLessThanOrEqual(100);
    }
    expect(state.pendingInterrupts.every((i) => i.simId !== near.id && i.simId !== far.id)).toBe(true);
    assertSane(near);
    assertSane(far);
  });

  it('stress relaxes at home and climbs while needs are critical', () => {
    const { state, sim } = world();
    const eng = engine(state);
    for (const k of NEED_IDS) sim.needs[k] = 95;
    sim.mind.stress = 50;
    eng.advance(4 * HOUR, { allowInterrupt: false });
    expect(sim.mind.stress).toBeCloseTo(48, 0);
    for (const k of NEED_IDS) sim.needs[k] = 95;
    sim.needs.fun = 5;
    const s = sim.mind.stress;
    eng.advance(4 * HOUR, { allowInterrupt: false });
    expect(sim.mind.stress).toBeGreaterThan(s);
    sim.mind.stress = 90;
    eng.advance(2, { allowInterrupt: false });
    expect(sim.mind.moodlets.some((m) => m.label === 'Stressed out')).toBe(true);
  });
});
