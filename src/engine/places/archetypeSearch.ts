/**
 * The nearby searches worldgen runs when seeding a new game. Balanced for ~120 venues around the chosen
 * city center. `includedTypes` only contains Places API (New) Table A names (Google rejects unknown types
 * in `searchNearby`). Archetypes Google has no dedicated type for carry a `textQuery` instead: worldgen
 * should call `provider.searchText(textQuery, …)` for those and force `archetype` on the results.
 */
import type { VenueArchetype } from '../core/types';

export interface SearchPlanEntry {
  archetype: VenueArchetype;
  /** Table A types for `searchNearby`. Empty when `textQuery` must be used instead. */
  includedTypes: string[];
  maxResults: number;
  radiusM: number;
  /** fallback / alternative text search (used when includedTypes is empty or yields nothing) */
  textQuery?: string;
  /** archetype is essential for a playable world (tests assert coverage) */
  essential?: boolean;
}

export const SEARCH_PLAN: SearchPlanEntry[] = [
  // ---- food & daily life ----
  { archetype: 'grocery', includedTypes: ['supermarket', 'grocery_store'], maxResults: 6, radiusM: 6000, essential: true },
  { archetype: 'convenience', includedTypes: ['convenience_store'], maxResults: 4, radiusM: 4000, essential: true },
  { archetype: 'restaurant', includedTypes: ['restaurant'], maxResults: 12, radiusM: 5000, essential: true },
  { archetype: 'fast_food', includedTypes: ['fast_food_restaurant', 'hamburger_restaurant', 'sandwich_shop'], maxResults: 5, radiusM: 5000, essential: true },
  { archetype: 'cafe', includedTypes: ['coffee_shop', 'cafe'], maxResults: 6, radiusM: 5000, essential: true },
  { archetype: 'bar', includedTypes: ['bar', 'pub', 'wine_bar'], maxResults: 6, radiusM: 5000, essential: true },
  { archetype: 'nightclub', includedTypes: ['night_club'], maxResults: 2, radiusM: 8000 },
  { archetype: 'bakery', includedTypes: ['bakery'], maxResults: 2, radiusM: 6000 },
  { archetype: 'butcher', includedTypes: ['butcher_shop'], maxResults: 1, radiusM: 8000 },
  { archetype: 'farmers_market', includedTypes: ['market'], maxResults: 1, radiusM: 8000, textQuery: 'farmers market' },
  { archetype: 'liquor_store', includedTypes: ['liquor_store'], maxResults: 2, radiusM: 6000 },
  { archetype: 'dispensary', includedTypes: [], maxResults: 1, radiusM: 10000, textQuery: 'cannabis dispensary' },

  // ---- fitness & outdoors ----
  { archetype: 'gym', includedTypes: ['gym', 'fitness_center'], maxResults: 3, radiusM: 6000, essential: true },
  { archetype: 'park', includedTypes: ['park'], maxResults: 6, radiusM: 6000, essential: true },
  { archetype: 'playground', includedTypes: ['playground'], maxResults: 2, radiusM: 5000 },
  { archetype: 'trail', includedTypes: ['hiking_area', 'cycling_park'], maxResults: 2, radiusM: 12000 },
  { archetype: 'beach', includedTypes: ['beach'], maxResults: 1, radiusM: 20000 },
  { archetype: 'sports_field', includedTypes: ['athletic_field', 'sports_complex'], maxResults: 2, radiusM: 8000 },
  { archetype: 'golf', includedTypes: ['golf_course'], maxResults: 1, radiusM: 15000 },
  { archetype: 'pool', includedTypes: ['swimming_pool'], maxResults: 1, radiusM: 8000 },
  { archetype: 'ice_rink', includedTypes: ['ice_skating_rink'], maxResults: 1, radiusM: 15000 },
  { archetype: 'climbing_gym', includedTypes: ['adventure_sports_center'], maxResults: 1, radiusM: 12000, textQuery: 'climbing gym' },
  { archetype: 'yoga', includedTypes: ['yoga_studio'], maxResults: 1, radiusM: 8000 },
  { archetype: 'martial_arts', includedTypes: ['sports_coaching'], maxResults: 1, radiusM: 10000, textQuery: 'martial arts' },
  { archetype: 'dance_studio', includedTypes: [], maxResults: 1, radiusM: 10000, textQuery: 'dance studio' },

  // ---- education ----
  { archetype: 'school', includedTypes: ['primary_school', 'secondary_school'], maxResults: 3, radiusM: 6000, essential: true },
  { archetype: 'daycare', includedTypes: ['child_care_agency', 'preschool'], maxResults: 1, radiusM: 6000, essential: true },
  { archetype: 'college', includedTypes: ['university'], maxResults: 2, radiusM: 15000, essential: true },
  { archetype: 'library', includedTypes: ['library'], maxResults: 2, radiusM: 8000, essential: true },
  { archetype: 'music_school', includedTypes: [], maxResults: 1, radiusM: 10000, textQuery: 'music school' },
  { archetype: 'art_studio', includedTypes: ['art_studio'], maxResults: 1, radiusM: 10000 },

  // ---- health ----
  { archetype: 'hospital', includedTypes: ['hospital'], maxResults: 2, radiusM: 12000, essential: true },
  { archetype: 'clinic', includedTypes: ['doctor'], maxResults: 3, radiusM: 6000, essential: true },
  { archetype: 'dentist', includedTypes: ['dental_clinic', 'dentist'], maxResults: 1, radiusM: 6000, essential: true },
  { archetype: 'pharmacy', includedTypes: ['pharmacy', 'drugstore'], maxResults: 3, radiusM: 6000, essential: true },
  { archetype: 'vet', includedTypes: ['veterinary_care'], maxResults: 1, radiusM: 8000, essential: true },
  { archetype: 'pet_store', includedTypes: ['pet_store'], maxResults: 1, radiusM: 8000, essential: true },
  { archetype: 'spa', includedTypes: ['spa', 'massage'], maxResults: 1, radiusM: 8000 },

  // ---- government / civic ----
  { archetype: 'police', includedTypes: ['police'], maxResults: 2, radiusM: 10000, essential: true },
  { archetype: 'fire_station', includedTypes: ['fire_station'], maxResults: 1, radiusM: 8000 },
  { archetype: 'courthouse', includedTypes: ['courthouse'], maxResults: 1, radiusM: 15000, essential: true },
  { archetype: 'jail', includedTypes: [], maxResults: 1, radiusM: 20000, textQuery: 'county jail' },
  { archetype: 'dmv', includedTypes: [], maxResults: 1, radiusM: 20000, textQuery: 'DMV driver license office', essential: true },
  { archetype: 'city_hall', includedTypes: ['city_hall'], maxResults: 1, radiusM: 15000 },
  { archetype: 'post_office', includedTypes: ['post_office'], maxResults: 1, radiusM: 6000, essential: true },
  { archetype: 'community_center', includedTypes: ['community_center'], maxResults: 1, radiusM: 8000, essential: true },
  { archetype: 'senior_center', includedTypes: [], maxResults: 1, radiusM: 10000, textQuery: 'senior center' },
  { archetype: 'shelter', includedTypes: [], maxResults: 1, radiusM: 12000, textQuery: 'homeless shelter', essential: true },
  { archetype: 'church', includedTypes: ['church', 'synagogue', 'mosque', 'hindu_temple'], maxResults: 2, radiusM: 6000, essential: true },
  { archetype: 'cemetery', includedTypes: ['cemetery'], maxResults: 1, radiusM: 12000 },
  { archetype: 'funeral_home', includedTypes: ['funeral_home'], maxResults: 1, radiusM: 12000 },

  // ---- money & professional services ----
  { archetype: 'bank', includedTypes: ['bank'], maxResults: 3, radiusM: 6000, essential: true },
  { archetype: 'atm', includedTypes: ['atm'], maxResults: 2, radiusM: 3000 },
  { archetype: 'lawyer', includedTypes: ['lawyer'], maxResults: 1, radiusM: 10000, essential: true },
  { archetype: 'accountant', includedTypes: ['accounting'], maxResults: 1, radiusM: 10000 },
  { archetype: 'insurance', includedTypes: ['insurance_agency'], maxResults: 1, radiusM: 10000 },
  { archetype: 'real_estate', includedTypes: ['real_estate_agency'], maxResults: 1, radiusM: 10000, essential: true },
  { archetype: 'office', includedTypes: ['corporate_office'], maxResults: 3, radiusM: 8000, essential: true },
  { archetype: 'coworking', includedTypes: [], maxResults: 1, radiusM: 8000, textQuery: 'coworking space' },
  { archetype: 'factory', includedTypes: [], maxResults: 1, radiusM: 15000, textQuery: 'manufacturing plant' },
  { archetype: 'warehouse', includedTypes: ['courier_service', 'moving_company'], maxResults: 1, radiusM: 15000, textQuery: 'distribution warehouse' },
  { archetype: 'storage', includedTypes: ['storage'], maxResults: 1, radiusM: 10000 },

  // ---- retail ----
  { archetype: 'retail', includedTypes: ['department_store', 'discount_store', 'sporting_goods_store'], maxResults: 3, radiusM: 8000, essential: true },
  { archetype: 'mall', includedTypes: ['shopping_mall'], maxResults: 1, radiusM: 15000 },
  { archetype: 'clothing', includedTypes: ['clothing_store'], maxResults: 2, radiusM: 8000, essential: true },
  { archetype: 'electronics', includedTypes: ['electronics_store', 'cell_phone_store'], maxResults: 1, radiusM: 10000, essential: true },
  { archetype: 'furniture', includedTypes: ['furniture_store', 'home_goods_store'], maxResults: 1, radiusM: 10000, essential: true },
  { archetype: 'hardware', includedTypes: ['hardware_store', 'home_improvement_store'], maxResults: 1, radiusM: 10000, essential: true },
  { archetype: 'bookstore', includedTypes: ['book_store'], maxResults: 1, radiusM: 10000 },
  { archetype: 'thrift_store', includedTypes: [], maxResults: 1, radiusM: 10000, textQuery: 'thrift store' },
  { archetype: 'florist', includedTypes: ['florist'], maxResults: 1, radiusM: 8000 },

  // ---- entertainment ----
  { archetype: 'cinema', includedTypes: ['movie_theater'], maxResults: 2, radiusM: 10000, essential: true },
  { archetype: 'theater', includedTypes: ['performing_arts_theater', 'comedy_club'], maxResults: 1, radiusM: 10000 },
  { archetype: 'concert_hall', includedTypes: ['concert_hall', 'amphitheatre'], maxResults: 1, radiusM: 12000 },
  { archetype: 'museum', includedTypes: ['museum', 'art_gallery'], maxResults: 1, radiusM: 10000 },
  { archetype: 'stadium', includedTypes: ['stadium'], maxResults: 1, radiusM: 15000 },
  { archetype: 'arena', includedTypes: ['arena'], maxResults: 1, radiusM: 15000 },
  { archetype: 'zoo', includedTypes: ['zoo', 'wildlife_park'], maxResults: 1, radiusM: 25000 },
  { archetype: 'aquarium', includedTypes: ['aquarium'], maxResults: 1, radiusM: 25000 },
  { archetype: 'amusement_park', includedTypes: ['amusement_park', 'water_park'], maxResults: 1, radiusM: 30000 },
  { archetype: 'bowling', includedTypes: ['bowling_alley'], maxResults: 1, radiusM: 12000 },
  { archetype: 'arcade', includedTypes: ['video_arcade', 'amusement_center'], maxResults: 1, radiusM: 12000 },
  { archetype: 'casino', includedTypes: ['casino'], maxResults: 1, radiusM: 40000 },

  // ---- personal care ----
  { archetype: 'salon', includedTypes: ['hair_salon', 'beauty_salon', 'nail_salon'], maxResults: 1, radiusM: 6000, essential: true },
  { archetype: 'barber', includedTypes: ['barber_shop'], maxResults: 1, radiusM: 6000 },
  { archetype: 'tattoo', includedTypes: ['body_art_service'], maxResults: 1, radiusM: 10000 },
  { archetype: 'laundromat', includedTypes: ['laundry'], maxResults: 1, radiusM: 6000, essential: true },

  // ---- automotive & transport ----
  { archetype: 'car_dealer', includedTypes: ['car_dealer'], maxResults: 1, radiusM: 12000, essential: true },
  { archetype: 'car_rental', includedTypes: ['car_rental'], maxResults: 1, radiusM: 12000 },
  { archetype: 'gas_station', includedTypes: ['gas_station'], maxResults: 3, radiusM: 5000, essential: true },
  { archetype: 'ev_charger', includedTypes: ['electric_vehicle_charging_station'], maxResults: 1, radiusM: 6000 },
  { archetype: 'mechanic', includedTypes: ['car_repair'], maxResults: 1, radiusM: 8000, essential: true },
  { archetype: 'car_wash', includedTypes: ['car_wash'], maxResults: 1, radiusM: 8000 },
  { archetype: 'parking', includedTypes: ['parking'], maxResults: 1, radiusM: 3000 },
  { archetype: 'transit_stop', includedTypes: ['bus_stop', 'transit_station', 'light_rail_station', 'subway_station'], maxResults: 2, radiusM: 3000, essential: true },
  { archetype: 'train_station', includedTypes: ['train_station'], maxResults: 1, radiusM: 15000 },
  { archetype: 'bus_station', includedTypes: ['bus_station'], maxResults: 1, radiusM: 15000 },
  { archetype: 'airport', includedTypes: ['airport', 'international_airport'], maxResults: 1, radiusM: 40000, essential: true },
  { archetype: 'hotel', includedTypes: ['hotel', 'motel'], maxResults: 2, radiusM: 8000, essential: true },
];

/** Archetypes a playable world must contain. */
export const ESSENTIAL_ARCHETYPES: readonly VenueArchetype[] = SEARCH_PLAN.filter((e) => e.essential).map((e) => e.archetype);

/** Sum of maxResults across the plan (upper bound on seeded venues). */
export const SEARCH_PLAN_TOTAL = SEARCH_PLAN.reduce((s, e) => s + e.maxResults, 0);
