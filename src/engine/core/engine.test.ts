import { describe, expect, it } from 'vitest';
import { Engine } from './engine';
import { makeEmptyWorld, makeHousehold, makeSim, makeVenue } from './factories';
import { RNG } from './rng';
import type { ActionDef } from './types';
import { CONTENT } from '../content';
import type { System } from './systems';

function world() {
  const rng = new RNG('test');
  const state = makeEmptyWorld({ seed: 'test', epoch: '2026-09-10' });
  const home = makeVenue({ name: 'Home', archetype: 'home', location: state.region.center, rng, rooms: ['Kitchen', 'Bedroom'] });
  state.venues[home.id] = home;
  const sim = makeSim({ firstName: 'Ada', lastName: 'Lee', gender: 'female', age: 28, epoch: state.epoch, rng, venueId: home.id, isPlayerControlled: true, startingCash: 1000 });
  state.sims[sim.id] = sim;
  const hh = makeHousehold({ name: 'Lee', simIds: [sim.id], homeVenueId: home.id, rng });
  state.households[hh.id] = hh;
  sim.householdId = hh.id;
  state.player = { householdId: hh.id, activeSimId: sim.id, controlledSimIds: [sim.id], favorites: [], tutorial: {} };
  return { state, sim, home, hh };
}

describe('Engine kernel', () => {
  it('advances time and fires day events', () => {
    const { state } = world();
    const seen: string[] = [];
    const sys: System = { id: 'calendar', intervalMinutes: 60, onEvent: (_c, e) => seen.push(e.type) };
    const eng = new Engine(state, { content: CONTENT, systems: [sys], holidayResolver: () => [] });
    eng.init(true);
    const advanced = eng.advance(1440);
    expect(advanced).toBe(1440);
    expect(state.time.minute).toBe(8 * 60 + 1440);
    expect(seen).toContain('time:day');
    expect(seen.filter((t) => t === 'time:hour').length).toBe(24);
  });

  it('performs an action with cost, duration and effects', () => {
    const { state, sim } = world();
    const eng = new Engine(state, { content: CONTENT, systems: [], holidayResolver: () => [] });
    eng.init(true);
    const action: ActionDef = {
      id: 'test:eat',
      label: 'Eat',
      category: 'needs',
      durationMinutes: 30,
      cost: { amount: 12.5, memo: 'Lunch' },
      effects: { needs: { hunger: 30 }, perMinute: { fun: 0.1 } },
    };
    sim.needs.hunger = 40;
    sim.needs.fun = 50;
    const before = state.time.minute;
    const res = eng.perform(sim.id, action.id, {}, action);
    expect(res.ok).toBe(true);
    expect(res.minutes).toBe(30);
    expect(state.time.minute - before).toBe(30);
    expect(sim.needs.hunger).toBeCloseTo(70, 5);
    expect(sim.needs.fun).toBeCloseTo(53, 5);
    const cash = sim.finance.accounts.reduce((s, a) => s + (a.kind === 'credit_card' ? -a.balance : a.balance), 0);
    expect(cash).toBeCloseTo(987.5, 2);
    expect(sim.finance.transactions.length).toBe(1);
  });

  it('rejects unaffordable actions', () => {
    const { state, sim } = world();
    const eng = new Engine(state, { content: CONTENT, systems: [], holidayResolver: () => [] });
    const action: ActionDef = { id: 'test:buy', label: 'Buy car', category: 'shop', durationMinutes: 5, cost: { amount: 50000, memo: 'car' }, requirements: [{ kind: 'money', reason: 'Too expensive', params: { amount: 50000 } }], effects: {} };
    const res = eng.perform(sim.id, action.id, {}, action);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Too expensive');
  });

  it('interrupts an action and scales effects', () => {
    const { state, sim } = world();
    const sys: System = {
      id: 'needs',
      intervalMinutes: 1,
      onTick: (ctx) => {
        if (ctx.state.time.minute === 8 * 60 + 10) ctx.interrupt({ kind: 'phone_call', title: 'Call', body: 'Mom is calling', options: [] });
      },
    };
    const eng = new Engine(state, { content: CONTENT, systems: [sys], holidayResolver: () => [] });
    const action: ActionDef = { id: 'test:nap', label: 'Nap', category: 'needs', durationMinutes: 60, effects: { needs: { energy: 40 } } };
    sim.needs.energy = 20;
    const res = eng.perform(sim.id, action.id, {}, action);
    expect(res.ok).toBe(true);
    expect(res.interrupted?.kind).toBe('phone_call');
    expect(res.minutes).toBe(10);
    // less than half complete → no completion effects
    expect(sim.needs.energy).toBe(20);
    expect(state.pendingInterrupts.length).toBe(1);
  });

  it('serializes deterministically with seeded rng', () => {
    const a = world();
    const b = world();
    const ea = new Engine(a.state, { content: CONTENT, systems: [], holidayResolver: () => [] });
    const eb = new Engine(b.state, { content: CONTENT, systems: [], holidayResolver: () => [] });
    ea.advance(100);
    eb.advance(100);
    expect(ea.rng.next()).toBe(eb.rng.next());
  });
});
