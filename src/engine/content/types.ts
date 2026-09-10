/**
 * Content catalog types. Data lives in the sibling files (objects.ts, careers.ts, …)
 * and is assembled into a single `ContentCatalog` in content/index.ts.
 */
import type {
  ActionCategory,
  BioCategory,
  CrimeId,
  EducationLevel,
  EffectBundle,
  HobbyId,
  HolidayId,
  ItemDef,
  ItemId,
  LifeStage,
  NeedId,
  ObjectCategory,
  OutcomeTable,
  PetSpecies,
  Requirement,
  SkillId,
  TraitId,
  VenueArchetype,
  Weekday,
} from '../core/types';

// ---------------------------------------------------------------------------
// Objects and their interactions
// ---------------------------------------------------------------------------
export interface InteractionDef {
  id: string;
  label: string;
  description?: string;
  category: ActionCategory;
  icon?: string;
  durationMinutes: number;
  effects: EffectBundle;
  outcomes?: OutcomeTable;
  requirements?: Requirement[];
  cost?: number;
  /** what need it satisfies (for autonomy) */
  satisfies?: NeedId[];
  autonomyWeight?: number;
  /** dirties the object per use */
  dirtiesBy?: number;
  /** wears the object per use */
  wearBy?: number;
  /** minimum life stage */
  minStage?: LifeStage;
  /** object must be on/off/clean/etc. */
  requiresState?: { on?: boolean; notBroken?: boolean; maxDirty?: number; unoccupied?: boolean; minCharge?: number };
  setsState?: { on?: boolean; occupied?: boolean };
  /** llm involvement */
  llm?: 'narrate' | 'adjudicate';
  /** consumes items from inventory/pantry */
  consumes?: { itemId: ItemId; qty: number }[];
  /** produces items */
  produces?: { itemId: ItemId; qty: number }[];
  /** tags for grouping in UI */
  group?: string;
}

export interface ObjectDef {
  id: string;
  name: string;
  category: ObjectCategory;
  description: string;
  icon: string;
  basePrice: number;
  /** quality tiers available 1..5, price multiplier per tier */
  tiers?: number[];
  interactions: InteractionDef[];
  /** ambient effects on the venue (e.g. decor improves environment) */
  ambient?: { comfort?: number; fun?: number; environment?: number; noise?: number };
  portable: boolean;
  /** durability: expected uses before breaking at tier 1 */
  durabilityUses: number;
  repairCost: number;
  /** monthly running cost (electricity etc) */
  runningCostMonthly?: number;
  /** requires electricity/water to function */
  requiresUtility?: 'electric' | 'water' | 'gas' | 'internet';
  /** default placement rooms */
  rooms?: string[];
  tags: string[];
}

// ---------------------------------------------------------------------------
// Recipes / food
// ---------------------------------------------------------------------------
export interface RecipeDef {
  id: string;
  name: string;
  ingredients: { itemId: ItemId; qty: number }[];
  requiresObject: string[]; // object def ids (any of)
  skillId: SkillId;
  minLevel: number;
  durationMinutes: number;
  servings: number;
  producesItemId: ItemId;
  /** hunger restored per serving at perfect quality */
  hunger: number;
  fun?: number;
  calories: number;
  healthy: number; // −1..1
  tags: string[];
}

// ---------------------------------------------------------------------------
// Skills / hobbies / traits
// ---------------------------------------------------------------------------
export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  icon: string;
  category: 'creative' | 'physical' | 'mental' | 'social' | 'practical' | 'professional';
  /** xp required per level 1..10 */
  xpCurve: number[];
  /** what unlocks at levels */
  unlocks: Record<number, string>;
}

export interface HobbyDef {
  id: HobbyId;
  name: string;
  icon: string;
  skillId?: SkillId;
  /** object def ids that enable it at home */
  objects: string[];
  /** venue archetypes where it can be pursued */
  venues: VenueArchetype[];
  costPerSession: number;
  fun: number;
  social: number;
  fitness?: number;
  stress: number; // negative = relaxes
  description: string;
  seasonal?: ('spring' | 'summer' | 'fall' | 'winter')[];
}

export interface TraitDef {
  id: TraitId;
  name: string;
  description: string;
  icon: string;
  category: 'personality' | 'lifestyle' | 'social' | 'mental' | 'physical' | 'quirk';
  /** conflicting traits */
  conflicts: TraitId[];
  /** need decay multipliers */
  needDecay?: Partial<Record<NeedId, number>>;
  /** skill xp multipliers */
  skillMult?: Partial<Record<SkillId, number>>;
  /** effects on relationship gains */
  socialMult?: number;
  stressMult?: number;
  /** flavor for LLM */
  llmHint: string;
}

// ---------------------------------------------------------------------------
// Careers
// ---------------------------------------------------------------------------
export interface CareerLevel {
  title: string;
  /** annual salary at cost-of-living 1.0 */
  salary: number;
  hourly?: number;
  hoursPerWeek: number;
  /** typical shift */
  shift: { start: number; end: number; days: Weekday[] };
  /** skills needed to be promoted to this level */
  requiredSkills: Partial<Record<SkillId, number>>;
  /** daily tasks label for narrative */
  tasks: string[];
  /** performance target per day */
  dailyPerformanceGain: number;
  remoteEligible: boolean;
}

export interface CareerDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  sector: 'service' | 'retail' | 'healthcare' | 'education' | 'tech' | 'trades' | 'creative' | 'public' | 'finance' | 'legal' | 'logistics' | 'hospitality' | 'science' | 'sales' | 'gig' | 'military' | 'criminal';
  /** venue archetypes that employ this career */
  venues: VenueArchetype[];
  levels: CareerLevel[];
  educationRequired: EducationLevel;
  /** skills relevant to performance */
  skills: SkillId[];
  /** background check disqualifies felonies */
  backgroundCheck: boolean;
  drugTest: boolean;
  /** stress per shift */
  stress: number;
  /** physical toll per shift */
  physical: number;
  uniform?: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------
export interface ProgramDef {
  id: string;
  name: string;
  level: EducationLevel;
  field: string;
  creditsRequired: number;
  termsTypical: number;
  tuitionPerTerm: number;
  courses: { name: string; skillId?: SkillId }[];
  venues: VenueArchetype[];
  prerequisites: EducationLevel;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export interface IllnessDef {
  id: string;
  name: string;
  description: string;
  kind: 'infection' | 'chronic' | 'mental' | 'injury' | 'condition';
  contagious: boolean;
  baseDurationDays: number;
  chronic: boolean;
  /** daily prevalence chance baseline */
  incidence: number;
  seasonal?: ('spring' | 'summer' | 'fall' | 'winter')[];
  /** per-day effects while active */
  effects: { health?: number; energy?: number; comfort?: number; fun?: number; stress?: number; hunger?: number };
  /** severity gain per day untreated */
  progression: number;
  /** treatment options */
  treatments: { label: string; venue: VenueArchetype | 'home'; cost: number; effectiveness: number; itemId?: ItemId }[];
  /** can kill if severity reaches 100 */
  lethal: boolean;
  symptoms: string[];
}

// ---------------------------------------------------------------------------
// Law
// ---------------------------------------------------------------------------
export interface CrimeDef {
  id: CrimeId;
  label: string;
  severity: 'infraction' | 'misdemeanor' | 'felony';
  /** chance of being caught baseline 0..1 (modified by heat, witnesses, venue safety) */
  detection: number;
  fineRange: [number, number];
  jailDaysRange: [number, number];
  probationDays: number;
  /** points on license */
  licensePoints?: number;
  description: string;
  /** typical potential gain (money) */
  gainRange?: [number, number];
  skillId?: SkillId;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export interface HolidayDef {
  id: HolidayId;
  name: string;
  /** fixed date, nth weekday, or computed */
  rule:
    | { kind: 'fixed'; month: number; day: number }
    | { kind: 'nth_weekday'; month: number; weekday: Weekday; n: number } // n = -1 for last
    | { kind: 'computed'; fn: (year: number) => { month: number; day: number } }
    | { kind: 'range'; month: number; from: number; to: number };
  federal: boolean;
  schoolClosed: boolean;
  businessesClosed: 'most' | 'some' | 'none';
  /** typical activities offered as actions */
  activities: { label: string; venue?: VenueArchetype | 'home'; cost: number; fun: number; social: number; durationMinutes: number }[];
  /** flavor for LLM & narration */
  description: string;
  /** mood effects */
  moodlet?: { emotion: string; label: string; intensity: number };
  /** shopping surge / cost effect */
  spendingMultiplier?: number;
  tags: string[];
}

export interface FestivalDef {
  id: string;
  name: string;
  /** season & typical month */
  month: number;
  /** venue archetypes where it happens */
  venues: VenueArchetype[];
  durationDays: number;
  ticketPrice: number;
  activities: { label: string; cost: number; fun: number; social: number; durationMinutes: number; skillId?: SkillId }[];
  description: string;
  crowd: number; // 0..1
  tags: string[];
}

// ---------------------------------------------------------------------------
// Venue archetypes
// ---------------------------------------------------------------------------
export interface ArchetypeDef {
  id: VenueArchetype;
  name: string;
  icon: string;
  /** google place types that map here (priority order) */
  googleTypes: string[];
  /** default objects instantiated here (def ids) with counts */
  objects: { defId: string; count: number; room?: string }[];
  rooms: string[];
  /** staff roles → career id */
  staff: { role: string; careerId: string; count: number }[];
  /** venue-level actions (not tied to objects) */
  actions: InteractionDef[];
  /** base price multiplier at google priceLevel 2 */
  basePrice: number;
  /** open hours fallback if google has none */
  defaultHours: { open: number; close: number; days: Weekday[] };
  capacity: number;
  /** ambient per-minute effects while present */
  ambient?: Partial<Record<NeedId, number>>;
  noiseByHour?: number[]; // 24 entries 0..100
  crowdByHour?: number[]; // 24 entries 0..1
  /** items sold here */
  sells?: ItemId[] | 'grocery' | 'convenience' | 'pharmacy' | 'clothing' | 'electronics' | 'furniture' | 'hardware' | 'pet' | 'books' | 'liquor';
  /** chance of random encounter with a stranger per hour */
  encounterRate: number;
  /** LLM description of ambience */
  llmHint: string;
  /** safety baseline */
  safety: number;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Pets / vehicles
// ---------------------------------------------------------------------------
export interface PetBreedDef {
  species: PetSpecies;
  breed: string;
  adoptionCost: number;
  purchaseCost: number;
  monthlyCost: number;
  lifespanYears: number;
  energy: number; // 0..1 activity need
  size: 'tiny' | 'small' | 'medium' | 'large';
  temperaments: string[];
  trainability: number;
}

export interface VehicleDef {
  make: string;
  model: string;
  kind: 'car' | 'truck' | 'suv' | 'motorcycle' | 'bicycle' | 'ebike' | 'scooter' | 'van';
  fuelType: 'gas' | 'diesel' | 'electric' | 'hybrid' | 'none';
  basePriceNew: number;
  mpg: number;
  tankGallons: number;
  seats: number;
  reliability: number; // 0..1
  insuranceMonthly: number;
  years: [number, number];
  tags: string[];
}

// ---------------------------------------------------------------------------
// Bio templates (for fallback bio generation)
// ---------------------------------------------------------------------------
export interface BioTemplate {
  category: BioCategory;
  secret: boolean;
  depth: number;
  /** templated text with {tokens} */
  text: string;
  /** conditions */
  minAge?: number;
  maxAge?: number;
  weight: number;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------
export interface ContentCatalog {
  objects: Record<string, ObjectDef>;
  items: Record<ItemId, ItemDef>;
  recipes: Record<string, RecipeDef>;
  skills: Record<SkillId, SkillDef>;
  hobbies: Record<HobbyId, HobbyDef>;
  traits: Record<TraitId, TraitDef>;
  careers: Record<string, CareerDef>;
  programs: Record<string, ProgramDef>;
  illnesses: Record<string, IllnessDef>;
  crimes: Record<CrimeId, CrimeDef>;
  holidays: Record<HolidayId, HolidayDef>;
  festivals: Record<string, FestivalDef>;
  archetypes: Record<VenueArchetype, ArchetypeDef>;
  petBreeds: PetBreedDef[];
  vehicles: VehicleDef[];
  bioTemplates: BioTemplate[];
  names: { first: Record<'male' | 'female' | 'nonbinary', string[]>; last: string[] };
}
