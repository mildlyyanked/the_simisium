/**
 * Floor plans: deterministic, connected, objects inside their rooms; walking costs time and
 * using an object puts you next to it.
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
import { generateLayout, findPath, floorTilesOf, positionOf, cellAt, roomAt } from '../src/engine/space';
import type { ObjectId, WorldState } from '../src/engine/core/types';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({
    seed: 'space',
    epoch: '2026-09-10',
    name: 'Space',
    region,
    places: createPlacesProvider({}),
    household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] },
  });
}

describe('floor plans', () => {
  it('are deterministic, fully connected, and keep objects in their rooms', async () => {
    const state = await world();
    let checked = 0;
    for (const venue of Object.values(state.venues)) {
      const a = generateLayout(venue, state.objects);
      const b = generateLayout(venue, state.objects);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      // every room reachable from the entrance
      for (const room of a.rooms) {
        const tiles = floorTilesOf(a, room);
        expect(tiles.length).toBeGreaterThan(0);
        expect(findPath(a, a.entranceInside, tiles[0])).toBeDefined();
      }
      // every object of the venue has a tile inside its own room
      for (const oid of venue.objectIds) {
        const o = state.objects[oid];
        if (!o || o.carriedBy) continue;
        const p = a.objects[oid];
        expect(p).toBeDefined();
        const room = roomAt(a, p.x, p.y)!;
        const wanted = a.rooms.find((r) => r.id === o.roomId) ?? a.rooms[0];
        expect(room.id).toBe(wanted.id);
        expect(cellAt(a, p.x, p.y)).toBe('object');
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('let the player walk between rooms and stand next to what they use', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const layout = engine.layoutOf(state.sims[me].location.venueId)!;
    const start = engine.positionOf(me)!;
    expect(start.roomId).toBe(layout.rooms[0].id);
    // walk to the last room
    const far = layout.rooms[layout.rooms.length - 1];
    const tile = floorTilesOf(layout, far)[0];
    const t0 = engine.now;
    const res = engine.moveTo(me, tile.x, tile.y);
    expect(res.ok).toBe(true);
    expect(engine.positionOf(me)!.roomId).toBe(far.id);
    expect(engine.now - t0).toBe(res.minutes);
    // using an object puts you next to it
    const oid = Object.keys(layout.objects)[0] as ObjectId;
    const actions = engine.actionsFor(me).filter((a) => a.available && a.action.target?.kind === 'object' && a.action.target.id === oid);
    if (actions.length) {
      engine.perform(me, actions[0].action.id);
      const p = engine.positionOf(me)!;
      const o = layout.objects[oid];
      expect(Math.abs(p.x - o.x) + Math.abs(p.y - o.y)).toBe(1);
    }
    // NPCs have stable spots
    const npc = Object.values(state.sims).find((s) => s.id !== me)!;
    const l2 = engine.layoutOf(npc.location.venueId)!;
    const p1 = positionOf(state, l2, npc);
    const p2 = positionOf(state, l2, npc);
    expect(p1).toEqual(p2);
  });
});
