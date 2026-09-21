import type { WorldState } from './types';

export const SAVE_VERSION = 1;

export interface SaveEnvelope {
  version: number;
  savedAt: string;
  state: WorldState;
}

export function serialize(state: WorldState): string {
  const env: SaveEnvelope = { version: SAVE_VERSION, savedAt: new Date().toISOString(), state };
  return JSON.stringify(env);
}

export function deserialize(json: string): WorldState {
  const env = JSON.parse(json) as SaveEnvelope;
  if (!env || typeof env !== 'object' || !env.state) throw new Error('Invalid save file');
  return migrate(env.state, env.version ?? 0);
}

type Migration = (s: WorldState) => WorldState;
const MIGRATIONS: Record<number, Migration> = {
  // 0 -> 1: initial
  0: (s) => s,
};

export function migrate(state: WorldState, from: number): WorldState {
  let s = state;
  for (let v = from; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (m) s = m(s);
  }
  s.meta.version = SAVE_VERSION;
  // defensive defaults for fields added later
  s.pendingInterrupts ||= [];
  s.placesCache ||= {};
  s.flags ||= {};
  s.conversations ||= {};
  s.layouts ||= {};
  s.dilemmas ||= [];
  s.news ||= [];
  s.feed ||= [];
  return s;
}

/** small summary for save slot list */
export function saveSummary(state: WorldState): { name: string; day: number; simName: string; city: string; updatedAt: string; money: number } {
  const sim = state.sims[state.player.activeSimId];
  const money = sim ? sim.finance.accounts.filter((a) => a.kind !== 'credit_card' && a.kind !== 'retirement').reduce((s, a) => s + a.balance, 0) : 0;
  return {
    name: state.meta.name,
    day: Math.floor(state.time.minute / 1440) + 1,
    simName: sim ? `${sim.identity.firstName} ${sim.identity.lastName}` : '?',
    city: state.region.name,
    updatedAt: state.meta.updatedAt,
    money: Math.round(money),
  };
}
