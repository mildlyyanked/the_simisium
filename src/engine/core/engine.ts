/**
 * The Engine: owns WorldState, runs systems on a minute clock, executes actions,
 * routes freeform/conversation through the LLM service, and exposes snapshots to the UI.
 */
import type { ContentCatalog } from '../content/types';
import type { InteractionDef } from '../content/types';
import { availableActions, evaluateAction, type ActionAvailability } from './actions';
import { clockInfo, type ClockInfo, type HolidayResolver } from './clock';
import { addMoodlet, applyEffects, DEFAULT_ENVELOPE, transact, validateEffects, type EffectContext, type ValidationEnvelope } from './effects';
import { EventBus, type GameEvent } from './events';
import { newConversationId, newEventId, shortId } from './ids';
import { adjacentFree, ensureLayout, findPath, nearestWalkable, positionOf, roomAt, walkMinutes, type Tile } from '../space';
import { quickActions, resolveIntent, type QuickAction } from './intents';
import { staffOpinion } from '../systems/social';
import { installGeneratedDilemma, installTemplateDilemma } from '../systems/story';
import type { InteractionOutcome, LLMService, SceneSnapshot } from './llmTypes';
import { makeQuery, simName } from './query';
import { RNG } from './rng';
import type { ActionResult, System, SystemContext, WorldQuery } from './systems';
import type { ActionDef, Conversation, EffectBundle, Interrupt, LogEntry, ScheduledEvent, ScheduledEventSpec, Sim, SimId, VenueId, WorldState } from './types';
import { clamp100, DAY, HOUR, round2 } from './util';

export interface EngineOptions {
  content: ContentCatalog;
  systems: System[];
  llm?: LLMService;
  holidayResolver: HolidayResolver;
  /** max minutes a single advance() may run (guards runaway loops) */
  maxAdvance?: number;
  onLog?: (entry: LogEntry) => void;
}

export interface PerformResult {
  ok: boolean;
  reason?: string;
  text?: string;
  outcomeLabel?: string;
  minutes: number;
  interrupted?: Interrupt;
  conversationId?: string;
  data?: Record<string, unknown>;
  rejected?: string[];
  llm?: InteractionOutcome;
}

export class Engine {
  state: WorldState;
  readonly content: ContentCatalog;
  readonly systems: System[];
  readonly bus = new EventBus();
  rng: RNG;
  llm?: LLMService;
  private holidayResolver: HolidayResolver;
  private lastTick: Record<string, number> = {};
  private maxAdvance: number;
  private onLog?: (entry: LogEntry) => void;
  private _clock?: ClockInfo;
  private _clockMinute = -1;
  private listeners = new Set<() => void>();
  private query: WorldQuery;
  /** actions cache per sim per minute */
  private actionsCache: { minute: number; simId: SimId; list: ActionAvailability[] } | null = null;
  private stopRequested = false;

  constructor(state: WorldState, opts: EngineOptions) {
    this.state = state;
    this.content = opts.content;
    this.systems = opts.systems;
    this.llm = opts.llm;
    this.holidayResolver = opts.holidayResolver;
    this.maxAdvance = opts.maxAdvance ?? DAY * 3;
    this.onLog = opts.onLog;
    this.rng = new RNG(state.rngState?.length === 4 ? state.rngState : state.meta.seed);
    this.query = makeQuery(this.state, this.content);
    this.bus.on((e) => this.dispatchToSystems(e));
    for (const s of this.systems) this.lastTick[s.id] = state.time.minute;
  }

  // ---------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------
  get clock(): ClockInfo {
    if (this._clockMinute !== this.state.time.minute || !this._clock) {
      this._clock = clockInfo(this.state.epoch, this.state.time.minute, this.state.region.center.lat, this.holidayResolver);
      this._clockMinute = this.state.time.minute;
    }
    return this._clock;
  }

  get now(): number {
    return this.state.time.minute;
  }

  ctx(): SystemContext {
    return {
      state: this.state,
      rng: this.rng,
      content: this.content,
      clock: this.clock,
      emit: (e) => this.bus.emit(e),
      schedule: (spec) => this.schedule(spec),
      cancelScheduled: (id) => {
        this.state.scheduled = this.state.scheduled.filter((e) => e.id !== id);
      },
      log: (entry) => this.log(entry),
      interrupt: (i) => this.pushInterrupt(i),
      applyEffects: (simId, bundle, source) => this.applyEffects(simId, bundle, source),
      query: this.query,
    };
  }

  private effectCtx(): EffectContext {
    return {
      state: this.state,
      rng: this.rng,
      content: this.content,
      emit: (e) => this.bus.emit(e),
      scheduleSpec: (spec) => this.schedule(spec),
      log: (text, kind = 'narrative', simId, importance = 1) => this.log({ text, kind, simId, importance }),
    };
  }

  applyEffects(simId: SimId, bundle: EffectBundle, source: string): void {
    applyEffects(this.effectCtx(), simId, bundle, source);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.state.rngState = this.rng.getState();
    this.state.meta.updatedAt = new Date().toISOString();
    this.actionsCache = null;
    for (const l of this.listeners) l();
  }

  log(entry: Omit<LogEntry, 'id' | 'at'> & { at?: number }): void {
    const e: LogEntry = { id: shortId(this.rng, 'log'), at: entry.at ?? this.now, ...entry } as LogEntry;
    this.state.log.push(e);
    if (this.state.log.length > 600) this.state.log.splice(0, this.state.log.length - 600);
    this.onLog?.(e);
  }

  schedule(spec: ScheduledEventSpec): string {
    const at = spec.atMinute ?? this.now + (spec.inMinutes ?? 0);
    const ev: ScheduledEvent = { id: newEventId(this.rng), atMinute: Math.max(this.now, Math.round(at)), kind: spec.kind, label: spec.label, simId: spec.simId, venueId: spec.venueId, payload: spec.payload, visible: !spec.kind.startsWith('_') };
    this.state.scheduled.push(ev);
    this.state.scheduled.sort((a, b) => a.atMinute - b.atMinute);
    return ev.id;
  }

  pushInterrupt(i: Omit<Interrupt, 'id' | 'at'>): void {
    const full: Interrupt = { id: shortId(this.rng, 'int'), at: this.now, ...i };
    this.state.pendingInterrupts.push(full);
    this.bus.emit({ type: 'interrupt', interrupt: full });
    this.stopRequested = true;
  }

  resolveInterrupt(id: string): void {
    this.state.pendingInterrupts = this.state.pendingInterrupts.filter((i) => i.id !== id);
    this.notify();
  }

  private dispatchToSystems(e: GameEvent): void {
    const ctx = this.ctx();
    for (const s of this.systems) {
      if (!s.onEvent) continue;
      try {
        s.onEvent(ctx, e);
      } catch (err) {
        this.log({ text: `[${s.id}] event error: ${(err as Error).message}`, kind: 'system', importance: 0 });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------
  /** Dilemma requests the story system posted for the model (the store drains these). */
  takeStoryRequests(): { simId: SimId; theme: string }[] {
    const out: { simId: SimId; theme: string }[] = [];
    for (const [k, v] of Object.entries(this.state.flags)) {
      if (!k.startsWith('story:request:') || typeof v !== 'string') continue;
      try {
        const req = JSON.parse(v) as { simId: SimId; theme: string };
        out.push(req);
      } catch {
        /* ignore */
      }
      delete this.state.flags[k];
    }
    return out;
  }

  /** Install a model-written dilemma (or fall back to the catalog when the model produced nothing). */
  installDilemma(simId: SimId, theme: string, generated?: import('./types').GeneratedDilemma): void {
    const sim = this.state.sims[simId];
    if (!sim) return;
    const ctx = this.ctx();
    if (generated) installGeneratedDilemma(ctx, sim, generated, theme);
    else installTemplateDilemma(ctx, sim, theme);
    this.notify();
  }

  init(isNew: boolean): void {
    this.state.flags['story:llm'] = !!this.llm?.isLive() && !!this.llm.generateDilemma;
    const ctx = this.ctx();
    for (const s of this.systems) s.onInit?.(ctx);
    this.bus.emit({ type: isNew ? 'world:new_game' : 'world:loaded' });
    this.notify();
  }

  // ---------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------
  /**
   * Advance the world by `minutes`, one minute at a time. Stops early when an interrupt is raised
   * (returns the minutes actually advanced).
   */
  advance(minutes: number, opts: { silent?: boolean; allowInterrupt?: boolean } = {}): number {
    const target = Math.min(minutes, this.maxAdvance);
    this.stopRequested = false;
    let advanced = 0;
    for (let i = 0; i < target; i++) {
      this.tickMinute();
      advanced++;
      if (opts.allowInterrupt !== false && this.stopRequested) break;
    }
    if (!opts.silent) this.notify();
    return advanced;
  }

  private tickMinute(): void {
    const s = this.state;
    s.time.minute += 1;
    const minute = s.time.minute;
    const ctx = this.ctx();

    // scheduled events
    while (s.scheduled.length && s.scheduled[0].atMinute <= minute) {
      const ev = s.scheduled.shift()!;
      this.bus.emit({ type: 'scheduled:fired', event: ev });
      if (ev.recurring) {
        s.scheduled.push({ ...ev, id: newEventId(this.rng), atMinute: ev.atMinute + ev.recurring.everyMinutes });
        s.scheduled.sort((a, b) => a.atMinute - b.atMinute);
      }
    }

    // arrivals
    for (const sim of Object.values(s.sims)) {
      if (sim.travel && sim.travel.arriveAt <= minute) {
        const t = sim.travel;
        sim.travel = undefined;
        sim.location = { venueId: t.toVenueId, arrivedAt: minute };
        if (t.vehicleId && this.state.vehicles[t.vehicleId]) this.state.vehicles[t.vehicleId].location = { venueId: t.toVenueId };
        this.spawnAtEntrance(sim);
        this.bus.emit({ type: 'transport:arrived', simId: sim.id, venueId: t.toVenueId, mode: t.mode });
        this.bus.emit({ type: 'sim:arrived', simId: sim.id, venueId: t.toVenueId });
      }
      if (sim.currentAction?.perMinute) {
        for (const [k, v] of Object.entries(sim.currentAction.perMinute)) if (typeof v === 'number') sim.needs[k as keyof Sim['needs']] = clamp100(sim.needs[k as keyof Sim['needs']] + v);
      }
      if (sim.currentAction && sim.currentAction.endsAt <= minute) {
        const a = sim.currentAction;
        sim.currentAction = undefined;
        this.bus.emit({ type: 'action:completed', simId: sim.id, actionId: a.actionId, label: a.label, targetId: a.targetId });
      }
    }

    // conversations end when someone walks out
    this.pruneConversations(minute);

    // systems
    for (const sys of this.systems) {
      if (!sys.onTick) continue;
      const last = this.lastTick[sys.id] ?? minute - 1;
      const dt = minute - last;
      if (dt >= sys.intervalMinutes) {
        this.lastTick[sys.id] = minute;
        try {
          sys.onTick(ctx, dt);
        } catch (err) {
          this.log({ text: `[${sys.id}] tick error: ${(err as Error).message}`, kind: 'system', importance: 0 });
        }
      }
    }

    this.bus.emit({ type: 'time:minute', minute });
    const mod = minute % DAY;
    if (mod % HOUR === 0) this.bus.emit({ type: 'time:hour', minute, hour: mod / HOUR });
    if (mod === 0) {
      const c = this.clock;
      s.stats.daysPlayed += 1;
      this.bus.emit({ type: 'time:day', minute, isoDate: c.isoDate });
      if (c.weekday === 1) this.bus.emit({ type: 'time:week', minute });
      if (c.day.day === 1) this.bus.emit({ type: 'time:month', minute, month: c.day.month, year: c.day.year });
      if (c.day.dayOfYear === 1) this.bus.emit({ type: 'time:year', minute, year: c.day.year });
    }
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  actionsFor(simId: SimId): ActionAvailability[] {
    if (this.actionsCache && this.actionsCache.minute === this.now && this.actionsCache.simId === simId) return this.actionsCache.list;
    const list = availableActions(this.ctx(), simId, this.systems);
    this.actionsCache = { minute: this.now, simId, list };
    return list;
  }

  findAction(simId: SimId, actionId: string): ActionDef | undefined {
    return this.actionsFor(simId).find((a) => a.action.id === actionId)?.action;
  }

  /**
   * Perform a deterministic action (object/venue/system). Freeform and conversation use the async APIs below.
   */
  perform(simId: SimId, actionId: string, params: Record<string, unknown> = {}, actionOverride?: ActionDef): PerformResult {
    const sim = this.state.sims[simId];
    if (!sim) return { ok: false, reason: 'Unknown sim', minutes: 0 };
    const action = actionOverride ?? this.findAction(simId, actionId);
    if (!action) return { ok: false, reason: 'Action not available', minutes: 0 };
    const ctx = this.ctx();
    const availability = evaluateAction(ctx, sim, action);
    if (!availability.available) return { ok: false, reason: availability.reasons.join('; '), minutes: 0 };

    // interrupt a running action
    if (sim.currentAction) {
      this.bus.emit({ type: 'action:interrupted', simId, actionId: sim.currentAction.actionId, reason: 'new action' });
      sim.currentAction = undefined;
    }

    const merged = { ...(action.params ?? {}), ...params };
    // system-owned action?
    const owner = this.systems.find((s) => s.handles?.(action.id) && s.execute);
    let result: ActionResult | void = undefined;
    if (owner) {
      try {
        result = owner.execute!(ctx, simId, action, merged);
      } catch (err) {
        this.log({ text: `[${owner.id}] execute error: ${(err as Error).message}`, kind: 'system', importance: 0 });
        return { ok: false, reason: (err as Error).message, minutes: 0 };
      }
      if (result && !result.ok) {
        this.bus.emit({ type: 'action:failed', simId, actionId: action.id, reason: result.text ?? 'failed' });
        this.notify();
        return { ok: false, reason: result.text, minutes: 0 };
      }
    }

    // charge cost
    if (action.cost && action.cost.amount > 0) {
      const tx = transact(sim, -action.cost.amount, action.cost.memo, this.now, { account: action.cost.account, category: action.cost.category ?? action.category, counterparty: action.cost.counterparty, venueId: sim.location.venueId, rng: this.rng });
      if (!tx.ok) {
        this.bus.emit({ type: 'money:insufficient', simId, amount: action.cost.amount, memo: action.cost.memo });
        return { ok: false, reason: `You can't afford $${action.cost.amount.toFixed(2)}`, minutes: 0 };
      }
      this.bus.emit({ type: 'money:transaction', simId, amount: -action.cost.amount, memo: action.cost.memo, accountId: tx.accountId!, category: action.cost.category ?? action.category });
      this.state.stats.moneySpent = round2(this.state.stats.moneySpent + action.cost.amount);
    }

    const duration = Math.max(0, Math.round(result?.durationMinutes ?? action.durationMinutes));
    const target = action.target?.id;
    const objectId = action.target?.kind === 'object' ? (action.target.id as import('./types').ObjectId) : undefined;
    const obj = objectId ? this.state.objects[objectId] : undefined;
    if (obj && obj.venueId === sim.location.venueId) this.stepToObject(sim, obj.id, this.state.player.controlledSimIds.includes(simId));

    // consume ingredients up front
    const consumes = merged.consumes as { itemId: string; qty: number }[] | undefined;
    if (consumes) {
      const hh = this.query.householdOf(simId);
      for (const c of consumes) {
        let need = c.qty;
        const own = sim.inventory.consumables[c.itemId] ?? 0;
        const take = Math.min(own, need);
        if (take) {
          sim.inventory.consumables[c.itemId] = own - take;
          if (sim.inventory.consumables[c.itemId] === 0) delete sim.inventory.consumables[c.itemId];
        }
        need -= take;
        if (need > 0 && hh) {
          const p = hh.pantry[c.itemId] ?? 0;
          hh.pantry[c.itemId] = Math.max(0, p - need);
          if (hh.pantry[c.itemId] === 0) delete hh.pantry[c.itemId];
        }
      }
    }
    if (obj) {
      const sets = merged.setsState as { on?: boolean; occupied?: boolean } | undefined;
      if (sets?.on !== undefined) obj.state.on = sets.on;
      if (sets?.occupied) obj.state.occupiedBy = simId;
      this.bus.emit({ type: 'object:used', simId, objectId: obj.id, interactionId: String(merged.interactionId ?? action.id) });
    }

    sim.currentAction = { actionId: action.id, label: action.label, startedAt: this.now, endsAt: this.now + duration, targetId: target, interruptible: action.interruptible !== false, perMinute: action.effects.perMinute };
    this.bus.emit({ type: 'action:started', simId, action });
    this.state.stats.actionsTaken += 1;

    // run time
    let interrupted: Interrupt | undefined;
    const before = this.state.pendingInterrupts.length;
    const advanced = duration > 0 ? this.advance(duration, { silent: true }) : 0;
    if (this.state.pendingInterrupts.length > before && advanced < duration) {
      interrupted = this.state.pendingInterrupts[this.state.pendingInterrupts.length - 1];
      interrupted.interruptedActionId = action.id;
    }
    const completed = !interrupted && sim.currentAction?.actionId === action.id ? false : true; // tick loop cleared currentAction on completion
    if (sim.currentAction?.actionId === action.id) {
      // duration 0 or interrupted: finalize now
      sim.currentAction = undefined;
      if (!interrupted) this.bus.emit({ type: 'action:completed', simId, actionId: action.id, label: action.label, targetId: target });
    }
    void completed;

    // outcomes & completion effects (scaled if interrupted)
    const fraction = duration > 0 ? advanced / duration : 1;
    let outcomeLabel: string | undefined;
    let text = result?.text;
    const effects: EffectBundle = { ...action.effects };
    delete effects.perMinute;
    if (!interrupted || fraction >= 0.5) {
      if (action.outcomes && action.outcomes.outcomes.length) {
        const rolled = this.rng.weighted(
          action.outcomes.outcomes.map((o) => ({
            weight: o.weight + (o.skillId ? (sim.skills[o.skillId]?.level ?? 0) * (o.skillBias ?? 0) : 0),
            value: o,
          })),
        );
        outcomeLabel = rolled.label;
        this.applyEffects(simId, rolled.effects, `${action.id}:outcome`);
      }
      if (result?.effects) this.applyEffects(simId, result.effects, `${action.id}:system`);
      this.applyEffects(simId, scaleEffects(effects, interrupted ? fraction : 1), action.id);
      const produces = merged.produces as { itemId: string; qty: number }[] | undefined;
      if (produces) this.applyEffects(simId, { items: produces.map((p) => ({ op: 'gain', itemId: p.itemId, qty: p.qty })) }, `${action.id}:produce`);
    }
    if (obj) {
      if (obj.state.occupiedBy === simId) obj.state.occupiedBy = undefined;
      const dirty = Number(merged.dirtiesBy ?? 0);
      const wear = Number(merged.wearBy ?? 0);
      if (dirty) obj.state.dirty = clamp100((obj.state.dirty ?? 0) + dirty);
      if (wear) {
        obj.state.condition = clamp100(obj.state.condition - wear);
        const def = this.content.objects[obj.defId];
        const breakChance = obj.state.condition < 20 ? 0.08 : obj.state.condition < 40 ? 0.02 : 0.002 / Math.max(1, obj.quality);
        if (def && this.rng.chance(breakChance)) {
          obj.state.broken = true;
          this.bus.emit({ type: 'property:broken', objectId: obj.id, venueId: obj.venueId });
          this.log({ text: `The ${obj.name ?? def.name} broke.`, kind: 'alert', simId, importance: 2 });
        }
      }
    }
    if (outcomeLabel) this.bus.emit({ type: 'action:completed', simId, actionId: action.id, label: action.label, outcomeLabel, targetId: target });
    this.notify();
    return { ok: true, text, outcomeLabel, minutes: advanced, interrupted, conversationId: result?.conversationId, data: result?.data };
  }

  /** Wait / pass time deliberately. */
  wait(minutes: number): PerformResult {
    const advanced = this.advance(minutes);
    const interrupted = this.state.pendingInterrupts[this.state.pendingInterrupts.length - 1];
    return { ok: true, minutes: advanced, interrupted: advanced < minutes ? interrupted : undefined };
  }

  // ---------------------------------------------------------------------
  // LLM-driven interactions
  // ---------------------------------------------------------------------
  scene(simId: SimId, conversationId?: string): SceneSnapshot {
    const actor = this.query.sim(simId);
    const venue = this.query.venue(actor.location.venueId);
    const present = this.query.simsAt(venue.id).filter((s) => s.id !== simId);
    const conversation = conversationId ? this.state.conversations[conversationId as import('./types').ConversationId] : undefined;
    this.layoutOf(venue.id);
    return { state: this.state, actor, venue, present, conversation };
  }

  envelopeFor(simId: SimId, overrides: Partial<ValidationEnvelope> = {}): ValidationEnvelope {
    const actor = this.query.sim(simId);
    const present = new Set(this.query.simsAt(actor.location.venueId).map((s) => s.id));
    return { ...DEFAULT_ENVELOPE, presentSimIds: present, ...overrides };
  }

  /** Keep the phones' message threads in step with a text-channel conversation. */
  private mirrorText(from: SimId, to: SimId, text: string, read = false): void {
    const a = this.state.sims[from];
    const b = this.state.sims[to];
    if (!a || !b) return;
    const msg = { id: shortId(this.rng, 'msg'), from, to, at: this.now, text: text.slice(0, 500), read };
    (a.phone.threads[to] ||= []).push({ ...msg, read: true });
    (b.phone.threads[from] ||= []).push({ ...msg, read: read || b.id === this.state.player.activeSimId });
    for (const [s, key] of [[a, to], [b, from]] as const) {
      const t = s.phone.threads[key];
      if (t.length > 100) t.splice(0, t.length - 100);
    }
    if (!a.phone.contacts.includes(to)) a.phone.contacts.push(to);
    if (!b.phone.contacts.includes(from)) b.phone.contacts.push(from);
  }

  startConversation(simId: SimId, otherIds: SimId[], channel: Conversation['channel'] = 'in_person', topic?: string): Conversation {
    const actor = this.query.sim(simId);
    const existing = Object.values(this.state.conversations).find((c) => c.active && c.participantIds.includes(simId) && otherIds.every((o) => c.participantIds.includes(o)) && c.channel === channel);
    if (existing) return existing;
    if (channel === 'in_person' && this.state.player.controlledSimIds.includes(simId)) {
      const other = otherIds.map((o) => this.state.sims[o]).find((o) => o && o.location.venueId === actor.location.venueId);
      if (other) this.walkToSim(simId, other.id);
    }
    const conv: Conversation = { id: newConversationId(this.rng), participantIds: [simId, ...otherIds], venueId: actor.location.venueId, startedAt: this.now, lastTurnAt: this.now, turns: [], channel, active: true, topic };
    this.state.conversations[conv.id] = conv;
    this.state.stats.conversations += 1;
    for (const o of otherIds) {
      const other = this.state.sims[o];
      if (!other) continue;
      if (!actor.relationships[o]) {
        this.applyEffects(simId, { relationships: [{ simId: o, familiarity: 3, mutual: true }] }, 'meet');
        this.bus.emit({ type: 'sim:met', simId, otherId: o, venueId: actor.location.venueId });
        this.state.stats.simsMet += 1;
      }
    }
    this.bus.emit({ type: 'conversation:started', conversationId: conv.id, participantIds: conv.participantIds });
    // prune old inactive conversations
    const all = Object.values(this.state.conversations);
    if (all.length > 40) {
      all.sort((a, b) => a.lastTurnAt - b.lastTurnAt);
      for (const c of all.slice(0, all.length - 40)) if (!c.active) delete this.state.conversations[c.id];
    }
    this.notify();
    return conv;
  }

  /** The active in-person conversation a sim is part of, if any. */
  activeConversationOf(simId: SimId): Conversation | undefined {
    return Object.values(this.state.conversations).find((c) => c.active && c.participantIds.includes(simId));
  }

  /** In-person conversations cannot outlive co-presence: when a participant leaves the venue, it ends. */
  private pruneConversations(minute: number): void {
    for (const c of Object.values(this.state.conversations)) {
      if (!c.active || c.channel !== 'in_person') continue;
      const sims = c.participantIds.map((id) => this.state.sims[id]).filter(Boolean);
      const gone = sims.find((s) => s.travel || s.location.venueId !== c.venueId || !s.body.alive);
      if (!gone) continue;
      const controlled = sims.filter((s) => this.state.player.controlledSimIds.includes(s.id));
      const others = sims.filter((s) => s.id !== gone.id);
      const youLeft = this.state.player.controlledSimIds.includes(gone.id);
      const text = youLeft
        ? `You leave ${others.map((o) => o.identity.firstName).join(' and ')} behind mid-conversation.`
        : `${gone.identity.firstName} ${gone.currentAction?.label ? `has to go (${gone.currentAction.label.toLowerCase()})` : 'has to go'}. The conversation ends.`;
      if (controlled.length) this.log({ text, kind: 'narrative', simId: controlled[0].id, venueId: c.venueId, importance: 1, meta: { source: 'conversation:left' } });
      c.active = false;
      c.lastTurnAt = minute;
      this.bus.emit({ type: 'conversation:ended', conversationId: c.id });
    }
  }

  /**
   * End a conversation on purpose because the player is about to do something else: the
   * partner gets a parting line (live model) or a plain wrap-up (offline), then it closes.
   */
  async wrapUpConversation(simId: SimId, conversationId: string, reason: string): Promise<void> {
    const conv = this.state.conversations[conversationId as import('./types').ConversationId];
    if (!conv || !conv.active) return;
    const others = conv.participantIds.filter((p) => p !== simId).map((p) => this.state.sims[p]).filter(Boolean);
    const names = others.map((o) => o.identity.firstName).join(' and ');
    if (this.llm && this.llm.isLive() && others.length) {
      try {
        const scene = this.scene(simId, conversationId);
        const text = `(wrapping up: ${reason.replace(/\s*\(.*\)$/, '').toLowerCase()}) I should get going.`;
        conv.turns.push({ speakerId: simId, text, at: this.now });
        this.log({ text: `You wrap things up with ${names}: ${reason.replace(/\s*\(.*\)$/, '').toLowerCase()}.`, kind: 'narrative', simId, venueId: conv.venueId, importance: 1 });
        const outcome = await this.llm.converse(scene, others[0].id, text, { channel: conv.channel });
        outcome.endsConversation = true;
        this.applyOutcome(simId, outcome, conv, 'conversation');
      } catch {
        /* fall through to the plain wrap-up */
      }
    }
    if (conv.active) {
      this.log({ text: `You wrap things up with ${names} and ${reason ? reason.replace(/\s*\(.*\)$/, '').toLowerCase() : 'move on'}.`, kind: 'narrative', simId, venueId: conv.venueId, importance: 1 });
      for (const o of others) this.applyEffects(simId, { relationships: [{ simId: o.id, familiarity: 1, mutual: true }] }, 'conversation:wrapup');
      this.endConversation(conversationId);
    }
  }

  endConversation(conversationId: string): void {
    const c = this.state.conversations[conversationId as import('./types').ConversationId];
    if (!c) return;
    c.active = false;
    this.bus.emit({ type: 'conversation:ended', conversationId });
    this.notify();
  }

  /** Ensure NPC bio exists (async, LLM or fallback). */
  async ensureBio(simId: SimId): Promise<void> {
    const sim = this.state.sims[simId];
    if (!sim || sim.bio.generated || !this.llm) return;
    const res = await this.llm.generateBio(this.state, sim);
    sim.bio.summary = res.summary;
    sim.bio.facts = res.facts;
    sim.bio.generated = true;
    sim.bio.generatedBy = res.by;
    this.bus.emit({ type: 'bio:generated', simId, by: res.by });
    this.notify();
  }

  async say(simId: SimId, conversationId: string, text: string): Promise<PerformResult> {
    const conv = this.state.conversations[conversationId as import('./types').ConversationId];
    if (!conv || !conv.active) return { ok: false, reason: 'No active conversation', minutes: 0 };
    const targets = conv.participantIds.filter((p) => p !== simId);
    for (const t of targets) await this.ensureBio(t);
    const scene = this.scene(simId, conversationId);
    conv.turns.push({ speakerId: simId, text, at: this.now });
    if (conv.channel === 'text') for (const t of targets) this.mirrorText(simId, t, text);
    this.log({ text, kind: 'dialogue', simId, speakerId: simId, venueId: conv.venueId, importance: 1 });
    this.bus.emit({ type: 'conversation:turn', conversationId, speakerId: simId, text });
    if (!this.llm) return { ok: false, reason: 'LLM not configured', minutes: 0 };
    let outcome: InteractionOutcome;
    try {
      outcome = await this.llm.converse(scene, targets[0], text, { channel: conv.channel });
    } catch (err) {
      this.bus.emit({ type: 'llm:error', task: 'dialogue', error: (err as Error).message });
      return { ok: false, reason: `The conversation stalled (${(err as Error).message})`, minutes: 0 };
    }
    return this.applyOutcome(simId, outcome, conv, 'conversation');
  }

  async freeform(simId: SimId, text: string): Promise<PerformResult> {
    const sim = this.state.sims[simId];
    if (!sim) return { ok: false, reason: 'Unknown sim', minutes: 0 };
    if (!this.llm) return { ok: false, reason: 'LLM not configured', minutes: 0 };
    const presentNow = this.query.simsAt(sim.location.venueId).filter((p) => p.id !== simId);
    const intent = resolveIntent(this.state, sim, this.actionsFor(simId), text, presentNow);
    if (intent) {
      this.log({ text: `You: ${text}`, kind: 'narrative', simId, venueId: sim.location.venueId, importance: 1, meta: { intent: intent.via } });
      if (intent.actionId === 'system:noop') {
        this.log({ text: intent.label, kind: 'narrative', simId, venueId: sim.location.venueId, importance: 1 });
        this.notify();
        return { ok: true, text: intent.label, minutes: 0 };
      }
      if (intent.actionId === 'system:wait') {
        const r = this.wait(intent.waitMinutes ?? 30);
        return { ...r, text: intent.label };
      }
      const r = this.perform(simId, intent.actionId, intent.params);
      if (r.ok) {
        const done = r.text ?? `${intent.label.replace(/\s*\(.*\)$/, '')}.`;
        this.log({ text: done.charAt(0).toUpperCase() + done.slice(1), kind: 'narrative', simId, venueId: sim.location.venueId, importance: 1, meta: { intent: intent.via } });
        this.notify();
        return { ...r, text: done, data: { ...(r.data ?? {}), intent: intent.via } };
      }
      this.log({ text: r.reason ?? 'That didn’t work.', kind: 'narrative', simId, venueId: sim.location.venueId, importance: 1 });
      return r;
    }
    for (const p of presentNow) if (!p.bio.generated && sim.relationships[p.id]) await this.ensureBio(p.id);
    const scene = this.scene(simId);
    this.log({ text: `You try: ${text}`, kind: 'narrative', simId, venueId: sim.location.venueId, importance: 1 });
    let outcome: InteractionOutcome;
    try {
      outcome = await this.llm.adjudicate(scene, text);
    } catch (err) {
      this.bus.emit({ type: 'llm:error', task: 'adjudicate', error: (err as Error).message });
      return { ok: false, reason: `Nothing happens (${(err as Error).message})`, minutes: 0 };
    }
    let conv: Conversation | undefined;
    const target = outcome.startConversationWith;
    if (target && target !== simId && this.state.sims[target] && this.query.simsAt(sim.location.venueId).some((p) => p.id === target)) {
      conv = this.startConversation(simId, [target], 'in_person');
      conv.turns.push({ speakerId: simId, text, at: this.now });
    }
    return this.applyOutcome(simId, outcome, conv, conv ? 'conversation' : 'freeform');
  }

  /** Validate + apply an LLM outcome; advance time; log narration & dialogue. */
  applyOutcome(simId: SimId, outcome: InteractionOutcome, conv: Conversation | undefined, source: string): PerformResult {
    const sim = this.state.sims[simId];
    if (!sim) return { ok: false, reason: 'Unknown sim', minutes: 0 };
    const env = this.envelopeFor(simId, { allowMoveTo: source === 'freeform' });
    if (conv) for (const pid of conv.participantIds) if (pid !== simId) env.presentSimIds.add(pid);
    if (outcome.fallback && this.llm?.isLive()) {
      const why = this.llm.lastError?.message ?? 'unknown error';
      this.log({ text: `(The narrator stumbled: ${why.slice(0, 220)}. This turn used the offline fallback.)`, kind: 'system', simId, venueId: sim.location.venueId, importance: 1, meta: { source: 'llm:fallback' } });
    }
    const { bundle, rejected } = validateEffects(outcome.effects ?? {}, env, this.state, simId);
    const allRejected = [...rejected, ...(outcome.rejected ?? [])];
    // time first, so effects land at the right minute
    const minutes = Math.max(0, Math.min(env.maxTimeElapsed, Math.round(outcome.minutes ?? bundle.timeElapsedMinutes ?? 5)));
    const advanced = minutes > 0 ? this.advance(minutes, { silent: true }) : 0;

    if (outcome.narration) this.log({ text: outcome.narration, kind: 'llm', simId, venueId: sim.location.venueId, importance: 2, meta: { source } });
    for (const d of outcome.dialogue ?? []) {
      if (d.speakerId === simId) continue; // player's own words already logged
      this.log({ text: d.text, kind: 'dialogue', simId, speakerId: d.speakerId === 'narrator' ? undefined : d.speakerId, venueId: sim.location.venueId, importance: 1, meta: { emotion: d.emotion } });
      if (conv) {
        conv.turns.push({ speakerId: d.speakerId, text: d.text, at: this.now });
        if (conv.channel === 'text' && d.speakerId !== 'narrator') this.mirrorText(d.speakerId, simId, d.text, true);
        this.bus.emit({ type: 'conversation:turn', conversationId: conv.id, speakerId: d.speakerId, text: d.text });
      }
    }
    if (conv) conv.lastTurnAt = this.now;

    this.applyEffects(simId, bundle, source);
    for (const [otherId, other] of Object.entries(outcome.otherEffects ?? {})) {
      if (!this.state.sims[otherId as SimId]) continue;
      const v = validateEffects(other, { ...env, presentSimIds: new Set([...env.presentSimIds, simId]) }, this.state, otherId as SimId);
      this.applyEffects(otherId as SimId, v.bundle, `${source}:other`);
      allRejected.push(...v.rejected.map((r) => `${otherId}: ${r}`));
    }
    if (outcome.revealedFacts?.length) this.applyEffects(simId, { revealFacts: outcome.revealedFacts.map((r) => ({ simId: r.simId, factIds: r.factIds, to: simId })) }, `${source}:reveal`);
    for (const m of outcome.npcMemories ?? []) {
      const npc = this.state.sims[m.simId];
      if (!npc) continue;
      if (this.state.player.controlledSimIds.includes(simId)) {
        const venue = this.state.venues[sim.location.venueId];
        if (venue) staffOpinion(this.state, venue, npc.id, sim, m.valence ?? 0, this.now);
      }
      npc.memory.push({ id: shortId(this.rng, 'mem'), kind: 'conversation', at: this.now, text: m.text.slice(0, 400), participants: [simId], venueId: npc.location.venueId, salience: clamp100(m.salience ?? 40), valence: Math.max(-1, Math.min(1, m.valence ?? 0)), tags: [source] });
    }
    // the actor remembers too
    if (outcome.narration) {
      const others = (outcome.dialogue ?? []).map((d) => d.speakerId).filter((s): s is SimId => s !== 'narrator' && s !== simId);
      sim.memory.push({ id: shortId(this.rng, 'mem'), kind: conv ? 'conversation' : 'event', at: this.now, text: outcome.narration.slice(0, 300), participants: [...new Set(others)], venueId: sim.location.venueId, salience: 35, valence: 0, tags: [source] });
    }
    if (allRejected.length) this.bus.emit({ type: 'llm:rejected_effects', simId, rejected: allRejected });
    if (outcome.usage) {
      this.state.meta.llmCalls += 1;
      this.state.meta.llmCostUsd = round2(this.state.meta.llmCostUsd + outcome.usage.costUsd);
      this.state.meta.llmTokens += outcome.usage.tokensIn + outcome.usage.tokensOut;
    }
    if (conv && outcome.endsConversation) this.endConversation(conv.id);
    const interrupted = advanced < minutes ? this.state.pendingInterrupts[this.state.pendingInterrupts.length - 1] : undefined;
    this.notify();
    return { ok: true, text: outcome.narration, minutes: advanced, interrupted, conversationId: conv?.id, rejected: allRejected, llm: outcome, data: { followUps: outcome.followUps ?? [] } };
  }

  // ---------------------------------------------------------------------
  // Space: floor plans and walking around inside a venue
  // ---------------------------------------------------------------------
  /** Contextual one-tap actions for the composer. */
  quickActions(simId: SimId): QuickAction[] {
    const sim = this.state.sims[simId];
    if (!sim) return [];
    return quickActions(this.state, sim, this.actionsFor(simId));
  }

  /** The floor plan of a venue (generated on first use). */
  layoutOf(venueId: VenueId): import('./types').VenueLayout | undefined {
    return ensureLayout(this.state, venueId);
  }

  /** Where a sim stands inside their venue. */
  positionOf(simId: SimId): (Tile & { roomId?: string }) | undefined {
    const sim = this.state.sims[simId];
    if (!sim) return undefined;
    const layout = this.layoutOf(sim.location.venueId);
    return layout ? positionOf(this.state, layout, sim) : undefined;
  }

  roomNameOf(simId: SimId): string | undefined {
    const sim = this.state.sims[simId];
    if (!sim) return undefined;
    const layout = this.layoutOf(sim.location.venueId);
    if (!layout) return undefined;
    const p = positionOf(this.state, layout, sim);
    return layout.rooms.find((r) => r.id === p.roomId)?.name;
  }

  private spawnAtEntrance(sim: Sim): void {
    if (!this.state.player.controlledSimIds.includes(sim.id)) return;
    const layout = this.layoutOf(sim.location.venueId);
    if (!layout) return;
    const e = layout.entranceInside;
    sim.location.pos = { x: e.x, y: e.y };
    sim.location.roomId = roomAt(layout, e.x, e.y)?.id;
  }

  /** Walk a controlled sim to a tile; time passes for real walks. */
  moveTo(simId: SimId, x: number, y: number): PerformResult {
    const sim = this.state.sims[simId];
    if (!sim) return { ok: false, reason: 'Unknown sim', minutes: 0 };
    if (sim.travel) return { ok: false, reason: 'You are on the way somewhere.', minutes: 0 };
    const layout = this.layoutOf(sim.location.venueId);
    if (!layout) return { ok: false, reason: 'No floor plan here.', minutes: 0 };
    const dest = nearestWalkable(layout, x, y);
    if (!dest) return { ok: false, reason: "You can't stand there.", minutes: 0 };
    const from = positionOf(this.state, layout, sim);
    const path = findPath(layout, from, dest);
    if (!path) return { ok: false, reason: "There's no way through.", minutes: 0 };
    const fromRoom = from.roomId;
    const minutes = walkMinutes(path.length);
    if (sim.currentAction && sim.currentAction.interruptible !== false && path.length > 0) {
      this.bus.emit({ type: 'action:interrupted', simId, actionId: sim.currentAction.actionId, reason: 'walked away' });
      sim.currentAction = undefined;
    }
    sim.location.pos = { x: dest.x, y: dest.y };
    const room = roomAt(layout, dest.x, dest.y);
    sim.location.roomId = room?.id;
    const advanced = minutes > 0 ? this.advance(minutes, { silent: true }) : 0;
    if (room && room.id !== fromRoom && this.state.player.controlledSimIds.includes(simId)) this.log({ text: `You go to the ${room.name.toLowerCase()}.`, kind: 'travel', simId, venueId: sim.location.venueId, importance: 0 });
    this.notify();
    return { ok: true, minutes: advanced, text: room ? room.name : undefined };
  }

  /** Walk next to an object in the same venue. */
  walkToObject(simId: SimId, objectId: import('./types').ObjectId): PerformResult {
    const sim = this.state.sims[simId];
    const obj = this.state.objects[objectId];
    if (!sim || !obj || obj.venueId !== sim.location.venueId) return { ok: false, reason: 'Not here.', minutes: 0 };
    const layout = this.layoutOf(sim.location.venueId);
    const p = layout?.objects[objectId];
    if (!layout || !p) return { ok: false, reason: 'No floor plan here.', minutes: 0 };
    const from = positionOf(this.state, layout, sim);
    const spots = adjacentFree(layout, p.x, p.y);
    if (spots.some((t) => t.x === from.x && t.y === from.y)) return { ok: true, minutes: 0 };
    let best: { tile: Tile; len: number } | undefined;
    for (const t of spots) {
      const path = findPath(layout, from, t);
      if (path && (!best || path.length < best.len)) best = { tile: t, len: path.length };
    }
    if (!best) return { ok: false, reason: "You can't get to it.", minutes: 0 };
    return this.moveTo(simId, best.tile.x, best.tile.y);
  }

  /** Walk next to another sim in the same venue. */
  walkToSim(simId: SimId, otherId: SimId): PerformResult {
    const sim = this.state.sims[simId];
    const other = this.state.sims[otherId];
    if (!sim || !other || other.location.venueId !== sim.location.venueId) return { ok: false, reason: "They aren't here.", minutes: 0 };
    const layout = this.layoutOf(sim.location.venueId);
    if (!layout) return { ok: false, reason: 'No floor plan here.', minutes: 0 };
    const from = positionOf(this.state, layout, sim);
    const at = positionOf(this.state, layout, other);
    if (Math.abs(at.x - from.x) + Math.abs(at.y - from.y) <= 1) return { ok: true, minutes: 0 };
    const spots = adjacentFree(layout, at.x, at.y).filter((t) => !(t.x === at.x && t.y === at.y));
    let best: { tile: Tile; len: number } | undefined;
    for (const t of spots) {
      const path = findPath(layout, from, t);
      if (path && (!best || path.length < best.len)) best = { tile: t, len: path.length };
    }
    if (!best) return { ok: false, reason: "You can't get to them.", minutes: 0 };
    return this.moveTo(simId, best.tile.x, best.tile.y);
  }

  /** Stand next to an object about to be used (time passes only for the player's walks). */
  private stepToObject(sim: Sim, objectId: import('./types').ObjectId, timed: boolean): void {
    const layout = this.layoutOf(sim.location.venueId);
    const p = layout?.objects[objectId];
    if (!layout || !p) return;
    if (timed) {
      this.walkToObject(sim.id, objectId);
      return;
    }
    const spot = adjacentFree(layout, p.x, p.y)[0];
    if (spot) {
      sim.location.pos = { x: spot.x, y: spot.y };
      sim.location.roomId = roomAt(layout, spot.x, spot.y)?.id;
    }
  }

  // ---------------------------------------------------------------------
  // Player control
  // ---------------------------------------------------------------------
  setActiveSim(simId: SimId): void {
    if (!this.state.player.controlledSimIds.includes(simId)) return;
    this.state.player.activeSimId = simId;
    this.notify();
  }

  /** Move a sim instantly (used by worldgen and tests). */
  teleport(simId: SimId, venueId: VenueId): void {
    const sim = this.query.sim(simId);
    const from = sim.location.venueId;
    sim.location = { venueId, arrivedAt: this.now };
    sim.travel = undefined;
    this.spawnAtEntrance(sim);
    this.bus.emit({ type: 'sim:moved', simId, from, to: venueId });
    this.bus.emit({ type: 'sim:arrived', simId, venueId });
    this.notify();
  }

  addMoodlet(simId: SimId, spec: Parameters<typeof addMoodlet>[1]): void {
    const sim = this.query.sim(simId);
    addMoodlet(sim, spec, this.now, this.rng);
  }

  nameOf(simId: SimId): string {
    const s = this.state.sims[simId];
    return s ? simName(s) : 'someone';
  }

  /** Helper used by systems to convert an InteractionDef into an executable ActionDef for autonomy. */
  static interactionToActionDef(inter: InteractionDef, id: string, label = inter.label): ActionDef {
    return { id, label, category: inter.category, durationMinutes: inter.durationMinutes, effects: inter.effects, outcomes: inter.outcomes, requirements: inter.requirements, satisfies: inter.satisfies, autonomyWeight: inter.autonomyWeight };
  }
}

export function scaleEffects(e: EffectBundle, f: number): EffectBundle {
  if (f >= 1) return e;
  const out: EffectBundle = { ...e };
  if (e.needs) out.needs = Object.fromEntries(Object.entries(e.needs).map(([k, v]) => [k, (v ?? 0) * f]));
  if (e.skills) out.skills = Object.fromEntries(Object.entries(e.skills).map(([k, v]) => [k, (v ?? 0) * f]));
  for (const k of ['stress', 'health', 'fitness', 'weight'] as const) if (typeof e[k] === 'number') out[k] = e[k]! * f;
  if (e.relationships) out.relationships = e.relationships.map((r) => ({ ...r, friendship: r.friendship && r.friendship * f, romance: r.romance && r.romance * f, trust: r.trust && r.trust * f, familiarity: r.familiarity && r.familiarity * f }));
  return out;
}
