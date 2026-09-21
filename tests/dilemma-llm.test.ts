/**
 * Model-written dilemmas: the request is posted when the model is live, the reply is coerced
 * (names → ids, bounded effects), stored consequences apply deterministically, and follow-ups fire.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/core/engine';
import { CONTENT } from '../src/engine/content';
import { SYSTEMS } from '../src/engine/systems';
import { holidayResolver } from '../src/engine/systems/calendar';
import { generateWorld } from '../src/engine/gen/worldgen';
import { buildRegion } from '../src/engine/gen/region';
import { createPlacesProvider } from '../src/engine/places';
import { OpenRouterLLMService } from '../src/engine/llm/service';
import { DAY } from '../src/engine/core/util';
import type { WorldState } from '../src/engine/core/types';

function fakeFetch(reply: (body: { messages: { role: string; content: string }[] }) => unknown, calls: { body: { messages: { role: string; content: string }[] } }[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] };
    calls.push({ body });
    const payload = { model: 'fake/model', choices: [{ message: { content: JSON.stringify(reply(body)) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), headers: { get: () => null } } as unknown as Response;
  }) as typeof fetch;
}

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({ seed: 'dilemma-llm', epoch: '2026-09-10', name: 'D', region, places: createPlacesProvider({}), household: { name: 'Hayes', residence: 'apartment', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious'], careerId: 'barista' }] } });
}

describe('model-written dilemmas', () => {
  it('are requested when the model is live, coerced safely, applied and followed up', async () => {
    const state = await world();
    const me = state.player.activeSimId;
    const sim = state.sims[me];
    const friend = Object.values(state.sims).find((s) => s.id !== me && s.body.alive)!;
    const calls: { body: { messages: { role: string; content: string }[] } }[] = [];
    const llm = new OpenRouterLLMService({
      apiKey: 'test',
      content: CONTENT,
      retryBaseMs: 0,
      fetchImpl: fakeFetch(
        () => ({
          title: `${friend.identity.firstName} needs a ride at 5 AM`,
          body: 'They have a flight and no car. You have a shift at eight.',
          deadlineHours: 12,
          defaultOptionId: 'no',
          options: [
            {
              id: 'drive',
              label: 'Drive them',
              hint: 'Lose sleep',
              narration: 'You set the alarm for 4:15.',
              effects: { needs: { energy: '-15' }, memories: [{ kind: 'event', text: 'Drove them to the airport before dawn.' }] },
              otherEffects: { [friend.identity.firstName]: { relationships: [{ simId: me, friendship: 8, trust: 6 }], memories: [{ kind: 'event', text: 'Amir drove me to the airport at 5 AM. Nobody does that.' }] } },
              flags: ['drove_friend_to_airport'],
              followUps: [{ inDays: 9, chance: 1, text: 'A postcard shows up. Just "thank you", underlined twice.', effects: { moodlets: [{ emotion: 'grateful', label: 'Postcard', intensity: 4, durationMinutes: 600 }] }, otherEffects: {} }],
            },
            { id: 'no', label: 'Say you cannot', hint: 'They will find a cab', narration: 'You send the cab company number.', effects: {}, otherEffects: { [friend.id]: { relationships: [{ simId: me, friendship: -4 }] } }, flags: [], followUps: [] },
          ],
        }),
        calls,
      ),
    });
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm, holidayResolver });
    engine.init(true);
    engine.applyEffects(me, { relationships: [{ simId: friend.id, friendship: 40, familiarity: 30, mutual: true }] }, 'test');
    expect(state.flags['story:llm']).toBe(true);
    // force a request as the story system would
    state.flags[`story:request:${me}`] = JSON.stringify({ simId: me, theme: 'friend_loan', at: engine.now });
    const reqs = engine.takeStoryRequests();
    expect(reqs).toHaveLength(1);
    const generated = await llm.generateDilemma(state, sim, { theme: reqs[0].theme });
    expect(generated).toBeDefined();
    expect(generated!.actors).toContain(friend.id); // resolved from the first name
    expect(calls[0].body.messages[1].content).toContain(friend.id); // the dossier listed them by id
    engine.installDilemma(me, reqs[0].theme, generated);
    const d = state.dilemmas[0];
    expect(d.source).toBe('llm');
    expect(state.pendingInterrupts.some((i) => i.title === d.title)).toBe(true);
    const trustBefore = friend.relationships[me]?.trust ?? 0;
    const res = engine.perform(me, `story:decide:${d.id}:drive`);
    expect(res.ok).toBe(true);
    expect(sim.flags['dilemma:drove_friend_to_airport']).toBe(true);
    expect((friend.relationships[me]?.trust ?? 0) > trustBefore).toBe(true);
    expect(friend.memory.some((m) => /airport/.test(m.text))).toBe(true);
    expect(state.scheduled.some((e) => e.kind === 'story:followup_gen')).toBe(true);
    for (let i = 0; i < 11; i++) {
      engine.advance(DAY, { allowInterrupt: false });
      state.pendingInterrupts = [];
    }
    expect(state.log.some((l) => /postcard/i.test(l.text))).toBe(true);
  });

  it('fall back to the catalog when the model produces nothing', async () => {
    const state = await world();
    const me = state.player.activeSimId;
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm: new OpenRouterLLMService({ apiKey: 'test', content: CONTENT, retryBaseMs: 0, maxRetries: 0, fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } }) as unknown as Response) as typeof fetch }), holidayResolver });
    engine.init(true);
    engine.installDilemma(me, 'found_wallet', undefined);
    expect(state.dilemmas[0]?.source).toBe('template');
  });
});
