/**
 * Venue archetypes — what a real place found on Google Maps *is* in the simulation.
 *
 * Each archetype declares the objects instantiated inside it (so every gym has treadmills and
 * every grocery store has a produce display), the staff roles worldgen hires (so the LLM knows a
 * barista exists), the venue-level actions that aren't bound to an object, realistic opening hours
 * used when Google has none, hourly crowd/noise curves, what it sells, and an ambience hint the
 * LLM uses to narrate the place.
 *
 * Object and career ids are the canonical ones in docs/IDS.md.
 * `googleTypes` is derived from the shared type→archetype priority list in `places/archetypes.ts`.
 */
import type { InteractionDef, ArchetypeDef } from './types';
import type { EffectBundle, EmotionId, ItemId, LifeStage, MoodletSpec, NeedId, VenueArchetype, Weekday } from '../core/types';
import { TYPE_PRIORITY, archetypeIcon } from '../places/archetypes';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const NO_SUNDAY: Weekday[] = [1, 2, 3, 4, 5, 6];
const h = (n: number, m = 0) => n * 60 + m;

const HOURS = {
  always: { open: 0, close: 1440, days: ALL_DAYS },
  early: { open: h(6), close: h(22), days: ALL_DAYS },
  retail: { open: h(10), close: h(21), days: ALL_DAYS },
  grocery: { open: h(7), close: h(22), days: ALL_DAYS },
  office: { open: h(9), close: h(17), days: WEEKDAYS },
  gov: { open: h(8), close: h(17), days: WEEKDAYS },
  clinic: { open: h(8), close: h(18), days: WEEKDAYS },
  restaurant: { open: h(11), close: h(22), days: ALL_DAYS },
  cafe: { open: h(6, 30), close: h(19), days: ALL_DAYS },
  bar: { open: h(16), close: h(26), days: ALL_DAYS },
  club: { open: h(21), close: h(26), days: [4, 5, 6] as Weekday[] },
  gym: { open: h(5), close: h(23), days: ALL_DAYS },
  school: { open: h(7, 30), close: h(16), days: WEEKDAYS },
  park: { open: h(5), close: h(22), days: ALL_DAYS },
  evening: { open: h(11), close: h(24), days: ALL_DAYS },
  worship: { open: h(8), close: h(20), days: ALL_DAYS },
  salon: { open: h(9), close: h(19), days: NO_SUNDAY },
} as const;

/** hourly curve helpers: v(peakHours, base, peak) → 24 entries */
const curve = (base: number, peak: number, peaks: number[]): number[] =>
  Array.from({ length: 24 }, (_, i) => {
    const d = Math.min(...peaks.map((p) => Math.min(Math.abs(i - p), 24 - Math.abs(i - p))));
    return Math.round((base + (peak - base) * Math.max(0, 1 - d / 3)) * 100) / 100;
  });

const mood = (emotion: EmotionId, label: string, intensity: number, durationMinutes: number): MoodletSpec => ({ emotion, label, intensity, durationMinutes });
const cx = (kind: string, payload?: Record<string, unknown>) => ({ kind, payload });
const YA: LifeStage = 'young_adult';
const TEEN: LifeStage = 'teen';

type IOpts = Omit<InteractionDef, 'effects'> & { effects?: EffectBundle };
const act = (o: IOpts): InteractionDef => ({ effects: {}, ...o });

/** Google types that map to this archetype, most specific first. */
const typesFor = (a: VenueArchetype): string[] => TYPE_PRIORITY.filter(([, arch]) => arch === a).map(([t]) => t);

interface ADef {
  name: string;
  objects?: [string, number][];
  rooms?: string[];
  staff?: [string, string, number][]; // [role, careerId, count]
  actions?: InteractionDef[];
  basePrice?: number;
  hours?: { open: number; close: number; days: Weekday[] };
  capacity?: number;
  ambient?: Partial<Record<NeedId, number>>;
  noise?: number[];
  crowd?: number[];
  sells?: ArchetypeDef['sells'];
  encounterRate?: number;
  llmHint: string;
  safety?: number;
  tags?: string[];
}

const build = (id: VenueArchetype, d: ADef): ArchetypeDef => ({
  id,
  name: d.name,
  icon: archetypeIcon(id),
  googleTypes: typesFor(id),
  objects: (d.objects ?? []).map(([defId, count]) => ({ defId, count })),
  rooms: d.rooms ?? ['Main floor'],
  staff: (d.staff ?? []).map(([role, careerId, count]) => ({ role, careerId, count })),
  actions: d.actions ?? [],
  basePrice: d.basePrice ?? 1,
  defaultHours: d.hours ?? HOURS.retail,
  capacity: d.capacity ?? 40,
  ambient: d.ambient,
  noiseByHour: d.noise ?? curve(15, 45, [12, 18]),
  crowdByHour: d.crowd ?? curve(0.1, 0.6, [12, 18]),
  sells: d.sells,
  encounterRate: d.encounterRate ?? 0.15,
  llmHint: d.llmHint,
  safety: d.safety ?? 75,
  tags: d.tags ?? [],
});

// ---------------------------------------------------------------------------
// shared venue actions
// ---------------------------------------------------------------------------
const askStaff = act({ id: 'ask_staff', label: 'Ask an employee something', category: 'social', icon: '💬', durationMinutes: 6, effects: { needs: { social: 6 }, custom: [cx('shop:ask_staff', {})] }, llm: 'narrate', autonomyWeight: 0.15, group: 'Here' });
const browse = (kind: string, minutes = 20, fun = 10) => act({ id: 'browse', label: 'Browse', category: 'shop', icon: '🛍️', durationMinutes: minutes, effects: { needs: { fun } , custom: [cx('shop:browse', { kind })] }, satisfies: ['fun'], autonomyWeight: 0.4, group: 'Shop' });
const buyGroceries = act({ id: 'buy_groceries', label: 'Do the weekly shopping', category: 'shop', icon: '🛒', durationMinutes: 45, effects: { needs: { energy: -12, comfort: -6 }, custom: [cx('shop:groceries', { basket: 'weekly' })] }, autonomyWeight: 1.2, group: 'Shop' });
const grabFew = act({ id: 'grab_a_few', label: 'Grab a few things', category: 'shop', icon: '🧺', durationMinutes: 15, effects: { needs: { energy: -4 }, custom: [cx('shop:groceries', { basket: 'small' })] }, autonomyWeight: 0.8, group: 'Shop' });
const returnItem = act({ id: 'return_item', label: 'Return something', category: 'shop', icon: '↩️', durationMinutes: 18, effects: { stress: 4, custom: [cx('shop:return_item', {})] }, llm: 'narrate', autonomyWeight: 0.1, group: 'Shop' });
const orderMeal = (price: number, hunger: number, minutes: number, label = 'Order a meal') =>
  act({ id: 'order_meal', label, category: 'needs', icon: '🍽️', durationMinutes: minutes, cost: price, effects: { needs: { hunger, fun: 10, social: 8, comfort: 6 }, custom: [cx('shop:order', { what: 'food' }), cx('needs:ate', { calories: hunger * 15, healthy: 0, hungerRestored: hunger })] }, satisfies: ['hunger'], llm: 'narrate', autonomyWeight: 1.3, group: 'Order' });
const orderTakeout = (price: number) => act({ id: 'order_takeout', label: 'Order takeout to go', category: 'needs', icon: '🥡', durationMinutes: 18, cost: price, effects: { items: [{ op: 'gain', itemId: 'takeout_meal' as ItemId, qty: 1 }], custom: [cx('shop:order', { what: 'food' })] }, autonomyWeight: 0.6, group: 'Order' });
const restroom = act({ id: 'use_restroom', label: 'Use the restroom', category: 'needs', icon: '🚻', durationMinutes: 5, effects: { needs: { bladder: 88, hygiene: -2 }, custom: [cx('amenity:restroom', {})] }, satisfies: ['bladder'], autonomyWeight: 3, group: 'Here' });
const peopleWatch = act({ id: 'people_watch', label: 'Hang back and take it in', category: 'entertainment', icon: '👀', durationMinutes: 20, effects: { perMinute: { fun: 0.2, comfort: 0.1 } }, llm: 'narrate', satisfies: ['fun'], autonomyWeight: 0.3, group: 'Here' });
const waitAround = act({ id: 'wait', label: 'Wait', category: 'needs', icon: '⏳', durationMinutes: 20, effects: { perMinute: { comfort: -0.05 } }, autonomyWeight: 0.1, group: 'Here' });
const volunteer = act({ id: 'volunteer', label: 'Volunteer for a shift', category: 'civic', icon: '🤝', durationMinutes: 150, effects: { needs: { social: 28, energy: -25, fun: 10 }, custom: [cx('civic:volunteer', { hours: 2.5 })], moodlets: [mood('proud', 'Gave your time', 11, 1440)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.25, group: 'Community' });
const attendClass = (cost: number, label: string, skill: string, minutes = 60) =>
  act({ id: 'class', label, category: 'hobby', icon: '🎓', durationMinutes: minutes, cost, effects: { needs: { fun: 20, social: 18, energy: -14 }, skills: { [skill]: minutes * 0.55 }, stress: -10, moodlets: [mood('inspired', 'Learned something', 6, 480)] }, minStage: TEEN, autonomyWeight: 0.3, group: 'Class' });

// ---------------------------------------------------------------------------
// the catalog
// ---------------------------------------------------------------------------
const D: Record<VenueArchetype, ADef> = {
  // ===================== residential =====================
  home: {
    name: 'Home', rooms: ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom'], hours: HOURS.always, capacity: 12, encounterRate: 0,
    ambient: { comfort: 0.06 }, noise: curve(8, 22, [8, 19]), crowd: curve(0.05, 0.2, [8, 20]),
    llmHint: 'A private home. Whatever happens here happens without an audience.', safety: 90, tags: ['residential', 'private'],
  },
  apartment_building: {
    name: 'Apartment building', objects: [['mailbox', 1], ['laundromat_washer', 2], ['laundromat_dryer', 2], ['park_bench', 1]],
    rooms: ['Lobby', 'Mail room', 'Laundry', 'Courtyard'], hours: HOURS.always, capacity: 60, encounterRate: 0.25,
    actions: [act({ id: 'chat_lobby', label: 'Linger in the lobby', category: 'social', icon: '🏢', durationMinutes: 12, effects: { needs: { social: 8 } }, llm: 'narrate', autonomyWeight: 0.2, group: 'Here' })],
    llmHint: 'A shared building: mailboxes, a laundry room, neighbors you half-know by sight.', safety: 78, tags: ['residential'],
  },

  // ===================== food & drink =====================
  grocery: {
    name: 'Grocery store', basePrice: 1, hours: HOURS.grocery, capacity: 120, sells: 'grocery', encounterRate: 0.3,
    objects: [['grocery_shelf', 6], ['produce_display', 2], ['deli_counter', 1], ['bakery_case', 1], ['cash_register', 3], ['self_checkout', 4], ['shopping_cart', 1], ['public_restroom', 1], ['vending_machine', 1]],
    rooms: ['Produce', 'Aisles', 'Deli', 'Checkout'], staff: [['cashier', 'cashier', 3], ['stocker', 'retail_associate', 2], ['deli clerk', 'retail_associate', 1]],
    actions: [buyGroceries, grabFew, askStaff, returnItem, restroom],
    noise: curve(25, 55, [17, 18]), crowd: curve(0.15, 0.85, [11, 17, 18]),
    llmHint: 'Fluorescent light, a floor-cleaner smell, carts with one bad wheel, an announcement for a price check.', safety: 82, tags: ['shop', 'food', 'essential'],
  },
  convenience: {
    name: 'Convenience store', basePrice: 1.35, hours: { open: h(6), close: h(24), days: ALL_DAYS }, capacity: 20, sells: 'convenience',
    objects: [['grocery_shelf', 2], ['cash_register', 1], ['vending_machine', 1], ['liquor_shelf', 1]],
    staff: [['clerk', 'cashier', 1]], actions: [grabFew, askStaff],
    llmHint: 'A narrow store with a bell on the door, a hot-dog roller, and a lottery display by the register.', safety: 68, tags: ['shop', 'food'],
  },
  restaurant: {
    name: 'Restaurant', basePrice: 22, hours: HOURS.restaurant, capacity: 70, encounterRate: 0.25,
    objects: [['restaurant_table', 10], ['host_stand', 1], ['kitchen_line', 1], ['bar_counter', 1], ['public_restroom', 2]],
    rooms: ['Dining room', 'Bar', 'Patio'], staff: [['server', 'server', 4], ['host', 'host', 1], ['line cook', 'line_cook', 3], ['chef', 'chef', 1]],
    actions: [orderMeal(24, 62, 55), orderTakeout(22), act({ id: 'order_dessert', label: 'Order dessert', category: 'needs', icon: '🍰', durationMinutes: 20, cost: 9, effects: { needs: { hunger: 16, fun: 12 }, custom: [cx('needs:ate', { calories: 420, healthy: -0.6, hungerRestored: 16 })] }, autonomyWeight: 0.3, group: 'Order' }), act({ id: 'wait_table', label: 'Wait for a table', category: 'needs', icon: '⏳', durationMinutes: 20, effects: { perMinute: { comfort: -0.1 } }, autonomyWeight: 0.2, group: 'Order' }), askStaff, restroom],
    noise: curve(30, 70, [12, 19]), crowd: curve(0.1, 0.9, [12, 19, 20]),
    llmHint: 'Table service, a chalkboard of specials, a kitchen you can hear through the pass.', tags: ['food', 'social'],
  },
  fast_food: {
    name: 'Fast food', basePrice: 11, hours: { open: h(6), close: h(24), days: ALL_DAYS }, capacity: 50,
    objects: [['cash_register', 2], ['self_checkout', 2], ['restaurant_table', 8], ['public_restroom', 1], ['vending_machine', 1]],
    staff: [['crew', 'fast_food_crew', 4], ['shift lead', 'fast_food_crew', 1]],
    actions: [orderMeal(11, 52, 20, 'Order at the counter'), orderTakeout(10), act({ id: 'drive_thru', label: 'Go through the drive-thru', category: 'needs', icon: '🚗', durationMinutes: 12, cost: 11, effects: { items: [{ op: 'gain', itemId: 'fast_food_meal' as ItemId, qty: 1 }], custom: [cx('shop:order', { what: 'food' })] }, requirements: [{ kind: 'vehicle', reason: 'No vehicle here', params: {} }], autonomyWeight: 0.8, group: 'Order' }), restroom],
    noise: curve(35, 65, [12, 18]), crowd: curve(0.15, 0.8, [12, 18]),
    llmHint: 'Molded seating, a soda fountain, order numbers called over a speaker.', safety: 70, tags: ['food'],
  },
  cafe: {
    name: 'Café', basePrice: 6, hours: HOURS.cafe, capacity: 40, encounterRate: 0.35,
    objects: [['cafe_counter', 1], ['barista_station', 1], ['cafe_table', 8], ['bakery_case', 1], ['public_restroom', 1]],
    rooms: ['Counter', 'Seating', 'Patio'], staff: [['barista', 'barista', 3], ['manager', 'barista', 1]],
    actions: [act({ id: 'order_coffee', label: 'Order a coffee', category: 'needs', icon: '☕', durationMinutes: 12, cost: 5.25, effects: { needs: { thirst: 30, energy: 14, comfort: 8 }, caffeine: 120, custom: [cx('shop:order', { what: 'coffee' })] }, satisfies: ['energy'], autonomyWeight: 1.5, group: 'Order' }), act({ id: 'order_pastry', label: 'Order a pastry', category: 'needs', icon: '🥐', durationMinutes: 10, cost: 4.5, effects: { needs: { hunger: 22, fun: 8 }, custom: [cx('needs:ate', { calories: 380, healthy: -0.4, hungerRestored: 22 })] }, autonomyWeight: 0.6, group: 'Order' }), act({ id: 'work_from_cafe', label: 'Work from a corner table', category: 'work', icon: '💻', durationMinutes: 120, effects: { perMinute: { energy: -0.05, social: 0.05, comfort: 0.05 }, skills: { logic: 40 }, custom: [cx('career:remote_work', { minutes: 120 })] }, autonomyWeight: 0.4, group: 'Here' }), peopleWatch, restroom],
    ambient: { comfort: 0.04 }, noise: curve(25, 50, [8, 15]), crowd: curve(0.15, 0.75, [8, 9, 15]),
    llmHint: 'Espresso hiss, a chalkboard menu, laptops at half the tables, a tip jar with a joke on it.', tags: ['food', 'social', 'third_place'],
  },
  bar: {
    name: 'Bar', basePrice: 9, hours: HOURS.bar, capacity: 80, encounterRate: 0.6,
    objects: [['bar_counter', 1], ['bar_stool', 10], ['restaurant_table', 6], ['pool_table', 1], ['dartboard', 1], ['jukebox', 1], ['public_restroom', 2]],
    rooms: ['Bar', 'Back room', 'Patio'], staff: [['bartender', 'bartender', 2], ['server', 'server', 2], ['bouncer', 'security_guard', 1]],
    actions: [act({ id: 'happy_hour', label: 'Catch happy hour', category: 'social', icon: '🍻', durationMinutes: 75, cost: 16, effects: { needs: { social: 26, fun: 24, thirst: 20 }, bloodAlcohol: 0.045, stress: -18, moodlets: [mood('relaxed', 'Happy hour', 8, 300)] }, requirements: [{ kind: 'time_window', reason: 'Happy hour is 4–7', params: { start: h(16), end: h(19) } }], minStage: YA, satisfies: ['social', 'fun'], llm: 'narrate', autonomyWeight: 0.6, group: 'Bar' }), act({ id: 'trivia_night', label: 'Play bar trivia', category: 'entertainment', icon: '🧠', durationMinutes: 110, cost: 22, effects: { needs: { fun: 34, social: 30 }, skills: { logic: 40 }, bloodAlcohol: 0.04, moodlets: [mood('playful', 'Trivia night', 9, 480)] }, requirements: [{ kind: 'time_window', reason: 'Trivia starts at 7', params: { start: h(19), close: 0, end: h(22) } }], minStage: YA, llm: 'narrate', autonomyWeight: 0.35, group: 'Bar' }), askStaff, restroom],
    ambient: { fun: 0.06, social: 0.05 }, noise: curve(35, 85, [21, 22, 23]), crowd: curve(0.1, 0.9, [20, 21, 22]),
    llmHint: 'Low light, a game on mute above the bottles, a bartender who reads people fast.', safety: 62, tags: ['nightlife', 'social', 'alcohol'],
  },
  nightclub: {
    name: 'Nightclub', basePrice: 14, hours: HOURS.club, capacity: 250, encounterRate: 0.8,
    objects: [['dance_floor', 1], ['dj_booth', 1], ['bar_counter', 2], ['bar_stool', 8], ['public_restroom', 2]],
    rooms: ['Floor', 'Bar', 'VIP'], staff: [['bartender', 'bartender', 3], ['DJ', 'musician', 1], ['bouncer', 'security_guard', 2]],
    actions: [act({ id: 'cover_charge', label: 'Pay the cover and go in', category: 'entertainment', icon: '🎟️', durationMinutes: 8, cost: 20, effects: { needs: { fun: 8 } }, minStage: YA, autonomyWeight: 0.3, group: 'Club' }), act({ id: 'dance_all_night', label: 'Dance until close', category: 'entertainment', icon: '💃', durationMinutes: 150, effects: { perMinute: { fun: 0.45, social: 0.3, energy: -0.3, hygiene: -0.35 }, skills: { dancing: 70 }, fitness: 0.8, custom: [cx('entertainment:dance', {})], moodlets: [mood('energized', 'Danced till close', 12, 480)] }, minStage: YA, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.4, group: 'Club' }), restroom],
    ambient: { fun: 0.12, social: 0.08, hygiene: -0.04 }, noise: curve(40, 98, [23, 0, 1]), crowd: curve(0.05, 0.95, [23, 0, 1]),
    llmHint: 'Bass you feel in your chest, a fog machine, a line outside and a clipboard at the door.', safety: 52, tags: ['nightlife', 'alcohol', 'loud'],
  },
  bakery: {
    name: 'Bakery', basePrice: 5, hours: { open: h(6), close: h(16), days: ALL_DAYS }, capacity: 25, sells: ['bread', 'cookies', 'coffee_cup'] as ItemId[],
    objects: [['bakery_case', 1], ['cash_register', 1], ['cafe_table', 4]], staff: [['baker', 'baker', 2], ['counter', 'cashier', 1]],
    actions: [act({ id: 'buy_bread', label: 'Buy fresh bread', category: 'shop', icon: '🥖', durationMinutes: 10, cost: 6, effects: { items: [{ op: 'gain', itemId: 'bread' as ItemId, qty: 1 }], custom: [cx('shop:order', { what: 'bakery' })], moodlets: [mood('happy', 'Warm bread', 5, 240)] }, autonomyWeight: 0.5, group: 'Bakery' }), act({ id: 'order_cake', label: 'Order a cake for an occasion', category: 'family', icon: '🎂', durationMinutes: 20, cost: 48, effects: { custom: [cx('shop:order', { what: 'bakery' })], moodlets: [mood('hopeful', 'Cake ordered', 6, 1440)] }, autonomyWeight: 0.15, llm: 'narrate', group: 'Bakery' })],
    llmHint: 'Sugar and yeast in the air, trays sliding out of the oven, half the case already sold out.', tags: ['food', 'shop'],
  },
  butcher: {
    name: 'Butcher shop', basePrice: 14, hours: HOURS.retail, capacity: 15, sells: ['beef', 'chicken', 'ground_beef', 'fish'] as ItemId[],
    objects: [['butcher_counter', 1], ['cash_register', 1]], staff: [['butcher', 'chef', 2]], actions: [askStaff],
    llmHint: 'Cold air, sawdust smell, a case of cuts on white paper, a scale that prints stickers.', tags: ['food', 'shop'],
  },
  farmers_market: {
    name: 'Farmers market', basePrice: 1.25, hours: { open: h(8), close: h(13), days: [6, 0] as Weekday[] }, capacity: 200, encounterRate: 0.5,
    objects: [['farmers_stall', 8], ['flower_display', 1], ['food_truck', 2], ['picnic_table', 4], ['public_restroom', 1]],
    rooms: ['Stalls', 'Food row'], staff: [['vendor', 'farmer_market_vendor', 6]],
    actions: [browse('market', 35, 18), peopleWatch, act({ id: 'live_music_market', label: 'Listen to the busker', category: 'entertainment', icon: '🎸', durationMinutes: 20, effects: { needs: { fun: 14 }, stress: -8 }, autonomyWeight: 0.2, group: 'Market' })],
    noise: curve(30, 60, [10]), crowd: curve(0.1, 0.85, [9, 10, 11]),
    llmHint: 'Pop-up canopies, dogs on leashes, a guy with a guitar, cash-only signs.', tags: ['food', 'shop', 'outdoor', 'weekend'],
  },
  liquor_store: {
    name: 'Liquor store', basePrice: 1.1, hours: { open: h(10), close: h(21), days: ALL_DAYS }, capacity: 20, sells: 'liquor',
    objects: [['liquor_shelf', 4], ['cash_register', 1], ['wine_rack', 1]], staff: [['clerk', 'cashier', 1]], actions: [browse('liquor', 15, 8), askStaff],
    llmHint: 'Bright light on glass, a locked case of the good stuff, an ID check at the register.', safety: 65, tags: ['shop', 'alcohol'],
  },
  dispensary: {
    name: 'Dispensary', basePrice: 1.2, hours: { open: h(9), close: h(21), days: ALL_DAYS }, capacity: 25, sells: ['cannabis_flower', 'vape'] as ItemId[],
    objects: [['dispensary_counter', 1], ['cash_register', 1]], staff: [['budtender', 'retail_associate', 2], ['security', 'security_guard', 1]],
    actions: [askStaff],
    llmHint: 'An ID scanner at the door, a menu on screens, glass cases and a smell that gets into your jacket.', safety: 72, tags: ['shop', 'cannabis'],
  },

  // ===================== fitness & outdoors =====================
  gym: {
    name: 'Gym', basePrice: 45, hours: HOURS.gym, capacity: 90, encounterRate: 0.35,
    objects: [['gym_treadmill', 5], ['gym_rack', 2], ['squat_rack', 3], ['rowing_machine', 2], ['elliptical', 3], ['spin_bike', 4], ['sauna', 1], ['locker', 1], ['public_restroom', 2], ['water_cooler', 1], ['vending_machine', 1]],
    rooms: ['Cardio', 'Weights', 'Studio', 'Locker room'], staff: [['trainer', 'personal_trainer', 2], ['front desk', 'receptionist', 1]],
    actions: [act({ id: 'join_gym', label: 'Sign up for a membership', category: 'fitness', icon: '📝', durationMinutes: 25, cost: 45, effects: { flags: { gym_member: true }, custom: [cx('finance:subscription', { name: 'Gym membership', amount: 45 })], moodlets: [mood('hopeful', 'This year is different', 6, 1440)] }, minStage: TEEN, autonomyWeight: 0.2, group: 'Membership' }), act({ id: 'personal_training', label: 'Book a session with a trainer', category: 'fitness', icon: '🏋️', durationMinutes: 60, cost: 75, effects: { needs: { energy: -25, hygiene: -30, fun: 12 }, fitness: 2.2, weight: -0.2, skills: { fitness: 60 }, custom: [cx('health:workout', { minutes: 60, kind: 'training' })], moodlets: [mood('proud', 'Worked with a trainer', 8, 720)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.2, group: 'Fitness' }), act({ id: 'group_class', label: 'Take a group class', category: 'fitness', icon: '🤸', durationMinutes: 50, effects: { needs: { energy: -22, hygiene: -28, fun: 20, social: 22 }, fitness: 1.6, weight: -0.16, skills: { fitness: 40, dancing: 10 }, custom: [cx('health:workout', { minutes: 50, kind: 'class' })] }, minStage: TEEN, satisfies: ['fun'], autonomyWeight: 0.35, group: 'Fitness' }), restroom],
    ambient: { fun: 0.02 }, noise: curve(30, 60, [6, 17, 18]), crowd: curve(0.1, 0.85, [6, 17, 18]),
    llmHint: 'Rubber floors, clanging plates, a wall of cardio machines facing muted TVs.', tags: ['fitness'],
  },
  climbing_gym: {
    name: 'Climbing gym', basePrice: 28, hours: { open: h(10), close: h(23), days: ALL_DAYS }, capacity: 60, encounterRate: 0.45,
    objects: [['climbing_wall', 4], ['yoga_studio_floor', 1], ['locker', 1], ['public_restroom', 2], ['water_cooler', 1]],
    rooms: ['Bouldering', 'Ropes', 'Training'], staff: [['route setter', 'personal_trainer', 1], ['front desk', 'receptionist', 1]],
    actions: [act({ id: 'day_pass', label: 'Buy a day pass', category: 'fitness', icon: '🎟️', durationMinutes: 10, cost: 28, effects: { flags: { climbing_pass: true } }, minStage: TEEN, autonomyWeight: 0.3, group: 'Climbing' }), act({ id: 'belay_class', label: 'Take the belay class', category: 'fitness', icon: '🧗', durationMinutes: 90, cost: 45, effects: { needs: { fun: 24, social: 20, energy: -20 }, skills: { athletics: 50 }, fitness: 1.2, moodlets: [mood('confident', 'Learned to belay', 7, 1440)] }, minStage: TEEN, autonomyWeight: 0.2, group: 'Climbing' })],
    llmHint: 'Chalk dust in the light, crash pads, strangers cheering each other up a wall.', tags: ['fitness', 'social'],
  },
  yoga: {
    name: 'Yoga studio', basePrice: 22, hours: { open: h(6), close: h(21), days: ALL_DAYS }, capacity: 30,
    objects: [['yoga_studio_floor', 1], ['locker', 1], ['public_restroom', 1]], staff: [['instructor', 'yoga_instructor', 3]],
    actions: [act({ id: 'yoga_class', label: 'Take a class', category: 'fitness', icon: '🧘', durationMinutes: 60, cost: 22, effects: { needs: { energy: -8, fun: 16, social: 10, hygiene: -12 }, fitness: 0.9, stress: -28, skills: { fitness: 32 }, custom: [cx('health:workout', { minutes: 60, kind: 'yoga' })], moodlets: [mood('relaxed', 'Left it on the mat', 10, 480)] }, minStage: TEEN, satisfies: ['comfort'], autonomyWeight: 0.35, group: 'Yoga' })],
    ambient: { comfort: 0.06 }, noise: curve(10, 25, [18]), llmHint: 'Warm floors, dim light, a rack of blocks and straps, everyone barefoot.', tags: ['fitness', 'wellness'],
  },
  martial_arts: {
    name: 'Martial arts school', basePrice: 130, hours: { open: h(15), close: h(21), days: NO_SUNDAY }, capacity: 40,
    objects: [['yoga_studio_floor', 1], ['punching_bag', 4], ['locker', 1], ['public_restroom', 1]], staff: [['sensei', 'personal_trainer', 2]],
    actions: [act({ id: 'martial_class', label: 'Train with the class', category: 'fitness', icon: '🥋', durationMinutes: 75, effects: { needs: { energy: -28, hygiene: -35, fun: 22, social: 18 }, fitness: 1.8, skills: { athletics: 55, fitness: 30 }, custom: [cx('health:workout', { minutes: 75, kind: 'martial' })], moodlets: [mood('confident', 'Trained hard', 9, 720)] }, minStage: 'child' as LifeStage, autonomyWeight: 0.3, group: 'Training' })],
    noise: curve(25, 65, [17, 18]), llmHint: 'Mats, a wall of belts, bowing at the door, counting out loud in another language.', tags: ['fitness'],
  },
  dance_studio: {
    name: 'Dance studio', basePrice: 25, hours: { open: h(14), close: h(21), days: NO_SUNDAY }, capacity: 35,
    objects: [['yoga_studio_floor', 1], ['stereo', 1], ['mirror', 2], ['locker', 1]], staff: [['instructor', 'yoga_instructor', 2]],
    actions: [attendClass(25, 'Take a dance class', 'dancing', 75)],
    llmHint: 'A wall of mirrors, a barre, a floor scuffed pale where everyone stands.', tags: ['fitness', 'creative'],
  },
  pool: {
    name: 'Public pool', basePrice: 6, hours: { open: h(10), close: h(20), days: ALL_DAYS }, capacity: 120,
    objects: [['lap_pool', 1], ['locker', 1], ['public_restroom', 2], ['vending_machine', 1]], staff: [['lifeguard', 'lifeguard', 3]],
    actions: [act({ id: 'swim_laps', label: 'Swim laps', category: 'fitness', icon: '🏊', durationMinutes: 45, cost: 6, effects: { needs: { energy: -22, fun: 16, hygiene: 6 }, fitness: 1.5, weight: -0.18, skills: { athletics: 40 }, custom: [cx('health:workout', { minutes: 45, kind: 'swim' })] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Pool' }), act({ id: 'open_swim', label: 'Take the kids to open swim', category: 'family', icon: '🩱', durationMinutes: 90, cost: 12, effects: { needs: { fun: 26, social: 20, energy: -16 }, skills: { parenting: 24 }, custom: [cx('family:play_with_child', {})], moodlets: [mood('happy', 'Pool afternoon', 8, 480)] }, minStage: TEEN, autonomyWeight: 0.2, group: 'Pool' })],
    noise: curve(30, 70, [14, 15]), crowd: curve(0.1, 0.9, [13, 14, 15]),
    llmHint: 'Chlorine, a whistle, wet concrete, a lifeguard chair with a rescue tube across the arms.', tags: ['fitness', 'family', 'summer'],
  },
  ice_rink: {
    name: 'Ice rink', basePrice: 14, hours: { open: h(10), close: h(22), days: ALL_DAYS }, capacity: 150,
    objects: [['ice_rink_surface', 1], ['locker', 1], ['concession_stand', 1], ['public_restroom', 2]], staff: [['rink attendant', 'retail_associate', 2]],
    actions: [act({ id: 'public_skate', label: 'Public skate', category: 'entertainment', icon: '⛸️', durationMinutes: 75, cost: 16, effects: { needs: { fun: 30, social: 16, energy: -18 }, fitness: 0.9, skills: { athletics: 30 }, moodlets: [mood('playful', 'Skated for an hour', 8, 480)] }, outcomes: { outcomes: [{ weight: 8, label: 'Stayed upright', effects: {} }, { weight: 3, label: 'Went down hard', effects: { custom: [cx('health:injury', { name: 'Bruised tailbone', bodyPart: 'back', severity: 15, days: 4 })] } }] }, satisfies: ['fun'], autonomyWeight: 0.25, group: 'Rink' })],
    llmHint: 'Cold that gets into your fingers, rental skates, an organ track on loop.', tags: ['entertainment', 'winter'],
  },
  golf: {
    name: 'Golf course', basePrice: 55, hours: { open: h(6), close: h(20), days: ALL_DAYS }, capacity: 90,
    objects: [['golf_tee', 4], ['cash_register', 1], ['public_restroom', 2], ['bar_counter', 1]], staff: [['pro shop', 'retail_associate', 1], ['groundskeeper', 'landscaper', 2]],
    actions: [act({ id: 'play_round', label: 'Play a round', category: 'hobby', icon: '⛳', durationMinutes: 240, cost: 62, effects: { needs: { fun: 32, social: 28, energy: -30, hygiene: -20 }, fitness: 0.8, skills: { athletics: 60 }, stress: -22, moodlets: [mood('relaxed', 'Four hours outside', 9, 720)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.2, group: 'Golf' }), act({ id: 'driving_range', label: 'Hit a bucket at the range', category: 'hobby', icon: '🏌️', durationMinutes: 60, cost: 18, effects: { needs: { fun: 18, energy: -12 }, skills: { athletics: 25 }, stress: -14 }, minStage: TEEN, autonomyWeight: 0.2, group: 'Golf' })],
    llmHint: 'Cut grass, a beverage cart, a foursome waiting on the tee behind you.', tags: ['sport', 'social', 'expensive'],
  },
  sports_field: {
    name: 'Sports field', basePrice: 0, hours: HOURS.park, capacity: 200, encounterRate: 0.4,
    objects: [['soccer_field', 1], ['baseball_diamond', 1], ['basketball_court', 2], ['tennis_court', 2], ['park_bench', 4], ['public_restroom', 1], ['vending_machine', 1]],
    actions: [act({ id: 'pickup_ball', label: 'Get in a pickup game', category: 'fitness', icon: '🏀', durationMinutes: 60, effects: { needs: { energy: -30, hygiene: -45, fun: 32, social: 30 }, fitness: 1.6, skills: { athletics: 45 }, custom: [cx('health:workout', { minutes: 60, kind: 'sport' })], moodlets: [mood('energized', 'Ran full court', 10, 480)] }, minStage: TEEN, satisfies: ['fun', 'social'], llm: 'narrate', autonomyWeight: 0.35, group: 'Sport' }), act({ id: 'watch_game', label: 'Watch the game from the fence', category: 'entertainment', icon: '👀', durationMinutes: 45, effects: { needs: { fun: 14, social: 10 } }, autonomyWeight: 0.2, group: 'Sport' })],
    noise: curve(20, 60, [17, 18, 19]), llmHint: 'Chalked lines, a rec-league game with real intensity, parents on folding chairs.', tags: ['sport', 'outdoor'],
  },
  park: {
    name: 'Park', basePrice: 0, hours: HOURS.park, capacity: 300, encounterRate: 0.35,
    objects: [['park_bench', 6], ['picnic_table', 4], ['walking_trail', 1], ['playground_set', 1], ['swing_set', 1], ['public_restroom', 1], ['campfire', 1], ['basketball_court', 1]],
    rooms: ['Grounds', 'Playground', 'Trail'], staff: [['parks crew', 'landscaper', 1]],
    actions: [peopleWatch, act({ id: 'sit_in_grass', label: 'Sit in the grass', category: 'needs', icon: '🌳', durationMinutes: 25, effects: { perMinute: { comfort: 0.4, fun: 0.2 }, stress: -16 }, satisfies: ['comfort'], autonomyWeight: 0.5, group: 'Park' })],
    ambient: { comfort: 0.05, fun: 0.03 }, noise: curve(10, 35, [12, 17]), crowd: curve(0.05, 0.7, [11, 17, 18]),
    llmHint: 'Open green, a paved loop, dogs and strollers, someone practicing an instrument badly under a tree.', safety: 76, tags: ['outdoor', 'free', 'family'],
  },
  playground: {
    name: 'Playground', basePrice: 0, hours: HOURS.park, capacity: 60, encounterRate: 0.3,
    objects: [['playground_set', 1], ['swing_set', 2], ['park_bench', 3], ['public_restroom', 1]],
    actions: [], ambient: { fun: 0.06 }, noise: curve(15, 60, [10, 16]), crowd: curve(0.05, 0.8, [10, 16, 17]),
    llmHint: 'Wood chips, a slide too hot in the sun, parents on the bench watching over their phones.', tags: ['outdoor', 'family', 'free'],
  },
  trail: {
    name: 'Trailhead', basePrice: 0, hours: { open: h(5), close: h(21), days: ALL_DAYS }, capacity: 80,
    objects: [['hiking_trail', 1], ['park_bench', 2], ['public_restroom', 1], ['fishing_pier', 1]],
    ambient: { comfort: 0.06, fun: 0.05 }, noise: curve(5, 18, [9]), crowd: curve(0.05, 0.5, [8, 9, 18]),
    llmHint: 'A dirt path into the greenbelt, cicadas, a creek somewhere below the trail.', tags: ['outdoor', 'free', 'nature'],
  },
  beach: {
    name: 'Beach', basePrice: 0, hours: { open: h(6), close: h(22), days: ALL_DAYS }, capacity: 400, encounterRate: 0.4,
    objects: [['beach_towel_spot', 1], ['volleyball_net', 1], ['public_restroom', 2], ['food_truck', 1], ['park_bench', 2]],
    staff: [['lifeguard', 'lifeguard', 2]],
    ambient: { comfort: 0.06, fun: 0.06 }, noise: curve(15, 45, [14]), crowd: curve(0.05, 0.9, [13, 14, 15]),
    llmHint: 'Sand that gets everywhere, a wind that never stops, a lifeguard stand and a red flag or a green one.', tags: ['outdoor', 'free', 'summer'],
  },

  // ===================== education =====================
  school: {
    name: 'School', basePrice: 0, hours: HOURS.school, capacity: 700, encounterRate: 0.5,
    objects: [['classroom_desk', 30], ['whiteboard', 4], ['locker', 1], ['school_cafeteria_table', 8], ['library_shelf', 2], ['public_restroom', 4], ['playground_set', 1], ['vending_machine', 2]],
    rooms: ['Classrooms', 'Cafeteria', 'Gym', 'Library', 'Office'],
    staff: [['teacher', 'teacher_k12', 12], ['principal', 'teacher_k12', 1], ['counselor', 'social_worker', 1], ['janitor', 'janitor', 2], ['front office', 'receptionist', 1]],
    actions: [act({ id: 'parent_conference', label: 'Meet with the teacher', category: 'family', icon: '🧑‍🏫', durationMinutes: 30, effects: { needs: { social: 10 }, skills: { parenting: 20 }, custom: [cx('education:conference', {})] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.2, group: 'School' }), act({ id: 'pick_up_kid', label: 'Pick up your kid', category: 'family', icon: '🚗', durationMinutes: 20, effects: { skills: { parenting: 10 }, custom: [cx('family:pickup_child', {})] }, minStage: YA, autonomyWeight: 0.6, group: 'School' }), restroom],
    noise: curve(15, 70, [8, 12, 15]), crowd: curve(0.05, 0.95, [8, 12, 15]),
    llmHint: 'Cinderblock halls, a bell schedule, laminated posters, the smell of a cafeteria at 11 a.m.', safety: 80, tags: ['education', 'kids'],
  },
  daycare: {
    name: 'Daycare', basePrice: 1200, hours: { open: h(6, 30), close: h(18, 30), days: WEEKDAYS }, capacity: 60,
    objects: [['daycare_playmat', 4], ['toy_box', 4], ['crib', 8], ['public_restroom', 2]],
    staff: [['teacher', 'daycare_worker', 6], ['director', 'daycare_worker', 1]],
    actions: [act({ id: 'enroll_daycare', label: 'Enroll your child', category: 'family', icon: '📝', durationMinutes: 45, effects: { custom: [cx('family:enroll_daycare', {})], stress: -8 }, minStage: YA, llm: 'narrate', autonomyWeight: 0.2, group: 'Daycare' }), act({ id: 'drop_off', label: 'Drop off your child', category: 'family', icon: '👶', durationMinutes: 15, effects: { skills: { parenting: 6 }, custom: [cx('family:dropoff_child', {})] }, minStage: YA, autonomyWeight: 0.9, group: 'Daycare' }), act({ id: 'pick_up_daycare', label: 'Pick up your child', category: 'family', icon: '🧒', durationMinutes: 15, effects: { skills: { parenting: 6 }, custom: [cx('family:pickup_child', {})] }, minStage: YA, autonomyWeight: 0.9, group: 'Daycare' })],
    noise: curve(20, 65, [9, 15]), llmHint: 'Cubbies with names, a wall of art, a sign-in sheet on a clipboard by the door.', safety: 88, tags: ['kids', 'childcare'],
  },
  college: {
    name: 'College', basePrice: 0, hours: { open: h(7), close: h(23), days: ALL_DAYS }, capacity: 3000, encounterRate: 0.55,
    objects: [['lecture_hall_seat', 60], ['study_table', 12], ['library_shelf', 6], ['computer_terminal', 12], ['lab_bench', 8], ['whiteboard', 6], ['cafe_counter', 1], ['public_restroom', 6], ['vending_machine', 3]],
    rooms: ['Lecture halls', 'Library', 'Labs', 'Quad', 'Student center'],
    staff: [['professor', 'professor', 15], ['advisor', 'social_worker', 2], ['librarian', 'librarian', 2], ['admissions', 'office_admin', 2]],
    actions: [act({ id: 'meet_advisor', label: 'Meet with an advisor', category: 'school', icon: '🎓', durationMinutes: 40, effects: { needs: { social: 8 }, custom: [cx('education:advising', {})] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.25, group: 'College' }), act({ id: 'campus_event', label: 'Go to a campus event', category: 'social', icon: '🎪', durationMinutes: 90, effects: { needs: { fun: 24, social: 30 }, moodlets: [mood('playful', 'Campus life', 7, 480)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.25, group: 'College' }), restroom],
    noise: curve(20, 60, [11, 14]), crowd: curve(0.1, 0.85, [10, 11, 14]),
    llmHint: 'A quad crossed by bikes, flyers stapled to every board, a library open past midnight during finals.', tags: ['education'],
  },
  library: {
    name: 'Library', basePrice: 0, hours: { open: h(9), close: h(20), days: NO_SUNDAY }, capacity: 150, encounterRate: 0.2,
    objects: [['library_shelf', 10], ['study_table', 8], ['reading_nook', 4], ['computer_terminal', 8], ['public_restroom', 2]],
    rooms: ['Stacks', 'Reading room', 'Computers', "Children's"], staff: [['librarian', 'librarian', 3], ['clerk', 'office_admin', 1]],
    actions: [act({ id: 'library_card', label: 'Get a library card', category: 'civic', icon: '💳', durationMinutes: 15, effects: { flags: { library_card: true }, custom: [cx('amenity:library_card', {})], moodlets: [mood('proud', 'Got a library card', 4, 720)] }, autonomyWeight: 0.2, group: 'Library' }), act({ id: 'free_event', label: 'Sit in on a free event', category: 'entertainment', icon: '🎫', durationMinutes: 60, effects: { needs: { fun: 18, social: 14 }, skills: { logic: 20 } }, llm: 'narrate', autonomyWeight: 0.2, group: 'Library' }), act({ id: 'story_time', label: 'Take your kid to story time', category: 'family', icon: '📖', durationMinutes: 45, effects: { needs: { social: 16, fun: 12 }, skills: { parenting: 22 }, custom: [cx('family:read_to_child', {})], moodlets: [mood('grateful', 'Story time', 7, 480)] }, minStage: YA, autonomyWeight: 0.2, group: 'Library' }), restroom],
    ambient: { comfort: 0.05 }, noise: curve(8, 22, [15]), crowd: curve(0.1, 0.6, [11, 15, 16]),
    llmHint: 'Quiet with an undertone of murmur, carpet, a hold shelf, someone asleep in an armchair.', safety: 85, tags: ['education', 'free', 'third_place'],
  },
  music_school: {
    name: 'Music school', basePrice: 60, hours: { open: h(13), close: h(21), days: NO_SUNDAY }, capacity: 40,
    objects: [['piano', 3], ['keyboard', 2], ['guitar', 3], ['drum_kit', 1], ['public_restroom', 1]], staff: [['instructor', 'musician', 4]],
    actions: [act({ id: 'music_lesson', label: 'Take a lesson', category: 'hobby', icon: '🎵', durationMinutes: 45, cost: 60, effects: { needs: { fun: 20, social: 12, energy: -8 }, skills: { music: 60 }, moodlets: [mood('inspired', 'Made progress', 7, 720)] }, minStage: 'child' as LifeStage, autonomyWeight: 0.25, group: 'Music' }), act({ id: 'recital', label: 'Play in the recital', category: 'entertainment', icon: '🎹', durationMinutes: 90, effects: { needs: { fun: 24, social: 24 }, stress: 14, skills: { music: 45 }, moodlets: [mood('proud', 'Played in front of people', 12, 1440)] }, llm: 'narrate', autonomyWeight: 0.1, group: 'Music' })],
    llmHint: 'Soundproof rooms with small windows, scales bleeding through the walls, a recital hall with folding chairs.', tags: ['education', 'creative'],
  },
  art_studio: {
    name: 'Art studio', basePrice: 45, hours: { open: h(10), close: h(21), days: NO_SUNDAY }, capacity: 30,
    objects: [['easel', 6], ['pottery_wheel', 4], ['workbench', 2], ['public_restroom', 1]], staff: [['instructor', 'graphic_designer', 2]],
    actions: [attendClass(45, 'Take an art class', 'painting', 120), act({ id: 'open_studio', label: 'Use the open studio', category: 'hobby', icon: '🎨', durationMinutes: 120, cost: 20, effects: { needs: { fun: 28, energy: -12 }, skills: { painting: 70, creativity: 40 }, stress: -24, moodlets: [mood('inspired', 'Made something', 9, 720)] }, autonomyWeight: 0.25, group: 'Studio' })],
    llmHint: 'Paint-spattered floors, a shelf of drying bisque, good north light.', tags: ['creative'],
  },

  // ===================== health =====================
  hospital: {
    name: 'Hospital', basePrice: 1, hours: HOURS.always, capacity: 500, encounterRate: 0.2,
    objects: [['hospital_bed', 20], ['exam_table', 8], ['waiting_room_chair', 30], ['xray_machine', 2], ['vending_machine', 3], ['public_restroom', 6], ['cafe_counter', 1]],
    rooms: ['Emergency', 'Waiting room', 'Wards', 'Imaging'],
    staff: [['physician', 'doctor', 6], ['nurse', 'nurse_rn', 14], ['aide', 'nurse_cna', 6], ['registration', 'receptionist', 3], ['paramedic', 'emt', 4]],
    actions: [act({ id: 'er_visit', label: 'Check in to the ER', category: 'health', icon: '🚑', durationMinutes: 210, effects: { needs: { comfort: -24, energy: -18 }, stress: 26, custom: [cx('health:checkup', { kind: 'urgent' })], moodlets: [mood('anxious', 'Hours in the ER', -10, 720)] }, llm: 'narrate', autonomyWeight: 0.5, group: 'Hospital' }), act({ id: 'visit_patient', label: 'Visit someone', category: 'social', icon: '💐', durationMinutes: 45, effects: { needs: { social: 18 }, stress: 8, moodlets: [mood('grateful', 'Sat with them a while', 6, 480)] }, llm: 'narrate', autonomyWeight: 0.3, group: 'Hospital' }), waitAround, restroom],
    ambient: { comfort: -0.04 }, noise: curve(25, 50, [10, 20]), crowd: curve(0.3, 0.85, [10, 19, 20]),
    llmHint: 'Hand sanitizer, a TV bolted high in the waiting room, everyone here on the worst day of some week.', safety: 84, tags: ['health', 'emergency'],
  },
  clinic: {
    name: 'Clinic', basePrice: 1, hours: HOURS.clinic, capacity: 60,
    objects: [['exam_table', 6], ['waiting_room_chair', 14], ['public_restroom', 2]],
    staff: [['physician', 'doctor', 2], ['nurse', 'nurse_rn', 3], ['front desk', 'receptionist', 2], ['therapist', 'therapist', 1]],
    actions: [act({ id: 'doctor_visit', label: 'See a doctor', category: 'health', icon: '🩺', durationMinutes: 60, effects: { needs: { comfort: -6 }, custom: [cx('health:checkup', { kind: 'physical' })] }, llm: 'narrate', autonomyWeight: 0.6, group: 'Clinic' }), act({ id: 'urgent_care', label: 'Urgent care walk-in', category: 'health', icon: '🏥', durationMinutes: 90, effects: { needs: { comfort: -12 }, stress: 10, custom: [cx('health:checkup', { kind: 'urgent' })] }, llm: 'narrate', autonomyWeight: 0.7, group: 'Clinic' }), act({ id: 'therapy', label: 'Therapy session', category: 'health', icon: '🛋️', durationMinutes: 50, effects: { stress: -30, needs: { social: 14 }, custom: [cx('health:therapy_session', {})], moodlets: [mood('relaxed', 'Talked it through', 10, 1440)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.3, group: 'Clinic' }), act({ id: 'flu_shot', label: 'Get a flu shot', category: 'health', icon: '💉', durationMinutes: 20, effects: { custom: [cx('health:vaccine', {})], moodlets: [mood('proud', 'Got the shot', 3, 720)] }, autonomyWeight: 0.2, group: 'Clinic' }), waitAround],
    noise: curve(15, 30, [10, 15]), llmHint: 'Paper on the exam table, a blood-pressure cuff on the wall, a poster about handwashing.', safety: 86, tags: ['health'],
  },
  dentist: {
    name: 'Dental office', basePrice: 1, hours: HOURS.clinic, capacity: 25,
    objects: [['dental_chair', 4], ['waiting_room_chair', 8], ['xray_machine', 1], ['public_restroom', 1]],
    staff: [['dentist', 'doctor', 1], ['hygienist', 'dental_hygienist', 3], ['front desk', 'receptionist', 1]],
    actions: [act({ id: 'cleaning', label: 'Get a cleaning', category: 'health', icon: '🦷', durationMinutes: 55, effects: { needs: { comfort: -10, hygiene: 12 }, custom: [cx('health:checkup', { kind: 'dental' })], moodlets: [mood('proud', 'Clean teeth', 5, 1440)] }, autonomyWeight: 0.25, group: 'Dental' }), act({ id: 'dental_work', label: 'Get the work done', category: 'health', icon: '🪥', durationMinutes: 90, effects: { needs: { comfort: -28 }, stress: 18, custom: [cx('health:checkup', { kind: 'dental_work' })] }, llm: 'narrate', autonomyWeight: 0.3, group: 'Dental' })],
    llmHint: 'A ceiling TV, that high whine, a fish tank in the waiting room.', tags: ['health'],
  },
  pharmacy: {
    name: 'Pharmacy', basePrice: 1, hours: { open: h(8), close: h(21), days: ALL_DAYS }, capacity: 40, sells: 'pharmacy',
    objects: [['pharmacy_counter', 1], ['grocery_shelf', 3], ['cash_register', 2], ['self_checkout', 2], ['public_restroom', 1]],
    staff: [['pharmacist', 'pharmacist', 2], ['tech', 'pharmacy_tech', 2], ['cashier', 'cashier', 2]],
    actions: [act({ id: 'fill_rx', label: 'Fill a prescription', category: 'health', icon: '💊', durationMinutes: 25, effects: { custom: [cx('health:pharmacy', { action: 'pickup' })] }, autonomyWeight: 0.7, group: 'Pharmacy' }), act({ id: 'consult_pharmacist', label: 'Ask the pharmacist', category: 'health', icon: '💬', durationMinutes: 12, effects: { needs: { social: 6 }, custom: [cx('health:pharmacy', { action: 'consult' })] }, llm: 'narrate', autonomyWeight: 0.2, group: 'Pharmacy' }), grabFew],
    llmHint: 'A counter at the back, a photo kiosk nobody uses, seasonal candy at the front.', tags: ['health', 'shop'],
  },
  vet: {
    name: 'Veterinary clinic', basePrice: 1, hours: HOURS.clinic, capacity: 25,
    objects: [['vet_exam_table', 4], ['waiting_room_chair', 8], ['pet_kennel', 6], ['public_restroom', 1]],
    staff: [['veterinarian', 'veterinarian', 2], ['vet tech', 'vet_tech', 3], ['front desk', 'receptionist', 1]],
    actions: [act({ id: 'vet_checkup', label: 'Bring your pet in', category: 'pet', icon: '🐾', durationMinutes: 45, cost: 85, effects: { custom: [cx('pet:vet_exam', { kind: 'checkup' })] }, llm: 'narrate', autonomyWeight: 0.5, group: 'Vet' }), act({ id: 'vaccines', label: 'Get vaccines updated', category: 'pet', icon: '💉', durationMinutes: 30, cost: 62, effects: { custom: [cx('pet:vet_exam', { kind: 'vaccine' })] }, autonomyWeight: 0.3, group: 'Vet' }), act({ id: 'spay_neuter', label: 'Schedule spay/neuter', category: 'pet', icon: '🏥', durationMinutes: 40, cost: 310, effects: { custom: [cx('pet:vet_exam', { kind: 'spay_neuter' })] }, autonomyWeight: 0.2, group: 'Vet' })],
    llmHint: 'Barking behind a door, a scale on the floor, a wall of thank-you photos.', tags: ['health', 'pets'],
  },
  pet_store: {
    name: 'Pet store', basePrice: 1, hours: HOURS.retail, capacity: 40, sells: 'pet',
    objects: [['adoption_pen', 2], ['pet_kennel', 4], ['aquarium', 3], ['bird_cage', 2], ['grocery_shelf', 4], ['cash_register', 2]],
    staff: [['associate', 'retail_associate', 3]],
    actions: [browse('pet', 25, 16), act({ id: 'adopt_here', label: 'Meet the adoptable pets', category: 'pet', icon: '🐶', durationMinutes: 35, effects: { needs: { fun: 22, social: 8 }, custom: [cx('pet:adopt', { source: 'store' })], moodlets: [mood('happy', 'Played with the puppies', 8, 480)] }, llm: 'narrate', autonomyWeight: 0.3, group: 'Pets' }), askStaff],
    noise: curve(25, 45, [14]), llmHint: 'Aquarium hum, a wall of leashes, an adoption weekend in the front corner.', tags: ['shop', 'pets'],
  },

  // ===================== government & law =====================
  police: {
    name: 'Police station', basePrice: 0, hours: HOURS.always, capacity: 80,
    objects: [['police_desk', 1], ['holding_cell', 4], ['waiting_room_chair', 8], ['public_restroom', 2]],
    rooms: ['Lobby', 'Booking', 'Holding'], staff: [['officer', 'police_officer', 10], ['desk sergeant', 'police_officer', 1], ['clerk', 'office_admin', 2]],
    actions: [waitAround], noise: curve(20, 45, [22]),
    llmHint: 'A lobby with bulletproof glass, radios in the background, nobody here by choice.', safety: 88, tags: ['legal', 'gov'],
  },
  fire_station: {
    name: 'Fire station', basePrice: 0, hours: HOURS.always, capacity: 30,
    objects: [['fire_engine', 2], ['waiting_room_chair', 4]], staff: [['firefighter', 'firefighter', 8], ['paramedic', 'emt', 4]],
    llmHint: 'Bay doors open on a warm evening, gear racked by the truck, dinner cooking upstairs.', safety: 92, tags: ['emergency', 'gov'],
  },
  courthouse: {
    name: 'Courthouse', basePrice: 0, hours: HOURS.gov, capacity: 200,
    objects: [['courthouse_bench', 12], ['judge_bench', 2], ['jury_box', 2], ['security_checkpoint', 1], ['public_restroom', 4]],
    rooms: ['Lobby', 'Courtroom A', 'Courtroom B', 'Clerk'], staff: [['judge', 'lawyer', 2], ['bailiff', 'security_guard', 3], ['clerk', 'paralegal', 4]],
    actions: [act({ id: 'pay_court_fine', label: 'Pay a fine at the window', category: 'legal', icon: '💵', durationMinutes: 30, effects: { custom: [cx('legal:pay_fine', {})] }, autonomyWeight: 0.5, group: 'Court' }), act({ id: 'get_married_civil', label: 'Get married at the courthouse', category: 'family', icon: '💍', durationMinutes: 45, cost: 80, effects: { needs: { fun: 30, social: 24 }, custom: [cx('family:civil_wedding', {})], moodlets: [mood('in_love', 'Married at the courthouse', 20, 4320)] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.15, group: 'Court' }), waitAround],
    llmHint: 'Metal detectors at the door, a hallway of benches, docket sheets taped beside each courtroom.', safety: 86, tags: ['legal', 'gov'],
  },
  jail: {
    name: 'County jail', basePrice: 0, hours: HOURS.always, capacity: 400,
    objects: [['jail_bunk', 40], ['holding_cell', 8], ['public_restroom', 4]],
    rooms: ['Intake', 'Cells', 'Visitation'], staff: [['corrections officer', 'police_officer', 12]],
    actions: [act({ id: 'visitation', label: 'Visit someone inside', category: 'social', icon: '📞', durationMinutes: 40, effects: { needs: { social: 14 }, stress: 16, moodlets: [mood('sad', 'Visited them inside', -8, 720)] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.2, group: 'Jail' })],
    ambient: { comfort: -0.1, fun: -0.05 }, llmHint: 'Sallyport doors, painted cinderblock, a visitation room of phones and glass.', safety: 40, tags: ['legal', 'gov'],
  },
  dmv: {
    name: 'DMV', basePrice: 0, hours: HOURS.gov, capacity: 120,
    objects: [['dmv_window', 6], ['waiting_room_chair', 40], ['public_restroom', 2]], staff: [['clerk', 'office_admin', 6]],
    actions: [waitAround], ambient: { comfort: -0.06, fun: -0.04 }, crowd: curve(0.5, 0.95, [9, 12, 16]),
    llmHint: 'A number board, rows of linked chairs, forms in racks, a photo backdrop with a stool.', tags: ['gov', 'legal'],
  },
  city_hall: {
    name: 'City hall', basePrice: 0, hours: HOURS.gov, capacity: 150,
    objects: [['city_hall_desk', 4], ['community_hall_table', 8], ['waiting_room_chair', 12], ['public_restroom', 2]],
    rooms: ['Clerk', 'Council chamber'], staff: [['clerk', 'office_admin', 5], ['council aide', 'office_admin', 2]],
    actions: [act({ id: 'council_meeting', label: 'Sit in on the council meeting', category: 'civic', icon: '🏛️', durationMinutes: 120, effects: { needs: { fun: -6, social: 10, comfort: -10 }, custom: [cx('civic:meeting', {})], moodlets: [mood('proud', 'Showed up for the city', 5, 720)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.15, group: 'Civic' }), act({ id: 'vote_here', label: 'Vote', category: 'civic', icon: '🗳️', durationMinutes: 25, effects: { custom: [cx('civic:vote', {})], moodlets: [mood('proud', 'Voted', 8, 1440)] }, minStage: TEEN, autonomyWeight: 0.4, group: 'Civic' }), waitAround],
    llmHint: 'Terrazzo floors, a portrait of the mayor, a council chamber with a public-comment podium.', tags: ['gov', 'civic'],
  },
  post_office: {
    name: 'Post office', basePrice: 0, hours: { open: h(9), close: h(17), days: NO_SUNDAY }, capacity: 40,
    objects: [['post_counter', 2], ['mailbox', 2], ['waiting_room_chair', 4]], staff: [['clerk', 'mail_carrier', 3], ['carrier', 'mail_carrier', 6]],
    actions: [waitAround], llmHint: 'A rope line, flat-rate boxes stacked by the wall, a scale that always rounds up.', tags: ['gov', 'service'],
  },

  // ===================== money =====================
  bank: {
    name: 'Bank', basePrice: 0, hours: { open: h(9), close: h(17), days: NO_SUNDAY }, capacity: 40,
    objects: [['bank_teller_window', 3], ['loan_desk', 2], ['atm_machine', 1], ['waiting_room_chair', 6], ['safe', 1]],
    staff: [['teller', 'bank_teller', 3], ['loan officer', 'loan_officer', 2], ['manager', 'financial_analyst', 1]],
    actions: [waitAround], llmHint: 'Carpet, a velvet rope, a bowl of lollipops, rates posted on a small board.', safety: 88, tags: ['finance'],
  },
  atm: {
    name: 'ATM', basePrice: 0, hours: HOURS.always, capacity: 3, objects: [['atm_machine', 1]],
    llmHint: 'A lit alcove, a keypad worn smooth, a receipt printer that is out of paper.', safety: 60, tags: ['finance'],
  },
  lawyer: {
    name: 'Law office', basePrice: 0, hours: HOURS.office, capacity: 20,
    objects: [['lawyer_desk', 3], ['waiting_room_chair', 6], ['filing_cabinet', 4]], staff: [['attorney', 'lawyer', 3], ['paralegal', 'paralegal', 3], ['receptionist', 'receptionist', 1]],
    llmHint: 'Suite 300 in a low office building, diplomas framed, a clock that bills by the tenth of an hour.', tags: ['legal', 'service'],
  },
  accountant: {
    name: 'Accounting office', basePrice: 0, hours: HOURS.office, capacity: 15,
    objects: [['accountant_desk', 3], ['waiting_room_chair', 4], ['filing_cabinet', 4], ['printer', 1]], staff: [['CPA', 'accountant', 3], ['assistant', 'office_admin', 1]],
    llmHint: 'A strip-mall office that gets busy in March, a whiteboard of deadlines, free pens.', tags: ['finance', 'service'],
  },
  insurance: {
    name: 'Insurance agency', basePrice: 0, hours: HOURS.office, capacity: 15,
    objects: [['insurance_desk', 3], ['waiting_room_chair', 4], ['printer', 1]], staff: [['agent', 'insurance_agent', 3]],
    llmHint: 'A storefront office with a sign in the window, a desk of brochures, a candy dish.', tags: ['finance', 'service'],
  },
  real_estate: {
    name: 'Real estate office', basePrice: 0, hours: { open: h(9), close: h(18), days: NO_SUNDAY }, capacity: 20,
    objects: [['realtor_desk', 4], ['waiting_room_chair', 4], ['printer', 1]], staff: [['agent', 'real_estate_agent', 4]],
    llmHint: 'Listing sheets in the window, headshots on the wall, a bowl of keys behind the desk.', tags: ['property', 'service'],
  },
  storage: {
    name: 'Storage facility', basePrice: 0, hours: { open: h(6), close: h(22), days: ALL_DAYS }, capacity: 30,
    objects: [['storage_unit', 20], ['cash_register', 1]], staff: [['manager', 'office_admin', 1]],
    llmHint: 'Rows of orange roll-up doors, a keypad gate, a cart you have to fetch from the office.', safety: 70, tags: ['service'],
  },

  // ===================== work =====================
  office: {
    name: 'Office', basePrice: 0, hours: HOURS.office, capacity: 200, encounterRate: 0.4,
    objects: [['office_desk', 30], ['cubicle', 20], ['conference_table', 4], ['break_room_fridge', 2], ['water_cooler', 3], ['copier', 2], ['printer', 3], ['public_restroom', 4], ['vending_machine', 2]],
    rooms: ['Floor', 'Conference rooms', 'Break room'], staff: [['manager', 'product_manager', 2], ['admin', 'office_admin', 2]],
    actions: [act({ id: 'break_room_chat', label: 'Hang around the break room', category: 'social', icon: '☕', durationMinutes: 15, effects: { needs: { social: 14, thirst: 12 }, caffeine: 80 }, satisfies: ['social'], llm: 'narrate', autonomyWeight: 0.4, group: 'Work' }), restroom],
    noise: curve(12, 40, [10, 14]), crowd: curve(0.05, 0.85, [10, 11, 14]),
    llmHint: 'Carpet tile, a badge reader, monitors in rows, a conference room booked by someone who never shows.', safety: 84, tags: ['work'],
  },
  coworking: {
    name: 'Coworking space', basePrice: 32, hours: { open: h(7), close: h(21), days: ALL_DAYS }, capacity: 80, encounterRate: 0.45,
    objects: [['office_desk', 20], ['conference_table', 3], ['cafe_counter', 1], ['break_room_fridge', 1], ['public_restroom', 2], ['printer', 1]],
    staff: [['community manager', 'office_admin', 1]],
    actions: [act({ id: 'day_desk', label: 'Buy a day pass', category: 'work', icon: '💼', durationMinutes: 10, cost: 32, effects: { flags: { coworking_day: true } }, minStage: TEEN, autonomyWeight: 0.2, group: 'Work' }), act({ id: 'network', label: 'Talk to whoever\'s at the next desk', category: 'social', icon: '🤝', durationMinutes: 20, effects: { needs: { social: 18 }, skills: { charisma: 20 }, custom: [cx('career:network', {})] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.3, group: 'Work' })],
    llmHint: 'Cold brew on tap, phone booths, a wall of stickers, a Slack channel for the building.', tags: ['work'],
  },
  factory: {
    name: 'Factory', basePrice: 0, hours: HOURS.always, capacity: 300,
    objects: [['assembly_line', 4], ['forklift', 2], ['warehouse_shelf', 12], ['locker', 1], ['public_restroom', 4], ['vending_machine', 3]],
    staff: [['line worker', 'warehouse_associate', 20], ['supervisor', 'warehouse_associate', 3]],
    ambient: { comfort: -0.05 }, noise: curve(70, 92, [10, 22]),
    llmHint: 'Ear protection required past the yellow line, a shift-change horn, a time clock by the door.', safety: 66, tags: ['work', 'industrial'],
  },
  warehouse: {
    name: 'Warehouse', basePrice: 0, hours: { open: h(5), close: h(23), days: ALL_DAYS }, capacity: 200,
    objects: [['warehouse_shelf', 20], ['forklift', 3], ['loading_dock', 2], ['locker', 1], ['public_restroom', 3], ['vending_machine', 2]],
    staff: [['picker', 'warehouse_associate', 25], ['driver', 'delivery_driver', 8], ['supervisor', 'warehouse_associate', 3]],
    ambient: { comfort: -0.04 }, noise: curve(45, 70, [9, 15]),
    llmHint: 'Racking to the ceiling, a scanner gun on your hip, a rate posted on a board.', safety: 70, tags: ['work', 'industrial'],
  },

  // ===================== retail =====================
  retail: {
    name: 'Store', basePrice: 1, hours: HOURS.retail, capacity: 80, sells: 'clothing',
    objects: [['clothing_rack', 6], ['fitting_room', 2], ['cash_register', 3], ['self_checkout', 2], ['grocery_shelf', 4], ['public_restroom', 1]],
    staff: [['associate', 'retail_associate', 4], ['cashier', 'cashier', 2]], actions: [browse('retail'), askStaff, returnItem],
    llmHint: 'Wide aisles, an endcap of seasonal junk, a song you half-know playing overhead.', tags: ['shop'],
  },
  clothing: {
    name: 'Clothing store', basePrice: 1, hours: HOURS.retail, capacity: 50, sells: 'clothing',
    objects: [['clothing_rack', 8], ['fitting_room', 4], ['mirror', 3], ['cash_register', 2]],
    staff: [['associate', 'retail_associate', 3]], actions: [browse('clothing', 25, 14), askStaff, returnItem],
    llmHint: 'Folded stacks on a table, a fitting room with a number tag, perfume in the air.', tags: ['shop', 'clothing'],
  },
  electronics: {
    name: 'Electronics store', basePrice: 1, hours: HOURS.retail, capacity: 60, sells: 'electronics',
    objects: [['electronics_display', 4], ['cash_register', 2], ['grocery_shelf', 2]], staff: [['associate', 'retail_associate', 4], ['tech support', 'it_support', 2]],
    actions: [browse('electronics', 25, 16), askStaff, returnItem],
    llmHint: 'A wall of TVs on the same demo loop, tethered phones, a service counter with a wait list.', tags: ['shop'],
  },
  furniture: {
    name: 'Furniture store', basePrice: 1, hours: HOURS.retail, capacity: 80, sells: 'furniture',
    objects: [['furniture_showroom', 1], ['sofa', 6], ['dining_table', 4], ['bed_double', 4], ['cash_register', 2], ['public_restroom', 1]],
    staff: [['associate', 'retail_associate', 3], ['delivery', 'delivery_driver', 2]], actions: [browse('furniture', 40, 14), askStaff],
    llmHint: 'Staged rooms you can walk into, a price tag on every arm, a delivery-scheduling desk at the exit.', tags: ['shop'],
  },
  hardware: {
    name: 'Hardware store', basePrice: 1, hours: { open: h(6, 30), close: h(21), days: ALL_DAYS }, capacity: 90, sells: 'hardware',
    objects: [['hardware_aisle', 6], ['cash_register', 3], ['self_checkout', 2], ['garden_bed', 2], ['public_restroom', 1]],
    staff: [['associate', 'retail_associate', 5], ['contractor desk', 'carpenter', 1]], actions: [browse('hardware', 25, 12), askStaff],
    llmHint: 'Concrete floors, lumber smell, a guy in an apron who actually knows the answer.', tags: ['shop'],
  },
  bookstore: {
    name: 'Bookstore', basePrice: 1, hours: HOURS.retail, capacity: 45, sells: 'books',
    objects: [['bookstore_shelf', 10], ['reading_nook', 4], ['cafe_counter', 1], ['cash_register', 1], ['public_restroom', 1]],
    staff: [['bookseller', 'retail_associate', 3]], actions: [browse('books', 30, 18), askStaff],
    ambient: { comfort: 0.05, fun: 0.03 }, llmHint: 'Staff picks with handwritten cards, a cat or the idea of one, a café in the back.', tags: ['shop', 'third_place'],
  },
  thrift_store: {
    name: 'Thrift store', basePrice: 0.35, hours: HOURS.retail, capacity: 60, sells: 'clothing',
    objects: [['thrift_rack', 8], ['fitting_room', 2], ['cash_register', 2], ['bookstore_shelf', 2], ['furniture_showroom', 1]],
    staff: [['associate', 'retail_associate', 3]], actions: [browse('thrift', 45, 20)],
    llmHint: 'Racks by color, a musty note under the detergent, a wall of mismatched mugs.', tags: ['shop', 'cheap'],
  },
  mall: {
    name: 'Mall', basePrice: 1, hours: { open: h(10), close: h(21), days: ALL_DAYS }, capacity: 800, encounterRate: 0.5, sells: 'clothing',
    objects: [['clothing_rack', 10], ['fitting_room', 4], ['electronics_display', 2], ['cash_register', 6], ['cafe_counter', 2], ['restaurant_table', 12], ['arcade_cabinet', 4], ['public_restroom', 6], ['vending_machine', 4], ['park_bench', 8]],
    rooms: ['Concourse', 'Food court', 'Anchor stores'], staff: [['associate', 'retail_associate', 12], ['security', 'security_guard', 3], ['food court', 'fast_food_crew', 6]],
    actions: [browse('mall', 60, 22), act({ id: 'food_court', label: 'Eat in the food court', category: 'needs', icon: '🍜', durationMinutes: 30, cost: 13, effects: { needs: { hunger: 48, social: 10, fun: 8 }, custom: [cx('needs:ate', { calories: 780, healthy: -0.4, hungerRestored: 48 })] }, satisfies: ['hunger'], autonomyWeight: 0.7, group: 'Mall' }), peopleWatch, restroom],
    noise: curve(30, 65, [14, 19]), crowd: curve(0.15, 0.85, [14, 15, 19]),
    llmHint: 'A skylit concourse, a fountain with coins in it, a kiosk salesperson who makes eye contact.', tags: ['shop', 'social'],
  },
  florist: {
    name: 'Florist', basePrice: 1, hours: { open: h(9), close: h(18), days: NO_SUNDAY }, capacity: 15,
    objects: [['florist_counter', 1], ['flower_display', 2], ['cash_register', 1]], staff: [['florist', 'florist', 2]],
    llmHint: 'A cooler of buckets, ribbon spools, clippings all over the workbench.', tags: ['shop', 'gift'],
  },

  // ===================== entertainment =====================
  cinema: {
    name: 'Movie theater', basePrice: 16, hours: { open: h(11), close: h(24), days: ALL_DAYS }, capacity: 300,
    objects: [['cinema_seat', 60], ['concession_stand', 2], ['arcade_cabinet', 2], ['public_restroom', 4]],
    rooms: ['Lobby', 'Auditorium 1', 'Auditorium 2'], staff: [['usher', 'retail_associate', 3], ['concessions', 'fast_food_crew', 3]],
    actions: [act({ id: 'see_movie', label: 'See a movie', category: 'entertainment', icon: '🎬', durationMinutes: 130, cost: 16, effects: { needs: { fun: 38, social: 12, comfort: 8, bladder: -20 }, stress: -20, custom: [cx('entertainment:watch', { channel: 'cinema' })], moodlets: [mood('happy', 'Saw a good one', 8, 480)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.5, group: 'Movies' }), act({ id: 'concessions', label: 'Get popcorn and a drink', category: 'needs', icon: '🍿', durationMinutes: 10, cost: 14, effects: { needs: { hunger: 20, thirst: 25, fun: 8 }, custom: [cx('needs:ate', { calories: 620, healthy: -0.8, hungerRestored: 20 })] }, autonomyWeight: 0.4, group: 'Movies' }), restroom],
    noise: curve(20, 45, [19, 20]), crowd: curve(0.05, 0.8, [19, 20, 21]),
    llmHint: 'Sticky floors, trailers you sit through, a lobby that smells like butter from the parking lot.', tags: ['entertainment'],
  },
  theater: {
    name: 'Theater', basePrice: 45, hours: { open: h(17), close: h(23), days: [3, 4, 5, 6, 0] as Weekday[] }, capacity: 400,
    objects: [['theater_seat', 80], ['stage', 1], ['concession_stand', 1], ['bar_counter', 1], ['public_restroom', 4]],
    staff: [['usher', 'retail_associate', 4], ['actor', 'actor', 8], ['stage manager', 'office_admin', 1]],
    actions: [act({ id: 'see_play', label: 'See the show', category: 'entertainment', icon: '🎭', durationMinutes: 150, cost: 48, effects: { needs: { fun: 40, social: 14, comfort: 4 }, skills: { writing: 20 }, stress: -22, custom: [cx('entertainment:watch', { channel: 'theater' })], moodlets: [mood('inspired', 'Saw something real', 12, 720)] }, minStage: TEEN, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.2, group: 'Theater' })],
    llmHint: 'Red seats, a printed program, an intermission line at the bar.', tags: ['entertainment', 'culture'],
  },
  concert_hall: {
    name: 'Concert hall', basePrice: 65, hours: { open: h(18), close: h(24), days: [3, 4, 5, 6] as Weekday[] }, capacity: 900, encounterRate: 0.5,
    objects: [['concert_stage', 1], ['theater_seat', 100], ['bar_counter', 2], ['public_restroom', 6]],
    staff: [['sound tech', 'musician', 2], ['bartender', 'bartender', 3], ['security', 'security_guard', 4]],
    actions: [act({ id: 'see_show', label: 'See the show', category: 'entertainment', icon: '🎤', durationMinutes: 180, cost: 68, effects: { needs: { fun: 46, social: 26, energy: -20, hygiene: -14 }, skills: { music: 25 }, stress: -26, custom: [cx('entertainment:watch', { channel: 'concert' })], moodlets: [mood('energized', 'That show', 14, 1440)] }, minStage: TEEN, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.25, group: 'Concert' })],
    noise: curve(30, 95, [21, 22]), llmHint: 'A floor that sticks, ears ringing at the merch table, a set list taped to the stage.', safety: 68, tags: ['entertainment', 'nightlife'],
  },
  stadium: {
    name: 'Stadium', basePrice: 75, hours: { open: h(11), close: h(23), days: [0, 5, 6] as Weekday[] }, capacity: 45000, encounterRate: 0.4,
    objects: [['stadium_seat', 200], ['concession_stand', 8], ['public_restroom', 12], ['bar_counter', 4]],
    staff: [['usher', 'retail_associate', 20], ['concessions', 'fast_food_crew', 25], ['security', 'security_guard', 12]],
    actions: [act({ id: 'attend_game', label: 'Go to the game', category: 'entertainment', icon: '🏟️', durationMinutes: 210, cost: 78, effects: { needs: { fun: 44, social: 30, energy: -22, hygiene: -16, thirst: -20 }, stress: -20, custom: [cx('entertainment:watch', { channel: 'sports' })], moodlets: [mood('energized', 'Was at the game', 13, 1440)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.25, group: 'Game' }), act({ id: 'stadium_food', label: 'Get a beer and a hot dog', category: 'needs', icon: '🌭', durationMinutes: 15, cost: 22, effects: { needs: { hunger: 26, thirst: 20 }, bloodAlcohol: 0.02, custom: [cx('needs:ate', { calories: 520, healthy: -0.7, hungerRestored: 26 })] }, minStage: YA, autonomyWeight: 0.4, group: 'Game' }), restroom],
    noise: curve(40, 100, [14, 20]), crowd: curve(0.05, 0.95, [13, 14, 20]),
    llmHint: 'A concourse packed at halftime, a wave that never quite goes around, $14 beer.', tags: ['entertainment', 'sport'],
  },
  arena: {
    name: 'Arena', basePrice: 90, hours: { open: h(16), close: h(24), days: ALL_DAYS }, capacity: 18000,
    objects: [['stadium_seat', 150], ['concession_stand', 6], ['bar_counter', 3], ['public_restroom', 10]],
    staff: [['usher', 'retail_associate', 15], ['concessions', 'fast_food_crew', 18], ['security', 'security_guard', 10]],
    actions: [act({ id: 'attend_event', label: 'Go to the event', category: 'entertainment', icon: '🏒', durationMinutes: 180, cost: 95, effects: { needs: { fun: 42, social: 26, energy: -20 }, stress: -18, custom: [cx('entertainment:watch', { channel: 'arena' })], moodlets: [mood('energized', 'Big night out', 12, 1440)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.2, group: 'Event' }), restroom],
    noise: curve(35, 98, [20, 21]), llmHint: 'A bowl of seats under a scoreboard the size of a house, a t-shirt cannon, ice or hardwood under the lights.', tags: ['entertainment'],
  },
  museum: {
    name: 'Museum', basePrice: 18, hours: { open: h(10), close: h(17), days: NO_SUNDAY }, capacity: 400,
    objects: [['museum_exhibit', 12], ['park_bench', 8], ['cafe_counter', 1], ['public_restroom', 4]],
    rooms: ['Galleries', 'Special exhibit', 'Café'], staff: [['docent', 'librarian', 4], ['curator', 'scientist', 2], ['security', 'security_guard', 4]],
    actions: [act({ id: 'visit_museum', label: 'Walk the galleries', category: 'entertainment', icon: '🖼️', durationMinutes: 110, cost: 18, effects: { needs: { fun: 30, energy: -14, comfort: -6 }, skills: { research: 40, creativity: 25 }, stress: -18, custom: [cx('entertainment:exhibit', { kind: 'museum' })], moodlets: [mood('inspired', 'Saw something that stayed with you', 10, 720)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.25, group: 'Museum' }), act({ id: 'special_exhibit', label: 'See the special exhibit', category: 'entertainment', icon: '✨', durationMinutes: 60, cost: 12, effects: { needs: { fun: 22 }, skills: { research: 25 } }, autonomyWeight: 0.15, group: 'Museum' })],
    ambient: { comfort: 0.02 }, noise: curve(12, 30, [14]), llmHint: 'Polished floors, wall text nobody finishes reading, a gift shop you exit through.', safety: 88, tags: ['culture', 'entertainment'],
  },
  zoo: {
    name: 'Zoo', basePrice: 26, hours: { open: h(9), close: h(18), days: ALL_DAYS }, capacity: 2000,
    objects: [['zoo_enclosure', 14], ['park_bench', 10], ['concession_stand', 3], ['playground_set', 1], ['public_restroom', 6], ['picnic_table', 6]],
    staff: [['keeper', 'vet_tech', 8], ['educator', 'teacher_k12', 2], ['concessions', 'fast_food_crew', 4]],
    actions: [act({ id: 'visit_zoo', label: 'Walk the zoo', category: 'entertainment', icon: '🦁', durationMinutes: 180, cost: 26, effects: { needs: { fun: 36, social: 18, energy: -26, hygiene: -12 }, skills: { parenting: 20, research: 20 }, custom: [cx('entertainment:exhibit', { kind: 'zoo' })], moodlets: [mood('happy', 'A day at the zoo', 10, 720)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.25, group: 'Zoo' })],
    noise: curve(25, 60, [11, 14]), crowd: curve(0.1, 0.85, [11, 12, 14]),
    llmHint: 'Sun-faded signage, a train that loops the grounds, a keeper talk at the elephant yard.', tags: ['entertainment', 'family'],
  },
  aquarium: {
    name: 'Aquarium', basePrice: 30, hours: { open: h(9), close: h(18), days: ALL_DAYS }, capacity: 900,
    objects: [['aquarium_tank', 12], ['park_bench', 6], ['concession_stand', 2], ['public_restroom', 4]],
    staff: [['aquarist', 'vet_tech', 6], ['educator', 'teacher_k12', 2]],
    actions: [act({ id: 'visit_aquarium', label: 'Walk the tanks', category: 'entertainment', icon: '🐠', durationMinutes: 120, cost: 30, effects: { needs: { fun: 34, energy: -14 }, skills: { research: 25 }, stress: -22, custom: [cx('entertainment:exhibit', { kind: 'aquarium' })], moodlets: [mood('relaxed', 'Blue light and slow fish', 10, 720)] }, satisfies: ['fun'], llm: 'narrate', autonomyWeight: 0.2, group: 'Aquarium' })],
    ambient: { comfort: 0.04 }, noise: curve(20, 45, [13]), llmHint: 'Dim halls, blue light on everyone\'s faces, a tunnel with rays gliding overhead.', tags: ['entertainment', 'family'],
  },
  amusement_park: {
    name: 'Amusement park', basePrice: 65, hours: { open: h(11), close: h(22), days: [5, 6, 0] as Weekday[] }, capacity: 8000,
    objects: [['roller_coaster', 3], ['ferris_wheel', 1], ['carousel', 2], ['concession_stand', 6], ['arcade_cabinet', 8], ['claw_machine', 4], ['public_restroom', 8], ['picnic_table', 10]],
    staff: [['ride operator', 'retail_associate', 15], ['concessions', 'fast_food_crew', 10], ['security', 'security_guard', 5]],
    actions: [act({ id: 'park_admission', label: 'Buy admission', category: 'entertainment', icon: '🎟️', durationMinutes: 20, cost: 68, effects: { flags: { park_admission: true } }, autonomyWeight: 0.2, group: 'Park' })],
    noise: curve(40, 85, [14, 19]), crowd: curve(0.1, 0.9, [13, 14, 19]),
    llmHint: 'Screams from a drop tower, funnel-cake sugar in the air, a line that snakes back on itself six times.', safety: 72, tags: ['entertainment', 'family'],
  },
  bowling: {
    name: 'Bowling alley', basePrice: 24, hours: { open: h(11), close: h(24), days: ALL_DAYS }, capacity: 150, encounterRate: 0.4,
    objects: [['bowling_lane', 16], ['arcade_cabinet', 6], ['bar_counter', 1], ['restaurant_table', 8], ['public_restroom', 2]],
    staff: [['front desk', 'retail_associate', 2], ['bartender', 'bartender', 1], ['kitchen', 'line_cook', 2]],
    actions: [act({ id: 'bowl_game', label: 'Bowl a few games', category: 'entertainment', icon: '🎳', durationMinutes: 90, cost: 26, effects: { needs: { fun: 34, social: 28, energy: -14 }, skills: { athletics: 25 }, stress: -18, moodlets: [mood('playful', 'Bowling night', 9, 480)] }, satisfies: ['fun', 'social'], llm: 'narrate', autonomyWeight: 0.3, group: 'Bowling' })],
    noise: curve(45, 75, [20, 21]), llmHint: 'Pins crashing, lane oil, glow-bowl lighting after nine, rental shoes in a numbered cubby.', tags: ['entertainment', 'social'],
  },
  arcade: {
    name: 'Arcade', basePrice: 20, hours: { open: h(12), close: h(24), days: ALL_DAYS }, capacity: 120,
    objects: [['arcade_cabinet', 20], ['claw_machine', 6], ['pool_table', 2], ['bar_counter', 1], ['public_restroom', 2]],
    staff: [['attendant', 'retail_associate', 2]],
    actions: [act({ id: 'play_arcade', label: 'Load a card and play', category: 'entertainment', icon: '🕹️', durationMinutes: 60, cost: 22, effects: { needs: { fun: 34, social: 20 }, skills: { gaming: 35 }, moodlets: [mood('playful', 'Arcade night', 8, 480)] }, satisfies: ['fun'], autonomyWeight: 0.3, group: 'Arcade' })],
    noise: curve(55, 85, [20]), llmHint: 'Attract-mode noise from thirty machines at once, a prize wall of junk, blacklight carpet.', tags: ['entertainment'],
  },
  casino: {
    name: 'Casino', basePrice: 0, hours: HOURS.always, capacity: 1500, encounterRate: 0.45,
    objects: [['slot_machine', 30], ['poker_table', 8], ['roulette_table', 4], ['bar_counter', 3], ['restaurant_table', 10], ['atm_machine', 3], ['public_restroom', 6]],
    staff: [['dealer', 'bartender', 8], ['security', 'security_guard', 6], ['cocktail server', 'server', 6]],
    actions: [restroom],
    ambient: { fun: 0.04 }, noise: curve(50, 75, [21, 22, 23]), crowd: curve(0.2, 0.9, [21, 22, 23]),
    llmHint: 'No clocks, no windows, carpet designed to keep you looking up, a free drink if you keep playing.', safety: 58, tags: ['nightlife', 'gambling', 'alcohol'],
  },

  // ===================== services & community =====================
  church: {
    name: 'Church', basePrice: 0, hours: HOURS.worship, capacity: 400, encounterRate: 0.4,
    objects: [['pew', 30], ['altar', 1], ['candle_stand', 2], ['community_hall_table', 8], ['soup_kitchen_counter', 1], ['public_restroom', 3]],
    rooms: ['Sanctuary', 'Fellowship hall'], staff: [['pastor', 'social_worker', 1], ['music director', 'musician', 1], ['office', 'office_admin', 1]],
    actions: [volunteer],
    ambient: { comfort: 0.05 }, noise: curve(10, 45, [10]), crowd: curve(0.02, 0.9, [9, 10, 11]),
    llmHint: 'Stained light on the pews, hymnals in the racks, a bulletin folded in your hand, coffee after.', safety: 88, tags: ['worship', 'community'],
  },
  community_center: {
    name: 'Community center', basePrice: 0, hours: { open: h(8), close: h(21), days: ALL_DAYS }, capacity: 200, encounterRate: 0.4,
    objects: [['community_hall_table', 12], ['basketball_court', 1], ['yoga_studio_floor', 1], ['computer_terminal', 6], ['public_restroom', 3], ['vending_machine', 2]],
    rooms: ['Hall', 'Gym', 'Classrooms'], staff: [['coordinator', 'social_worker', 2], ['instructor', 'personal_trainer', 2]],
    actions: [volunteer, attendClass(12, 'Take a rec class', 'creativity', 90), act({ id: 'vote_cc', label: 'Vote', category: 'civic', icon: '🗳️', durationMinutes: 25, effects: { custom: [cx('civic:vote', {})], moodlets: [mood('proud', 'Voted', 8, 1440)] }, minStage: TEEN, autonomyWeight: 0.4, group: 'Civic' })],
    llmHint: 'A linoleum multipurpose room, a bulletin board layered with flyers, folding chairs stacked on a cart.', tags: ['community', 'free'],
  },
  senior_center: {
    name: 'Senior center', basePrice: 0, hours: { open: h(8), close: h(17), days: WEEKDAYS }, capacity: 120,
    objects: [['community_hall_table', 10], ['board_games', 4], ['chess_set', 4], ['piano', 1], ['public_restroom', 3]],
    staff: [['coordinator', 'social_worker', 2], ['aide', 'nurse_cna', 3]],
    actions: [volunteer, act({ id: 'senior_lunch', label: 'Have lunch here', category: 'needs', icon: '🍽️', durationMinutes: 45, cost: 4, effects: { needs: { hunger: 44, social: 26 }, custom: [cx('needs:ate', { calories: 560, healthy: 0.4, hungerRestored: 44 })] }, autonomyWeight: 0.4, group: 'Center' })],
    llmHint: 'A card game that has been running for years, a piano nobody plays, a bingo board on the wall.', safety: 88, tags: ['community'],
  },
  shelter: {
    name: 'Shelter', basePrice: 0, hours: HOURS.always, capacity: 150,
    objects: [['cot', 40], ['soup_kitchen_counter', 1], ['public_restroom', 4], ['locker', 1]],
    staff: [['case worker', 'social_worker', 4], ['staff', 'office_admin', 3]],
    actions: [volunteer, act({ id: 'case_worker', label: 'Meet with a case worker', category: 'civic', icon: '📋', durationMinutes: 60, effects: { needs: { social: 12 }, stress: -12, custom: [cx('civic:benefits', { action: 'apply' })] }, llm: 'narrate', autonomyWeight: 0.4, group: 'Services' })],
    ambient: { comfort: -0.03 }, llmHint: 'Rows of cots under fluorescent light, a lockbox for valuables, a sign-in at the door by 8.', safety: 60, tags: ['community', 'services'],
  },
  salon: {
    name: 'Salon', basePrice: 65, hours: HOURS.salon, capacity: 20,
    objects: [['salon_chair', 6], ['nail_station', 4], ['mirror', 6], ['waiting_room_chair', 4]],
    staff: [['stylist', 'hair_stylist', 4], ['nail tech', 'nail_tech', 2]],
    actions: [act({ id: 'haircut', label: 'Get a cut and style', category: 'needs', icon: '💇', durationMinutes: 60, cost: 68, effects: { needs: { hygiene: 22, fun: 14, social: 16 }, moodlets: [mood('confident', 'Fresh cut', 10, 4320)] }, satisfies: ['hygiene'], llm: 'narrate', autonomyWeight: 0.3, group: 'Salon' }), act({ id: 'color', label: 'Get your color done', category: 'needs', icon: '🎨', durationMinutes: 150, cost: 175, effects: { needs: { hygiene: 14, social: 22, comfort: -8 }, moodlets: [mood('confident', 'New color', 12, 10080)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.15, group: 'Salon' }), act({ id: 'manicure', label: 'Get a manicure', category: 'needs', icon: '💅', durationMinutes: 50, cost: 45, effects: { needs: { hygiene: 12, comfort: 14, social: 12 }, stress: -14, moodlets: [mood('confident', 'Nails done', 7, 4320)] }, autonomyWeight: 0.2, group: 'Salon' })],
    noise: curve(25, 45, [11, 16]), llmHint: 'Blow dryers, a stack of magazines, a stylist who remembers everything you told her last time.', tags: ['service', 'grooming'],
  },
  barber: {
    name: 'Barbershop', basePrice: 32, hours: HOURS.salon, capacity: 15, encounterRate: 0.4,
    objects: [['barber_chair', 4], ['mirror', 4], ['waiting_room_chair', 6], ['tv', 1]],
    staff: [['barber', 'hair_stylist', 3]],
    actions: [act({ id: 'barber_cut', label: 'Get a cut', category: 'needs', icon: '💈', durationMinutes: 35, cost: 32, effects: { needs: { hygiene: 20, social: 18, fun: 8 }, moodlets: [mood('confident', 'Fresh cut', 9, 4320)] }, satisfies: ['hygiene'], llm: 'narrate', autonomyWeight: 0.35, group: 'Barber' }), act({ id: 'shave', label: 'Get a straight-razor shave', category: 'needs', icon: '🪒', durationMinutes: 30, cost: 38, effects: { needs: { hygiene: 18, comfort: 16 }, stress: -14, moodlets: [mood('relaxed', 'Hot towel', 8, 720)] }, minStage: TEEN, autonomyWeight: 0.15, group: 'Barber' })],
    llmHint: 'A game on the TV, clippers buzzing, an argument about sports that has been running for years.', tags: ['service', 'grooming', 'social'],
  },
  spa: {
    name: 'Spa', basePrice: 120, hours: { open: h(9), close: h(20), days: ALL_DAYS }, capacity: 30,
    objects: [['massage_table', 6], ['sauna', 2], ['tanning_bed', 2], ['locker', 1], ['public_restroom', 2]],
    staff: [['therapist', 'personal_trainer', 4], ['front desk', 'receptionist', 1]],
    actions: [act({ id: 'massage', label: 'Get a massage', category: 'health', icon: '💆', durationMinutes: 60, cost: 118, effects: { needs: { comfort: 42, fun: 12 }, stress: -40, custom: [cx('health:massage', {})], moodlets: [mood('relaxed', 'Fully unwound', 14, 720)] }, minStage: TEEN, satisfies: ['comfort'], autonomyWeight: 0.2, group: 'Spa' }), act({ id: 'facial', label: 'Get a facial', category: 'needs', icon: '🧖', durationMinutes: 50, cost: 95, effects: { needs: { hygiene: 26, comfort: 24 }, stress: -24, moodlets: [mood('confident', 'Glowing', 8, 1440)] }, minStage: TEEN, autonomyWeight: 0.15, group: 'Spa' })],
    ambient: { comfort: 0.1 }, noise: curve(8, 18, [14]), llmHint: 'Eucalyptus, a water feature, robes and slippers, whispering at the front desk.', tags: ['wellness', 'expensive'],
  },
  tattoo: {
    name: 'Tattoo shop', basePrice: 180, hours: { open: h(12), close: h(22), days: NO_SUNDAY }, capacity: 15,
    objects: [['tattoo_chair', 4], ['waiting_room_chair', 4], ['stereo', 1]], staff: [['artist', 'tattoo_artist', 3]],
    actions: [act({ id: 'get_tattoo', label: 'Get tattooed', category: 'needs', icon: '🖋️', durationMinutes: 150, cost: 280, effects: { needs: { comfort: -26, fun: 20, social: 16 }, custom: [cx('health:tattoo', {})], moodlets: [mood('proud', 'New ink', 14, 10080)] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.15, group: 'Tattoo' }), act({ id: 'consult_tattoo', label: 'Talk through an idea', category: 'social', icon: '✏️', durationMinutes: 30, effects: { needs: { social: 14, fun: 10 }, skills: { creativity: 18 } }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.1, group: 'Tattoo' })],
    noise: curve(30, 55, [18]), llmHint: 'Flash sheets on the wall, an autoclave in the back, a needle buzzing behind a curtain.', tags: ['service', 'creative'],
  },
  laundromat: {
    name: 'Laundromat', basePrice: 4, hours: { open: h(6), close: h(23), days: ALL_DAYS }, capacity: 30, encounterRate: 0.3,
    objects: [['laundromat_washer', 12], ['laundromat_dryer', 12], ['park_bench', 3], ['vending_machine', 1], ['public_restroom', 1]],
    staff: [['attendant', 'janitor', 1]],
    actions: [waitAround], noise: curve(35, 55, [19]),
    llmHint: 'A wall of machines, folding tables down the middle, a TV bolted in the corner, quarters everywhere.', safety: 66, tags: ['service'],
  },
  funeral_home: {
    name: 'Funeral home', basePrice: 0, hours: { open: h(9), close: h(20), days: ALL_DAYS }, capacity: 120,
    objects: [['pew', 16], ['waiting_room_chair', 10], ['flower_display', 3], ['public_restroom', 2]],
    staff: [['director', 'office_admin', 2]],
    actions: [act({ id: 'arrange_funeral', label: 'Make arrangements', category: 'family', icon: '⚱️', durationMinutes: 90, effects: { stress: 24, needs: { social: 8 }, custom: [cx('family:funeral_arrange', {})], moodlets: [mood('grieving', 'Made the arrangements', -12, 2880)] }, minStage: YA, llm: 'narrate', autonomyWeight: 0.3, group: 'Funeral' }), act({ id: 'attend_visitation', label: 'Attend the visitation', category: 'family', icon: '🕊️', durationMinutes: 90, effects: { needs: { social: 20 }, stress: 12, moodlets: [mood('grieving', 'Paid your respects', -8, 1440)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.3, group: 'Funeral' })],
    ambient: { comfort: -0.02 }, noise: curve(8, 20, [14]),
    llmHint: 'Carpet, tissue boxes at the end of every row, a guest book on a stand by the door.', safety: 90, tags: ['family'],
  },
  cemetery: {
    name: 'Cemetery', basePrice: 0, hours: { open: h(7), close: h(19), days: ALL_DAYS }, capacity: 60,
    objects: [['park_bench', 4], ['walking_trail', 1], ['flower_display', 1]],
    actions: [act({ id: 'visit_grave', label: 'Visit a grave', category: 'family', icon: '🌷', durationMinutes: 35, effects: { needs: { comfort: -6, social: 4 }, stress: -12, moodlets: [mood('nostalgic', 'Sat with them a while', 4, 720)] }, minStage: TEEN, llm: 'narrate', autonomyWeight: 0.2, group: 'Cemetery' })],
    ambient: { comfort: 0.02 }, noise: curve(5, 12, [12]),
    llmHint: 'Mown grass between the rows, plastic flowers faded by sun, wind and nothing else.', safety: 74, tags: ['family', 'quiet'],
  },

  // ===================== vehicles & transport =====================
  car_dealer: {
    name: 'Car dealership', basePrice: 0, hours: { open: h(9), close: h(20), days: ALL_DAYS }, capacity: 60,
    objects: [['dealer_lot', 1], ['office_desk', 6], ['waiting_room_chair', 8], ['cafe_counter', 1], ['public_restroom', 2]],
    staff: [['salesperson', 'sales_rep', 6], ['finance manager', 'loan_officer', 2], ['service advisor', 'mechanic', 2]],
    actions: [askStaff], llmHint: 'Balloons on the light poles, a showroom with two cars on the tile, a finance office with a closed door.', tags: ['vehicle', 'shop'],
  },
  car_rental: {
    name: 'Car rental', basePrice: 0, hours: { open: h(7), close: h(21), days: ALL_DAYS }, capacity: 25,
    objects: [['rental_counter', 2], ['dealer_lot', 1], ['waiting_room_chair', 6]], staff: [['agent', 'sales_rep', 3]],
    actions: [waitAround], llmHint: 'A counter with a queue, a lot of identical white sedans, a hard sell on the insurance.', tags: ['vehicle', 'service'],
  },
  gas_station: {
    name: 'Gas station', basePrice: 1.35, hours: HOURS.always, capacity: 30, sells: 'convenience',
    objects: [['fuel_pump', 8], ['grocery_shelf', 3], ['cash_register', 1], ['vending_machine', 1], ['public_restroom', 1], ['car_wash_bay', 1]],
    staff: [['clerk', 'cashier', 2]], actions: [grabFew, restroom],
    llmHint: 'Canopy lights, a pump screen playing an ad, a store with roller dogs and an ICEE machine.', safety: 62, tags: ['fuel', 'shop'],
  },
  ev_charger: {
    name: 'EV charging station', basePrice: 0, hours: HOURS.always, capacity: 12,
    objects: [['ev_charger', 8], ['park_bench', 2], ['vending_machine', 1]],
    actions: [waitAround], llmHint: 'A row of chargers behind a shopping center, everyone waiting in their cars on their phones.', tags: ['fuel', 'vehicle'],
  },
  mechanic: {
    name: 'Auto shop', basePrice: 0, hours: { open: h(8), close: h(18), days: NO_SUNDAY }, capacity: 25,
    objects: [['car_lift', 4], ['parts_counter', 1], ['waiting_room_chair', 8], ['tool_chest', 3], ['public_restroom', 1]],
    staff: [['mechanic', 'mechanic', 4], ['service writer', 'office_admin', 1]],
    actions: [waitAround], noise: curve(45, 70, [10, 14]),
    llmHint: 'Impact wrenches, a waiting room with old coffee, an estimate handed over on a clipboard.', tags: ['vehicle', 'service'],
  },
  car_wash: {
    name: 'Car wash', basePrice: 0, hours: { open: h(7), close: h(21), days: ALL_DAYS }, capacity: 15,
    objects: [['car_wash_bay', 2], ['vending_machine', 1]], staff: [['attendant', 'retail_associate', 2]],
    llmHint: 'Colored foam, a light telling you to pull forward, vacuums on a rack at the exit.', tags: ['vehicle', 'service'],
  },
  parking: {
    name: 'Parking', basePrice: 0, hours: HOURS.always, capacity: 400,
    objects: [['parking_space', 40], ['ticket_kiosk', 1]],
    llmHint: 'Numbered spaces, a pay station that takes cards, a level marked in a color you will forget.', safety: 64, tags: ['vehicle'],
  },
  transit_stop: {
    name: 'Transit stop', basePrice: 2.5, hours: HOURS.always, capacity: 25, encounterRate: 0.3,
    objects: [['bus_stop_sign', 1], ['park_bench', 2], ['ticket_kiosk', 1]],
    llmHint: 'A shelter with a bench and a route map, someone else checking the same app you are.', safety: 62, tags: ['transit'],
  },
  bus_station: {
    name: 'Bus station', basePrice: 2.5, hours: { open: h(5), close: h(24), days: ALL_DAYS }, capacity: 200,
    objects: [['bus_stop_sign', 6], ['ticket_kiosk', 3], ['waiting_room_chair', 30], ['vending_machine', 3], ['public_restroom', 3]],
    staff: [['agent', 'office_admin', 2], ['driver', 'bus_driver', 8]],
    actions: [waitAround], llmHint: 'Rows of bolted seats, a departures board, luggage nobody is watching closely enough.', safety: 58, tags: ['transit'],
  },
  train_station: {
    name: 'Train station', basePrice: 6, hours: { open: h(5), close: h(24), days: ALL_DAYS }, capacity: 400,
    objects: [['train_platform', 4], ['ticket_kiosk', 4], ['waiting_room_chair', 30], ['cafe_counter', 1], ['vending_machine', 3], ['public_restroom', 4]],
    staff: [['agent', 'office_admin', 3]],
    actions: [waitAround], noise: curve(30, 65, [8, 17]),
    llmHint: 'A departures board flipping over, a platform announcement you can barely parse, echo off tile.', safety: 66, tags: ['transit'],
  },
  airport: {
    name: 'Airport', basePrice: 0, hours: HOURS.always, capacity: 10000, encounterRate: 0.2,
    objects: [['airport_gate', 20], ['security_checkpoint', 4], ['ticket_kiosk', 8], ['cafe_counter', 4], ['restaurant_table', 20], ['bar_counter', 3], ['bookstore_shelf', 2], ['vending_machine', 6], ['public_restroom', 12], ['rental_counter', 2]],
    rooms: ['Ticketing', 'Security', 'Concourse', 'Baggage claim'],
    staff: [['gate agent', 'office_admin', 12], ['TSA officer', 'security_guard', 15], ['flight attendant', 'flight_attendant', 20], ['barista', 'barista', 6]],
    actions: [waitAround, restroom], noise: curve(45, 70, [7, 17]), crowd: curve(0.3, 0.9, [6, 7, 17]),
    llmHint: 'Moving walkways, gate changes, $9 water, a whole building of people who would rather be elsewhere.', safety: 82, tags: ['transit', 'travel'],
  },
  hotel: {
    name: 'Hotel', basePrice: 165, hours: HOURS.always, capacity: 300,
    objects: [['hotel_lobby_desk', 1], ['hotel_bed', 30], ['cafe_counter', 1], ['gym_treadmill', 2], ['lap_pool', 1], ['public_restroom', 4]],
    rooms: ['Lobby', 'Rooms', 'Fitness room', 'Pool'], staff: [['front desk', 'hotel_clerk', 3], ['housekeeper', 'housekeeper', 8], ['manager', 'office_admin', 1]],
    actions: [act({ id: 'hotel_breakfast', label: 'Eat the free breakfast', category: 'needs', icon: '🍳', durationMinutes: 25, effects: { needs: { hunger: 38, thirst: 20 }, caffeine: 90, custom: [cx('needs:ate', { calories: 520, healthy: -0.2, hungerRestored: 38 })] }, requirements: [{ kind: 'time_window', reason: 'Breakfast ends at 9:30', params: { start: h(6), end: h(9, 30) } }], satisfies: ['hunger'], autonomyWeight: 0.6, group: 'Hotel' })],
    llmHint: 'A lobby that smells faintly of chlorine, a luggage cart, a waffle iron with a line at 8 a.m.', safety: 80, tags: ['travel', 'lodging'],
  },

  unknown: {
    name: 'Place', basePrice: 1, hours: HOURS.retail, capacity: 30,
    objects: [['park_bench', 2], ['public_restroom', 1]], actions: [peopleWatch, restroom],
    llmHint: 'A place with a door and a sign, doing whatever it does.', tags: [],
  },
};

export const ARCHETYPES: Record<VenueArchetype, ArchetypeDef> = Object.fromEntries(
  (Object.keys(D) as VenueArchetype[]).map((id) => [id, build(id, D[id])]),
) as Record<VenueArchetype, ArchetypeDef>;

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as VenueArchetype[];

/** Archetypes a sim can plausibly walk into and do something at (excludes home/private). */
export const PUBLIC_ARCHETYPES = ARCHETYPE_IDS.filter((a) => a !== 'home' && a !== 'apartment_building' && a !== 'unknown');
