/**
 * Draft state for the New Life flow (city → household → home & money → review).
 */
import { create } from 'zustand';
import type { AvatarParams, Gender, LatLng } from '@engine/core/types';
import type { PlayerSimSpec } from '@engine/gen/simgen';
import { randomAvatar } from '@/ui/avatar/avatarParams';

export interface DraftRegion {
  name: string;
  state?: string;
  stateCode?: string;
  center: LatLng;
}

export interface DraftMember extends PlayerSimSpec {
  id: string;
  avatar: AvatarParams;
}

export type ResidenceKind = 'apartment' | 'house' | 'room' | 'family_home';
export type VehicleKind = 'none' | 'used_car' | 'bicycle' | 'new_car';

export interface DraftPet {
  species: string;
  name: string;
}

export interface NewGameDraft {
  step: number;
  region: DraftRegion | null;
  members: DraftMember[];
  householdName: string;
  residence: ResidenceKind;
  startingCash: number;
  pets: DraftPet[];
  vehicle: VehicleKind;
  seed: string;
  name: string;

  setStep(step: number): void;
  setRegion(r: DraftRegion | null): void;
  addMember(partial?: Partial<DraftMember>): DraftMember;
  updateMember(id: string, patch: Partial<DraftMember>): void;
  removeMember(id: string): void;
  setHousehold(patch: Partial<Pick<NewGameDraft, 'householdName' | 'residence' | 'startingCash' | 'pets' | 'vehicle' | 'name'>>): void;
  reset(): void;
}

const FIRST_NAMES: Record<Gender, string[]> = {
  female: ['Ava', 'Maya', 'Nora', 'Isla', 'Zoe', 'Camila', 'Harper', 'Elena', 'Priya', 'June', 'Rosa', 'Leah', 'Sadie', 'Imani', 'Wren'],
  male: ['Leo', 'Miles', 'Eli', 'Jonah', 'Theo', 'Mateo', 'Cal', 'Owen', 'Dev', 'Rafael', 'Amir', 'Jude', 'Silas', 'Marcus', 'Wes'],
  nonbinary: ['Sam', 'Riley', 'Quinn', 'Rowan', 'Jules', 'Sage', 'Avery', 'Kai', 'Emerson', 'Blake', 'Robin', 'Ari', 'Remy', 'Charlie', 'Sky'],
};
const LAST_NAMES = ['Nguyen', 'Garcia', 'Okafor', 'Patel', 'Brooks', 'Kim', 'Rivera', 'Lindqvist', 'Hayes', 'Moreau', 'Delgado', 'Cohen', 'Whitaker', 'Torres', 'Baptiste', 'Novak', 'Adeyemi', 'Callahan'];

function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let memberCounter = 0;

export function randomMember(seedLast?: string): DraftMember {
  const gender = rnd<Gender>(['female', 'male', 'nonbinary', 'female', 'male']);
  const firstName = rnd(FIRST_NAMES[gender]);
  const lastName = seedLast ?? rnd(LAST_NAMES);
  const age = 18 + Math.floor(Math.random() * 30);
  return {
    id: `m${++memberCounter}_${Date.now().toString(36)}`,
    firstName,
    lastName,
    gender,
    age,
    traits: [],
    hobbies: [],
    careerId: 'unemployed',
    educationLevel: 'high_school',
    avatar: randomAvatar(gender),
    background: '',
    aspiration: '',
  };
}

function makeSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const useNewGameDraft = create<NewGameDraft>((set, get) => ({
  step: 0,
  region: null,
  members: [],
  householdName: '',
  residence: 'apartment',
  startingCash: 2500,
  pets: [],
  vehicle: 'none',
  seed: makeSeed(),
  name: '',

  setStep: (step) => set({ step }),
  setRegion: (region) => set({ region }),
  addMember: (partial) => {
    const first = get().members[0];
    const m = { ...randomMember(first?.lastName), ...(partial ?? {}) };
    if (get().members.length > 0 && !partial?.relationship) m.relationship = 'roommate';
    set({ members: [...get().members, m], householdName: get().householdName || `${m.lastName} household` });
    return m;
  },
  updateMember: (id, patch) => set({ members: get().members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }),
  removeMember: (id) => set({ members: get().members.filter((m) => m.id !== id) }),
  setHousehold: (patch) => set(patch),
  reset: () => set({ step: 0, region: null, members: [], householdName: '', residence: 'apartment', startingCash: 2500, pets: [], vehicle: 'none', seed: makeSeed(), name: '' }),
}));

export const CASH_PRESETS: { label: string; sub: string; amount: number; icon: string }[] = [
  { label: 'Broke', sub: 'Rent is due in two weeks.', amount: 300, icon: 'cash-remove' },
  { label: 'Modest', sub: 'A cushion, if you’re careful.', amount: 2500, icon: 'cash' },
  { label: 'Comfortable', sub: 'Room to make a plan.', amount: 12000, icon: 'cash-multiple' },
  { label: 'Trust fund', sub: 'Money isn’t the problem.', amount: 80000, icon: 'safe' },
];

export const RESIDENCE_OPTIONS: { id: ResidenceKind; label: string; sub: string; icon: string }[] = [
  { id: 'apartment', label: 'Apartment', sub: 'One bedroom, thin walls, your own lease.', icon: 'office-building' },
  { id: 'house', label: 'House', sub: 'A yard, a mortgage or a big rent check.', icon: 'home' },
  { id: 'room', label: 'Rented room', sub: 'Cheap, shared kitchen, roommates you didn’t pick.', icon: 'door' },
  { id: 'family_home', label: 'Family home', sub: 'No rent. Plenty of opinions.', icon: 'home-heart' },
];

export const VEHICLE_OPTIONS: { id: VehicleKind; label: string; sub: string; icon: string }[] = [
  { id: 'none', label: 'No vehicle', sub: 'Feet, buses, and rideshares.', icon: 'walk' },
  { id: 'bicycle', label: 'Bicycle', sub: 'Free to run, weather permitting.', icon: 'bike' },
  { id: 'used_car', label: 'Used car', sub: 'Runs. Mostly.', icon: 'car' },
  { id: 'new_car', label: 'New car', sub: 'Shiny, with a payment attached.', icon: 'car-sports' },
];

export const PET_SPECIES: { id: string; label: string; icon: string }[] = [
  { id: 'dog', label: 'Dog', icon: 'dog' },
  { id: 'cat', label: 'Cat', icon: 'cat' },
  { id: 'rabbit', label: 'Rabbit', icon: 'rabbit' },
  { id: 'hamster', label: 'Hamster', icon: 'rodent' },
  { id: 'bird', label: 'Bird', icon: 'bird' },
  { id: 'fish', label: 'Fish', icon: 'fish' },
  { id: 'reptile', label: 'Reptile', icon: 'snake' },
];

export const EDUCATION_OPTIONS: { id: NonNullable<PlayerSimSpec['educationLevel']>; label: string }[] = [
  { id: 'high_school' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'High school' },
  { id: 'ged' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'GED' },
  { id: 'some_college' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'Some college' },
  { id: 'associate' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'Associate' },
  { id: 'bachelor' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'Bachelor’s' },
  { id: 'master' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'Master’s' },
  { id: 'doctorate' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'Doctorate' },
  { id: 'none' as NonNullable<PlayerSimSpec['educationLevel']>, label: 'None' },
];

export const RELATIONSHIP_OPTIONS: { id: NonNullable<PlayerSimSpec['relationship']>; label: string }[] = [
  { id: 'spouse', label: 'Spouse' },
  { id: 'partner', label: 'Partner' },
  { id: 'child', label: 'Child' },
  { id: 'parent', label: 'Parent' },
  { id: 'sibling', label: 'Sibling' },
  { id: 'roommate', label: 'Roommate' },
];
