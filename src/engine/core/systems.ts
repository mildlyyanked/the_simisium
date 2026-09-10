import type { ContentCatalog } from '../content/types';
import type { ClockInfo } from './clock';
import type { GameEvent } from './events';
import type { RNG } from './rng';
import type {
  ActionDef,
  EffectBundle,
  Household,
  HouseholdId,
  Interrupt,
  LogEntry,
  ObjectInstance,
  Pet,
  ScheduledEventSpec,
  Sim,
  SimId,
  Venue,
  VenueId,
  WorldState,
} from './types';

export type SystemId =
  | 'calendar'
  | 'weather'
  | 'needs'
  | 'health'
  | 'skills'
  | 'relationships'
  | 'family'
  | 'pets'
  | 'finance'
  | 'property'
  | 'amenities'
  | 'transport'
  | 'shopping'
  | 'career'
  | 'education'
  | 'law'
  | 'civic'
  | 'entertainment'
  | 'communication'
  | 'npcAI'
  | 'lifeEvents'
  | 'story';

/**
 * Everything a system may touch. `state` is mutable during a tick.
 * Systems must not import each other; they talk through events and state.
 */
export interface SystemContext {
  state: WorldState;
  rng: RNG;
  content: ContentCatalog;
  clock: ClockInfo;
  emit(event: GameEvent): void;
  schedule(spec: ScheduledEventSpec): string;
  cancelScheduled(id: string): void;
  log(entry: Omit<LogEntry, 'id' | 'at'> & { at?: number }): void;
  interrupt(i: Omit<Interrupt, 'id' | 'at'>): void;
  /** apply an effect bundle through the shared validator/applier */
  applyEffects(simId: SimId, bundle: EffectBundle, source: string): void;
  query: WorldQuery;
}

export interface WorldQuery {
  sim(id: SimId): Sim;
  simMaybe(id: SimId): Sim | undefined;
  venue(id: VenueId): Venue;
  venueMaybe(id: VenueId): Venue | undefined;
  household(id: HouseholdId): Household;
  householdOf(simId: SimId): Household | undefined;
  homeOf(simId: SimId): Venue | undefined;
  simsAt(venueId: VenueId): Sim[];
  objectsAt(venueId: VenueId): ObjectInstance[];
  objectsOf(sim: Sim): ObjectInstance[];
  petsOf(householdId: HouseholdId): Pet[];
  controlledSims(): Sim[];
  activeSim(): Sim;
  isControlled(simId: SimId): boolean;
  aliveSims(): Sim[];
  /** sims with lod full or near */
  simulatedSims(): Sim[];
  isVenueOpen(venueId: VenueId, minute?: number): boolean;
  venuesByArchetype(archetype: Venue['archetype']): Venue[];
  nearestVenue(from: VenueId, archetype: Venue['archetype']): Venue | undefined;
  distanceKm(a: VenueId, b: VenueId): number;
  ageOf(sim: Sim): number;
  relationship(a: SimId, b: SimId): Sim['relationships'][SimId] | undefined;
  /** objects at venue matching def id */
  findObject(venueId: VenueId, defId: string): ObjectInstance | undefined;
  /** total balance across liquid accounts (cash+checking+savings) */
  liquidCash(sim: Sim): number;
}

export interface System {
  id: SystemId;
  intervalMinutes: number;
  onInit?(ctx: SystemContext): void;
  onTick?(ctx: SystemContext, dt: number): void;
  onEvent?(ctx: SystemContext, event: GameEvent): void;
  /** context-sensitive actions for a sim (merged by actions.ts) */
  actions?(ctx: SystemContext, simId: SimId): ActionDef[];
  /** optional handler for executing an action this system owns (id prefix match) */
  handles?(actionId: string): boolean;
  execute?(ctx: SystemContext, simId: SimId, action: ActionDef, params: Record<string, unknown>): ActionResult | void;
}

export interface ActionResult {
  ok: boolean;
  /** narrative to show */
  text?: string;
  outcomeLabel?: string;
  effects?: EffectBundle;
  /** override duration (e.g. travel time computed) */
  durationMinutes?: number;
  /** if the action opens a conversation */
  conversationId?: string;
  /** structured data for the UI */
  data?: Record<string, unknown>;
}
