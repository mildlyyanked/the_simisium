/**
 * Core domain types for The Simisium.
 * PURE TypeScript — no React / React Native imports allowed in src/engine.
 * See docs/ARCHITECTURE.md for the contract these types implement.
 */

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------
export type SimId = `sim_${string}`;
export type VenueId = `ven_${string}`;
export type ObjectId = `obj_${string}`;
export type HouseholdId = `hh_${string}`;
export type PetId = `pet_${string}`;
export type VehicleId = `veh_${string}`;
export type EventId = `evt_${string}`;
export type ConversationId = `conv_${string}`;
export type AnyId = SimId | VenueId | ObjectId | HouseholdId | PetId | VehicleId | EventId | ConversationId;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
export interface SimTime {
  /** minutes since epoch (WorldState.epoch at 00:00 local) */
  minute: number;
}
export type Season = 'spring' | 'summer' | 'fall' | 'winter';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface CalendarDay {
  isoDate: string; // YYYY-MM-DD
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  weekday: Weekday;
  dayOfYear: number;
  season: Season;
  holidays: HolidayId[];
  isWeekend: boolean;
  isFederalHoliday: boolean;
  isSchoolDay: boolean;
}
export type HolidayId = string;

// ---------------------------------------------------------------------------
// Geography / Places
// ---------------------------------------------------------------------------
export interface LatLng {
  lat: number;
  lng: number;
}

export type VenueArchetype =
  | 'home'
  | 'apartment_building'
  | 'grocery'
  | 'convenience'
  | 'restaurant'
  | 'fast_food'
  | 'cafe'
  | 'bar'
  | 'nightclub'
  | 'gym'
  | 'park'
  | 'playground'
  | 'trail'
  | 'beach'
  | 'school'
  | 'daycare'
  | 'college'
  | 'library'
  | 'hospital'
  | 'clinic'
  | 'dentist'
  | 'pharmacy'
  | 'vet'
  | 'pet_store'
  | 'police'
  | 'fire_station'
  | 'courthouse'
  | 'jail'
  | 'dmv'
  | 'city_hall'
  | 'post_office'
  | 'bank'
  | 'atm'
  | 'office'
  | 'coworking'
  | 'factory'
  | 'warehouse'
  | 'retail'
  | 'clothing'
  | 'electronics'
  | 'furniture'
  | 'hardware'
  | 'bookstore'
  | 'mall'
  | 'liquor_store'
  | 'dispensary'
  | 'cinema'
  | 'theater'
  | 'concert_hall'
  | 'stadium'
  | 'arena'
  | 'museum'
  | 'zoo'
  | 'aquarium'
  | 'amusement_park'
  | 'bowling'
  | 'arcade'
  | 'casino'
  | 'church'
  | 'salon'
  | 'barber'
  | 'spa'
  | 'tattoo'
  | 'laundromat'
  | 'car_dealer'
  | 'car_rental'
  | 'gas_station'
  | 'ev_charger'
  | 'mechanic'
  | 'car_wash'
  | 'parking'
  | 'transit_stop'
  | 'train_station'
  | 'bus_station'
  | 'airport'
  | 'hotel'
  | 'community_center'
  | 'senior_center'
  | 'shelter'
  | 'cemetery'
  | 'funeral_home'
  | 'lawyer'
  | 'accountant'
  | 'insurance'
  | 'real_estate'
  | 'storage'
  | 'farmers_market'
  | 'bakery'
  | 'butcher'
  | 'florist'
  | 'thrift_store'
  | 'sports_field'
  | 'golf'
  | 'pool'
  | 'ice_rink'
  | 'climbing_gym'
  | 'yoga'
  | 'martial_arts'
  | 'dance_studio'
  | 'music_school'
  | 'art_studio'
  | 'unknown';

export interface OpeningPeriod {
  /** 0 = Sunday */
  day: Weekday;
  /** minutes since midnight, e.g. 540 = 09:00 */
  open: number;
  /** minutes since midnight; may exceed 1440 for after-midnight closing */
  close: number;
}

export interface GooglePlaceData {
  placeId: string;
  displayName: string;
  formattedAddress?: string;
  types: string[];
  primaryType?: string;
  location: LatLng;
  rating?: number;
  userRatingCount?: number;
  /** 0..4 (Google PRICE_LEVEL_FREE..VERY_EXPENSIVE) */
  priceLevel?: number;
  openingPeriods?: OpeningPeriod[];
  phone?: string;
  website?: string;
  editorialSummary?: string;
  /** short review excerpts used as LLM context */
  reviewSnippets?: string[];
  /** derived review themes, e.g. ["friendly staff", "long waits"] */
  reviewThemes?: string[];
  photoRef?: string;
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
  fetchedAt?: string;
}

export interface Room {
  id: string;
  name: string;
  objectIds: ObjectId[];
}

export interface Venue {
  id: VenueId;
  name: string;
  archetype: VenueArchetype;
  google?: GooglePlaceData;
  location: LatLng;
  address?: string;
  /** owner household if residential / owned business */
  ownerHouseholdId?: HouseholdId;
  rooms: Room[];
  objectIds: ObjectId[];
  /** how this place regards each controlled sim (regular, good tipper, trouble, banned) */
  standing?: Record<SimId, VenueStanding>;
  staffSimIds: SimId[];
  /** sims typically found here (regulars, residents) */
  regularSimIds: SimId[];
  capacity: number;
  /** derived price multiplier (1 = average) from Google priceLevel + region */
  priceMultiplier: number;
  /** 0..1 how nice / clean / safe */
  quality: number;
  cleanliness: number; // 0..100
  safety: number; // 0..100
  noise: number; // 0..100 current
  /** residential specifics */
  residence?: Residence;
  /** custom flags (e.g. "has_pool") */
  tags: string[];
  /** true if player has discovered it (shows on map) */
  discovered: boolean;
  /** last time any controlled sim visited */
  lastVisited?: number;
  /** narrative description (LLM generated, cached) */
  description?: string;
}

export interface Residence {
  kind: 'apartment' | 'house' | 'condo' | 'townhouse' | 'mobile_home' | 'dorm' | 'room';
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  tenure: 'rent' | 'own' | 'family' | 'shelter';
  monthlyRent?: number;
  mortgage?: LoanRef;
  marketValue: number;
  /** 0..100 physical condition; repairs raise it, time lowers it */
  condition: number;
  utilities: UtilityAccount[];
  hoaMonthly?: number;
  propertyTaxAnnual?: number;
  leaseEndsMinute?: number;
  landlordSimId?: SimId;
  furnishingLevel: number; // 0..100
  securitySystem: boolean;
  yard: boolean;
  garage: boolean;
  petsAllowed: boolean;
}

export interface UtilityAccount {
  kind: 'electric' | 'gas' | 'water' | 'internet' | 'trash' | 'phone' | 'streaming' | 'insurance_renters' | 'insurance_home';
  provider: string;
  monthlyCost: number;
  active: boolean;
  /** service cut when unpaid for this many cycles */
  unpaidCycles: number;
  dueDayOfMonth: number;
}

// ---------------------------------------------------------------------------
// Objects & items
// ---------------------------------------------------------------------------
export type ObjectCategory =
  | 'appliance'
  | 'furniture'
  | 'plumbing'
  | 'electronics'
  | 'decor'
  | 'fitness'
  | 'hobby'
  | 'kitchen'
  | 'outdoor'
  | 'vehicle'
  | 'tool'
  | 'toy'
  | 'pet'
  | 'commercial'
  | 'medical'
  | 'office'
  | 'misc';

export interface ObjectState {
  on?: boolean;
  dirty?: number; // 0..100
  broken?: boolean;
  /** 0..100, decreases with use */
  condition: number;
  occupiedBy?: SimId;
  contents?: Record<ItemId, number>;
  charge?: number; // 0..100 for battery devices
  custom?: Record<string, string | number | boolean>;
}

export interface ObjectInstance {
  id: ObjectId;
  defId: string;
  /** display name override */
  name?: string;
  venueId?: VenueId;
  roomId?: string;
  /** if carried by a sim */
  carriedBy?: SimId;
  ownerHouseholdId?: HouseholdId;
  state: ObjectState;
  purchasedAtMinute?: number;
  purchasePrice?: number;
  quality: number; // 1..5 tier
}

export type ItemId = string;

export interface ItemDef {
  id: ItemId;
  name: string;
  category: 'food' | 'drink' | 'ingredient' | 'medicine' | 'toiletry' | 'clothing' | 'pet_supply' | 'tool' | 'book' | 'gift' | 'ticket' | 'document' | 'misc' | 'alcohol' | 'cannabis' | 'tobacco' | 'electronics';
  basePrice: number;
  /** shelf-life in days, undefined = non-perishable */
  perishDays?: number;
  effects?: EffectBundle;
  /** nutrition for food */
  calories?: number;
  unit?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Needs, mood, body
// ---------------------------------------------------------------------------
export type NeedId = 'hunger' | 'thirst' | 'energy' | 'bladder' | 'hygiene' | 'social' | 'fun' | 'comfort';
export const NEED_IDS: readonly NeedId[] = ['hunger', 'thirst', 'energy', 'bladder', 'hygiene', 'social', 'fun', 'comfort'] as const;

export type Needs = Record<NeedId, number>;

export type EmotionId =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'anxious'
  | 'stressed'
  | 'bored'
  | 'energized'
  | 'tired'
  | 'inspired'
  | 'flirty'
  | 'embarrassed'
  | 'confident'
  | 'lonely'
  | 'grateful'
  | 'guilty'
  | 'proud'
  | 'jealous'
  | 'grieving'
  | 'scared'
  | 'focused'
  | 'playful'
  | 'sick'
  | 'uncomfortable'
  | 'tense'
  | 'relaxed'
  | 'nostalgic'
  | 'hopeful'
  | 'in_love';

export interface Moodlet {
  id: string;
  emotion: EmotionId;
  label: string;
  /** signed contribution to mood, roughly −30..+30 */
  intensity: number;
  source: string;
  startedAt: number;
  expiresAt: number; // minute
}

export interface MoodletSpec {
  emotion: EmotionId;
  label: string;
  intensity: number;
  durationMinutes: number;
  source?: string;
  /** replace existing moodlet with same id */
  id?: string;
}

export interface Illness {
  id: string;
  name: string;
  /** illness def id from content/illnesses */
  defId: string;
  severity: number; // 0..100
  startedAt: number;
  contagious: boolean;
  chronic: boolean;
  treated: boolean;
  diagnosed: boolean;
}

export interface Injury {
  id: string;
  name: string;
  bodyPart: string;
  severity: number;
  startedAt: number;
  healsAt: number;
  treated: boolean;
}

export interface Pregnancy {
  conceivedAt: number;
  dueAt: number;
  otherParentId?: SimId;
  known: boolean;
  complications: number;
}

export type AddictionKind = 'alcohol' | 'nicotine' | 'caffeine' | 'cannabis' | 'gambling' | 'gaming' | 'opioids';

export interface Body {
  health: number; // 0..100
  fitness: number; // 0..100
  /** kg */
  weight: number;
  heightCm: number;
  illnesses: Illness[];
  injuries: Injury[];
  pregnancy?: Pregnancy;
  disabilities: string[];
  addictions: Partial<Record<AddictionKind, number>>; // 0..100 dependency
  bloodAlcohol: number; // BAC
  caffeine: number; // mg equivalent
  cannabis: number; // 0..100 intoxication
  sleepDebtHours: number;
  immune: number; // 0..100
  /** minutes since last meal */
  lastAteAt: number;
  lastSleptAt: number;
  /** 'none' | 'basic' | 'employer' | 'marketplace' | 'medicaid' | 'medicare' */
  insurance: InsurancePlan;
  medications: string[];
  fertility: number; // 0..1
  alive: boolean;
  deathCause?: string;
  diedAt?: number;
}

export interface InsurancePlan {
  kind: 'none' | 'employer' | 'marketplace' | 'medicaid' | 'medicare' | 'parent';
  monthlyPremium: number;
  deductible: number;
  deductibleMet: number;
  copay: number;
  coinsurance: number; // 0..1 share patient pays after deductible
}

export type MentalCondition = 'depression' | 'anxiety_disorder' | 'ptsd' | 'adhd' | 'insomnia' | 'burnout' | 'eating_disorder';

export interface Mind {
  stress: number; // 0..100
  /** derived; cached each tick */
  mood: number; // −100..100
  moodlets: Moodlet[];
  conditions: MentalCondition[];
  therapy: boolean;
  /** long-term life satisfaction 0..100 */
  satisfaction: number;
  /** current dominant emotion label for UI */
  dominantEmotion: EmotionId;
}

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------
export type TraitId = string;

export interface Personality {
  openness: number; // 0..1
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  traits: TraitId[];
  /** 0..1 how much they value each */
  values: {
    family: number;
    career: number;
    wealth: number;
    adventure: number;
    community: number;
    faith: number;
    creativity: number;
    health: number;
    knowledge: number;
    pleasure: number;
  };
  /** LLM voice hints */
  speechStyle: string;
  humor: number; // 0..1
  honesty: number; // 0..1
  ambition: number; // 0..1
  libido: number; // 0..1
  riskTolerance: number; // 0..1
  politics: 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'apolitical';
  religion?: string;
  sexuality: 'straight' | 'gay' | 'bi' | 'ace' | 'pan' | 'questioning';
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------
export type SkillId = string;
export interface SkillState {
  level: number; // 0..10
  xp: number;
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------
export type EducationLevel = 'none' | 'elementary' | 'middle' | 'high_school' | 'ged' | 'some_college' | 'associate' | 'bachelor' | 'master' | 'doctorate' | 'professional';

export interface Enrollment {
  institutionVenueId?: VenueId;
  institutionName: string;
  program: string;
  level: EducationLevel;
  startedAt: number;
  expectedGraduationAt: number;
  creditsEarned: number;
  creditsRequired: number;
  gpa: number;
  tuitionPerTerm: number;
  courses: Course[];
  attendanceRate: number; // 0..1
  status: 'enrolled' | 'probation' | 'suspended' | 'graduated' | 'dropped';
}

export interface Course {
  id: string;
  name: string;
  skillId?: SkillId;
  grade: number; // 0..100
  homeworkDue?: number;
  homeworkDone: boolean;
  examAt?: number;
}

export interface Degree {
  level: EducationLevel;
  field: string;
  institution: string;
  earnedAt: number;
  gpa: number;
}

export interface Education {
  highestLevel: EducationLevel;
  enrollment?: Enrollment;
  degrees: Degree[];
  certifications: string[];
  /** K-12 grade if child */
  grade?: number;
}

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------
export type CareerId = string;

export interface ShiftBlock {
  day: Weekday;
  start: number; // minutes since midnight
  end: number;
}

export interface Job {
  id: string;
  careerId: CareerId;
  title: string;
  level: number;
  employerName: string;
  employerVenueId?: VenueId;
  bossSimId?: SimId;
  coworkerSimIds: SimId[];
  /** hourly or annual */
  payType: 'hourly' | 'salary' | 'gig' | 'commission';
  hourlyRate?: number;
  annualSalary?: number;
  shifts: ShiftBlock[];
  remote: boolean;
  startedAt: number;
  performance: number; // 0..100
  /** progress to next promotion 0..100 */
  promotionProgress: number;
  warnings: number;
  ptoHoursBalance: number;
  sickHoursBalance: number;
  benefits: { health: boolean; retirement401k: boolean; matchPct: number; dental: boolean };
  hoursWorkedThisPeriod: number;
  lastPaidAt: number;
  payFrequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  status: 'active' | 'suspended' | 'notice';
}

export interface JobApplication {
  id: string;
  careerId: CareerId;
  employerName: string;
  employerVenueId?: VenueId;
  level: number;
  appliedAt: number;
  interviewAt?: number;
  status: 'applied' | 'interview' | 'offer' | 'rejected' | 'accepted' | 'withdrawn';
  offer?: { hourlyRate?: number; annualSalary?: number; startAt: number };
}

export interface Career {
  job?: Job;
  secondJob?: Job;
  history: { title: string; employer: string; from: number; to?: number; reason?: string }[];
  applications: JobApplication[];
  unemployment?: { weeklyBenefit: number; weeksLeft: number; lastPaidAt: number };
  gig: { platformsJoined: string[]; rating: number; completed: number };
  reputation: number; // 0..100 professional reputation
  retired: boolean;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------
export type AccountKind = 'cash' | 'checking' | 'savings' | 'credit_card' | 'retirement' | 'brokerage' | 'hsa';

export interface Account {
  id: string;
  kind: AccountKind;
  bankName: string;
  balance: number; // for credit cards, balance = amount owed (positive)
  creditLimit?: number;
  apr?: number; // e.g. 0.249
  apy?: number;
  openedAt: number;
  minPaymentDueAt?: number;
  minPaymentAmount?: number;
  overdraftFeesThisMonth: number;
  frozen: boolean;
}

export interface LoanRef {
  id: string;
  kind: 'student' | 'auto' | 'mortgage' | 'personal' | 'payday' | 'medical';
  lender: string;
  principal: number;
  balance: number;
  apr: number;
  monthlyPayment: number;
  nextDueAt: number;
  missedPayments: number;
  termMonths: number;
  startedAt: number;
  /** collateral */
  collateralId?: VehicleId | VenueId;
  inDefault: boolean;
  deferred: boolean;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;
  dueDayOfMonth: number;
  category: 'rent' | 'mortgage' | 'utility' | 'subscription' | 'insurance' | 'loan' | 'phone' | 'childcare' | 'tuition' | 'other';
  autopay: boolean;
  lastPaidAt?: number;
  missed: number;
  linkedId?: string;
}

export interface Transaction {
  id: string;
  at: number;
  amount: number; // negative = spend
  accountId: string;
  memo: string;
  category: string;
  counterparty?: string;
  venueId?: VenueId;
}

export interface Finance {
  accounts: Account[];
  loans: LoanRef[];
  bills: RecurringBill[];
  creditScore: number; // 300..850
  transactions: Transaction[]; // capped
  taxes: {
    ytdIncome: number;
    ytdWithheld: number;
    filedYears: number[];
    owed: number;
    refundPending: number;
  };
  /** monthly budget targets by category */
  budget: Record<string, number>;
  netWorthHistory: { at: number; value: number }[];
  /** government benefits */
  benefits: { snap: number; unemployment: boolean; socialSecurity: number; disability: number };
}

// ---------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------
export type CrimeId = string;

export interface Charge {
  id: string;
  crimeId: CrimeId;
  label: string;
  severity: 'infraction' | 'misdemeanor' | 'felony';
  at: number;
  status: 'pending' | 'dismissed' | 'convicted' | 'acquitted' | 'plea';
  courtDateAt?: number;
  fine?: number;
  jailDays?: number;
  probationDays?: number;
  arrestingVenueId?: VenueId;
}

export interface LegalRecord {
  charges: Charge[];
  warrants: { chargeId: string; issuedAt: number }[];
  license: { status: 'none' | 'permit' | 'valid' | 'suspended' | 'revoked' | 'expired'; expiresAt?: number; points: number };
  tickets: { id: string; kind: string; amount: number; issuedAt: number; dueAt: number; paid: boolean; contested: boolean }[];
  incarceratedUntil?: number;
  probationUntil?: number;
  lawyerSimId?: SimId;
  /** criminal skill / heat 0..100, police attention */
  heat: number;
  civil: { lawsuits: { id: string; vs: string; amount: number; status: string }[] };
}

// ---------------------------------------------------------------------------
// Relationships & memory & bio
// ---------------------------------------------------------------------------
export type RelationshipFlag =
  | 'acquaintance'
  | 'friend'
  | 'good_friend'
  | 'best_friend'
  | 'enemy'
  | 'rival'
  | 'crush'
  | 'dating'
  | 'partner'
  | 'engaged'
  | 'married'
  | 'ex'
  | 'divorced'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'grandparent'
  | 'grandchild'
  | 'aunt_uncle'
  | 'niece_nephew'
  | 'cousin'
  | 'in_law'
  | 'step_parent'
  | 'step_child'
  | 'roommate'
  | 'neighbor'
  | 'coworker'
  | 'boss'
  | 'employee'
  | 'teacher'
  | 'student'
  | 'classmate'
  | 'doctor'
  | 'patient'
  | 'landlord'
  | 'tenant'
  | 'client'
  | 'service_provider'
  | 'blocked'
  | 'affair'
  | 'mentor'
  | 'mentee';

export interface RelationshipFlagChange {
  flag: RelationshipFlag;
  op: 'add' | 'remove';
}

export interface Relationship {
  simId: SimId;
  friendship: number; // −100..100
  romance: number; // −100..100
  trust: number; // −100..100
  familiarity: number; // 0..100 how well they know each other
  attraction: number; // 0..100 from other's POV
  flags: RelationshipFlag[];
  firstMetAt?: number;
  lastInteractedAt?: number;
  interactionsCount: number;
  /** what this sim owes/promised the other */
  promises: { id: string; text: string; madeAt: number; dueAt?: number; kept?: boolean }[];
  /** unresolved grievances */
  grudges: { text: string; at: number; weight: number }[];
  /** debts between people */
  moneyOwed: number; // positive = other owes this sim
  /** slow-arc moments reached with this person (met, first real talk, first text, hung out, came over…) */
  milestones?: { id: string; at: number }[];
  /** decay pause (e.g. family) */
  decayRate: number; // per day
}

export type MemoryKind = 'interaction' | 'event' | 'observation' | 'promise' | 'conflict' | 'milestone' | 'gossip' | 'summary' | 'conversation';

export interface Memory {
  id: string;
  kind: MemoryKind;
  at: number;
  text: string;
  /** who was involved */
  participants: SimId[];
  venueId?: VenueId;
  /** 0..100 how important; decays */
  salience: number;
  /** emotional valence −1..1 */
  valence: number;
  tags: string[];
}

export interface MemorySpec {
  kind: MemoryKind;
  text: string;
  participants?: SimId[];
  salience?: number;
  valence?: number;
  tags?: string[];
}

export type BioCategory =
  | 'origin'
  | 'family'
  | 'childhood'
  | 'education'
  | 'career'
  | 'romance'
  | 'health'
  | 'money'
  | 'hobby'
  | 'belief'
  | 'secret'
  | 'fear'
  | 'dream'
  | 'habit'
  | 'quirk'
  | 'relationship'
  | 'trauma'
  | 'achievement'
  | 'daily_life'
  | 'opinion';

export interface BioFact {
  id: string;
  category: BioCategory;
  text: string;
  /** secrets need high trust to reveal */
  secret: boolean;
  /** 0..100 minimum familiarity typically needed to learn it */
  depth: number;
  revealedTo: SimId[];
  revealedAt?: Record<SimId, number>;
}

export interface Bio {
  /** one-paragraph summary visible to the LLM only */
  summary: string;
  facts: BioFact[];
  generated: boolean;
  generatedBy?: 'llm' | 'fallback';
  /** the prompt seed that generated this bio, kept for consistency */
  seed: string;
}

// ---------------------------------------------------------------------------
// Schedule / location / actions
// ---------------------------------------------------------------------------
export type RoutineKind = 'sleep' | 'work' | 'school' | 'commute' | 'meal' | 'gym' | 'errand' | 'social' | 'hobby' | 'chores' | 'worship' | 'free' | 'childcare';

export interface RoutineBlock {
  day: Weekday | 'weekday' | 'weekend' | 'daily';
  start: number; // minutes since midnight
  end: number;
  kind: RoutineKind;
  venueId?: VenueId;
  label?: string;
}

export interface SimLocation {
  venueId: VenueId;
  roomId?: string;
  arrivedAt: number;
  /** tile position inside the venue's floor plan (see VenueLayout); derived when absent */
  pos?: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Floor plans: a deterministic tile layout per venue so people and objects have places
// ---------------------------------------------------------------------------
export interface LayoutRoom {
  id: string;
  name: string;
  /** rect in tiles, walls included (the border ring is wall) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VenueLayout {
  venueId: VenueId;
  version: number;
  width: number;
  height: number;
  rooms: LayoutRoom[];
  /** wall tiles that are passable */
  doors: { x: number; y: number }[];
  /** the door to the outside, and the floor tile just inside it */
  entrance: { x: number; y: number };
  entranceInside: { x: number; y: number };
  /** object tile positions (one tile per object) */
  objects: Record<ObjectId, { x: number; y: number }>;
}

export type TravelMode = 'walk' | 'bike' | 'drive' | 'transit' | 'rideshare' | 'taxi' | 'carpool' | 'scooter' | 'fly';

export interface Travel {
  fromVenueId: VenueId;
  toVenueId: VenueId;
  mode: TravelMode;
  departedAt: number;
  arriveAt: number;
  vehicleId?: VehicleId;
  cost: number;
}

export interface CurrentAction {
  actionId: string;
  label: string;
  startedAt: number;
  endsAt: number;
  targetId?: string;
  interruptible: boolean;
  /** effect bundle applied per minute */
  perMinute?: Partial<Record<NeedId, number>>;
}

export type ActionCategory =
  | 'needs'
  | 'social'
  | 'romance'
  | 'work'
  | 'school'
  | 'travel'
  | 'shop'
  | 'object'
  | 'phone'
  | 'hobby'
  | 'fitness'
  | 'chores'
  | 'finance'
  | 'legal'
  | 'health'
  | 'pet'
  | 'family'
  | 'entertainment'
  | 'civic'
  | 'freeform'
  | 'system';

export interface Requirement {
  kind:
    | 'money'
    | 'skill'
    | 'item'
    | 'object_state'
    | 'time_window'
    | 'venue_open'
    | 'age'
    | 'relationship'
    | 'need'
    | 'flag'
    | 'license'
    | 'vehicle'
    | 'not_incarcerated'
    | 'energy'
    | 'custom';
  /** human-readable reason shown when unmet */
  reason: string;
  /** predicate evaluated by actions.ts; params vary by kind */
  params?: Record<string, unknown>;
}

export interface Outcome {
  weight: number;
  label: string;
  effects: EffectBundle;
  /** skill that biases weight; each level adds `skillBias` weight */
  skillId?: SkillId;
  skillBias?: number;
}

export interface OutcomeTable {
  outcomes: Outcome[];
}

export interface ActionDef {
  id: string;
  label: string;
  description?: string;
  category: ActionCategory;
  icon?: string;
  target?: { kind: 'object' | 'sim' | 'venue' | 'pet' | 'item' | 'vehicle'; id: string; name?: string };
  durationMinutes: number;
  cost?: MoneyAmount;
  requirements?: Requirement[];
  effects: EffectBundle;
  outcomes?: OutcomeTable;
  llm?: 'narrate' | 'adjudicate' | 'converse';
  autonomyWeight?: number;
  /** which need this satisfies most, for autonomy scoring */
  satisfies?: NeedId[];
  interruptible?: boolean;
  /** hidden from menus (used by autonomy only) */
  hidden?: boolean;
  /** group label for the action sheet */
  group?: string;
  /** free-form params supplied by UI (e.g. text for freeform) */
  params?: Record<string, unknown>;
}

export interface MoneyAmount {
  amount: number;
  account?: AccountKind;
  memo: string;
  counterparty?: string;
  category?: string;
}

export interface LegalEffect {
  kind: 'charge' | 'ticket' | 'warrant' | 'arrest' | 'license' | 'heat' | 'release';
  crimeId?: CrimeId;
  label?: string;
  amount?: number;
  severity?: Charge['severity'];
  delta?: number;
  licenseStatus?: LegalRecord['license']['status'];
}

export interface ScheduledEventSpec {
  inMinutes?: number;
  atMinute?: number;
  kind: string;
  label: string;
  simId?: SimId;
  venueId?: VenueId;
  payload?: Record<string, unknown>;
}

export interface EffectBundle {
  needs?: Partial<Record<NeedId, number>>;
  perMinute?: Partial<Record<NeedId, number>>;
  money?: MoneyAmount;
  skills?: Partial<Record<SkillId, number>>;
  moodlets?: MoodletSpec[];
  stress?: number;
  health?: number;
  fitness?: number;
  weight?: number;
  bloodAlcohol?: number;
  caffeine?: number;
  cannabis?: number;
  relationships?: {
    simId: SimId;
    friendship?: number;
    romance?: number;
    trust?: number;
    familiarity?: number;
    attraction?: number;
    flags?: RelationshipFlagChange[];
    /** apply symmetrically to the other side */
    mutual?: boolean;
  }[];
  revealFacts?: { simId: SimId; factIds: string[]; to: SimId }[];
  memories?: MemorySpec[];
  items?: { op: 'gain' | 'lose'; itemId: ItemId; qty: number }[];
  objects?: { objectId: ObjectId; patch: Partial<ObjectState> }[];
  legal?: LegalEffect[];
  schedule?: ScheduledEventSpec[];
  moveTo?: { venueId: VenueId; roomId?: string };
  timeElapsedMinutes?: number;
  flags?: Record<string, string | number | boolean>;
  /** pet effects */
  pet?: { petId: PetId; needs?: Partial<Record<PetNeedId, number>>; bond?: number; training?: number }[];
  /** venue effects */
  venue?: { venueId: VenueId; cleanliness?: number; noise?: number; safety?: number }[];
  /** cancel current action of a sim */
  interrupt?: SimId[];
  /** custom hooks handled by systems via event */
  custom?: { kind: string; payload?: Record<string, unknown> }[];
}

// ---------------------------------------------------------------------------
// Sim
// ---------------------------------------------------------------------------
export type Gender = 'male' | 'female' | 'nonbinary';
export type LifeStage = 'infant' | 'toddler' | 'child' | 'teen' | 'young_adult' | 'adult' | 'middle_aged' | 'senior';
export type SimLOD = 'full' | 'near' | 'far';

export interface Identity {
  firstName: string;
  lastName: string;
  nickname?: string;
  gender: Gender;
  pronouns: string; // "she/her"
  /** ISO date */
  birthDate: string;
  heritage: string;
  appearance: {
    hair: string;
    eyes: string;
    build: string;
    style: string;
    distinguishing: string[];
    /** procedural avatar params */
    avatar: AvatarParams;
    /** set once a realistic portrait was generated (the image itself lives outside the save) */
    portrait?: 'generated';
  };
  voice: string;
  hometown: string;
}

export interface AvatarParams {
  skin: string;
  hair: string;
  hairStyle: number;
  eye: string;
  faceShape: number;
  accessory: number;
  clothing: string;
  facialHair: number;
  glasses: boolean;
}

export interface Sim {
  id: SimId;
  identity: Identity;
  lifeStage: LifeStage;
  personality: Personality;
  needs: Needs;
  body: Body;
  mind: Mind;
  skills: Record<SkillId, SkillState>;
  education: Education;
  career: Career;
  finance: Finance;
  legal: LegalRecord;
  relationships: Record<SimId, Relationship>;
  memory: Memory[];
  bio: Bio;
  schedule: RoutineBlock[];
  inventory: { objectIds: ObjectId[]; consumables: Record<ItemId, number>; wearing: string[] };
  location: SimLocation;
  travel?: Travel;
  currentAction?: CurrentAction;
  householdId?: HouseholdId;
  isPlayerControlled: boolean;
  lod: SimLOD;
  /** role in the world if NPC: e.g. { role: 'barista', venueId } */
  role?: { role: string; venueId?: VenueId; title?: string };
  hobbies: HobbyId[];
  /** phone & social */
  phone: PhoneState;
  /** free flags for story/quest state */
  flags: Record<string, string | number | boolean>;
  /** goals/aspirations, LLM-visible */
  aspirations: Aspiration[];
  createdAt: number;
  /** last full tick minute (for LOD catch-up) */
  lastSimulatedAt: number;
  /** reputation −100..100 in community */
  reputation: number;
  /** visible summary for other characters (LLM), regenerated when things change */
  publicSummary?: string;
}

export type HobbyId = string;

export interface Aspiration {
  id: string;
  text: string;
  category: 'career' | 'family' | 'wealth' | 'knowledge' | 'creativity' | 'social' | 'health' | 'adventure' | 'home';
  progress: number; // 0..100
  completed: boolean;
  milestones: { text: string; done: boolean }[];
}

export interface PhoneState {
  number: string;
  contacts: SimId[];
  threads: Record<SimId, TextMessage[]>;
  missedCalls: { from: SimId; at: number }[];
  notifications: PhoneNotification[];
  apps: string[];
  socialMedia: { followers: number; posts: number; lastPostAt?: number; platform: string }[];
  battery: number;
  plan: { provider: string; monthly: number; active: boolean };
  dataUsed: number;
}

export interface TextMessage {
  id: string;
  from: SimId;
  to: SimId;
  at: number;
  text: string;
  read: boolean;
}

export interface PhoneNotification {
  id: string;
  at: number;
  app: string;
  title: string;
  body: string;
  read: boolean;
  actionId?: string;
}

// ---------------------------------------------------------------------------
// Household / pets / vehicles
// ---------------------------------------------------------------------------
export interface Household {
  id: HouseholdId;
  name: string;
  simIds: SimId[];
  homeVenueId: VenueId;
  petIds: PetId[];
  vehicleIds: VehicleId[];
  /** shared finances toggle */
  sharedFinances: boolean;
  /** household consumables (fridge/pantry) live on the home venue objects; this is the pantry roll-up */
  pantry: Record<ItemId, number>;
  chores: { id: string; label: string; dirtiness: number; assignedTo?: SimId }[];
  createdAt: number;
  /** mail waiting at home */
  mail: MailItem[];
  packages: { id: string; itemId: ItemId; qty: number; arrivesAt: number; from: string }[];
}

export interface MailItem {
  id: string;
  at: number;
  from: string;
  subject: string;
  body: string;
  kind: 'bill' | 'letter' | 'notice' | 'junk' | 'check' | 'summons' | 'tax' | 'invitation';
  amount?: number;
  read: boolean;
  actionId?: string;
}

export type PetSpecies = 'dog' | 'cat' | 'rabbit' | 'hamster' | 'bird' | 'fish' | 'reptile';
export type PetNeedId = 'hunger' | 'thirst' | 'energy' | 'bladder' | 'hygiene' | 'play' | 'affection';

export interface Pet {
  id: PetId;
  name: string;
  species: PetSpecies;
  breed: string;
  birthDate: string;
  gender: 'male' | 'female';
  needs: Record<PetNeedId, number>;
  health: number;
  weight: number;
  training: number; // 0..100
  temperament: string;
  bonds: Record<SimId, number>; // 0..100
  householdId?: HouseholdId;
  location: { venueId: VenueId };
  illnesses: Illness[];
  vaccinated: boolean;
  spayedNeutered: boolean;
  microchipped: boolean;
  licensed: boolean;
  alive: boolean;
  adoptedAt: number;
  lastVetAt?: number;
  monthlyCost: number;
  quirks: string[];
}

export interface Vehicle {
  id: VehicleId;
  kind: 'car' | 'truck' | 'suv' | 'motorcycle' | 'bicycle' | 'ebike' | 'scooter' | 'van';
  make: string;
  model: string;
  year: number;
  color: string;
  ownerHouseholdId?: HouseholdId;
  value: number;
  mileage: number;
  fuel: number; // 0..100 (or charge for EV)
  fuelType: 'gas' | 'diesel' | 'electric' | 'hybrid' | 'none';
  tankGallons: number;
  mpg: number;
  condition: number; // 0..100
  registrationExpiresAt?: number;
  insurance?: { provider: string; monthly: number; active: boolean; coverage: 'liability' | 'full' };
  loan?: LoanRef;
  location: { venueId: VenueId };
  seats: number;
  issues: string[];
  parkedIllegally: boolean;
}

// ---------------------------------------------------------------------------
// Region / weather / economy / calendar events
// ---------------------------------------------------------------------------
export type ClimateProfile = 'humid_subtropical' | 'hot_desert' | 'mediterranean' | 'humid_continental' | 'marine_west_coast' | 'semi_arid' | 'tropical' | 'subarctic';

export interface Region {
  name: string;
  state: string;
  stateCode: string;
  center: LatLng;
  timezone: string;
  /** 1.0 = US average */
  costOfLiving: number;
  climate: ClimateProfile;
  salesTax: number;
  stateIncomeTax: number;
  population: number;
  /** derived: 'urban' | 'suburban' | 'rural' */
  density: 'urban' | 'suburban' | 'rural';
  transitQuality: number; // 0..1
  walkability: number; // 0..1
  crimeIndex: number; // 0..1
  medianRent1br: number;
  medianHomePrice: number;
  minimumWage: number;
  /** local flavor for the LLM */
  culture: string;
}

export type WeatherCondition = 'clear' | 'partly_cloudy' | 'cloudy' | 'rain' | 'heavy_rain' | 'thunderstorm' | 'snow' | 'sleet' | 'fog' | 'windy' | 'heat_wave' | 'hurricane' | 'tornado_watch' | 'smoke';

export interface Weather {
  condition: WeatherCondition;
  tempF: number;
  humidity: number;
  windMph: number;
  precipChance: number;
  uv: number;
  sunriseMinute: number; // minutes since midnight
  sunsetMinute: number;
  /** severe weather alert text */
  alert?: string;
}

export interface WeatherState {
  current: Weather;
  forecast: { isoDate: string; hi: number; lo: number; condition: WeatherCondition; precipChance: number }[];
}

export interface Economy {
  gasPrice: number;
  inflationIndex: number; // 1.0 at start
  primeRate: number;
  mortgageRate: number;
  savingsApy: number;
  jobMarketHeat: number; // 0..1
  stockIndex: number; // 100 at start
  rentIndex: number;
  unemploymentRate: number;
}

export interface ScheduledEvent {
  id: EventId;
  atMinute: number;
  kind: string;
  label: string;
  simId?: SimId;
  venueId?: VenueId;
  payload?: Record<string, unknown>;
  /** shown on calendar */
  visible: boolean;
  recurring?: { everyMinutes: number };
}

export interface LogEntry {
  id: string;
  at: number;
  text: string;
  kind: 'narrative' | 'dialogue' | 'system' | 'money' | 'relationship' | 'alert' | 'need' | 'event' | 'travel' | 'phone' | 'llm';
  simId?: SimId;
  speakerId?: SimId;
  venueId?: VenueId;
  importance: number; // 0..3
  meta?: Record<string, unknown>;
}

export interface ConversationTurn {
  speakerId: SimId | 'narrator';
  text: string;
  at: number;
  /** freeform action attempted by player, if any */
  action?: string;
}

export interface Conversation {
  id: ConversationId;
  participantIds: SimId[];
  venueId: VenueId;
  startedAt: number;
  lastTurnAt: number;
  turns: ConversationTurn[];
  /** running LLM summary once turns exceed threshold */
  summary?: string;
  channel: 'in_person' | 'phone' | 'text' | 'video';
  active: boolean;
  topic?: string;
}

export interface VenueStanding {
  score: number; // −100..100
  visits: number;
  lastVisitAt: number;
  /** short remembered facts: "tips well", "caused a scene" */
  notes: string[];
  bannedUntil?: number;
}

export interface DilemmaOption {
  id: string;
  label: string;
  hint?: string;
}

/** A hard choice with a clock. Unanswered by the deadline, the default happens. */
export interface Dilemma {
  id: string;
  templateId: string;
  simId: SimId;
  title: string;
  body: string;
  createdAt: number;
  deadlineAt: number;
  options: DilemmaOption[];
  defaultOptionId: string;
  /** people and numbers this instance is about */
  actors: Record<string, SimId>;
  amounts: Record<string, number>;
  resolved?: { optionId: string; at: number; byDeadline: boolean };
  /** 'llm' when the model wrote it from this life; 'template' for the offline catalog */
  source?: 'llm' | 'template';
  /** consequences of each option when the model wrote the dilemma (stored, then deterministic) */
  generated?: Record<string, GeneratedConsequence>;
}

export interface GeneratedFollowUp {
  inDays: number;
  chance: number; // 0..1
  text: string;
  effects?: EffectBundle;
  otherEffects?: Record<SimId, EffectBundle>;
}

export interface GeneratedConsequence {
  narration: string;
  effects: EffectBundle;
  otherEffects?: Record<SimId, EffectBundle>;
  flags?: string[];
  followUps: GeneratedFollowUp[];
}

/** A dilemma as the model returns it, before it becomes state. */
export interface GeneratedDilemma {
  title: string;
  body: string;
  deadlineHours: number;
  defaultOptionId: string;
  options: { id: string; label: string; hint?: string; consequence: GeneratedConsequence }[];
  /** people the dilemma is about (resolved sim ids) */
  actors: SimId[];
}

export interface NewsEffects {
  transitDown?: boolean;
  rideshareSurge?: number;
  gasMultiplier?: number;
  travelMultiplier?: number;
  contagionMultiplier?: number;
  priceMultiplier?: number;
  layoffRisk?: boolean;
  closedVenueId?: VenueId;
  moodlet?: { emotion: string; label: string; intensity: number };
}

/** Something happening to the whole city for a few days. */
export interface NewsItem {
  id: string;
  kind: string;
  headline: string;
  body: string;
  startedAt: number;
  endsAt: number;
  effects: NewsEffects;
  venueId?: VenueId;
}

export interface FeedPost {
  id: string;
  simId: SimId;
  at: number;
  text: string;
  likes: number;
  venueId?: VenueId;
  kind: 'life' | 'work' | 'hobby' | 'news' | 'reply';
  /** post this replies to */
  replyTo?: string;
}

export interface WorldMeta {
  saveId: string;
  version: number;
  seed: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  llmCalls: number;
  llmCostUsd: number;
  llmTokens: number;
}

export interface WorldStats {
  daysPlayed: number;
  actionsTaken: number;
  moneyEarned: number;
  moneySpent: number;
  conversations: number;
  simsMet: number;
  placesVisited: number;
  arrests: number;
  promotions: number;
  births: number;
  deaths: number;
}

export interface PlayerState {
  householdId: HouseholdId;
  activeSimId: SimId;
  controlledSimIds: SimId[];
  /** venue ids the player has bookmarked */
  favorites: VenueId[];
  /** UI hints such as tutorial progress */
  tutorial: Record<string, boolean>;
}

export interface WorldState {
  meta: WorldMeta;
  time: SimTime;
  /** ISO date of minute 0, e.g. "2026-09-10" */
  epoch: string;
  region: Region;
  venues: Record<VenueId, Venue>;
  sims: Record<SimId, Sim>;
  households: Record<HouseholdId, Household>;
  pets: Record<PetId, Pet>;
  objects: Record<ObjectId, ObjectInstance>;
  vehicles: Record<VehicleId, Vehicle>;
  player: PlayerState;
  weather: WeatherState;
  economy: Economy;
  scheduled: ScheduledEvent[];
  log: LogEntry[];
  conversations: Record<ConversationId, Conversation>;
  /** floor plans, generated lazily and kept so they stay consistent */
  layouts: Record<VenueId, VenueLayout>;
  dilemmas: Dilemma[];
  news: NewsItem[];
  feed: FeedPost[];
  rngState: number[];
  stats: WorldStats;
  /** places cache: placeId → data (so worlds stay stable offline) */
  placesCache: Record<string, GooglePlaceData>;
  /** world-level flags & story state */
  flags: Record<string, string | number | boolean>;
  /** pending interrupts the UI must resolve (e.g. phone call, police) */
  pendingInterrupts: Interrupt[];
}

export interface Interrupt {
  id: string;
  at: number;
  kind: 'need_critical' | 'phone_call' | 'text' | 'visitor' | 'emergency' | 'police' | 'event' | 'death' | 'birth' | 'weather' | 'fire' | 'accident' | 'delivery' | 'reminder';
  title: string;
  body: string;
  simId?: SimId;
  fromSimId?: SimId;
  /** actions offered to resolve; ids executable through Engine.performAction */
  options: { label: string; actionId: string; params?: Record<string, unknown> }[];
  /** action interrupted, if any */
  interruptedActionId?: string;
}
