/**
 * Immersion systems: dilemmas with clocks, city news with real effects, venue standing and
 * bans, the social feed, and relationship milestones.
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
import { DILEMMA_TEMPLATES, newsEffects, resolveDilemma } from '../src/engine/systems/story';
import { isBanned, standingLabel } from '../src/engine/systems/social';
import { estimateTravel } from '../src/engine/systems/transportUtil';
import type { Dilemma, WorldState } from '../src/engine/core/types';
import { DAY, HOUR } from '../src/engine/core/util';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({ seed: 'story', epoch: '2026-09-10', name: 'Story', region, places: createPlacesProvider({}), household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, vehicle: 'used_car', members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious', 'outgoing'], careerId: 'barista' }] } });
}

function boot(state: WorldState): Engine {
  const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
  engine.init(true);
  return engine;
}

describe('dilemmas', () => {
  it('present a choice with a clock, apply the choice, and remember it with a follow-up', async () => {
    const state = await world();
    const engine = boot(state);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const ctx = engine.ctx();
    const t = DILEMMA_TEMPLATES.find((x) => x.id === 'friend_loan')!;
    // make sure there is a friend
    const someone = Object.values(state.sims).find((s) => s.id !== me)!;
    engine.applyEffects(me, { relationships: [{ simId: someone.id, friendship: 40, familiarity: 30, mutual: true }] }, 'test');
    expect(t.condition(ctx, sim)).toBe(true);
    const setup = t.setup(ctx, sim)!;
    const friend = state.sims[setup.actors.friend];
    const d: Dilemma = { id: 'dil_test', templateId: t.id, simId: me, title: '', body: '', createdAt: engine.now, deadlineAt: engine.now + t.deadlineHours * HOUR, options: [], defaultOptionId: t.defaultOptionId, actors: setup.actors, amounts: setup.amounts };
    d.title = t.title(ctx, d);
    d.body = t.body(ctx, d);
    d.options = t.options(ctx, d);
    state.dilemmas.push(d);
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    const cashBefore = ctx.query.liquidCash(sim);
    // decide through the engine's action path
    const res = engine.perform(me, `story:decide:${d.id}:lend`);
    expect(res.ok).toBe(true);
    expect(d.resolved?.optionId).toBe('lend');
    expect(ctx.query.liquidCash(sim)).toBeLessThan(cashBefore);
    expect(sim.flags['dilemma:friend_loan:lend']).toBe(true);
    expect(state.scheduled.some((e) => e.kind === 'story:followup')).toBe(true);
    // the follow-up fires weeks later and changes the relationship one way or the other
    const trustBefore = sim.relationships[friend.id].trust;
    for (let i = 0; i < 23; i++) {
      engine.advance(DAY, { allowInterrupt: false });
      state.pendingInterrupts = [];
    }
    expect(sim.relationships[friend.id].trust).not.toBe(trustBefore);
    expect(state.log.some((l) => /pays you back|doesn't mention the money/.test(l.text))).toBe(true);
  });

  it('fall to the default when the deadline passes', async () => {
    const state = await world();
    const engine = boot(state);
    const me = state.player.activeSimId;
    const ctx = engine.ctx();
    const t = DILEMMA_TEMPLATES.find((x) => x.id === 'found_wallet')!;
    const d: Dilemma = { id: 'dil_w', templateId: t.id, simId: me, title: 'w', body: 'w', createdAt: engine.now, deadlineAt: engine.now + 2 * HOUR, options: t.options(ctx, { actors: {}, amounts: { cash: 200 } } as unknown as Dilemma), defaultOptionId: t.defaultOptionId, actors: {}, amounts: { cash: 200 } };
    state.dilemmas.push(d);
    engine.advance(4 * HOUR, { allowInterrupt: false });
    expect(d.resolved?.byDeadline).toBe(true);
    expect(d.resolved?.optionId).toBe('leave');
    void resolveDilemma;
  });
});

describe('city news', () => {
  it('changes travel for real while it lasts', async () => {
    const state = await world();
    const engine = boot(state);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const home = sim.location.venueId;
    const dest = Object.values(state.venues).find((v) => v.id !== home && v.discovered)!;
    const before = estimateTravel(state, home, dest.id, 'rideshare').cost;
    state.news.push({ id: 'n1', kind: 'transit_strike', headline: 'Strike', body: '', startedAt: engine.now, endsAt: engine.now + 2 * DAY, effects: { transitDown: true, rideshareSurge: 1.6, travelMultiplier: 1.15 } });
    expect(newsEffects(state).transitDown).toBe(true);
    expect(estimateTravel(state, home, dest.id, 'rideshare').cost).toBeGreaterThan(before);
    expect(engine.actionsFor(me).some((a) => a.action.id === `travel:${dest.id}:transit`)).toBe(false);
    engine.advance(3 * DAY, { allowInterrupt: false });
    expect(newsEffects(state).transitDown).toBeUndefined();
    expect(engine.actionsFor(me).some((a) => a.action.id === `travel:${dest.id}:transit`)).toBe(true);
  });
});

describe('standing and milestones', () => {
  it('remember regulars, ban troublemakers, and mark moments with people', async () => {
    const state = await world();
    const engine = boot(state);
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const cafe = Object.values(state.venues).find((v) => v.archetype === 'cafe' || v.archetype === 'convenience')!;
    for (let i = 0; i < 13; i++) {
      for (const k of Object.keys(sim.needs) as (keyof typeof sim.needs)[]) sim.needs[k] = 90; // keep the test subject fed
      engine.teleport(me, cafe.id);
      engine.advance(7 * HOUR, { allowInterrupt: false });
      state.pendingInterrupts = [];
      engine.teleport(me, state.households[sim.householdId!].homeVenueId);
      engine.advance(7 * HOUR, { allowInterrupt: false });
      state.pendingInterrupts = [];
    }
    expect(standingLabel(cafe, me, engine.now)).toContain('regular');
    // trouble
    engine.teleport(me, cafe.id);
    engine.bus.emit({ type: 'legal:crime_committed', simId: me, crimeId: 'shoplifting', venueId: cafe.id, witnessed: true });
    expect(isBanned(cafe, me, engine.now)).toBe(true);
    expect(engine.actionsFor(me).some((a) => a.action.id.startsWith(`travel:${cafe.id}:`))).toBe(false);
    // milestones: meeting someone is recorded, a text is recorded
    const other = Object.values(state.sims).find((s) => s.id !== me && !sim.relationships[s.id])!;
    engine.teleport(other.id, sim.location.venueId);
    engine.startConversation(me, [other.id], 'in_person');
    expect(sim.relationships[other.id].milestones?.some((m) => m.id === 'met')).toBe(true);
    (sim.phone.threads[other.id] ||= []).push({ id: 'm1', from: other.id, to: me, at: engine.now, text: 'hey', read: false });
    engine.advance(60, { allowInterrupt: false });
    expect(sim.relationships[other.id].milestones?.some((m) => m.id === 'first_text')).toBe(true);
    // the feed fills with people you know
    engine.advance(2 * DAY, { allowInterrupt: false });
    expect(state.feed.length).toBeGreaterThan(0);
    expect(state.feed.every((p) => state.sims[p.simId])).toBe(true);
  });
});
