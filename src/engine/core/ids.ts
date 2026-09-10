import type { ConversationId, EventId, HouseholdId, ObjectId, PetId, SimId, VehicleId, VenueId } from './types';
import type { RNG } from './rng';

let counter = 0;

function token(rng?: RNG): string {
  counter = (counter + 1) % 1_000_000;
  const r = rng ? rng.uuidLike() : Math.random().toString(36).slice(2, 10);
  return `${r}${counter.toString(36)}`;
}

export const newSimId = (rng?: RNG): SimId => `sim_${token(rng)}`;
export const newVenueId = (rng?: RNG): VenueId => `ven_${token(rng)}`;
export const newObjectId = (rng?: RNG): ObjectId => `obj_${token(rng)}`;
export const newHouseholdId = (rng?: RNG): HouseholdId => `hh_${token(rng)}`;
export const newPetId = (rng?: RNG): PetId => `pet_${token(rng)}`;
export const newVehicleId = (rng?: RNG): VehicleId => `veh_${token(rng)}`;
export const newEventId = (rng?: RNG): EventId => `evt_${token(rng)}`;
export const newConversationId = (rng?: RNG): ConversationId => `conv_${token(rng)}`;
/** generic short id for sub-records (memories, moodlets, transactions…) */
export const shortId = (rng?: RNG, prefix = 'x'): string => `${prefix}_${token(rng)}`;
