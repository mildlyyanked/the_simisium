/**
 * Game store: the single owner of the Engine on the UI side.
 * All engine mutations go through here. Components never mutate engine.state directly.
 *
 * Rendering model: the engine notifies after every mutation → we bump `version`.
 * Selectors/hooks read `engine.state` directly (no deep copies) and re-render on `version`.
 */
import { create } from 'zustand';
import { Engine, type PerformResult } from '@engine/core/engine';
import type { ActionAvailability } from '@engine/core/actions';
import type { AvatarParams, Conversation, SimId, VenueId, WorldState } from '@engine/core/types';
import type { LLMUsage } from '@engine/core/llmTypes';
import { deserialize, saveSummary, serialize } from '@engine/core/save';
import { generateWorld } from '@engine/gen/worldgen';
import { buildEngine, buildLLM, buildPlaces } from './engineFactory';
import { deleteSaveBlob, getLastSaveId, readSaveBlob, readSaveIndex, removeFromSaveIndex, setLastSaveId, upsertSaveIndex, writeSaveBlob, type SaveIndexEntry } from './persistence';
import { useSettings } from './settings';
import { haptic } from '@/ui/haptics';

export type NewGameOptions = Parameters<typeof generateWorld>[0];
export type NewGameInput = Omit<NewGameOptions, 'places' | 'llm' | 'onProgress'> & {
  /** avatar params per household member, in `household.members` order (applied to controlled sims after worldgen) */
  avatars?: AvatarParams[];
};

export interface ToastItem {
  id: string;
  text: string;
  kind: 'error' | 'info' | 'success' | 'warning';
  at: number;
}

export interface PerformOutcome extends PerformResult {
  /** a conversation was opened as a result (UI should navigate to Live) */
  conversationOpened?: boolean;
}

export interface GameState {
  hydrated: boolean;
  engine: Engine | null;
  version: number;
  saveId: string | null;
  saves: SaveIndexEntry[];
  lastSaveId: string | null;
  busy: boolean;
  busyLabel: string;
  busySince: number;
  narrating: boolean;
  activeSimId: SimId | null;
  openConversationId: string | null;
  followUps: string[];
  recentActionIds: string[];
  errors: ToastItem[];
  genProgress: { message: string; fraction: number } | null;
  llmUsage: { calls: number; costUsd: number; tokens: number };
  lastSavedAt: number | null;
  saving: boolean;

  hydrate(): Promise<void>;
  listSaves(): Promise<SaveIndexEntry[]>;
  newGame(input: NewGameInput): Promise<string>;
  load(saveId: string): Promise<boolean>;
  save(): Promise<void>;
  deleteSave(saveId: string): Promise<void>;
  unload(): void;
  rebuildEngine(): void;

  getActions(): ActionAvailability[];
  perform(actionId: string, params?: Record<string, unknown>, opts?: { force?: boolean }): PerformOutcome | null;
  freeform(text: string): Promise<void>;
  say(conversationId: string, text: string): Promise<void>;
  wait(minutes: number): void;
  waitUntilMorning(): void;
  skipToNextEvent(): void;
  startConversation(targetId: SimId, channel?: Conversation['channel']): string | null;
  endConversation(opts?: { wrapUp?: boolean; reason?: string }): Promise<void>;
  /** an action that would end the open conversation is waiting for the player's OK */
  pendingConfirm: { title: string; body: string; confirmLabel: string; run: () => void } | null;
  cancelConfirm(): void;
  resolveInterrupt(id: string, optionActionId?: string, params?: Record<string, unknown>): void;
  switchSim(id: SimId): void;
  /** walk the active sim to a tile of the current floor plan */
  moveTo(x: number, y: number): void;
  walkToObject(objectId: string): void;
  walkToSim(simId: SimId): void;
  toggleAutonomy(id: SimId): void;
  toggleFavorite(venueId: VenueId): void;
  pushToast(text: string, kind?: ToastItem['kind']): void;
  dismissToast(id: string): void;
}

let unsubscribeEngine: (() => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastCounter = 0;

function attachEngine(engine: Engine, set: (p: Partial<GameState>) => void, get: () => GameState): void {
  unsubscribeEngine?.();
  unsubscribeEngine = engine.subscribe(() => {
    const s = get();
    set({ version: s.version + 1, activeSimId: engine.state.player.activeSimId });
    scheduleSave(get);
  });
}

/** Actions that belong to the conversation itself (talking to the partner) do not end it. */
function actionFitsConversation(action: { id: string; category?: string; target?: { kind: string; id: string } }, conv: Conversation): boolean {
  if (action.target?.kind === 'sim' && conv.participantIds.includes(action.target.id as SimId)) return true;
  if (action.id.startsWith('say') || action.id.startsWith('social:') || action.id.startsWith('romance:')) return true;
  if (conv.channel === 'text') return action.id.startsWith('phone:');
  return false;
}

const BUSY_LIMIT_MS = 90_000;
let busyTimer: ReturnType<typeof setTimeout> | null = null;
/** A model call that never resolves (app backgrounded mid-request, dead socket) must not freeze the game. */
function armBusyWatchdog(set: (p: Partial<GameState>) => void, get: () => GameState): void {
  if (busyTimer) clearTimeout(busyTimer);
  busyTimer = setTimeout(() => {
    busyTimer = null;
    if (get().busy) {
      set({ busy: false, busyLabel: '' });
      get().pushToast('That took too long. The world moved on; try again.', 'warning');
    }
  }, BUSY_LIMIT_MS);
}
/** Called when the app returns to the foreground: clear a stale busy flag. */
export function recoverFromBackground(): void {
  const s = useGame.getState();
  if (s.busy && Date.now() - s.busySince > 20_000) {
    useGame.setState({ busy: false, busyLabel: '' });
    s.pushToast('Reconnected. Your last request may not have gone through.', 'info');
  }
}

function scheduleSave(get: () => GameState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void get().save();
  }, 1500);
}

async function flushSave(get: () => GameState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await get().save();
}

function indexEntryFor(state: WorldState, bytes: number): SaveIndexEntry {
  const sum = saveSummary(state);
  return { saveId: state.meta.saveId, name: sum.name, simName: sum.simName, city: sum.city, day: sum.day, money: sum.money, updatedAt: state.meta.updatedAt, createdAt: state.meta.createdAt, bytes };
}

export const useGame = create<GameState>((set, get) => ({
  hydrated: false,
  engine: null,
  version: 0,
  saveId: null,
  saves: [],
  lastSaveId: null,
  busy: false,
  busyLabel: '',
  busySince: 0,
  pendingConfirm: null,
  narrating: false,
  activeSimId: null,
  openConversationId: null,
  followUps: [],
  recentActionIds: [],
  errors: [],
  genProgress: null,
  llmUsage: { calls: 0, costUsd: 0, tokens: 0 },
  lastSavedAt: null,
  saving: false,

  async hydrate() {
    try {
      const [saves, last] = await Promise.all([readSaveIndex(), getLastSaveId()]);
      set({ saves, lastSaveId: last, hydrated: true });
    } catch (err) {
      console.warn('[game] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  async listSaves() {
    const saves = await readSaveIndex();
    set({ saves });
    return saves;
  },

  async newGame(input) {
    const onUsage = (u: LLMUsage) => {
      const cur = get().llmUsage;
      set({ llmUsage: { calls: cur.calls + 1, costUsd: Math.round((cur.costUsd + u.costUsd) * 10000) / 10000, tokens: cur.tokens + u.tokensIn + u.tokensOut } });
    };
    set({ genProgress: { message: 'Preparing the world…', fraction: 0 } });
    try {
      const placesRes = buildPlaces(input.region?.center);
      if (placesRes.warning) get().pushToast(placesRes.warning, 'warning');
      if (!placesRes.places) throw new Error('Places provider unavailable');
      const llmRes = buildLLM(onUsage);
      if (llmRes.warning) get().pushToast(llmRes.warning, 'warning');
      const { avatars, ...genInput } = input;
      const state = await generateWorld({
        ...genInput,
        places: placesRes.places,
        llm: llmRes.llm,
        onProgress: (message: string, fraction: number) => set({ genProgress: { message, fraction: Math.max(0, Math.min(1, fraction)) } }),
      });
      if (avatars?.length) {
        state.player.controlledSimIds.forEach((id, i) => {
          const sim = state.sims[id];
          const av = avatars[i];
          if (sim && av) sim.identity.appearance.avatar = { ...av };
        });
      }
      set({ genProgress: { message: 'Waking everyone up…', fraction: 0.97 } });
      get().unload();
      const { engine, warnings } = buildEngine(state, { onUsage });
      for (const w of warnings) get().pushToast(w, 'warning');
      attachEngine(engine, set, get);
      set({ engine, saveId: state.meta.saveId, activeSimId: state.player.activeSimId, openConversationId: null, followUps: [], recentActionIds: [], version: get().version + 1 });
      engine.init(true);
      await flushSave(get);
      await setLastSaveId(state.meta.saveId);
      set({ lastSaveId: state.meta.saveId, genProgress: { message: 'Ready.', fraction: 1 } });
      haptic.success();
      return state.meta.saveId;
    } catch (err) {
      set({ genProgress: null });
      get().pushToast(`Could not create the world: ${(err as Error).message}`, 'error');
      throw err;
    }
  },

  async load(saveId) {
    try {
      const raw = await readSaveBlob(saveId);
      if (!raw) {
        get().pushToast('That save could not be found.', 'error');
        return false;
      }
      const state = deserialize(raw);
      get().unload();
      const onUsage = (u: LLMUsage) => {
        const cur = get().llmUsage;
        set({ llmUsage: { calls: cur.calls + 1, costUsd: Math.round((cur.costUsd + u.costUsd) * 10000) / 10000, tokens: cur.tokens + u.tokensIn + u.tokensOut } });
      };
      const { engine, warnings } = buildEngine(state, { onUsage });
      for (const w of warnings) get().pushToast(w, 'warning');
      attachEngine(engine, set, get);
      const openConv = Object.values(state.conversations).find((c) => c.active && c.participantIds.includes(state.player.activeSimId));
      set({ engine, saveId: state.meta.saveId, activeSimId: state.player.activeSimId, openConversationId: openConv?.id ?? null, followUps: [], recentActionIds: [], version: get().version + 1 });
      engine.init(false);
      await setLastSaveId(saveId);
      set({ lastSaveId: saveId });
      return true;
    } catch (err) {
      console.warn('[game] load failed', err);
      get().pushToast(`Could not load the save: ${(err as Error).message}`, 'error');
      return false;
    }
  },

  async save() {
    const { engine, saving } = get();
    if (!engine || saving) return;
    set({ saving: true });
    try {
      const json = serialize(engine.state);
      await writeSaveBlob(engine.state.meta.saveId, json);
      const saves = await upsertSaveIndex(indexEntryFor(engine.state, json.length));
      set({ saves, lastSavedAt: Date.now() });
    } catch (err) {
      console.warn('[game] save failed', err);
      get().pushToast('Autosave failed. Your progress may not persist.', 'warning');
    } finally {
      set({ saving: false });
    }
  },

  async deleteSave(saveId) {
    await deleteSaveBlob(saveId);
    const saves = await removeFromSaveIndex(saveId);
    const patch: Partial<GameState> = { saves };
    if (get().lastSaveId === saveId) {
      await setLastSaveId(null);
      patch.lastSaveId = null;
    }
    if (get().saveId === saveId) get().unload();
    set(patch);
  },

  unload() {
    unsubscribeEngine?.();
    unsubscribeEngine = null;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    set({ engine: null, saveId: null, activeSimId: null, openConversationId: null, followUps: [], busy: false, busyLabel: '', version: get().version + 1 });
  },

  rebuildEngine() {
    const old = get().engine;
    if (!old) return;
    const onUsage = (u: LLMUsage) => {
      const cur = get().llmUsage;
      set({ llmUsage: { calls: cur.calls + 1, costUsd: Math.round((cur.costUsd + u.costUsd) * 10000) / 10000, tokens: cur.tokens + u.tokensIn + u.tokensOut } });
    };
    const { engine, warnings } = buildEngine(old.state, { onUsage });
    for (const w of warnings) get().pushToast(w, 'warning');
    attachEngine(engine, set, get);
    set({ engine, version: get().version + 1 });
  },

  getActions() {
    const { engine } = get();
    if (!engine) return [];
    try {
      return engine.actionsFor(engine.state.player.activeSimId);
    } catch (err) {
      console.warn('[game] actionsFor failed', err);
      return [];
    }
  },

  perform(actionId, params = {}, opts = {}) {
    const { engine } = get();
    if (!engine) return null;
    const simId = engine.state.player.activeSimId;
    const action = engine.findAction(simId, actionId);
    // doing something else while talking to someone ends the conversation, and that deserves a heads-up
    const open = get().openConversationId ? engine.state.conversations[get().openConversationId as Conversation['id']] : undefined;
    if (!opts.force && open?.active && action && !actionFitsConversation(action, open)) {
      const partner = open.participantIds.filter((p) => p !== simId).map((p) => engine.state.sims[p]?.identity.firstName ?? 'them').join(' and ');
      set({
        pendingConfirm: {
          title: `End your conversation with ${partner}?`,
          body: `“${action.label}” means wrapping things up with ${partner} first. They'll remember how it ended.`,
          confirmLabel: 'Wrap up and go',
          run: () => {
            void get()
              .endConversation({ wrapUp: true, reason: action.label })
              .then(() => {
                get().perform(actionId, params, { force: true });
              });
          },
        },
      });
      return null;
    }
    let res: PerformOutcome;
    try {
      res = engine.perform(simId, actionId, params);
    } catch (err) {
      get().pushToast(`Something went wrong: ${(err as Error).message}`, 'error');
      return null;
    }
    if (!res.ok) {
      get().pushToast(res.reason ?? 'You can’t do that right now.', 'warning');
      haptic.warning();
      return res;
    }
    haptic.light();
    const recent = [actionId, ...get().recentActionIds.filter((a) => a !== actionId)].slice(0, 8);
    set({ recentActionIds: recent });
    if (res.text) {
      engine.log({ text: res.text, kind: 'narrative', simId, venueId: engine.state.sims[simId]?.location.venueId, importance: 1 });
      set({ version: get().version + 1 });
    }
    const data = res.data ?? {};
    const targetId = data.targetId as SimId | undefined;
    if (data.openConversation === true && targetId && engine.state.sims[targetId]) {
      const channel = (data.channel as Conversation['channel'] | undefined) ?? 'in_person';
      const conv = engine.startConversation(simId, [targetId], channel);
      set({ openConversationId: conv.id, followUps: [] });
      res.conversationOpened = true;
    } else if (res.conversationId && engine.state.conversations[res.conversationId as Conversation['id']]?.active) {
      set({ openConversationId: res.conversationId, followUps: [] });
      res.conversationOpened = true;
    }
    if (res.interrupted) haptic.warning();
    // optional flavor narration for deterministic actions
    if (action?.llm === 'narrate' && engine.llm && engine.llm.isLive() && !res.interrupted) {
      set({ narrating: true });
      engine.llm
        .narrate(engine.scene(simId), action, res.outcomeLabel)
        .then((text) => {
          if (text && get().engine === engine) {
            engine.log({ text, kind: 'llm', simId, venueId: engine.state.sims[simId]?.location.venueId, importance: 1, meta: { source: 'narrate' } });
            set({ version: get().version + 1 });
            scheduleSave(get);
          }
        })
        .catch(() => undefined)
        .finally(() => set({ narrating: false }));
    }
    return res;
  },

  async freeform(text) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    const t = text.trim();
    if (!t) return;
    const simId = engine.state.player.activeSimId;
    set({ busy: true, busyLabel: 'The world is thinking…', busySince: Date.now() });
    armBusyWatchdog(set, get);
    haptic.light();
    try {
      const res = await engine.freeform(simId, t);
      if (!res.ok) {
        get().pushToast(res.reason ?? 'Nothing happens.', 'warning');
        return;
      }
      set({ followUps: (res.data?.followUps as string[] | undefined) ?? [] });
      if (res.conversationId && engine.state.conversations[res.conversationId as Conversation['id']]?.active) {
        set({ openConversationId: res.conversationId });
        haptic.select();
      }
      if (res.rejected?.length) get().pushToast(`The world didn’t quite allow that: ${res.rejected.slice(0, 2).join('; ')}`, 'info');
      if (res.interrupted) haptic.warning();
    } catch (err) {
      get().pushToast(`The world stalled: ${(err as Error).message}`, 'error');
    } finally {
      set({ busy: false, busyLabel: '' });
    }
  },

  async say(conversationId, text) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    const t = text.trim();
    if (!t) return;
    const simId = engine.state.player.activeSimId;
    const conv = engine.state.conversations[conversationId as Conversation['id']];
    const other = conv?.participantIds.find((p) => p !== simId);
    const name = other ? engine.state.sims[other]?.identity.firstName ?? 'They' : 'They';
    set({ busy: true, busyLabel: `${name} is thinking…`, busySince: Date.now() });
    armBusyWatchdog(set, get);
    haptic.light();
    try {
      const res = await engine.say(simId, conversationId, t);
      if (!res.ok) {
        get().pushToast(res.reason ?? 'The conversation stalled.', 'warning');
        set({ version: get().version + 1 });
        return;
      }
      set({ followUps: (res.data?.followUps as string[] | undefined) ?? [] });
      const still = engine.state.conversations[conversationId as Conversation['id']];
      if (!still || !still.active) set({ openConversationId: null, followUps: [] });
      if (res.rejected?.length) get().pushToast(`Some of that didn’t land: ${res.rejected.slice(0, 2).join('; ')}`, 'info');
    } catch (err) {
      get().pushToast(`The conversation stalled: ${(err as Error).message}`, 'error');
    } finally {
      set({ busy: false, busyLabel: '' });
    }
  },

  wait(minutes) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    haptic.select();
    try {
      const res = engine.wait(minutes);
      if (res.interrupted) haptic.warning();
    } catch (err) {
      get().pushToast(`Time hiccup: ${(err as Error).message}`, 'error');
    }
  },

  waitUntilMorning() {
    const { engine } = get();
    if (!engine) return;
    const mod = engine.clock.minuteOfDay;
    const target = 7 * 60;
    const minutes = mod < target ? target - mod : 1440 - mod + target;
    get().wait(minutes);
  },

  skipToNextEvent() {
    const { engine } = get();
    if (!engine) return;
    const now = engine.now;
    const controlled = new Set(engine.state.player.controlledSimIds);
    const next = engine.state.scheduled.find((e) => e.visible && e.atMinute > now && (!e.simId || controlled.has(e.simId)));
    if (!next) {
      get().pushToast('Nothing on the calendar soon. Try waiting instead.', 'info');
      return;
    }
    const minutes = Math.min(next.atMinute - now, 1440);
    get().wait(Math.max(1, minutes));
  },

  startConversation(targetId, channel = 'in_person') {
    const { engine } = get();
    if (!engine) return null;
    const simId = engine.state.player.activeSimId;
    if (!engine.state.sims[targetId]) return null;
    try {
      const conv = engine.startConversation(simId, [targetId], channel);
      set({ openConversationId: conv.id, followUps: [] });
      haptic.light();
      return conv.id;
    } catch (err) {
      get().pushToast(`Could not start a conversation: ${(err as Error).message}`, 'error');
      return null;
    }
  },

  async endConversation(opts = {}) {
    const { engine, openConversationId } = get();
    if (!engine || !openConversationId) return;
    const conv = engine.state.conversations[openConversationId as Conversation['id']];
    if (conv?.active && opts.wrapUp) {
      set({ busy: true, busyLabel: 'Wrapping up…', busySince: Date.now() });
      armBusyWatchdog(set, get);
      try {
        await engine.wrapUpConversation(engine.state.player.activeSimId, openConversationId, opts.reason ?? 'move on');
      } catch (err) {
        engine.endConversation(openConversationId);
        get().pushToast(`The goodbye got lost: ${(err as Error).message}`, 'info');
      } finally {
        set({ busy: false, busyLabel: '' });
      }
    } else if (conv?.active) engine.endConversation(openConversationId);
    set({ openConversationId: null, followUps: [], version: get().version + 1 });
    scheduleSave(get);
  },

  cancelConfirm() {
    set({ pendingConfirm: null });
  },

  resolveInterrupt(id, optionActionId, params) {
    const { engine } = get();
    if (!engine) return;
    engine.resolveInterrupt(id);
    haptic.select();
    if (optionActionId) {
      const simId = engine.state.player.activeSimId;
      const exists = engine.findAction(simId, optionActionId);
      if (exists) get().perform(optionActionId, params);
    }
  },

  moveTo(x, y) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    const res = engine.moveTo(engine.state.player.activeSimId, x, y);
    if (!res.ok) {
      get().pushToast(res.reason ?? "You can't go there.", 'warning');
      return;
    }
    haptic.select();
    set({ version: get().version + 1 });
    scheduleSave(get);
  },

  walkToObject(objectId) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    const res = engine.walkToObject(engine.state.player.activeSimId, objectId as never);
    if (!res.ok) {
      get().pushToast(res.reason ?? "You can't get there.", 'warning');
      return;
    }
    set({ version: get().version + 1 });
  },

  walkToSim(simId) {
    const { engine, busy } = get();
    if (!engine || busy) return;
    const res = engine.walkToSim(engine.state.player.activeSimId, simId);
    if (!res.ok) {
      get().pushToast(res.reason ?? "You can't get there.", 'warning');
      return;
    }
    set({ version: get().version + 1 });
  },

  switchSim(id) {
    const { engine } = get();
    if (!engine) return;
    engine.setActiveSim(id);
    set({ activeSimId: engine.state.player.activeSimId, openConversationId: null, followUps: [] });
    haptic.select();
  },

  toggleAutonomy(id) {
    const { engine } = get();
    if (!engine) return;
    const sim = engine.state.sims[id];
    if (!sim) return;
    sim.flags.autonomy = !sim.flags.autonomy;
    set({ version: get().version + 1 });
    scheduleSave(get);
    haptic.medium();
  },

  toggleFavorite(venueId) {
    const { engine } = get();
    if (!engine) return;
    const favs = engine.state.player.favorites;
    const i = favs.indexOf(venueId);
    if (i >= 0) favs.splice(i, 1);
    else favs.push(venueId);
    set({ version: get().version + 1 });
    scheduleSave(get);
    haptic.select();
  },

  pushToast(text, kind = 'error') {
    const id = `toast_${++toastCounter}`;
    set({ errors: [...get().errors.slice(-3), { id, text, kind, at: Date.now() }] });
  },

  dismissToast(id) {
    set({ errors: get().errors.filter((e) => e.id !== id) });
  },
}));

// Rebuild the engine when keys / model prefs change.
useSettings.subscribe((s, prev) => {
  if (s.keysVersion !== prev.keysVersion) useGame.getState().rebuildEngine();
});
