import type {
  ActionDef,
  Charge,
  EffectBundle,
  HolidayId,
  Interrupt,
  NeedId,
  ObjectId,
  PetId,
  ScheduledEvent,
  SimId,
  VehicleId,
  VenueId,
  Weather,
} from './types';

/**
 * Every cross-system signal is a GameEvent on the bus. Systems react in `onEvent`.
 * Keep payloads JSON-serializable.
 */
export type GameEvent =
  | { type: 'world:new_game' }
  | { type: 'world:loaded' }
  | { type: 'time:minute'; minute: number }
  | { type: 'time:hour'; minute: number; hour: number }
  | { type: 'time:day'; minute: number; isoDate: string }
  | { type: 'time:week'; minute: number }
  | { type: 'time:month'; minute: number; month: number; year: number }
  | { type: 'time:year'; minute: number; year: number }
  | { type: 'calendar:holiday'; holidayId: HolidayId; label: string }
  | { type: 'calendar:birthday'; simId: SimId; age: number }
  | { type: 'weather:changed'; weather: Weather }
  | { type: 'weather:alert'; text: string; severity: number }
  | { type: 'need:critical'; simId: SimId; need: NeedId; value: number }
  | { type: 'need:restored'; simId: SimId; need: NeedId }
  | { type: 'sim:passed_out'; simId: SimId; reason: string }
  | { type: 'sim:sick'; simId: SimId; illnessId: string; name: string }
  | { type: 'sim:recovered'; simId: SimId; illnessId: string }
  | { type: 'sim:injured'; simId: SimId; injuryId: string; name: string }
  | { type: 'sim:died'; simId: SimId; cause: string }
  | { type: 'sim:born'; simId: SimId; parentIds: SimId[] }
  | { type: 'sim:aged_up'; simId: SimId; stage: string }
  | { type: 'sim:moved'; simId: SimId; from: VenueId; to: VenueId }
  | { type: 'sim:arrived'; simId: SimId; venueId: VenueId }
  | { type: 'sim:departed'; simId: SimId; venueId: VenueId }
  | { type: 'sim:met'; simId: SimId; otherId: SimId; venueId: VenueId }
  | { type: 'sim:mood_changed'; simId: SimId; mood: number; dominant: string }
  | { type: 'sim:pregnant'; simId: SimId; otherParentId?: SimId }
  | { type: 'sim:skill_up'; simId: SimId; skillId: string; level: number }
  | { type: 'sim:lod_changed'; simId: SimId; lod: string }
  | { type: 'action:started'; simId: SimId; action: ActionDef }
  | { type: 'action:completed'; simId: SimId; actionId: string; label: string; outcomeLabel?: string; targetId?: string }
  | { type: 'action:interrupted'; simId: SimId; actionId: string; reason: string }
  | { type: 'action:failed'; simId: SimId; actionId: string; reason: string }
  | { type: 'effects:applied'; simId: SimId; bundle: EffectBundle; source: string }
  | { type: 'money:transaction'; simId: SimId; amount: number; memo: string; accountId: string; category: string }
  | { type: 'money:insufficient'; simId: SimId; amount: number; memo: string }
  | { type: 'money:bill_due'; simId: SimId; billId: string; amount: number }
  | { type: 'money:bill_paid'; simId: SimId; billId: string; amount: number }
  | { type: 'money:bill_missed'; simId: SimId; billId: string; amount: number }
  | { type: 'money:paycheck'; simId: SimId; gross: number; net: number }
  | { type: 'money:credit_score'; simId: SimId; score: number; delta: number }
  | { type: 'money:loan_default'; simId: SimId; loanId: string }
  | { type: 'money:eviction_warning'; simId: SimId; venueId: VenueId }
  | { type: 'money:evicted'; simId: SimId; venueId: VenueId }
  | { type: 'career:hired'; simId: SimId; careerId: string; title: string; employer: string }
  | { type: 'career:fired'; simId: SimId; reason: string }
  | { type: 'career:quit'; simId: SimId }
  | { type: 'career:promoted'; simId: SimId; title: string; level: number }
  | { type: 'career:demoted'; simId: SimId; title: string }
  | { type: 'career:shift_start'; simId: SimId }
  | { type: 'career:shift_end'; simId: SimId; hours: number }
  | { type: 'career:late'; simId: SimId; minutes: number }
  | { type: 'career:absent'; simId: SimId }
  | { type: 'career:interview'; simId: SimId; applicationId: string }
  | { type: 'career:offer'; simId: SimId; applicationId: string }
  | { type: 'career:performance_review'; simId: SimId; score: number }
  | { type: 'education:enrolled'; simId: SimId; program: string }
  | { type: 'education:graduated'; simId: SimId; level: string; field: string }
  | { type: 'education:grade'; simId: SimId; courseId: string; grade: number }
  | { type: 'education:homework_due'; simId: SimId; courseId: string }
  | { type: 'education:exam'; simId: SimId; courseId: string }
  | { type: 'education:dropped'; simId: SimId }
  | { type: 'relationship:changed'; simId: SimId; otherId: SimId; axis: 'friendship' | 'romance' | 'trust' | 'familiarity'; value: number; delta: number }
  | { type: 'relationship:flag'; simId: SimId; otherId: SimId; flag: string; op: 'add' | 'remove' }
  | { type: 'relationship:milestone'; simId: SimId; otherId: SimId; milestone: string }
  | { type: 'relationship:breakup'; simId: SimId; otherId: SimId; initiator: SimId }
  | { type: 'family:proposal'; simId: SimId; otherId: SimId; accepted: boolean }
  | { type: 'family:married'; simId: SimId; otherId: SimId }
  | { type: 'family:divorced'; simId: SimId; otherId: SimId }
  | { type: 'family:moved_in'; simId: SimId; householdId: string }
  | { type: 'family:moved_out'; simId: SimId; householdId: string }
  | { type: 'family:birth'; parentIds: SimId[]; childId: SimId }
  | { type: 'family:adoption'; parentIds: SimId[]; childId: SimId }
  | { type: 'family:custody'; childId: SimId; guardianId: SimId }
  | { type: 'pet:adopted'; petId: PetId; householdId: string }
  | { type: 'pet:sick'; petId: PetId; name: string }
  | { type: 'pet:died'; petId: PetId; name: string }
  | { type: 'pet:need_critical'; petId: PetId; need: string }
  | { type: 'pet:escaped'; petId: PetId }
  | { type: 'pet:trained'; petId: PetId; level: number }
  | { type: 'legal:crime_committed'; simId: SimId; crimeId: string; venueId?: VenueId; witnessed: boolean }
  | { type: 'legal:police_called'; venueId: VenueId; reason: string; simId?: SimId }
  | { type: 'legal:arrested'; simId: SimId; charge: Charge }
  | { type: 'legal:released'; simId: SimId }
  | { type: 'legal:ticket'; simId: SimId; kind: string; amount: number }
  | { type: 'legal:court_date'; simId: SimId; chargeId: string }
  | { type: 'legal:verdict'; simId: SimId; chargeId: string; verdict: string }
  | { type: 'legal:license'; simId: SimId; status: string }
  | { type: 'legal:lawsuit'; simId: SimId; vs: string; amount: number }
  | { type: 'property:rent_due'; householdId: string; amount: number }
  | { type: 'property:repair_needed'; venueId: VenueId; objectId?: ObjectId; issue: string }
  | { type: 'property:broken'; objectId: ObjectId; venueId?: VenueId }
  | { type: 'property:repaired'; objectId: ObjectId }
  | { type: 'property:moved'; householdId: string; from: VenueId; to: VenueId }
  | { type: 'property:purchased'; householdId: string; venueId: VenueId; price: number }
  | { type: 'property:lease_signed'; householdId: string; venueId: VenueId; rent: number }
  | { type: 'property:fire'; venueId: VenueId; severity: number }
  | { type: 'property:burglary'; venueId: VenueId; loss: number }
  | { type: 'amenity:cut'; householdId: string; kind: string }
  | { type: 'amenity:restored'; householdId: string; kind: string }
  | { type: 'amenity:mail'; householdId: string; mailId: string }
  | { type: 'amenity:package'; householdId: string; itemId: string; qty: number }
  | { type: 'transport:departed'; simId: SimId; mode: string; to: VenueId; eta: number }
  | { type: 'transport:arrived'; simId: SimId; venueId: VenueId; mode: string }
  | { type: 'transport:breakdown'; vehicleId: VehicleId; simId?: SimId; issue: string }
  | { type: 'transport:accident'; simId: SimId; vehicleId?: VehicleId; severity: number; atFault: boolean }
  | { type: 'transport:out_of_fuel'; vehicleId: VehicleId; simId?: SimId }
  | { type: 'transport:pulled_over'; simId: SimId; reason: string }
  | { type: 'transport:vehicle_purchased'; householdId: string; vehicleId: VehicleId }
  | { type: 'transport:missed_bus'; simId: SimId }
  | { type: 'shop:purchased'; simId: SimId; venueId?: VenueId; items: { itemId: string; qty: number }[]; total: number }
  | { type: 'shop:object_purchased'; simId: SimId; objectId: ObjectId; defId: string; price: number }
  | { type: 'shop:delivery_scheduled'; householdId: string; arrivesAt: number }
  | { type: 'entertainment:event'; venueId: VenueId; kind: string; label: string; at: number }
  | { type: 'entertainment:watched'; simId: SimId; title: string; kind: string }
  | { type: 'civic:jury_summons'; simId: SimId; at: number }
  | { type: 'civic:election'; at: number; label: string }
  | { type: 'civic:tax_deadline'; simId: SimId }
  | { type: 'civic:census' }
  | { type: 'phone:call_incoming'; simId: SimId; fromSimId: SimId; reason: string }
  | { type: 'phone:text_received'; simId: SimId; fromSimId: SimId; text: string }
  | { type: 'phone:notification'; simId: SimId; app: string; title: string; body: string }
  | { type: 'phone:social_post'; simId: SimId; text: string; likes: number }
  | { type: 'conversation:started'; conversationId: string; participantIds: SimId[] }
  | { type: 'conversation:turn'; conversationId: string; speakerId: SimId | 'narrator'; text: string }
  | { type: 'conversation:ended'; conversationId: string }
  | { type: 'llm:call'; task: string; model: string; tokensIn: number; tokensOut: number; costUsd: number; ms: number; cached: boolean }
  | { type: 'llm:error'; task: string; error: string }
  | { type: 'llm:rejected_effects'; simId: SimId; rejected: string[] }
  | { type: 'bio:generated'; simId: SimId; by: 'llm' | 'fallback' }
  | { type: 'bio:revealed'; simId: SimId; factId: string; to: SimId }
  | { type: 'life:event'; simId: SimId; kind: string; label: string; payload?: Record<string, unknown> }
  | { type: 'life:milestone'; simId: SimId; label: string }
  | { type: 'story:beat'; label: string; simId?: SimId; payload?: Record<string, unknown> }
  | { type: 'scheduled:fired'; event: ScheduledEvent }
  | { type: 'interrupt'; interrupt: Interrupt }
  | { type: 'object:used'; simId: SimId; objectId: ObjectId; interactionId: string }
  | { type: 'object:state'; objectId: ObjectId; patch: Record<string, unknown> }
  | { type: 'venue:discovered'; venueId: VenueId; simId: SimId }
  | { type: 'venue:closed'; venueId: VenueId; reason: string }
  | { type: 'venue:crowd'; venueId: VenueId; level: number }
  | { type: 'custom'; kind: string; simId?: SimId; payload?: Record<string, unknown> };

export type GameEventType = GameEvent['type'];

export type EventListener = (event: GameEvent) => void;

export class EventBus {
  private listeners: EventListener[] = [];
  private typed = new Map<GameEventType, EventListener[]>();
  private queue: GameEvent[] = [];
  private dispatching = false;

  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  onType<T extends GameEventType>(type: T, listener: (e: Extract<GameEvent, { type: T }>) => void): () => void {
    const list = this.typed.get(type) ?? [];
    const wrapped = listener as EventListener;
    list.push(wrapped);
    this.typed.set(type, list);
    return () => {
      this.typed.set(type, (this.typed.get(type) ?? []).filter((l) => l !== wrapped));
    };
  }

  /** Enqueue; events dispatch in order, re-entrancy safe. */
  emit(event: GameEvent): void {
    this.queue.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length) {
        const e = this.queue.shift()!;
        for (const l of this.listeners) l(e);
        const t = this.typed.get(e.type);
        if (t) for (const l of t) l(e);
      }
    } finally {
      this.dispatching = false;
    }
  }

  clear(): void {
    this.listeners = [];
    this.typed.clear();
    this.queue = [];
  }
}
