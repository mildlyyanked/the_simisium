/**
 * Live LLMService over OpenRouter: builds scene context → prompts → structured completion →
 * zod parse → coercion into a safe InteractionOutcome. Every method falls back to the
 * deterministic FallbackLLMService on any error and marks the result `fallback: true`.
 */
import type { ContentCatalog } from '../content/types';
import type { HolidayResolver } from '../core/clock';
import type { InteractionOutcome, LLMService, LLMTask, LLMUsage, PartialReply, SceneSnapshot } from '../core/llmTypes';
import { RNG } from '../core/rng';
import type { ActionDef, BioFact, Conversation, EffectBundle, GeneratedDilemma, Sim, SimId, Venue, WorldState } from '../core/types';
import { hashKey, OpenRouterClient, type ChatMessage, type LLMConfig } from './client';
import { buildSceneContext, type SceneContext } from './context';
import { FallbackLLMService } from './fallback';
import * as adjudicatePrompt from './prompts/adjudicate';
import * as bioPrompt from './prompts/bio';
import * as dialoguePrompt from './prompts/dialogue';
import * as directorPrompt from './prompts/director';
import * as narratePrompt from './prompts/narrate';
import * as npcMessagePrompt from './prompts/npcMessage';
import { portraitPrompt } from './prompts/portrait';
import * as dilemmaPrompt from './prompts/dilemma';
import * as summarizePrompt from './prompts/summarize';
import { BioSchema, DilemmaSchema, DilemmaWireSchema, DirectorSchema, InteractionOutcomeSchema, InteractionOutcomeWireSchema, NpcMessageSchema, normalizeOutcomeShape, partialReply, toJsonSchema, type InteractionOutcomeOut } from './schemas';

export interface OpenRouterServiceOptions extends LLMConfig {
  content: ContentCatalog;
  fetchImpl?: typeof fetch;
  onUsage?: (u: LLMUsage) => void;
  /** called whenever a live call failed and the fallback path was used */
  onError?: (task: LLMTask, error: Error) => void;
  holidayResolver?: HolidayResolver;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
}

const OUTCOME_SCHEMA = { name: 'interaction_outcome', schema: toJsonSchema(InteractionOutcomeWireSchema) };
const BIO_JSON_SCHEMA = { name: 'npc_bio', schema: toJsonSchema(BioSchema) };
const DIRECTOR_JSON_SCHEMA = { name: 'story_beats', schema: toJsonSchema(DirectorSchema) };
const NPC_MESSAGE_JSON_SCHEMA = { name: 'npc_message', schema: toJsonSchema(NpcMessageSchema) };
const DILEMMA_JSON_SCHEMA = { name: 'dilemma', schema: toJsonSchema(DilemmaWireSchema) };

export class OpenRouterLLMService implements LLMService {
  readonly client: OpenRouterClient;
  readonly fallback: FallbackLLMService;
  private readonly content: ContentCatalog;
  private readonly onUsage?: (u: LLMUsage) => void;
  private readonly onError?: (task: LLMTask, error: Error) => void;
  private readonly holidayResolver?: HolidayResolver;
  lastError?: { task: LLMTask; message: string; at: number };

  constructor(opts: OpenRouterServiceOptions) {
    const { content, fetchImpl, onUsage, onError, holidayResolver, sleep, ...config } = opts;
    this.client = new OpenRouterClient(config, { fetchImpl, sleep });
    this.fallback = new FallbackLLMService(content);
    this.content = content;
    this.onUsage = onUsage;
    this.onError = onError;
    this.holidayResolver = holidayResolver;
  }

  isLive(): boolean {
    return this.client.hasKey;
  }

  private report(usage: LLMUsage): void {
    try {
      this.onUsage?.(usage);
    } catch {
      /* listeners must not break the game */
    }
  }

  private failed(task: LLMTask, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.lastError = { task, message: e.message, at: Date.now() };
    try {
      this.onError?.(task, e);
    } catch {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------------
  /** Stream the reply to the player as it is written, one growing line at a time. */
  private previewer(onPartial?: (p: PartialReply) => void): ((textSoFar: string) => void) | undefined {
    if (!onPartial) return undefined;
    let last = '';
    return (textSoFar: string) => {
      const p = partialReply(textSoFar);
      const key = p ? `${p.kind}:${p.speakerId ?? ''}:${p.text}` : '';
      if (key === last) return;
      last = key;
      if (p) onPartial(p);
    };
  }

  async converse(scene: SceneSnapshot, targetId: SimId, playerText: string, opts: { channel?: Conversation['channel']; onPartial?: (p: PartialReply) => void } = {}): Promise<InteractionOutcome> {
    try {
      const ctx = buildSceneContext(scene, { content: this.content, primaryId: targetId, channel: opts.channel, holidayResolver: this.holidayResolver, allowMoveTo: false });
      const messages: ChatMessage[] = [
        { role: 'system', content: dialoguePrompt.system(ctx) },
        { role: 'user', content: dialoguePrompt.user(ctx, playerText) },
      ];
      const started = Date.now();
      let res = await this.client.complete('dialogue', messages, { schema: OUTCOME_SCHEMA, onDelta: this.previewer(opts.onPartial) });
      let parsed = InteractionOutcomeSchema.safeParse(normalizeOutcomeShape(res.json));
      if (!parsed.success) throw new Error(`dialogue: response did not match schema (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      let outcome = coerceOutcome(parsed.data, scene, ctx, targetId, 'dialogue');
      this.report(res.usage);
      const target = scene.state.sims[targetId];
      const answered = outcome.dialogue.some((d) => d.speakerId === targetId);
      if (!answered && !outcome.endsConversation && target && Date.now() - started < 20_000) {
        // one corrective pass (only while the turn is still quick): the addressed NPC has to speak, or the model must say why not
        const retry: ChatMessage[] = [...messages, { role: 'assistant', content: res.text.slice(0, 4000) }, { role: 'user', content: `That response had no line from ${target.identity.firstName} (speakerId "${targetId}"). Rewrite the same turn so ${target.identity.firstName} actually answers ${ctx.conversation?.channel === 'text' ? 'by text' : 'out loud'} in "dialogue" (short is fine), or, if they truly cannot respond right now, say exactly why in one sentence of narration. JSON only.` }];
        const res2 = await this.client.complete('dialogue', retry, { schema: OUTCOME_SCHEMA, maxTokens: 700, onDelta: this.previewer(opts.onPartial) });
        const parsed2 = InteractionOutcomeSchema.safeParse(normalizeOutcomeShape(res2.json));
        if (parsed2.success) {
          const o2 = coerceOutcome(parsed2.data, scene, ctx, targetId, 'dialogue');
          this.report(res2.usage);
          if (o2.dialogue.some((d) => d.speakerId === targetId) || o2.narration) {
            outcome = o2;
            res = res2;
          }
        }
      }
      outcome.usage = res.usage;
      return outcome;
    } catch (err) {
      this.failed('dialogue', err);
      const fb = await this.fallback.converse(scene, targetId, playerText, opts);
      fb.fallback = true;
      return fb;
    }
  }

  async adjudicate(scene: SceneSnapshot, text: string, opts: { action?: ActionDef; onPartial?: (p: PartialReply) => void } = {}): Promise<InteractionOutcome> {
    try {
      const ctx = buildSceneContext(scene, { content: this.content, holidayResolver: this.holidayResolver, allowMoveTo: true });
      const messages: ChatMessage[] = [
        { role: 'system', content: adjudicatePrompt.system(ctx) },
        { role: 'user', content: adjudicatePrompt.user(ctx, text, opts.action) },
      ];
      const res = await this.client.complete('adjudicate', messages, { schema: OUTCOME_SCHEMA, onDelta: this.previewer(opts.onPartial) });
      const parsed = InteractionOutcomeSchema.safeParse(normalizeOutcomeShape(res.json));
      if (!parsed.success) throw new Error(`adjudicate: response did not match schema (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      const outcome = coerceOutcome(parsed.data, scene, ctx, undefined, 'adjudicate');
      outcome.usage = res.usage;
      this.report(res.usage);
      return outcome;
    } catch (err) {
      this.failed('adjudicate', err);
      const fb = await this.fallback.adjudicate(scene, text, opts);
      fb.fallback = true;
      return fb;
    }
  }

  async narrate(scene: SceneSnapshot, action: ActionDef, outcomeLabel?: string): Promise<string> {
    try {
      const ctx = buildSceneContext(scene, { content: this.content, holidayResolver: this.holidayResolver, maxNpcs: 3 });
      const messages: ChatMessage[] = [
        { role: 'system', content: narratePrompt.system() },
        { role: 'user', content: narratePrompt.user(ctx, action, outcomeLabel) },
      ];
      const res = await this.client.complete('narrate', messages, { cache: true });
      this.report(res.usage);
      const text = cleanProse(res.text);
      if (!text) throw new Error('narrate: empty response');
      return text;
    } catch (err) {
      this.failed('narrate', err);
      return this.fallback.narrate(scene, action, outcomeLabel);
    }
  }

  async generateBio(state: WorldState, sim: Sim): Promise<{ summary: string; facts: BioFact[]; by: 'llm' | 'fallback' }> {
    try {
      const seedRng = new RNG(`bio-temp:${sim.bio.seed}`);
      const temperature = Math.round((0.7 + seedRng.next() * 0.25) * 100) / 100;
      const messages: ChatMessage[] = [
        { role: 'system', content: bioPrompt.system() },
        { role: 'user', content: bioPrompt.user(state, sim, this.content) },
      ];
      const res = await this.client.complete('bio', messages, { schema: BIO_JSON_SCHEMA, temperature });
      const parsed = BioSchema.safeParse(res.json);
      if (!parsed.success) throw new Error(`bio: response did not match schema (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      this.report(res.usage);
      const idBase = hashKey(sim.bio.seed);
      const facts: BioFact[] = parsed.data.facts
        .filter((f) => typeof f.text === 'string' && f.text.trim().length > 0)
        .slice(0, 24)
        .map((f, i) => ({
          id: `bf_${idBase}_${i.toString(36)}`,
          category: f.category,
          text: f.text.trim().slice(0, 400),
          secret: !!f.secret,
          depth: Math.round(Math.max(0, Math.min(100, Number.isFinite(f.depth) ? f.depth : f.secret ? 70 : 20))),
          revealedTo: [],
        }))
        .map((f) => (f.secret && f.depth < 55 ? { ...f, depth: 60 } : f));
      const summary = parsed.data.summary.trim();
      if (facts.length < 10 || summary.length < 60) throw new Error(`bio: too thin (${facts.length} facts)`);
      return { summary, facts, by: 'llm' };
    } catch (err) {
      this.failed('bio', err);
      return this.fallback.generateBio(state, sim);
    }
  }

  async summarizeMemories(sim: Sim, texts: string[]): Promise<string> {
    if (!texts.length) return '';
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: summarizePrompt.system() },
        { role: 'user', content: summarizePrompt.user(sim, texts) },
      ];
      const res = await this.client.complete('summarize', messages, {});
      this.report(res.usage);
      const text = cleanProse(res.text);
      if (!text) throw new Error('summarize: empty response');
      return text;
    } catch (err) {
      this.failed('summarize', err);
      return this.fallback.summarizeMemories(sim, texts);
    }
  }

  async describeVenue(state: WorldState, venue: Venue): Promise<string> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: narratePrompt.venueSystem() },
        { role: 'user', content: narratePrompt.venueUser(state, venue, this.content.archetypes[venue.archetype]?.llmHint) },
      ];
      const res = await this.client.complete('narrate', messages, { cache: true });
      this.report(res.usage);
      const text = cleanProse(res.text);
      if (!text) throw new Error('describeVenue: empty response');
      return text;
    } catch (err) {
      this.failed('narrate', err);
      return this.fallback.describeVenue(state, venue);
    }
  }

  async npcMessage(state: WorldState, from: Sim, to: Sim, reason: string): Promise<string> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: npcMessagePrompt.system() },
        { role: 'user', content: npcMessagePrompt.user(state, from, to, reason, this.content) },
      ];
      const res = await this.client.complete('dialogue', messages, { schema: NPC_MESSAGE_JSON_SCHEMA, maxTokens: 200 });
      const parsed = NpcMessageSchema.safeParse(res.json);
      if (!parsed.success) throw new Error('npcMessage: response did not match schema');
      this.report(res.usage);
      const text = parsed.data.text.trim().slice(0, 400);
      if (!text) throw new Error('npcMessage: empty');
      return text;
    } catch (err) {
      this.failed('dialogue', err);
      return this.fallback.npcMessage(state, from, to, reason);
    }
  }

  async generateDilemma(state: WorldState, sim: Sim, opts: { theme?: string } = {}): Promise<GeneratedDilemma | undefined> {
    try {
      const liquidCash = sim.finance.accounts.filter((a) => a.kind === 'cash' || a.kind === 'checking' || a.kind === 'savings').reduce((s, a) => s + a.balance, 0);
      const messages: ChatMessage[] = [
        { role: 'system', content: dilemmaPrompt.system() },
        { role: 'user', content: dilemmaPrompt.user(state, sim, this.content, { theme: opts.theme, liquidCash }) },
      ];
      const res = await this.client.complete('director', messages, { schema: DILEMMA_JSON_SCHEMA, maxTokens: 2200, temperature: 0.85 });
      const parsed = DilemmaSchema.safeParse(res.json);
      if (!parsed.success) throw new Error(`dilemma: response did not match schema (${parsed.error.issues[0]?.message ?? 'unknown'})`);
      this.report(res.usage);
      const raw = parsed.data;
      // resolve people: ids as given, or first/full names among the people this sim knows
      const known = Object.keys(sim.relationships).map((id) => state.sims[id as SimId]).filter(Boolean);
      const byName = new Map<string, SimId>();
      for (const k of known) {
        byName.set(k.identity.firstName.toLowerCase(), k.id);
        byName.set(`${k.identity.firstName} ${k.identity.lastName}`.toLowerCase(), k.id);
      }
      const resolve = (id: string): SimId | undefined => (state.sims[id as SimId] ? (id as SimId) : byName.get(id.trim().toLowerCase().replace(/^@/, '')));
      const fixBundle = (b: EffectBundle | undefined, allowActorTarget: boolean): EffectBundle => {
        const out: EffectBundle = { ...(b ?? {}) };
        delete out.moveTo;
        delete out.schedule;
        if (out.relationships) out.relationships = out.relationships.map((r) => ({ ...r, simId: (r.simId === sim.id && allowActorTarget ? sim.id : resolve(r.simId)) as SimId, mutual: false })).filter((r) => !!r.simId);
        if (out.money && !out.money.memo) out.money.memo = 'A decision';
        return out;
      };
      const fixOthers = (o: Record<string, EffectBundle> | undefined): Record<SimId, EffectBundle> | undefined => {
        if (!o) return undefined;
        const out: Record<SimId, EffectBundle> = {};
        for (const [k, v] of Object.entries(o)) {
          const id = resolve(k);
          if (!id || id === sim.id || !v) continue;
          const b = fixBundle(v as EffectBundle, true);
          delete b.money;
          delete b.items;
          delete b.legal;
          // their feelings are about the player
          if (b.relationships) b.relationships = b.relationships.map((r) => ({ ...r, simId: sim.id, mutual: false }));
          out[id] = b;
        }
        return Object.keys(out).length ? out : undefined;
      };
      const actors = new Set<SimId>();
      const options = raw.options
        .filter((o) => o && o.label)
        .slice(0, 4)
        .map((o, i) => {
          const others = fixOthers(o.otherEffects as Record<string, EffectBundle> | undefined);
          for (const id of Object.keys(others ?? {})) actors.add(id as SimId);
          const followUps = (o.followUps ?? []).slice(0, 3).map((f) => ({ inDays: Math.round(Math.max(1, Math.min(60, f.inDays))), chance: Math.max(0.05, Math.min(1, f.chance)), text: f.text.trim().slice(0, 500), effects: fixBundle(f.effects as EffectBundle | undefined, false), otherEffects: fixOthers(f.otherEffects as Record<string, EffectBundle> | undefined) }));
          return {
            id: (o.id ?? `opt${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 24) || `opt${i + 1}`,
            label: o.label.trim().slice(0, 60),
            hint: o.hint?.trim().slice(0, 80),
            consequence: { narration: (o.narration ?? '').trim().slice(0, 600), effects: fixBundle(o.effects as EffectBundle | undefined, false), otherEffects: others, flags: (o.flags ?? []).map((f) => f.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40)).filter(Boolean).slice(0, 2), followUps },
          };
        });
      if (options.length < 2) throw new Error('dilemma: fewer than two options');
      const ids = new Set(options.map((o) => o.id));
      const dflt = raw.defaultOptionId && ids.has(raw.defaultOptionId.toLowerCase()) ? raw.defaultOptionId.toLowerCase() : options[options.length - 1].id;
      return {
        title: raw.title.trim().slice(0, 80),
        body: raw.body.trim().slice(0, 700),
        deadlineHours: Math.round(Math.max(4, Math.min(120, raw.deadlineHours))),
        defaultOptionId: dflt,
        options,
        actors: [...actors],
      };
    } catch (err) {
      this.failed('director', err);
      return undefined;
    }
  }

  async generatePortrait(state: WorldState, sim: Sim): Promise<{ dataUrl: string; usage: LLMUsage }> {
    const model = this.client.config.imageModel || 'google/gemini-2.5-flash-image';
    const res = await this.client.generateImage(portraitPrompt(state, sim), model);
    this.report(res.usage);
    return { dataUrl: res.dataUrl, usage: res.usage };
  }

  async direct(state: WorldState): Promise<{ beats: { label: string; simId?: SimId; inMinutes: number; kind: string; payload?: Record<string, unknown> }[] }> {
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: directorPrompt.system() },
        { role: 'user', content: directorPrompt.user(state, this.content) },
      ];
      const res = await this.client.complete('director', messages, { schema: DIRECTOR_JSON_SCHEMA });
      const parsed = DirectorSchema.safeParse(res.json);
      if (!parsed.success) throw new Error('director: response did not match schema');
      this.report(res.usage);
      const controlled = new Set(state.player.controlledSimIds);
      const beats = parsed.data.beats
        .filter((b) => b.label && b.payload?.text)
        .slice(0, 4)
        .map((b) => ({
          label: b.label.slice(0, 80),
          simId: b.simId && controlled.has(b.simId as SimId) ? (b.simId as SimId) : state.player.activeSimId,
          inMinutes: Math.round(Math.max(60, Math.min(10080, Number.isFinite(b.inMinutes) ? b.inMinutes : 1440))),
          kind: 'story_beat',
          payload: { text: b.payload!.text.slice(0, 600), options: (b.payload!.options ?? []).slice(0, 3) },
        }));
      if (!beats.length) throw new Error('director: no beats');
      return { beats };
    } catch (err) {
      this.failed('director', err);
      return this.fallback.direct(state);
    }
  }
}

// ---------------------------------------------------------------------------
// Coercion: model output → safe InteractionOutcome (the engine validates effects again)
// ---------------------------------------------------------------------------
export function coerceOutcome(raw: InteractionOutcomeOut, scene: SceneSnapshot, ctx: SceneContext, primaryId: SimId | undefined, task: 'dialogue' | 'adjudicate'): InteractionOutcome {
  const { actor, state } = scene;
  const present = new Map<SimId, Sim>();
  for (const s of scene.present) present.set(s.id, s);
  for (const pid of scene.conversation?.participantIds ?? []) if (pid !== actor.id && state.sims[pid]) present.set(pid, state.sims[pid]);
  const validIds = new Set<string>([actor.id, ...present.keys()]);
  const byName = new Map<string, SimId>();
  for (const s of [actor, ...scene.present]) {
    byName.set(s.identity.firstName.toLowerCase(), s.id);
    byName.set(`${s.identity.firstName} ${s.identity.lastName}`.toLowerCase(), s.id);
    if (s.identity.nickname) byName.set(s.identity.nickname.toLowerCase(), s.id);
  }
  const resolveId = (id: unknown, allowActor: boolean): SimId | undefined => {
    if (typeof id !== 'string') return undefined;
    const t = id.trim();
    if (validIds.has(t) && (allowActor || t !== actor.id)) return t as SimId;
    const byN = byName.get(t.toLowerCase().replace(/^@/, ''));
    if (byN && (allowActor || byN !== actor.id)) return byN;
    // partial id (model truncated "sim_abc…")
    for (const v of validIds) if ((allowActor || v !== actor.id) && (v.startsWith(t) || t.startsWith(v))) return v as SimId;
    return undefined;
  };
  const fallbackSpeaker: SimId | 'narrator' = primaryId && validIds.has(primaryId) ? primaryId : 'narrator';

  const dialogue = (raw.dialogue ?? [])
    .filter((d): d is NonNullable<typeof d> => !!d && typeof d.text === 'string' && !!d.text.trim())
    .slice(0, 8)
    .map((d) => {
      const sid = d.speakerId === 'narrator' ? 'narrator' : (resolveId(d.speakerId, true) ?? fallbackSpeaker);
      return { speakerId: sid, text: d.text.trim().slice(0, 600), emotion: d.emotion ? String(d.emotion).toLowerCase().replace(/\s+/g, '_') : undefined };
    });

  const fixRelationships = (b: EffectBundle, allowActorTarget: boolean): void => {
    if (!b.relationships) return;
    b.relationships = b.relationships
      .map((r) => ({ ...r, simId: resolveId(r.simId, allowActorTarget) }))
      .filter((r): r is typeof r & { simId: SimId } => !!r.simId)
      .map((r) => ({ ...r, mutual: false }));
  };
  const effects = (raw.effects ?? {}) as EffectBundle;
  fixRelationships(effects, false);
  if (task === 'dialogue') {
    delete effects.moveTo;
  } else if (effects.moveTo && !state.venues[effects.moveTo.venueId]) {
    const wanted = String(effects.moveTo.venueId).toLowerCase();
    const found = ctx.venue.knownVenues.find((v) => v.name.toLowerCase() === wanted || v.id.startsWith(wanted));
    if (found) effects.moveTo = { venueId: found.id };
    else delete effects.moveTo;
  }
  if (effects.money && !effects.money.memo) effects.money.memo = task === 'dialogue' ? 'Exchange' : 'Freeform action';

  const otherEffects: Record<SimId, EffectBundle> = {};
  for (const [k, v] of Object.entries(raw.otherEffects ?? {})) {
    const id = resolveId(k, false);
    if (!id || !v) continue;
    const b = v as EffectBundle;
    fixRelationships(b, true);
    delete b.moveTo;
    delete b.money;
    delete b.items;
    delete b.legal;
    delete b.schedule;
    otherEffects[id] = b;
  }

  const revealedFacts = (raw.revealedFacts ?? [])
    .map((r) => {
      const id = resolveId(r.simId, false);
      const npc = id ? present.get(id) : undefined;
      if (!npc) return undefined;
      const ids = (r.factIds ?? []).filter((fid) => typeof fid === 'string' && npc.bio.facts.some((f) => f.id === fid));
      return ids.length ? { simId: id!, factIds: [...new Set(ids)] } : undefined;
    })
    .filter((x): x is { simId: SimId; factIds: string[] } => !!x);

  const npcMemories = (raw.npcMemories ?? [])
    .map((m) => {
      const id = resolveId(m.simId, false);
      if (!id || typeof m.text !== 'string' || !m.text.trim()) return undefined;
      return { simId: id, text: m.text.trim().slice(0, 400), salience: clampNum(m.salience, 0, 100, 40), valence: clampNum(m.valence, -1, 1, 0) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 4);

  const followUps = [...new Set((raw.followUps ?? []).filter((f) => typeof f === 'string').map((f) => f.trim().replace(/^["'“”]+|["'“”]+$/g, '')).filter(Boolean))].slice(0, 3);
  const startWith = task === 'adjudicate' && !scene.conversation ? resolveId(raw.startConversationWith, false) : undefined;
  const startConversationWith = startWith && scene.present.some((p) => p.id === startWith) ? startWith : undefined;

  const maxMinutes = task === 'dialogue' ? 120 : ctx.rules.maxTimeElapsed;
  const minutesRaw = Number.isFinite(raw.minutes) ? (raw.minutes as number) : Number.isFinite(effects.timeElapsedMinutes) ? (effects.timeElapsedMinutes as number) : 5;
  const minutes = Math.round(Math.max(1, Math.min(maxMinutes, minutesRaw)));
  if (task === 'adjudicate' && effects.timeElapsedMinutes === undefined) effects.timeElapsedMinutes = minutes;

  return {
    narration: typeof raw.narration === 'string' ? raw.narration.trim().slice(0, 1200) : '',
    dialogue,
    effects,
    otherEffects: Object.keys(otherEffects).length ? otherEffects : undefined,
    revealedFacts,
    npcMemories,
    followUps,
    endsConversation: raw.endsConversation === true,
    startConversationWith,
    minutes,
    fallback: false,
  };
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dflt;
}

function cleanProse(text: string): string {
  let t = text.trim();
  // models sometimes wrap plain text in JSON or quotes anyway
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { text?: string; narration?: string };
      t = (j.text ?? j.narration ?? '').trim();
    } catch {
      /* keep as is */
    }
  }
  t = t.replace(/^```[a-z]*\s*|\s*```$/g, '').replace(/^["“]+|["”]+$/g, '').trim();
  return t.slice(0, 800);
}
