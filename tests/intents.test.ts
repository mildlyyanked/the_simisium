/**
 * Deterministic routing of freeform text: world interactions become the simulation's own
 * actions, speech still goes to the model, and vehicles travel with their drivers.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/core/engine';
import { CONTENT } from '../src/engine/content';
import { SYSTEMS } from '../src/engine/systems';
import { holidayResolver } from '../src/engine/systems/calendar';
import { generateWorld } from '../src/engine/gen/worldgen';
import { buildRegion } from '../src/engine/gen/region';
import { createPlacesProvider } from '../src/engine/places';
import { createLLMService } from '../src/engine/llm';
import { resolveIntent, quickActions, looksLikeSpeech } from '../src/engine/core/intents';
import type { WorldState } from '../src/engine/core/types';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({
    seed: 'intents',
    epoch: '2026-09-10',
    name: 'Intents',
    region,
    places: createPlacesProvider({}),
    household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, vehicle: 'used_car', members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] },
  });
}

describe('intent routing', () => {
  it('maps routines, work, home, waiting and travel onto deterministic actions', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const actions = engine.actionsFor(me);
    const r = (text: string) => resolveIntent(state, sim, actions, text, []);

    expect(r('take a shower')?.label).toMatch(/shower/i);
    expect(r('I want to make breakfast')?.label).toMatch(/cook|eat|make|breakfast|cereal|toast|egg|snack/i);
    expect(r('go to bed')?.label).toMatch(/sleep|bed|nap/i);
    expect(r('use the toilet')?.label).toMatch(/toilet/i);
    expect(r('wait 2 hours')).toMatchObject({ via: 'wait', waitMinutes: 120 });
    const work = r('go to my shift');
    expect(work?.via).toBe('work');
    expect(work?.actionId.startsWith('travel:')).toBe(true);
    expect(r('drive to work')?.actionId.endsWith(':drive')).toBe(true);
    expect(r('go home')?.actionId).toBe('system:noop'); // already home

    // speech and open-ended attempts fall through to the model
    expect(r('hey, how is it going?')).toBeUndefined();
    expect(r('convince the landlord to lower the rent')).toBeUndefined();
    expect(looksLikeSpeech('ask the barista about the job posting', [])).toBe(true);
  });

  it('freeform routes deterministically and the car goes where you drive it', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const carId = state.households[sim.householdId!].vehicleIds[0];
    expect(carId).toBeTruthy();
    const home = sim.location.venueId;
    const res = await engine.freeform(me, 'drive to work');
    expect(res.ok).toBe(true);
    expect(res.data?.intent).toBe('work');
    const dest = sim.travel?.toVenueId ?? sim.location.venueId;
    expect(dest).toBe(sim.career.job!.employerVenueId);
    // arrive
    engine.advance(240, { allowInterrupt: false });
    expect(sim.location.venueId).toBe(sim.career.job!.employerVenueId);
    expect(state.vehicles[carId].location.venueId).toBe(sim.career.job!.employerVenueId);
    expect(state.vehicles[carId].location.venueId).not.toBe(home);
    // and driving back is offered
    const back = engine.actionsFor(me).find((a) => a.available && a.action.id === `travel:${home}:drive`);
    expect(back).toBeDefined();
  });

  it('offers a "go to work" quick action before a shift', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const job = sim.career.job!;
    // jump to 90 minutes before the next shift
    const { minuteOfDay, weekdayAt } = await import('../src/engine/core/clock');
    for (let i = 0; i < 7 * 24; i++) {
      const day = weekdayAt(state.epoch, engine.now);
      const shift = job.shifts.find((s) => s.day === day);
      const mod = minuteOfDay(engine.now);
      if (shift && mod >= shift.start - 100 && mod < shift.start - 60) break;
      engine.advance(30, { allowInterrupt: false });
      state.pendingInterrupts = [];
    }
    const qa = quickActions(state, sim, engine.actionsFor(me));
    expect(qa.some((q) => /go to work/i.test(q.label))).toBe(true);
  });
});
