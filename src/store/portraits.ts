/**
 * Character portraits: generated on demand by an image model, stored per sim id (a text file
 * holding the data URL on device, AsyncStorage on web) and cached in memory for the avatars.
 */
import { create } from 'zustand';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SimId } from '@engine/core/types';
import { useGame } from './gameStore';

type FsApi = {
  File: new (...parts: (string | { uri: string })[]) => { exists: boolean; write(content: string): void; text(): Promise<string>; delete(): void; uri: string };
  Directory: new (...parts: (string | { uri: string })[]) => { exists: boolean; create(opts?: { intermediates?: boolean; idempotent?: boolean }): void; uri: string };
  Paths: { document: { uri: string } };
};
let fsApi: FsApi | null | undefined;
function fs(): FsApi | null {
  if (Platform.OS === 'web') return null;
  if (fsApi !== undefined) return fsApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fsApi = require('expo-file-system') as FsApi;
  } catch {
    fsApi = null;
  }
  return fsApi;
}
function dir(api: FsApi) {
  const d = new api.Directory(api.Paths.document, 'portraits');
  try {
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  } catch {
    /* write will surface */
  }
  return d;
}
const KEY = (id: string) => `portrait:${id}`;

async function readPortrait(id: SimId): Promise<string | null> {
  const api = fs();
  if (api) {
    try {
      const f = new api.File(dir(api), `${id}.txt`);
      if (!f.exists) return null;
      return await f.text();
    } catch {
      return null;
    }
  }
  try {
    return await AsyncStorage.getItem(KEY(id));
  } catch {
    return null;
  }
}
async function writePortrait(id: SimId, dataUrl: string | null): Promise<void> {
  const api = fs();
  if (api) {
    try {
      const f = new api.File(dir(api), `${id}.txt`);
      if (dataUrl) f.write(dataUrl);
      else if (f.exists) f.delete();
      return;
    } catch (err) {
      console.warn('[portraits] file write failed', err);
    }
  }
  try {
    if (dataUrl) await AsyncStorage.setItem(KEY(id), dataUrl);
    else await AsyncStorage.removeItem(KEY(id));
  } catch (err) {
    console.warn('[portraits] storage failed', err);
  }
}

interface PortraitState {
  uris: Record<string, string>;
  generating: Record<string, boolean>;
  checked: Record<string, boolean>;
  lastError: string | null;
  /** load a stored portrait into memory (no-op if already checked) */
  ensure(id: SimId): Promise<void>;
  generate(id: SimId): Promise<boolean>;
  remove(id: SimId): Promise<void>;
}

export const usePortraits = create<PortraitState>((set, get) => ({
  uris: {},
  generating: {},
  checked: {},
  lastError: null,

  async ensure(id) {
    if (get().checked[id]) return;
    set((s) => ({ checked: { ...s.checked, [id]: true } }));
    const uri = await readPortrait(id);
    if (uri) set((s) => ({ uris: { ...s.uris, [id]: uri } }));
  },

  async generate(id) {
    const { engine } = useGame.getState();
    if (!engine || !engine.llm || !engine.llm.generatePortrait || !engine.llm.isLive()) {
      set({ lastError: 'Add an OpenRouter key in Settings to generate portraits.' });
      return false;
    }
    const sim = engine.state.sims[id];
    if (!sim) return false;
    if (get().generating[id]) return false;
    set((s) => ({ generating: { ...s.generating, [id]: true }, lastError: null }));
    try {
      const { dataUrl, usage } = await engine.llm.generatePortrait(engine.state, sim);
      engine.state.meta.llmCalls += 1;
      engine.state.meta.llmCostUsd = Math.round((engine.state.meta.llmCostUsd + usage.costUsd) * 100) / 100;
      sim.identity.appearance.portrait = 'generated';
      await writePortrait(id, dataUrl);
      set((s) => ({ uris: { ...s.uris, [id]: dataUrl }, checked: { ...s.checked, [id]: true } }));
      useGame.setState({ version: useGame.getState().version + 1 });
      return true;
    } catch (err) {
      set({ lastError: (err as Error).message });
      return false;
    } finally {
      set((s) => ({ generating: { ...s.generating, [id]: false } }));
    }
  },

  async remove(id) {
    await writePortrait(id, null);
    set((s) => {
      const uris = { ...s.uris };
      delete uris[id];
      return { uris };
    });
  },
}));

/** Hook: the portrait uri for a sim, loading it from storage on first use. */
export function usePortrait(id: SimId | null | undefined): string | undefined {
  const uri = usePortraits((s) => (id ? s.uris[id] : undefined));
  const checked = usePortraits((s) => (id ? s.checked[id] : true));
  if (id && !checked) void usePortraits.getState().ensure(id);
  return uri;
}
