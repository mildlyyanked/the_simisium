/**
 * Google Places `types` → game `VenueArchetype`.
 *
 * Mapping is a priority list: the most specific Google types come first so that a place typed
 * `['gas_station', 'convenience_store', 'store']` becomes a gas station, not a convenience store, and
 * `['university', 'school']` becomes a college. `primaryType` (Places API New) is consulted first when it
 * maps to something; otherwise the first matching entry in `TYPE_PRIORITY` wins; `unknown` is the fallback.
 *
 * Type names are Places API (New) Table A names. A handful of speculative names (marked `// spec`) are not
 * in Table A but are accepted so that worldgen can tag venues found via text search (e.g. "DMV") and so the
 * mock fixtures can express archetypes Google has no dedicated type for.
 */
import type { VenueArchetype } from '../core/types';

/** Ordered [googleType, archetype] pairs. Earlier = higher priority. */
export const TYPE_PRIORITY: readonly (readonly [string, VenueArchetype])[] = [
  // --- transport hubs (very specific) ---
  ['international_airport', 'airport'],
  ['airport', 'airport'],
  ['airstrip', 'airport'],
  ['heliport', 'airport'],
  ['train_station', 'train_station'],
  ['bus_station', 'bus_station'],
  ['transit_depot', 'bus_station'],
  ['light_rail_station', 'transit_stop'],
  ['subway_station', 'transit_stop'],
  ['bus_stop', 'transit_stop'],
  ['transit_station', 'transit_stop'],
  ['taxi_stand', 'transit_stop'],
  ['ferry_terminal', 'transit_stop'],
  ['park_and_ride', 'parking'],

  // --- government / civic ---
  ['dmv', 'dmv'], // spec
  ['department_of_motor_vehicles', 'dmv'], // spec
  ['courthouse', 'courthouse'],
  ['jail', 'jail'], // spec
  ['prison', 'jail'], // spec
  ['neighborhood_police_station', 'police'],
  ['police', 'police'],
  ['fire_station', 'fire_station'],
  ['city_hall', 'city_hall'],
  ['post_office', 'post_office'],
  ['embassy', 'city_hall'],
  ['local_government_office', 'city_hall'],
  ['government_office', 'city_hall'],

  // --- health ---
  ['hospital', 'hospital'],
  ['emergency_room', 'hospital'], // spec
  ['dental_clinic', 'dentist'],
  ['dentist', 'dentist'],
  ['pharmacy', 'pharmacy'],
  ['drugstore', 'pharmacy'],
  ['veterinary_care', 'vet'],
  ['urgent_care', 'clinic'], // spec
  ['doctor', 'clinic'],
  ['medical_lab', 'clinic'],
  ['physiotherapist', 'clinic'],
  ['chiropractor', 'clinic'],
  ['skin_care_clinic', 'spa'],
  ['massage', 'spa'],
  ['spa', 'spa'],
  ['sauna', 'spa'],
  ['tanning_studio', 'spa'],
  ['wellness_center', 'spa'],
  ['public_bath', 'spa'],

  // --- education / childcare ---
  ['university', 'college'],
  ['community_college', 'college'], // spec
  ['library', 'library'],
  ['child_care_agency', 'daycare'],
  ['preschool', 'daycare'],
  ['music_school', 'music_school'], // spec
  ['dance_studio', 'dance_studio'], // spec
  ['dance_school', 'dance_studio'], // spec
  ['martial_arts_school', 'martial_arts'], // spec
  ['art_studio', 'art_studio'],
  ['primary_school', 'school'],
  ['secondary_school', 'school'],
  ['school', 'school'],

  // --- fitness / sports ---
  ['climbing_gym', 'climbing_gym'], // spec
  ['adventure_sports_center', 'climbing_gym'],
  ['yoga_studio', 'yoga'],
  ['pilates_studio', 'yoga'], // spec
  ['golf_course', 'golf'],
  ['swimming_pool', 'pool'],
  ['ice_skating_rink', 'ice_rink'],
  ['stadium', 'stadium'],
  ['arena', 'arena'],
  ['gym', 'gym'],
  ['fitness_center', 'gym'],
  ['athletic_field', 'sports_field'],
  ['sports_complex', 'sports_field'],
  ['sports_club', 'sports_field'],
  ['sports_activity_location', 'sports_field'],
  ['sports_coaching', 'martial_arts'],
  ['ski_resort', 'trail'],

  // --- entertainment ---
  ['movie_theater', 'cinema'],
  ['night_club', 'nightclub'],
  ['dance_hall', 'nightclub'],
  ['casino', 'casino'],
  ['bowling_alley', 'bowling'],
  ['video_arcade', 'arcade'],
  ['amusement_center', 'arcade'],
  ['amusement_park', 'amusement_park'],
  ['water_park', 'amusement_park'],
  ['roller_coaster', 'amusement_park'],
  ['ferris_wheel', 'amusement_park'],
  ['zoo', 'zoo'],
  ['wildlife_park', 'zoo'],
  ['wildlife_refuge', 'zoo'],
  ['aquarium', 'aquarium'],
  ['concert_hall', 'concert_hall'],
  ['philharmonic_hall', 'concert_hall'],
  ['opera_house', 'concert_hall'],
  ['amphitheatre', 'concert_hall'],
  ['performing_arts_theater', 'theater'],
  ['auditorium', 'theater'],
  ['comedy_club', 'theater'],
  ['museum', 'museum'],
  ['art_gallery', 'museum'],
  ['planetarium', 'museum'],
  ['cultural_landmark', 'museum'],
  ['historical_landmark', 'museum'],
  ['historical_place', 'museum'],
  ['monument', 'museum'],
  ['karaoke', 'bar'],

  // --- outdoors ---
  ['beach', 'beach'],
  ['marina', 'beach'],
  ['playground', 'playground'],
  ['skateboard_park', 'playground'],
  ['hiking_area', 'trail'],
  ['cycling_park', 'trail'],
  ['dog_park', 'park'],
  ['national_park', 'park'],
  ['state_park', 'park'],
  ['botanical_garden', 'park'],
  ['garden', 'park'],
  ['picnic_ground', 'park'],
  ['plaza', 'park'],
  ['park', 'park'],
  ['cemetery', 'cemetery'],
  ['funeral_home', 'funeral_home'],

  // --- lodging ---
  ['hotel', 'hotel'],
  ['motel', 'hotel'],
  ['resort_hotel', 'hotel'],
  ['extended_stay_hotel', 'hotel'],
  ['inn', 'hotel'],
  ['bed_and_breakfast', 'hotel'],
  ['hostel', 'hotel'],
  ['guest_house', 'hotel'],
  ['lodging', 'hotel'],

  // --- automotive ---
  ['gas_station', 'gas_station'],
  ['truck_stop', 'gas_station'],
  ['electric_vehicle_charging_station', 'ev_charger'],
  ['car_wash', 'car_wash'],
  ['car_repair', 'mechanic'],
  ['car_dealer', 'car_dealer'],
  ['car_rental', 'car_rental'],
  ['parking', 'parking'],
  ['rest_stop', 'gas_station'],

  // --- shopping (specific → generic) ---
  ['supermarket', 'grocery'],
  ['grocery_store', 'grocery'],
  ['asian_grocery_store', 'grocery'],
  ['warehouse_store', 'grocery'],
  ['food_store', 'grocery'],
  ['convenience_store', 'convenience'],
  ['liquor_store', 'liquor_store'],
  ['cannabis_store', 'dispensary'], // spec
  ['dispensary', 'dispensary'], // spec
  ['pharmacy_dispensary', 'dispensary'], // spec
  ['butcher_shop', 'butcher'],
  ['florist', 'florist'],
  ['bakery', 'bakery'],
  ['bagel_shop', 'bakery'],
  ['donut_shop', 'bakery'],
  ['market', 'farmers_market'],
  ['farmers_market', 'farmers_market'], // spec
  ['farm', 'farmers_market'],
  ['thrift_store', 'thrift_store'], // spec
  ['secondhand_store', 'thrift_store'], // spec
  ['pet_store', 'pet_store'],
  ['book_store', 'bookstore'],
  ['electronics_store', 'electronics'],
  ['cell_phone_store', 'electronics'],
  ['furniture_store', 'furniture'],
  ['home_goods_store', 'furniture'],
  ['hardware_store', 'hardware'],
  ['home_improvement_store', 'hardware'],
  ['shopping_mall', 'mall'],
  ['clothing_store', 'clothing'],
  ['shoe_store', 'clothing'],
  ['department_store', 'retail'],
  ['discount_store', 'retail'],
  ['sporting_goods_store', 'retail'],
  ['gift_shop', 'retail'],
  ['jewelry_store', 'retail'],
  ['auto_parts_store', 'retail'],
  ['bicycle_store', 'retail'],
  ['wholesaler', 'retail'],
  ['storage', 'storage'],
  ['self_storage', 'storage'], // spec

  // --- food & drink (specific → generic) ---
  ['coffee_shop', 'cafe'],
  ['cafe', 'cafe'],
  ['tea_house', 'cafe'],
  ['cat_cafe', 'cafe'],
  ['dog_cafe', 'cafe'],
  ['internet_cafe', 'cafe'],
  ['juice_shop', 'cafe'],
  ['acai_shop', 'cafe'],
  ['ice_cream_shop', 'cafe'],
  ['dessert_shop', 'cafe'],
  ['dessert_restaurant', 'cafe'],
  ['candy_store', 'cafe'],
  ['chocolate_shop', 'cafe'],
  ['confectionery', 'cafe'],
  ['bar', 'bar'],
  ['pub', 'bar'],
  ['wine_bar', 'bar'],
  ['fast_food_restaurant', 'fast_food'],
  ['hamburger_restaurant', 'fast_food'],
  ['sandwich_shop', 'fast_food'],
  ['deli', 'fast_food'],
  ['food_court', 'fast_food'],
  ['meal_takeaway', 'fast_food'],
  ['meal_delivery', 'fast_food'],
  ['food_truck', 'fast_food'], // spec
  ['bar_and_grill', 'restaurant'],
  ['american_restaurant', 'restaurant'],
  ['mexican_restaurant', 'restaurant'],
  ['italian_restaurant', 'restaurant'],
  ['chinese_restaurant', 'restaurant'],
  ['japanese_restaurant', 'restaurant'],
  ['sushi_restaurant', 'restaurant'],
  ['ramen_restaurant', 'restaurant'],
  ['thai_restaurant', 'restaurant'],
  ['vietnamese_restaurant', 'restaurant'],
  ['korean_restaurant', 'restaurant'],
  ['indian_restaurant', 'restaurant'],
  ['mediterranean_restaurant', 'restaurant'],
  ['middle_eastern_restaurant', 'restaurant'],
  ['greek_restaurant', 'restaurant'],
  ['french_restaurant', 'restaurant'],
  ['spanish_restaurant', 'restaurant'],
  ['brazilian_restaurant', 'restaurant'],
  ['african_restaurant', 'restaurant'],
  ['asian_restaurant', 'restaurant'],
  ['seafood_restaurant', 'restaurant'],
  ['steak_house', 'restaurant'],
  ['barbecue_restaurant', 'restaurant'],
  ['pizza_restaurant', 'restaurant'],
  ['breakfast_restaurant', 'restaurant'],
  ['brunch_restaurant', 'restaurant'],
  ['diner', 'restaurant'],
  ['buffet_restaurant', 'restaurant'],
  ['fine_dining_restaurant', 'restaurant'],
  ['vegan_restaurant', 'restaurant'],
  ['vegetarian_restaurant', 'restaurant'],
  ['cafeteria', 'restaurant'],
  ['restaurant', 'restaurant'],

  // --- services / offices ---
  ['bank', 'bank'],
  ['atm', 'atm'],
  ['lawyer', 'lawyer'],
  ['accounting', 'accountant'],
  ['insurance_agency', 'insurance'],
  ['real_estate_agency', 'real_estate'],
  ['laundry', 'laundromat'],
  ['laundromat', 'laundromat'], // spec
  ['barber_shop', 'barber'],
  ['hair_salon', 'salon'],
  ['beauty_salon', 'salon'],
  ['nail_salon', 'salon'],
  ['hair_care', 'salon'],
  ['beautician', 'salon'],
  ['makeup_artist', 'salon'],
  ['body_art_service', 'tattoo'],
  ['tattoo_shop', 'tattoo'], // spec
  ['coworking_space', 'coworking'], // spec
  ['corporate_office', 'office'],
  ['consultant', 'office'],
  ['telecommunications_service_provider', 'office'],
  ['travel_agency', 'office'],
  ['factory', 'factory'], // spec
  ['manufacturer', 'factory'], // spec
  ['industrial_park', 'factory'], // spec
  ['warehouse', 'warehouse'], // spec
  ['distribution_center', 'warehouse'], // spec
  ['courier_service', 'warehouse'],
  ['moving_company', 'warehouse'],

  // --- community / worship / housing ---
  ['homeless_shelter', 'shelter'], // spec
  ['shelter', 'shelter'], // spec
  ['senior_center', 'senior_center'], // spec
  ['community_center', 'community_center'],
  ['cultural_center', 'community_center'],
  ['event_venue', 'community_center'],
  ['banquet_hall', 'community_center'],
  ['convention_center', 'community_center'],
  ['church', 'church'],
  ['mosque', 'church'],
  ['synagogue', 'church'],
  ['hindu_temple', 'church'],
  ['place_of_worship', 'church'],
  ['apartment_building', 'apartment_building'],
  ['apartment_complex', 'apartment_building'],
  ['condominium_complex', 'apartment_building'],
  ['housing_complex', 'apartment_building'],
  ['mobile_home_park', 'apartment_building'],

  // --- generic Table B fallbacks (lowest priority) ---
  ['store', 'retail'],
  ['food', 'restaurant'],
  ['health', 'clinic'],
  ['finance', 'bank'],
  ['tourist_attraction', 'museum'],
  ['natural_feature', 'park'],
  ['campground', 'park'],
  ['rv_park', 'park'],
  ['premise', 'home'],
  ['street_address', 'home'],
];

const TYPE_TO_ARCHETYPE: ReadonlyMap<string, VenueArchetype> = new Map(TYPE_PRIORITY.map(([t, a]) => [t, a]));

/** Direct lookup of a single google type (undefined when unmapped). */
export function archetypeForType(type: string): VenueArchetype | undefined {
  return TYPE_TO_ARCHETYPE.get(type);
}

/**
 * Resolve the archetype for a place. `primaryType` wins when it is mapped; otherwise the highest-priority
 * mapped entry among `types`. Falls back to `unknown`.
 */
export function archetypeForTypes(types: string[], primaryType?: string): VenueArchetype {
  if (primaryType) {
    const a = TYPE_TO_ARCHETYPE.get(primaryType);
    if (a) return a;
  }
  if (!types || types.length === 0) return 'unknown';
  const set = new Set(types);
  for (const [t, a] of TYPE_PRIORITY) if (set.has(t)) return a;
  return 'unknown';
}

const ICONS: Record<VenueArchetype, string> = {
  home: '🏠',
  apartment_building: '🏢',
  grocery: '🛒',
  convenience: '🏪',
  restaurant: '🍽️',
  fast_food: '🍔',
  cafe: '☕',
  bar: '🍺',
  nightclub: '🪩',
  gym: '🏋️',
  park: '🌳',
  playground: '🛝',
  trail: '🥾',
  beach: '🏖️',
  school: '🏫',
  daycare: '🧸',
  college: '🎓',
  library: '📚',
  hospital: '🏥',
  clinic: '🩺',
  dentist: '🦷',
  pharmacy: '💊',
  vet: '🐾',
  pet_store: '🐶',
  police: '🚔',
  fire_station: '🚒',
  courthouse: '⚖️',
  jail: '🔒',
  dmv: '🪪',
  city_hall: '🏛️',
  post_office: '📮',
  bank: '🏦',
  atm: '🏧',
  office: '🏢',
  coworking: '💻',
  factory: '🏭',
  warehouse: '📦',
  retail: '🛍️',
  clothing: '👕',
  electronics: '📱',
  furniture: '🛋️',
  hardware: '🔧',
  bookstore: '📖',
  mall: '🏬',
  liquor_store: '🍾',
  dispensary: '🌿',
  cinema: '🎬',
  theater: '🎭',
  concert_hall: '🎻',
  stadium: '🏟️',
  arena: '🏒',
  museum: '🖼️',
  zoo: '🦁',
  aquarium: '🐠',
  amusement_park: '🎢',
  bowling: '🎳',
  arcade: '🕹️',
  casino: '🎰',
  church: '⛪',
  salon: '💇',
  barber: '💈',
  spa: '🧖',
  tattoo: '🪡',
  laundromat: '🧺',
  car_dealer: '🚗',
  car_rental: '🚙',
  gas_station: '⛽',
  ev_charger: '🔌',
  mechanic: '🔩',
  car_wash: '🫧',
  parking: '🅿️',
  transit_stop: '🚏',
  train_station: '🚉',
  bus_station: '🚌',
  airport: '✈️',
  hotel: '🏨',
  community_center: '🤝',
  senior_center: '🧓',
  shelter: '🛏️',
  cemetery: '🪦',
  funeral_home: '⚰️',
  lawyer: '👩‍⚖️',
  accountant: '🧾',
  insurance: '📋',
  real_estate: '🏡',
  storage: '🗄️',
  farmers_market: '🥕',
  bakery: '🥐',
  butcher: '🥩',
  florist: '💐',
  thrift_store: '🧥',
  sports_field: '⚽',
  golf: '⛳',
  pool: '🏊',
  ice_rink: '⛸️',
  climbing_gym: '🧗',
  yoga: '🧘',
  martial_arts: '🥋',
  dance_studio: '💃',
  music_school: '🎹',
  art_studio: '🎨',
  unknown: '📍',
};

export function archetypeIcon(a: VenueArchetype): string {
  return ICONS[a] ?? ICONS.unknown;
}

/** Every archetype in the union, in a stable order (useful for iteration/tests). */
export const ALL_ARCHETYPES: readonly VenueArchetype[] = Object.keys(ICONS) as VenueArchetype[];
