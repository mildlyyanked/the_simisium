import type { ContentCatalog } from '../content/types';
import { ageAt, minuteOfDay, weekdayAt } from './clock';
import { liquidCash } from './effects';
import type { WorldQuery } from './systems';
import type { Household, HouseholdId, ObjectInstance, Pet, Sim, SimId, Venue, VenueId, WorldState } from './types';
import { haversineKm } from './util';

export function makeQuery(state: WorldState, content: ContentCatalog): WorldQuery {
  const q: WorldQuery = {
    sim: (id) => {
      const s = state.sims[id];
      if (!s) throw new Error(`Unknown sim ${id}`);
      return s;
    },
    simMaybe: (id) => state.sims[id],
    venue: (id) => {
      const v = state.venues[id];
      if (!v) throw new Error(`Unknown venue ${id}`);
      return v;
    },
    venueMaybe: (id) => state.venues[id],
    household: (id: HouseholdId): Household => {
      const h = state.households[id];
      if (!h) throw new Error(`Unknown household ${id}`);
      return h;
    },
    householdOf: (simId) => {
      const s = state.sims[simId];
      return s?.householdId ? state.households[s.householdId] : undefined;
    },
    homeOf: (simId) => {
      const hh = q.householdOf(simId);
      return hh ? state.venues[hh.homeVenueId] : undefined;
    },
    simsAt: (venueId: VenueId): Sim[] => Object.values(state.sims).filter((s) => s.body.alive && s.location.venueId === venueId && !s.travel),
    objectsAt: (venueId: VenueId): ObjectInstance[] => {
      const v = state.venues[venueId];
      if (!v) return [];
      const out: ObjectInstance[] = [];
      for (const id of v.objectIds) {
        const o = state.objects[id];
        if (o) out.push(o);
      }
      return out;
    },
    objectsOf: (sim: Sim): ObjectInstance[] => sim.inventory.objectIds.map((id) => state.objects[id]).filter((o): o is ObjectInstance => !!o),
    petsOf: (householdId: HouseholdId): Pet[] => (state.households[householdId]?.petIds ?? []).map((id) => state.pets[id]).filter((p): p is Pet => !!p && p.alive),
    controlledSims: () => state.player.controlledSimIds.map((id) => state.sims[id]).filter((s): s is Sim => !!s),
    activeSim: () => q.sim(state.player.activeSimId),
    isControlled: (simId) => state.player.controlledSimIds.includes(simId),
    aliveSims: () => Object.values(state.sims).filter((s) => s.body.alive),
    simulatedSims: () => Object.values(state.sims).filter((s) => s.body.alive && s.lod !== 'far'),
    isVenueOpen: (venueId, minute) => {
      const v = state.venues[venueId];
      if (!v) return false;
      const m = minute ?? state.time.minute;
      if (v.archetype === 'home' || v.archetype === 'apartment_building' || v.archetype === 'park' || v.archetype === 'atm' || v.archetype === 'transit_stop' || v.archetype === 'parking' || v.archetype === 'ev_charger') return true;
      if (v.google?.businessStatus && v.google.businessStatus !== 'OPERATIONAL') return false;
      if ((state.news ?? []).some((n) => n.effects.closedVenueId === venueId && n.startedAt <= m && n.endsAt > m)) return false;
      const wd = weekdayAt(state.epoch, m);
      const mod = minuteOfDay(m);
      const periods = v.google?.openingPeriods;
      if (periods && periods.length) {
        return periods.some((p) => {
          if (p.day === wd && mod >= p.open && mod < p.close) return true;
          // after-midnight closing from previous day
          const prev = ((wd + 6) % 7) as typeof wd;
          if (p.day === prev && p.close > 1440 && mod < p.close - 1440) return true;
          return false;
        });
      }
      const arch = content.archetypes[v.archetype];
      if (!arch) return true;
      const h = arch.defaultHours;
      if (!h.days.includes(wd)) return false;
      return mod >= h.open && mod < h.close;
    },
    venuesByArchetype: (archetype) => Object.values(state.venues).filter((v) => v.archetype === archetype),
    nearestVenue: (from, archetype) => {
      const f = state.venues[from];
      if (!f) return undefined;
      let best: Venue | undefined;
      let bestD = Number.POSITIVE_INFINITY;
      for (const v of Object.values(state.venues)) {
        if (v.archetype !== archetype) continue;
        const d = haversineKm(f.location, v.location);
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
      return best;
    },
    distanceKm: (a, b) => {
      const va = state.venues[a];
      const vb = state.venues[b];
      if (!va || !vb) return 0;
      return haversineKm(va.location, vb.location);
    },
    ageOf: (sim) => ageAt(sim.identity.birthDate, state.epoch, state.time.minute),
    relationship: (a, b) => state.sims[a]?.relationships[b],
    findObject: (venueId, defId) => {
      const v = state.venues[venueId];
      if (!v) return undefined;
      for (const id of v.objectIds) {
        const o = state.objects[id];
        if (o && o.defId === defId) return o;
      }
      return undefined;
    },
    liquidCash: (sim) => liquidCash(sim),
  };
  return q;
}

export function simName(sim: Sim): string {
  return `${sim.identity.firstName} ${sim.identity.lastName}`;
}

export function simsKnownBy(state: WorldState, simId: SimId): Sim[] {
  const s = state.sims[simId];
  if (!s) return [];
  return Object.keys(s.relationships)
    .map((id) => state.sims[id as SimId])
    .filter((x): x is Sim => !!x);
}
