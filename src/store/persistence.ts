/**
 * Save persistence: large save blobs go to the document directory on native (expo-file-system),
 * and to AsyncStorage (localStorage) on web. The save index is always in AsyncStorage.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SAVE_INDEX_KEY = 'simisium:saves';
export const LAST_SAVE_KEY = 'simisium:lastSave';
export const savePrefix = (id: string) => `simisium:save:${id}`;

export interface SaveIndexEntry {
  saveId: string;
  name: string;
  simName: string;
  city: string;
  day: number;
  money: number;
  updatedAt: string;
  createdAt: string;
  bytes: number;
}

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

function saveDir(api: FsApi) {
  const dir = new api.Directory(api.Paths.document, 'saves');
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch {
    // ignore, write will surface the error
  }
  return dir;
}

export async function writeSaveBlob(saveId: string, json: string): Promise<void> {
  const api = fs();
  if (api) {
    try {
      const dir = saveDir(api);
      const file = new api.File(dir, `${saveId}.json`);
      file.write(json);
      return;
    } catch (err) {
      console.warn('[persistence] file write failed, falling back to AsyncStorage', err);
    }
  }
  await AsyncStorage.setItem(savePrefix(saveId), json);
}

export async function readSaveBlob(saveId: string): Promise<string | null> {
  const api = fs();
  if (api) {
    try {
      const dir = saveDir(api);
      const file = new api.File(dir, `${saveId}.json`);
      if (file.exists) return await file.text();
    } catch (err) {
      console.warn('[persistence] file read failed', err);
    }
  }
  return AsyncStorage.getItem(savePrefix(saveId));
}

export async function deleteSaveBlob(saveId: string): Promise<void> {
  const api = fs();
  if (api) {
    try {
      const dir = saveDir(api);
      const file = new api.File(dir, `${saveId}.json`);
      if (file.exists) file.delete();
    } catch (err) {
      console.warn('[persistence] file delete failed', err);
    }
  }
  await AsyncStorage.removeItem(savePrefix(saveId));
}

export async function readSaveIndex(): Promise<SaveIndexEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVE_INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SaveIndexEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function writeSaveIndex(list: SaveIndexEntry[]): Promise<void> {
  await AsyncStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list));
}

export async function upsertSaveIndex(entry: SaveIndexEntry): Promise<SaveIndexEntry[]> {
  const list = await readSaveIndex();
  const idx = list.findIndex((e) => e.saveId === entry.saveId);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  await writeSaveIndex(list);
  return list;
}

export async function removeFromSaveIndex(saveId: string): Promise<SaveIndexEntry[]> {
  const list = (await readSaveIndex()).filter((e) => e.saveId !== saveId);
  await writeSaveIndex(list);
  return list;
}

export async function setLastSaveId(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(LAST_SAVE_KEY, id);
  else await AsyncStorage.removeItem(LAST_SAVE_KEY);
}

export async function getLastSaveId(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SAVE_KEY);
}
