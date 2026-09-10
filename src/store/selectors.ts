/**
 * Read-only hooks over the engine state. Each subscribes to `version` so it re-renders after
 * any engine mutation, but reads live objects from `engine.state` (no deep copies).
 */
import { useMemo } from 'react';
import type { Engine } from '@engine/core/engine';
import type { ActionAvailability } from '@engine/core/actions';
import type { Household, Sim, SimId, Venue, WorldState } from '@engine/core/types';
import { useGame } from './gameStore';

export function useEngine(): Engine | null {
  useGame((s) => s.version);
  return useGame((s) => s.engine);
}

export function useWorld(): WorldState | null {
  const engine = useEngine();
  return engine ? engine.state : null;
}

export function useVersion(): number {
  return useGame((s) => s.version);
}

export function useActiveSim(): Sim | null {
  const engine = useEngine();
  if (!engine) return null;
  return engine.state.sims[engine.state.player.activeSimId] ?? null;
}

export function useSim(id: SimId | null | undefined): Sim | null {
  const engine = useEngine();
  if (!engine || !id) return null;
  return engine.state.sims[id] ?? null;
}

export function useHousehold(): Household | null {
  const engine = useEngine();
  if (!engine) return null;
  return engine.state.households[engine.state.player.householdId] ?? null;
}

export function useControlledSims(): Sim[] {
  const engine = useEngine();
  if (!engine) return [];
  return engine.state.player.controlledSimIds.map((id) => engine.state.sims[id]).filter((s): s is Sim => !!s);
}

export function useVenueOf(sim: Sim | null): Venue | null {
  const engine = useEngine();
  if (!engine || !sim) return null;
  return engine.state.venues[sim.location.venueId] ?? null;
}

export function useActions(): ActionAvailability[] {
  const version = useGame((s) => s.version);
  const engine = useGame((s) => s.engine);
  const getActions = useGame((s) => s.getActions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (engine ? getActions() : []), [version, engine]);
}

export function usePendingInterrupt() {
  const engine = useEngine();
  if (!engine) return null;
  return engine.state.pendingInterrupts[0] ?? null;
}

export function useOpenConversation() {
  const engine = useEngine();
  const id = useGame((s) => s.openConversationId);
  if (!engine || !id) return null;
  const conv = engine.state.conversations[id as keyof WorldState['conversations']];
  return conv && conv.active ? conv : null;
}

export function simFullName(sim: Sim | null | undefined): string {
  return sim ? `${sim.identity.firstName} ${sim.identity.lastName}` : 'Someone';
}

export function liquidCash(sim: Sim): number {
  return sim.finance.accounts.filter((a) => a.kind === 'cash' || a.kind === 'checking' || a.kind === 'savings').reduce((s, a) => s + a.balance, 0);
}

export function netWorth(sim: Sim, state: WorldState): number {
  let total = 0;
  for (const a of sim.finance.accounts) total += a.kind === 'credit_card' ? -a.balance : a.balance;
  for (const l of sim.finance.loans) total -= l.balance;
  const hh = sim.householdId ? state.households[sim.householdId] : undefined;
  if (hh) {
    for (const v of hh.vehicleIds) total += (state.vehicles[v]?.value ?? 0) - (state.vehicles[v]?.loan?.balance ?? 0);
    const home = state.venues[hh.homeVenueId];
    if (home?.residence?.tenure === 'own') total += home.residence.marketValue - (home.residence.mortgage?.balance ?? 0);
  }
  return Math.round(total);
}
