/**
 * Looking places up: the map's type-ahead reaches past the seeded venues, and a picked result
 * becomes a real, furnished, staffed venue the sim can travel to. Empty conversations just close.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/core/engine';
import { CONTENT } from '../src/engine/content';
import { SYSTEMS } from '../src/engine/systems';
import { holidayResolver } from '../src/engine/systems/calendar';
import { generateWorld, venueForPlace } from '../src/engine/gen/worldgen';
import { buildRegion } from '../src/engine/gen/region';
import { createPlacesProvider } from '../src/engine/places';
import { createLLMService } from '../src/engine/llm';
import type { WorldState } from '../src/engine/core/types';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({ seed: 'lookup', epoch: '2026-09-10', name: 'Lookup', region, places: createPlacesProvider({}), maxVenues: 30, household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] } });
}

describe('looking places up', () => {
  it('brings a searched place into the world once, furnished and staffed, and travel to it opens up', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const places = createPlacesProvider({});
    const known = new Set(Object.values(state.venues).map((v) => v.google?.placeId).filter(Boolean));
    // a fixture the seeded world (capped at 30 venues) does not have
    const preds = (await places.autocomplete('the', state.region.center)).filter((p) => !known.has(p.placeId) && !p.placeId.startsWith('city:'));
    expect(preds.length).toBeGreaterThan(0);
    const details = await places.details(preds[0].placeId);
    const count = Object.keys(state.venues).length;
    const venue = engine.addPlace(details);
    expect(Object.keys(state.venues).length).toBe(count + 1);
    expect(venue.discovered).toBe(true);
    expect(venue.google?.placeId).toBe(details.placeId);
    expect(venue.objectIds.length).toBeGreaterThan(0);
    expect(venue.staffSimIds.length).toBeGreaterThan(0);
    expect(venueForPlace(state, details.placeId)?.id).toBe(venue.id);
    expect(state.placesCache[details.placeId]).toBeDefined();
    expect(state.log.some((l) => l.text.startsWith(`You look up ${venue.name}`))).toBe(true);
    // looking it up again returns the same venue
    expect(engine.addPlace(details).id).toBe(venue.id);
    expect(Object.keys(state.venues).length).toBe(count + 1);
    // and it can be travelled to
    const me = state.player.activeSimId;
    expect(engine.actionsFor(me).some((a) => a.action.id.startsWith(`travel:${venue.id}:`))).toBe(true);
    expect(engine.layoutOf(venue.id)).toBeDefined();
  }, 60_000);

  it('closes a conversation with no turns without a wrap-up line', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const q = engine.ctx().query;
    const venue = Object.values(state.venues).find((v) => q.simsAt(v.id).some((s) => s.id !== me))!;
    engine.teleport(me, venue.id);
    const other = q.simsAt(venue.id).find((s) => s.id !== me)!;
    const conv = engine.startConversation(me, [other.id], 'in_person');
    const logBefore = state.log.length;
    const famBefore = state.sims[me].relationships[other.id]?.familiarity ?? 0;
    await engine.wrapUpConversation(me, conv.id, 'Order a coffee');
    expect(conv.active).toBe(false);
    expect(state.log.slice(logBefore).some((l) => /wrap things up/i.test(l.text))).toBe(false);
    expect(state.sims[me].relationships[other.id]?.familiarity ?? 0).toBe(famBefore);
  }, 60_000);
});
