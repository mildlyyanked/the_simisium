/**
 * Live-service behaviour with a fake OpenRouter: remote text partners get a voice, the NPC is
 * made to answer, malformed JSON is tolerated, and speech to a present NPC opens a conversation.
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
import { InteractionOutcomeSchema, normalizeOutcomeShape } from '../src/engine/llm/schemas';
import type { SimId, WorldState } from '../src/engine/core/types';

type Reply = (body: { messages: { role: string; content: string }[] }) => unknown;

function fakeFetch(replies: Reply[], calls: { body: { messages: { role: string; content: string }[] } }[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] };
    calls.push({ body });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const content = JSON.stringify(reply(body));
    const payload = { model: 'fake/model', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), headers: { get: () => null } } as unknown as Response;
  }) as typeof fetch;
}

async function world(): Promise<WorldState> {
  const region = buildRegion({ name: 'Austin', state: 'Texas', stateCode: 'TX', center: { lat: 30.2672, lng: -97.7431 } });
  return generateWorld({
    seed: 'llm-live',
    epoch: '2026-09-10',
    name: 'LLM',
    region,
    places: createPlacesProvider({}),
    household: { name: 'Hayes', residence: 'room', startingCash: 2500, members: [{ firstName: 'Amir', lastName: 'Hayes', gender: 'male', age: 27, traits: ['ambitious', 'outgoing'], careerId: 'barista' }] },
  });
}

describe('lenient outcome parsing', () => {
  it('normalizes aliases and numeric strings, and drops malformed entries instead of failing', () => {
    const raw = {
      narrative: 'You wave.',
      lines: [{ speaker: 'sim_x', line: 'Hey.' }, 'ambient', { nonsense: true }],
      effects: { needs: { social: '+4' }, moodlets: [{ emotion: 'happy', label: 'Seen', intensity: '3', durationMinutes: 'soon' }, { bad: 1 }] },
      timeMinutes: '3',
      startConversation: { simId: 'sim_x' },
    };
    const parsed = InteractionOutcomeSchema.safeParse(normalizeOutcomeShape(raw));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.narration).toBe('You wave.');
    expect(parsed.data.dialogue?.map((d) => d.speakerId)).toEqual(['sim_x', 'narrator']);
    expect(parsed.data.effects?.needs?.social).toBe(4);
    expect(parsed.data.effects?.moodlets?.length).toBe(1);
    expect(parsed.data.effects?.moodlets?.[0].durationMinutes).toBe(60);
    expect(parsed.data.minutes).toBe(3);
    expect(parsed.data.startConversationWith).toBe('sim_x');
  });
});

describe('live conversations', () => {
  it('gives a text-message partner who is elsewhere a voice, and makes them answer', async () => {
    const state = await world();
    const me = state.player.activeSimId;
    const other = Object.values(state.sims).find((s) => s.id !== me && s.location.venueId !== state.sims[me].location.venueId && s.body.alive)!;
    const calls: { body: { messages: { role: string; content: string }[] } }[] = [];
    const llm = new OpenRouterLLMService({
      apiKey: 'test',
      content: CONTENT,
      retryBaseMs: 0,
      fetchImpl: fakeFetch(
        [
          () => ({ narration: 'Your phone sits dark on the desk.', dialogue: [], minutes: 2 }),
          () => ({ narration: '', dialogue: [{ speakerId: other.id, text: 'lol what', emotion: 'amused' }], minutes: 2, followUps: ['a', 'b', 'c'] }),
        ],
        calls,
      ),
    });
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm, holidayResolver });
    engine.init(true);
    other.bio.generated = true; // skip the bio call so the fake replies line up with the dialogue turn
    const conv = engine.startConversation(me, [other.id], 'text');
    const res = await engine.say(me, conv.id, 'yo how are you');
    expect(res.ok).toBe(true);
    // the prompt told the model the partner is not here
    const sys = calls[0].body.messages[0].content + calls[0].body.messages[1].content;
    expect(sys).toContain('NOT in the same place');
    expect(sys).toContain(other.id);
    // the corrective second pass ran and the partner's line survived coercion
    expect(calls.length).toBe(2);
    const npcLines = conv.turns.filter((t) => t.speakerId === other.id);
    expect(npcLines.map((t) => t.text)).toEqual(['lol what']);
    expect(res.llm?.fallback).toBe(false);
  });

  it('opens a conversation when the player speaks to someone present', async () => {
    const state = await world();
    const me = state.player.activeSimId;
    const q = { simsAt: (v: string) => Object.values(state.sims).filter((s) => s.location.venueId === v && s.body.alive) };
    const venue = Object.values(state.venues).find((v) => q.simsAt(v.id).some((s) => s.id !== me))!;
    const calls: { body: { messages: { role: string; content: string }[] } }[] = [];
    let targetId: SimId | undefined;
    const llm = new OpenRouterLLMService({
      apiKey: 'test',
      content: CONTENT,
      retryBaseMs: 0,
      fetchImpl: fakeFetch(
        [
          (body) => {
            const m = /Present sim ids you may reference: ([^\n]+)/.exec(body.messages[1].content);
            targetId = m![1].split(',').map((s) => s.trim()).find((id) => id !== me) as SimId;
            return { narration: 'They look up.', dialogue: [{ speakerId: targetId, text: 'Hey, what can I get you?' }], startConversationWith: targetId, minutes: 1 };
          },
        ],
        calls,
      ),
    });
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm, holidayResolver });
    engine.init(true);
    engine.teleport(me, venue.id);
    const res = await engine.freeform(me, 'Hello');
    expect(res.ok).toBe(true);
    expect(res.conversationId).toBeTruthy();
    const conv = state.conversations[res.conversationId as keyof typeof state.conversations];
    expect(conv.active).toBe(true);
    expect(conv.participantIds).toContain(targetId);
    expect(conv.turns.map((t) => t.text)).toEqual(['Hello', 'Hey, what can I get you?']);
  });

  it('tells the player when the live model failed and the fallback answered', async () => {
    const state = await world();
    const me = state.player.activeSimId;
    const llm = new OpenRouterLLMService({
      apiKey: 'test',
      content: CONTENT,
      retryBaseMs: 0,
      maxRetries: 0,
      fetchImpl: (async () => ({ ok: false, status: 500, text: async () => 'boom', headers: { get: () => null } }) as unknown as Response) as typeof fetch,
    });
    const engine = new Engine(state, { content: CONTENT, systems: SYSTEMS, llm, holidayResolver });
    engine.init(true);
    const res = await engine.freeform(me, 'Look around');
    expect(res.ok).toBe(true);
    expect(res.llm?.fallback).toBe(true);
    const note = state.log.find((l) => l.meta?.source === 'llm:fallback');
    expect(note?.text).toContain('narrator stumbled');
    expect(note?.text).toContain('500');
  });
});
