import { describe, expect, it } from 'vitest';
import { Engine } from '../core/engine';
import type { GameEvent } from '../core/events';
import { makeEmptyWorld, makeHousehold, makeSim, makeVenue } from '../core/factories';
import { RNG } from '../core/rng';
import type { System } from '../core/systems';
import type { Sim, WorldState } from '../core/types';
import { NEED_IDS } from '../core/types';
import { DAY, HOUR } from '../core/util';
import type { ContentCatalog } from '../content/types';
import { HOBBIES } from '../content/hobbies';
import { ILLNESSES } from '../content/illnesses';
import { SKILLS } from '../content/skills';
import { TRAITS } from '../content/traits';
import { healthSystem, patientShare } from './health';
import { needsSystem } from './needs';

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

function world(seed = 'health-test', opts: { age?: number; cash?: number } = {}) {
  const rng = new RNG(seed);
  const state = makeEmptyWorld({ seed, epoch: '2026-09-10' });
  const c = state.region.center;
  const home = makeVenue({ name: 'Home', archetype: 'home', location: c, rng });
  const clinic = makeVenue({ name: 'Austin Regional Clinic', archetype: 'clinic', location: { lat: c.lat + 0.01, lng: c.lng }, rng });
  const hospital = makeVenue({ name: 'Dell Seton Medical Center', archetype: 'hospital', location: { lat: c.lat + 0.02, lng: c.lng }, rng });
  const pharmacy = makeVenue({ name: 'CVS', archetype: 'pharmacy', location: { lat: c.lat + 0.005, lng: c.lng }, rng });
  const dentist = makeVenue({ name: 'Bright Smiles Dental', archetype: 'dentist', location: { lat: c.lat + 0.006, lng: c.lng }, rng });
  for (const v of [home, clinic, hospital, pharmacy, dentist]) state.venues[v.id] = v;
  const sim = makeSim({ firstName: 'Ada', lastName: 'Lee', gender: 'female', age: opts.age ?? 28, epoch: state.epoch, rng, venueId: home.id, isPlayerControlled: true, startingCash: opts.cash ?? 2000 });
  state.sims[sim.id] = sim;
  const hh = makeHousehold({ name: 'Lee', simIds: [sim.id], homeVenueId: home.id, rng });
  state.households[hh.id] = hh;
  sim.householdId = hh.id;
  home.ownerHouseholdId = hh.id;
  state.player = { householdId: hh.id, activeSimId: sim.id, controlledSimIds: [sim.id], favorites: [], tutorial: {} };
  return { state, sim, home, clinic, hospital, pharmacy, dentist, hh, rng };
}

/** keeps a sim fed/rested so multi-day runs test health rather than starvation */
const caretaker: System = {
  id: 'story',
  intervalMinutes: 60,
  onTick: (ctx) => {
    for (const s of ctx.query.controlledSims()) for (const k of NEED_IDS) s.needs[k] = Math.max(s.needs[k], 70);
  },
};

function engine(state: WorldState, systems: System[], events: GameEvent[] = []) {
  const eng = new Engine(state, { content, systems: [...systems, { id: 'story', intervalMinutes: 60, onEvent: (_c, e) => events.push(e) }], holidayResolver: () => [] });
  eng.init(true);
  return eng;
}

function sane(sim: Sim) {
  for (const k of ['health', 'fitness', 'weight', 'immune', 'sleepDebtHours'] as const) expect(Number.isFinite(sim.body[k])).toBe(true);
  expect(sim.body.health).toBeGreaterThanOrEqual(0);
  expect(sim.body.health).toBeLessThanOrEqual(100);
  expect(sim.body.immune).toBeGreaterThanOrEqual(0);
  expect(sim.body.immune).toBeLessThanOrEqual(100);
  for (const i of sim.body.illnesses) {
    expect(Number.isFinite(i.severity)).toBe(true);
    expect(i.severity).toBeGreaterThanOrEqual(0);
    expect(i.severity).toBeLessThanOrEqual(100);
  }
  for (const k of NEED_IDS) expect(Number.isFinite(sim.needs[k])).toBe(true);
}

describe('health system', () => {
  it('7 days with needs + health: invariants hold, weight and fitness move sanely', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [needsSystem, healthSystem, caretaker], events);
    const w0 = sim.body.weight;
    const f0 = sim.body.fitness;
    for (let d = 0; d < 7; d++) {
      eng.advance(DAY, { allowInterrupt: false });
      sane(sim);
    }
    expect(sim.body.alive).toBe(true);
    expect(Math.abs(sim.body.weight - w0)).toBeLessThan(3);
    expect(sim.body.fitness).toBeLessThan(f0);
    expect(sim.body.fitness).toBeGreaterThan(f0 - 1.5);
    expect(sim.flags.tdee).toBeGreaterThan(1200);
    expect(events.some((e) => e.type === 'sim:died')).toBe(false);
  });

  it('forced contraction runs through sick → recovered', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem, caretaker], events);
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'common_cold' } });
    expect(sim.body.illnesses.length).toBe(1);
    expect(events.some((e) => e.type === 'sim:sick' && e.name === 'Common cold')).toBe(true);
    expect(sim.mind.moodlets.some((m) => m.label === 'Common cold')).toBe(true);
    const sev0 = sim.body.illnesses[0].severity;
    eng.advance(2 * DAY, { allowInterrupt: false });
    expect(sim.body.illnesses[0].severity).toBeGreaterThan(sev0);
    for (let d = 0; d < 12 && sim.body.illnesses.length; d++) eng.advance(DAY, { allowInterrupt: false });
    expect(sim.body.illnesses.length).toBe(0);
    expect(events.some((e) => e.type === 'sim:recovered')).toBe(true);
    expect(sim.mind.moodlets.some((m) => m.label === 'Common cold')).toBe(false);
    expect(sim.mind.moodlets.some((m) => m.label === 'Feeling better')).toBe(true);
    sane(sim);
  });

  it('a run-down sim catches something naturally with a seeded rng', () => {
    const { state, sim } = world('sickly');
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem, caretaker], events);
    sim.body.immune = 0;
    sim.mind.stress = 95;
    sim.body.sleepDebtHours = 20;
    for (let d = 0; d < 120 && !events.some((e) => e.type === 'sim:sick'); d++) {
      eng.advance(DAY, { allowInterrupt: false });
      sim.body.immune = 0;
      sim.mind.stress = 95;
    }
    expect(events.some((e) => e.type === 'sim:sick')).toBe(true);
    sane(sim);
  });

  it('contagion spreads between sims sharing a venue', () => {
    const { state, sim, home, rng } = world('contagion');
    const roommate = makeSim({ firstName: 'Ben', lastName: 'Ng', gender: 'male', age: 30, epoch: state.epoch, rng, venueId: home.id, lod: 'full', householdId: sim.householdId });
    state.sims[roommate.id] = roommate;
    state.households[sim.householdId!].simIds.push(roommate.id);
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem, caretaker], events);
    roommate.body.immune = 0;
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'flu', severity: 70 } });
    for (let d = 0; d < 20 && !roommate.body.illnesses.some((i) => i.defId === 'flu'); d++) {
      eng.advance(DAY, { allowInterrupt: false });
      roommate.body.immune = 0;
      const flu = sim.body.illnesses.find((i) => i.defId === 'flu');
      if (flu) flu.severity = 70;
      else eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'flu', severity: 70 } });
    }
    expect(roommate.body.illnesses.some((i) => i.defId === 'flu')).toBe(true);
  });

  it('lethal illness kills: sim:died, stats, interrupt', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem], events);
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'heart_attack', severity: 95 } });
    eng.advance(6 * HOUR, { allowInterrupt: false });
    expect(sim.body.alive).toBe(false);
    expect(sim.body.deathCause).toBe('Heart attack');
    expect(sim.body.diedAt).toBeDefined();
    expect(state.stats.deaths).toBe(1);
    expect(events.some((e) => e.type === 'sim:died')).toBe(true);
    expect(state.pendingInterrupts.some((i) => i.kind === 'death')).toBe(true);
    // dead sims stop ticking
    const illnessesAfter = sim.body.illnesses.length;
    eng.advance(DAY, { allowInterrupt: false });
    expect(sim.body.illnesses.length).toBe(illnessesAfter);
  });

  it('but the ER saves you (and bills you, with a payment plan when broke)', () => {
    const { state, sim, hospital } = world('er', { cash: 50 });
    const eng = engine(state, [healthSystem]);
    eng.teleport(sim.id, hospital.id);
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'appendicitis', severity: 60 } });
    const er = eng.actionsFor(sim.id).find((a) => a.action.id === 'health:er');
    expect(er?.available).toBe(true);
    const res = eng.perform(sim.id, 'health:er');
    expect(res.ok).toBe(true);
    const app = sim.body.illnesses.find((i) => i.defId === 'appendicitis')!;
    expect(app.treated).toBe(true);
    expect(app.diagnosed).toBe(true);
    // uninsured, broke: a medical debt was created rather than a crash
    expect(sim.finance.loans.some((l) => l.kind === 'medical' && l.balance > 10000)).toBe(true);
    for (let d = 0; d < 8 && sim.body.illnesses.length; d++) eng.advance(DAY, { allowInterrupt: false });
    expect(sim.body.alive).toBe(true);
    expect(sim.body.illnesses.some((i) => i.defId === 'appendicitis')).toBe(false);
  });

  it('insurance math', () => {
    const none = { kind: 'none', monthlyPremium: 0, deductible: 0, deductibleMet: 0, copay: 0, coinsurance: 0 } as const;
    expect(patientShare(none, 200, 'office').patient).toBe(200);
    const employer = { kind: 'employer', monthlyPremium: 180, deductible: 1500, deductibleMet: 0, copay: 30, coinsurance: 0.2 } as const;
    expect(patientShare(employer, 200, 'office')).toEqual({ patient: 30, insurer: 170, deductibleUsed: 0 });
    expect(patientShare(employer, 250, 'preventive').patient).toBe(0);
    const er = patientShare(employer, 5000, 'er');
    expect(er.patient).toBeCloseTo(1500 + 3500 * 0.2, 2);
    expect(er.insurer).toBeCloseTo(5000 - er.patient, 2);
    expect(er.deductibleUsed).toBe(1500);
    const met = patientShare({ ...employer, deductibleMet: 1500 }, 5000, 'er');
    expect(met.patient).toBeCloseTo(1000, 2);
    expect(patientShare({ ...employer, kind: 'medicaid' }, 1200, 'er').patient).toBe(8);
    expect(patientShare({ ...employer, kind: 'medicare' }, 200, 'dental').patient).toBe(200);
  });

  it('doctor visit charges the copay, diagnoses and treats; pharmacy fills scripts', () => {
    const { state, sim, clinic, pharmacy } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem], events);
    sim.body.insurance = { kind: 'employer', monthlyPremium: 180, deductible: 1500, deductibleMet: 0, copay: 30, coinsurance: 0.2 };
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'hypertension' } });
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'strep_throat' } });
    expect(sim.body.illnesses.find((i) => i.defId === 'hypertension')!.diagnosed).toBe(false);
    eng.teleport(sim.id, clinic.id);
    const doc = eng.findAction(sim.id, 'health:see_doctor')!;
    expect(doc.cost?.amount).toBe(30);
    const cash = eng.ctx().query.liquidCash(sim);
    const res = eng.perform(sim.id, 'health:see_doctor');
    expect(res.ok).toBe(true);
    expect(res.text).toMatch(/Diagnosis/);
    expect(eng.ctx().query.liquidCash(sim)).toBeCloseTo(cash - 30, 2);
    for (const i of sim.body.illnesses) expect(i.diagnosed).toBe(true);
    expect(sim.body.illnesses.find((i) => i.defId === 'strep_throat')!.treated).toBe(true);
    expect(sim.flags['health:rx']).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'custom' && e.kind === 'health:bill')).toBe(true);

    eng.teleport(sim.id, pharmacy.id);
    const fill = eng.findAction(sim.id, 'health:fill_rx');
    expect(fill).toBeDefined();
    expect(eng.perform(sim.id, 'health:fill_rx').ok).toBe(true);
    expect(sim.inventory.consumables.prescription_meds).toBeGreaterThan(0);
    expect(sim.flags['health:rx']).toBeUndefined();
    const take = eng.findAction(sim.id, 'health:item:prescription_meds');
    expect(take).toBeDefined();
    expect(eng.perform(sim.id, 'health:item:prescription_meds').ok).toBe(true);
    expect(sim.body.illnesses.find((i) => i.defId === 'hypertension')!.treated).toBe(true);
  });

  it('medicine items are consumed and help; dental and flu shot gated correctly', () => {
    const { state, sim, dentist, pharmacy } = world();
    const eng = engine(state, [healthSystem]);
    sim.inventory.consumables.painkillers = 2;
    eng.bus.emit({ type: 'custom', kind: 'health:contract', simId: sim.id, payload: { defId: 'migraine' } });
    const sev = sim.body.illnesses[0].severity;
    sim.needs.comfort = 40;
    expect(eng.perform(sim.id, 'health:item:painkillers').ok).toBe(true);
    expect(sim.inventory.consumables.painkillers).toBe(1);
    expect(sim.body.illnesses[0].severity).toBeLessThan(sev);
    expect(sim.body.illnesses[0].treated).toBe(true);
    expect(sim.needs.comfort).toBeGreaterThan(50);

    eng.teleport(sim.id, dentist.id);
    expect(eng.findAction(sim.id, 'health:dental')).toBeDefined();
    expect(eng.perform(sim.id, 'health:dental').ok).toBe(true);
    expect(eng.findAction(sim.id, 'health:dental')).toBeUndefined(); // six-monthly

    eng.teleport(sim.id, pharmacy.id);
    expect(eng.findAction(sim.id, 'health:flu_shot')).toBeDefined(); // September = fall
    expect(eng.perform(sim.id, 'health:flu_shot').ok).toBe(true);
    expect(sim.flags['health:fluShotYear']).toBe(2026);
    expect(eng.findAction(sim.id, 'health:flu_shot')).toBeUndefined();
  });

  it('injuries heal over time and faster when treated', () => {
    const { state, sim } = world();
    const events: GameEvent[] = [];
    const eng = engine(state, [healthSystem], events);
    eng.bus.emit({ type: 'custom', kind: 'health:injury', simId: sim.id, payload: { name: 'Sprained wrist', bodyPart: 'wrist', severity: 30, days: 4 } });
    expect(sim.body.injuries.length).toBe(1);
    expect(events.some((e) => e.type === 'sim:injured')).toBe(true);
    const healsAt = sim.body.injuries[0].healsAt;
    sim.inventory.consumables.first_aid_kit = 1;
    expect(eng.perform(sim.id, 'health:item:first_aid_kit').ok).toBe(true);
    expect(sim.body.injuries[0].treated).toBe(true);
    expect(sim.body.injuries[0].healsAt).toBeLessThan(healsAt);
    eng.advance(4 * DAY, { allowInterrupt: false });
    expect(sim.body.injuries.length).toBe(0);
  });

  it('pregnancy becomes known after ~5 weeks, or via a test', () => {
    const a = world('preg-a');
    const ea = engine(a.state, [healthSystem, caretaker]);
    a.sim.body.pregnancy = { conceivedAt: a.state.time.minute, dueAt: a.state.time.minute + 280 * DAY, known: false, complications: 0 };
    for (let d = 0; d < 33; d++) ea.advance(DAY, { allowInterrupt: false });
    expect(a.sim.body.pregnancy.known).toBe(false);
    for (let d = 0; d < 4; d++) ea.advance(DAY, { allowInterrupt: false });
    expect(a.sim.body.pregnancy.known).toBe(true);
    expect(a.sim.mind.moodlets.some((m) => m.id === 'preg:tri')).toBe(true);

    const b = world('preg-b');
    const eb = engine(b.state, [healthSystem]);
    b.sim.body.pregnancy = { conceivedAt: b.state.time.minute - 12 * DAY, dueAt: b.state.time.minute + 268 * DAY, known: false, complications: 0 };
    b.sim.inventory.consumables.pregnancy_test = 1;
    expect(eb.perform(b.sim.id, 'health:item:pregnancy_test').ok).toBe(true);
    expect(b.sim.body.pregnancy.known).toBe(true);
    expect(b.sim.inventory.consumables.pregnancy_test).toBeUndefined();
  });

  it('weight follows calorie balance and addictions withdraw', () => {
    const { state, sim } = world();
    const eng = engine(state, [healthSystem, caretaker]);
    sim.lod = 'full';
    const w0 = sim.body.weight;
    sim.flags.tdee = 2000;
    sim.flags.calories_yesterday = 2000 + 7700;
    eng.advance(DAY, { allowInterrupt: false });
    expect(sim.body.weight).toBeCloseTo(w0 + 1, 1);

    eng.bus.emit({ type: 'custom', kind: 'health:nicotine', simId: sim.id, payload: { units: 20 } });
    expect(sim.body.addictions.nicotine).toBeGreaterThanOrEqual(30);
    eng.advance(2 * DAY, { allowInterrupt: false });
    expect(sim.mind.moodlets.some((m) => m.id === 'addict:nicotine')).toBe(true);
    eng.bus.emit({ type: 'custom', kind: 'health:nicotine', simId: sim.id, payload: { units: 1 } });
    expect(sim.mind.moodlets.some((m) => m.id === 'addict:nicotine')).toBe(false);
  });

  it('prolonged stress becomes burnout; therapy helps', () => {
    const { state, sim } = world();
    const eng = engine(state, [healthSystem, caretaker]);
    for (let d = 0; d < 9; d++) {
      sim.mind.stress = 95;
      eng.advance(DAY, { allowInterrupt: false });
    }
    expect(sim.body.illnesses.some((i) => i.defId === 'burnout')).toBe(true);
    expect(sim.mind.conditions).toContain('burnout');
    eng.bus.emit({ type: 'custom', kind: 'health:therapy_session', simId: sim.id });
    expect(sim.mind.therapy).toBe(true);
    expect(sim.body.illnesses.find((i) => i.defId === 'burnout')!.treated).toBe(true);
  });
});
