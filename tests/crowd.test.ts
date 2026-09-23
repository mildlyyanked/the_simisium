/**
 * Crowds: a club on a Saturday night is full, a closed shop is empty, the anonymous figures are
 * stable within a half hour, picking one out makes a real person, and hiring covers roles first.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/core/engine';
import { CONTENT } from '../src/engine/content';
import { SYSTEMS } from '../src/engine/systems';
import { holidayResolver } from '../src/engine/systems/calendar';
import { addVenueFromPlace, generateWorld } from '../src/engine/gen/worldgen';
import { buildRegion } from '../src/engine/gen/region';
import { createPlacesProvider } from '../src/engine/places';
import { createLLMService } from '../src/engine/llm';
import { crowdAt, extrasAt, whereLabel } from '../src/engine/systems/crowd';
import { RNG } from '../src/engine/core/rng';
import { ageAt, weekdayAt } from '../src/engine/core/clock';
import type { GooglePlaceData, WorldState } from '../src/engine/core/types';
import { DAY, HOUR } from '../src/engine/core/util';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({ seed: 'crowd', epoch: '2026-09-10', name: 'Crowd', region, places: createPlacesProvider({}), maxVenues: 30, household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] } });
}

const CLUB: GooglePlaceData = { placeId: 'club-1', displayName: 'Exchange LA', types: ['night_club', 'bar'], primaryType: 'night_club', location: { lat: 30.268, lng: -97.74 }, rating: 4.2, priceLevel: 3 };

describe('crowds', () => {
  it('fill a club on a Saturday night and empty it on a Tuesday morning', async () => {
    const state = await world();
    const club = addVenueFromPlace(state, CONTENT, new RNG('x'), CLUB);
    expect(club.archetype).toBe('nightclub');
    // find the next Saturday 23:30 from the epoch
    let minute = 23 * HOUR + 30;
    while (weekdayAt(state.epoch, minute) !== 6) minute += DAY;
    const sat = crowdAt(state, CONTENT, club.id, minute);
    expect(sat.count).toBeGreaterThan(100);
    expect(sat.label).toBe('packed');
    let tue = 10 * HOUR;
    while (weekdayAt(state.epoch, tue) !== 2) tue += DAY;
    const morning = crowdAt(state, CONTENT, club.id, tue);
    expect(morning.count).toBeLessThan(10);
    // never below the real people standing there
    const staff = club.staffSimIds.length;
    for (const id of club.staffSimIds) state.sims[id].location = { venueId: club.id, arrivedAt: 0 };
    expect(crowdAt(state, CONTENT, club.id, tue).count).toBeGreaterThanOrEqual(staff);
  }, 60_000);

  it('place a stable anonymous crowd that shuffles every half hour and stays off objects', async () => {
    const state = await world();
    const club = addVenueFromPlace(state, CONTENT, new RNG('x'), CLUB);
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const layout = engine.layoutOf(club.id)!;
    const crowd = { count: 180, level: 0.9, label: 'packed' as const };
    const a = extrasAt(layout, crowd, [{ x: layout.entranceInside.x, y: layout.entranceInside.y }], 1000);
    const b = extrasAt(layout, crowd, [{ x: layout.entranceInside.x, y: layout.entranceInside.y }], 1010);
    const c = extrasAt(layout, crowd, [{ x: layout.entranceInside.x, y: layout.entranceInside.y }], 1040);
    expect(a.length).toBeGreaterThan(10);
    expect(a.map((e) => `${e.x},${e.y}`)).toEqual(b.map((e) => `${e.x},${e.y}`));
    expect(a.map((e) => `${e.x},${e.y}`)).not.toEqual(c.map((e) => `${e.x},${e.y}`));
    const objectTiles = new Set(Object.values(layout.objects).map((p) => `${p.x},${p.y}`));
    expect(a.every((e) => !objectTiles.has(`${e.x},${e.y}`))).toBe(true);
    expect(a.some((e) => e.x === layout.entranceInside.x && e.y === layout.entranceInside.y)).toBe(false);
    // the crowd stays out of the restrooms
    const quiet = layout.rooms.filter((r) => /rest|toilet|bath/.test(r.name.toLowerCase())).map((r) => r.id);
    expect(a.filter((e) => quiet.includes(e.roomId)).length).toBeLessThanOrEqual(2);
    expect(whereLabel(layout.rooms[0])).toMatch(/^(on|in) the /);
    expect(whereLabel({ name: 'Floor' })).toBe('on the floor');
    expect(whereLabel({ name: 'Kitchen' })).toBe('in the kitchen');
  }, 60_000);

  it('turn a figure in the crowd into a real person the player can talk to', async () => {
    const state = await world();
    const club = addVenueFromPlace(state, CONTENT, new RNG('x'), CLUB);
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    engine.teleport(me, club.id);
    const before = Object.keys(state.sims).length;
    const npc = engine.meetStranger(me, { x: 3, y: 3 })!;
    expect(npc).toBeDefined();
    expect(Object.keys(state.sims).length).toBe(before + 1);
    expect(npc.location.venueId).toBe(club.id);
    expect(npc.location.pos).toEqual({ x: 3, y: 3 });
    const age = ageAt(npc.identity.birthDate, state.epoch, state.time.minute);
    expect(age).toBeGreaterThanOrEqual(21);
    expect(age).toBeLessThanOrEqual(36);
    expect(npc.flags.transient).toBe(true);
    expect(state.sims[me].relationships[npc.id]?.familiarity ?? 0).toBeGreaterThan(0);
    expect(npc.relationships[me]).toBeDefined();
    expect(state.log.some((l) => /pick out a/.test(l.text) && l.meta?.noticedSimId === npc.id)).toBe(true);
    const conv = engine.startConversation(me, [npc.id], 'in_person');
    expect(conv.active).toBe(true);
    expect(engine.ctx().query.simsAt(club.id).some((s) => s.id === npc.id)).toBe(true);
  }, 60_000);

  it('hire one of each role before doubling up, and list nobody twice', async () => {
    const state = await world();
    const club = addVenueFromPlace(state, CONTENT, new RNG('x'), CLUB);
    expect(club.staffSimIds.length).toBe(2);
    expect(new Set(club.staffSimIds).size).toBe(2);
    const roles = club.staffSimIds.map((id) => state.sims[id].role?.role);
    expect(new Set(roles).size).toBe(2);
    for (const v of Object.values(state.venues)) expect(new Set(v.staffSimIds).size).toBe(v.staffSimIds.length);
  }, 60_000);
});
