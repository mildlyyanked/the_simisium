/**
 * Conversation lifecycle: it ends when a participant leaves the venue, NPCs stay put while
 * talking to the player, and a deliberate wrap-up closes it with a line and a small bond.
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
import { closeTruncatedJson, extractJson } from '../src/engine/llm/schemas';
import type { WorldState } from '../src/engine/core/types';

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({ seed: 'conv', epoch: '2026-09-10', name: 'Conv', region, places: createPlacesProvider({}), household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] } });
}

describe('conversations', () => {
  it('end when the other person leaves, and a wrap-up closes them cleanly', async () => {
    const state = await world();
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: createLLMService({ content: CONTENT }), holidayResolver });
    engine.init(true);
    const me = state.player.activeSimId;
    const q = engine.ctx().query;
    const venue = Object.values(state.venues).find((v) => q.simsAt(v.id).some((s) => s.id !== me))!;
    engine.teleport(me, venue.id);
    const other = q.simsAt(venue.id).find((s) => s.id !== me)!;
    const conv = engine.startConversation(me, [other.id], 'in_person');
    expect(conv.active).toBe(true);
    // the partner walks out
    engine.teleport(other.id, state.sims[me].location.venueId === venue.id ? Object.keys(state.venues).find((id) => id !== venue.id)! as never : venue.id);
    engine.advance(1, { allowInterrupt: false });
    expect(conv.active).toBe(false);
    expect(state.log.some((l) => l.meta?.source === 'conversation:left')).toBe(true);

    // a deliberate wrap-up
    const other2 = q.simsAt(venue.id).find((s) => s.id !== me) ?? other;
    engine.teleport(other2.id, venue.id);
    const conv2 = engine.startConversation(me, [other2.id], 'in_person');
    const before = state.sims[me].relationships[other2.id]?.familiarity ?? 0;
    await engine.wrapUpConversation(me, conv2.id, 'Order a coffee');
    expect(conv2.active).toBe(false);
    expect(state.log.some((l) => /wrap things up/i.test(l.text))).toBe(true);
    expect(state.sims[me].relationships[other2.id].familiarity).toBeGreaterThan(before);
  });

  it('recovers a reply that was cut off by max_tokens', () => {
    const cut = '{"narration": "She looks up from the register.", "dialogue": [{"speakerId": "sim_a", "text": "Hey, what can I get';
    const closed = closeTruncatedJson(cut);
    const v = extractJson(cut) as { narration: string; dialogue: { text: string }[] } | undefined;
    expect(JSON.parse(closed)).toBeTruthy();
    expect(v?.narration).toContain('register');
    expect(v?.dialogue?.[0]?.text).toContain('what can I get');
  });
});
