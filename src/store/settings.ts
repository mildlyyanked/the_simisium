/**
 * Settings store: API keys (secure storage on native, AsyncStorage on web), model prefs, UI prefs.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import type { LLMTask } from '@engine/core/llmTypes';
import { setHapticsEnabled } from '@/ui/haptics';

export type ModelPreset = 'balanced' | 'quality' | 'budget';

export interface SettingsState {
  hydrated: boolean;
  openRouterKey: string;
  googlePlacesKey: string;
  modelPreset: ModelPreset;
  modelOverrides: Partial<Record<LLMTask, string>>;
  budgetUsd: number;
  textSize: number; // 0.9 .. 1.3 multiplier
  haptics: boolean;
  autoAdvanceWhenIdle: boolean;
  reduceMotion: boolean;
  autonomyDefault: boolean;
  /** bumps whenever a key changes so the engine factory can rebuild */
  keysVersion: number;
  hydrate(): Promise<void>;
  setKey(which: 'openRouterKey' | 'googlePlacesKey', value: string): Promise<void>;
  update(patch: Partial<Pick<SettingsState, 'modelPreset' | 'modelOverrides' | 'budgetUsd' | 'textSize' | 'haptics' | 'autoAdvanceWhenIdle' | 'reduceMotion' | 'autonomyDefault'>>): Promise<void>;
}

const SETTINGS_KEY = 'simisium:settings';
const SECURE_KEYS = { openRouterKey: 'simisium_openrouter_key', googlePlacesKey: 'simisium_google_places_key' } as const;

type SecureStoreModule = { getItemAsync(k: string): Promise<string | null>; setItemAsync(k: string, v: string): Promise<void>; deleteItemAsync(k: string): Promise<void> };

let secureStore: SecureStoreModule | null | undefined;
function getSecureStore(): SecureStoreModule | null {
  if (Platform.OS === 'web') return null;
  if (secureStore !== undefined) return secureStore;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    secureStore = require('expo-secure-store') as SecureStoreModule;
  } catch {
    secureStore = null;
  }
  return secureStore;
}

async function readSecret(name: string): Promise<string> {
  const ss = getSecureStore();
  try {
    if (ss) return (await ss.getItemAsync(name)) ?? '';
    return (await AsyncStorage.getItem(`secret:${name}`)) ?? '';
  } catch {
    return '';
  }
}

async function writeSecret(name: string, value: string): Promise<void> {
  const ss = getSecureStore();
  try {
    if (ss) {
      if (value) await ss.setItemAsync(name, value);
      else await ss.deleteItemAsync(name);
      return;
    }
    if (value) await AsyncStorage.setItem(`secret:${name}`, value);
    else await AsyncStorage.removeItem(`secret:${name}`);
  } catch (err) {
    console.warn('[settings] could not persist secret', err);
  }
}

const DEFAULTS = {
  modelPreset: 'balanced' as ModelPreset,
  modelOverrides: {} as Partial<Record<LLMTask, string>>,
  budgetUsd: 5,
  textSize: 1,
  haptics: true,
  autoAdvanceWhenIdle: false,
  reduceMotion: false,
  autonomyDefault: false,
};

export const useSettings = create<SettingsState>((set, get) => ({
  hydrated: false,
  openRouterKey: '',
  googlePlacesKey: '',
  ...DEFAULTS,
  keysVersion: 0,

  async hydrate() {
    try {
      const [raw, orKey, gKey] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), readSecret(SECURE_KEYS.openRouterKey), readSecret(SECURE_KEYS.googlePlacesKey)]);
      const parsed = raw ? (JSON.parse(raw) as Partial<typeof DEFAULTS>) : {};
      const merged = { ...DEFAULTS, ...parsed };
      setHapticsEnabled(merged.haptics);
      set({ ...merged, openRouterKey: orKey, googlePlacesKey: gKey, hydrated: true });
    } catch (err) {
      console.warn('[settings] hydrate failed', err);
      set({ hydrated: true });
    }
  },

  async setKey(which, value) {
    const v = value.trim();
    set({ [which]: v, keysVersion: get().keysVersion + 1 } as Partial<SettingsState>);
    await writeSecret(SECURE_KEYS[which], v);
  },

  async update(patch) {
    set(patch);
    if (patch.haptics !== undefined) setHapticsEnabled(patch.haptics);
    const s = get();
    const persisted: typeof DEFAULTS = {
      modelPreset: s.modelPreset,
      modelOverrides: s.modelOverrides,
      budgetUsd: s.budgetUsd,
      textSize: s.textSize,
      haptics: s.haptics,
      autoAdvanceWhenIdle: s.autoAdvanceWhenIdle,
      reduceMotion: s.reduceMotion,
      autonomyDefault: s.autonomyDefault,
    };
    try {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
    } catch (err) {
      console.warn('[settings] persist failed', err);
    }
    if (patch.modelPreset !== undefined || patch.modelOverrides !== undefined || patch.budgetUsd !== undefined) set({ keysVersion: get().keysVersion + 1 });
  },
}));

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(16, key.length - 8))}${key.slice(-4)}`;
}
