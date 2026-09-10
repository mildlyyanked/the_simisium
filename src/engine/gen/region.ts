/**
 * Region presets and derivation (owned by the worldgen builder).
 *
 * `REGION_PRESETS` holds ~60 US metros and small towns keyed by lowercase "city, st".
 * `buildRegion` returns a full `Region`: the preset when matched, otherwise values derived from
 * state tables (income tax, sales tax, minimum wage, timezone — all 50 states + DC) and a
 * climate heuristic on lat/lng. Numbers are early-2026 approximations at national scale.
 */
import { defaultRegion } from '../core/factories';
import type { ClimateProfile, LatLng, Region } from '../core/types';

// ---------------------------------------------------------------------------
// State tables
// ---------------------------------------------------------------------------
export interface StateInfo {
  name: string;
  /** representative marginal rate for a median earner (0 = no wage income tax) */
  incomeTax: number;
  /** average combined state + local sales tax */
  salesTax: number;
  /** state minimum wage effective Jan 2026 (federal $7.25 where the state has none/lower) */
  minimumWage: number;
  timezone: string;
}

export const STATES: Record<string, StateInfo> = {
  AL: { name: 'Alabama', incomeTax: 0.05, salesTax: 0.0929, minimumWage: 7.25, timezone: 'America/Chicago' },
  AK: { name: 'Alaska', incomeTax: 0, salesTax: 0.0182, minimumWage: 14.0, timezone: 'America/Anchorage' },
  AZ: { name: 'Arizona', incomeTax: 0.025, salesTax: 0.0838, minimumWage: 15.15, timezone: 'America/Phoenix' },
  AR: { name: 'Arkansas', incomeTax: 0.039, salesTax: 0.0945, minimumWage: 11.0, timezone: 'America/Chicago' },
  CA: { name: 'California', incomeTax: 0.06, salesTax: 0.0885, minimumWage: 16.9, timezone: 'America/Los_Angeles' },
  CO: { name: 'Colorado', incomeTax: 0.044, salesTax: 0.0781, minimumWage: 15.16, timezone: 'America/Denver' },
  CT: { name: 'Connecticut', incomeTax: 0.05, salesTax: 0.0635, minimumWage: 16.94, timezone: 'America/New_York' },
  DE: { name: 'Delaware', incomeTax: 0.055, salesTax: 0, minimumWage: 15.0, timezone: 'America/New_York' },
  DC: { name: 'District of Columbia', incomeTax: 0.065, salesTax: 0.06, minimumWage: 17.95, timezone: 'America/New_York' },
  FL: { name: 'Florida', incomeTax: 0, salesTax: 0.07, minimumWage: 14.0, timezone: 'America/New_York' },
  GA: { name: 'Georgia', incomeTax: 0.0519, salesTax: 0.074, minimumWage: 7.25, timezone: 'America/New_York' },
  HI: { name: 'Hawaii', incomeTax: 0.0725, salesTax: 0.045, minimumWage: 16.0, timezone: 'Pacific/Honolulu' },
  ID: { name: 'Idaho', incomeTax: 0.053, salesTax: 0.0603, minimumWage: 7.25, timezone: 'America/Boise' },
  IL: { name: 'Illinois', incomeTax: 0.0495, salesTax: 0.0886, minimumWage: 15.0, timezone: 'America/Chicago' },
  IN: { name: 'Indiana', incomeTax: 0.03, salesTax: 0.07, minimumWage: 7.25, timezone: 'America/Indiana/Indianapolis' },
  IA: { name: 'Iowa', incomeTax: 0.038, salesTax: 0.0694, minimumWage: 7.25, timezone: 'America/Chicago' },
  KS: { name: 'Kansas', incomeTax: 0.052, salesTax: 0.0865, minimumWage: 7.25, timezone: 'America/Chicago' },
  KY: { name: 'Kentucky', incomeTax: 0.04, salesTax: 0.06, minimumWage: 7.25, timezone: 'America/New_York' },
  LA: { name: 'Louisiana', incomeTax: 0.03, salesTax: 0.0956, minimumWage: 7.25, timezone: 'America/Chicago' },
  ME: { name: 'Maine', incomeTax: 0.0675, salesTax: 0.055, minimumWage: 15.1, timezone: 'America/New_York' },
  MD: { name: 'Maryland', incomeTax: 0.0475, salesTax: 0.06, minimumWage: 15.0, timezone: 'America/New_York' },
  MA: { name: 'Massachusetts', incomeTax: 0.05, salesTax: 0.0625, minimumWage: 15.0, timezone: 'America/New_York' },
  MI: { name: 'Michigan', incomeTax: 0.0425, salesTax: 0.06, minimumWage: 13.73, timezone: 'America/Detroit' },
  MN: { name: 'Minnesota', incomeTax: 0.068, salesTax: 0.0804, minimumWage: 11.41, timezone: 'America/Chicago' },
  MS: { name: 'Mississippi', incomeTax: 0.044, salesTax: 0.0706, minimumWage: 7.25, timezone: 'America/Chicago' },
  MO: { name: 'Missouri', incomeTax: 0.047, salesTax: 0.0839, minimumWage: 15.0, timezone: 'America/Chicago' },
  MT: { name: 'Montana', incomeTax: 0.059, salesTax: 0, minimumWage: 10.85, timezone: 'America/Denver' },
  NE: { name: 'Nebraska', incomeTax: 0.052, salesTax: 0.0697, minimumWage: 15.0, timezone: 'America/Chicago' },
  NV: { name: 'Nevada', incomeTax: 0, salesTax: 0.0824, minimumWage: 12.0, timezone: 'America/Los_Angeles' },
  NH: { name: 'New Hampshire', incomeTax: 0, salesTax: 0, minimumWage: 7.25, timezone: 'America/New_York' },
  NJ: { name: 'New Jersey', incomeTax: 0.0557, salesTax: 0.066, minimumWage: 15.92, timezone: 'America/New_York' },
  NM: { name: 'New Mexico', incomeTax: 0.049, salesTax: 0.0762, minimumWage: 12.0, timezone: 'America/Denver' },
  NY: { name: 'New York', incomeTax: 0.06, salesTax: 0.0853, minimumWage: 16.0, timezone: 'America/New_York' },
  NC: { name: 'North Carolina', incomeTax: 0.0399, salesTax: 0.07, minimumWage: 7.25, timezone: 'America/New_York' },
  ND: { name: 'North Dakota', incomeTax: 0.0195, salesTax: 0.0704, minimumWage: 7.25, timezone: 'America/Chicago' },
  OH: { name: 'Ohio', incomeTax: 0.0275, salesTax: 0.0724, minimumWage: 11.0, timezone: 'America/New_York' },
  OK: { name: 'Oklahoma', incomeTax: 0.0475, salesTax: 0.0899, minimumWage: 7.25, timezone: 'America/Chicago' },
  OR: { name: 'Oregon', incomeTax: 0.0875, salesTax: 0, minimumWage: 15.45, timezone: 'America/Los_Angeles' },
  PA: { name: 'Pennsylvania', incomeTax: 0.0307, salesTax: 0.0634, minimumWage: 7.25, timezone: 'America/New_York' },
  RI: { name: 'Rhode Island', incomeTax: 0.0475, salesTax: 0.07, minimumWage: 16.0, timezone: 'America/New_York' },
  SC: { name: 'South Carolina', incomeTax: 0.062, salesTax: 0.075, minimumWage: 7.25, timezone: 'America/New_York' },
  SD: { name: 'South Dakota', incomeTax: 0, salesTax: 0.0611, minimumWage: 11.7, timezone: 'America/Chicago' },
  TN: { name: 'Tennessee', incomeTax: 0, salesTax: 0.0955, minimumWage: 7.25, timezone: 'America/Chicago' },
  TX: { name: 'Texas', incomeTax: 0, salesTax: 0.082, minimumWage: 7.25, timezone: 'America/Chicago' },
  UT: { name: 'Utah', incomeTax: 0.045, salesTax: 0.072, minimumWage: 7.25, timezone: 'America/Denver' },
  VT: { name: 'Vermont', incomeTax: 0.066, salesTax: 0.0636, minimumWage: 14.42, timezone: 'America/New_York' },
  VA: { name: 'Virginia', incomeTax: 0.0575, salesTax: 0.0577, minimumWage: 12.77, timezone: 'America/New_York' },
  WA: { name: 'Washington', incomeTax: 0, salesTax: 0.0938, minimumWage: 17.13, timezone: 'America/Los_Angeles' },
  WV: { name: 'West Virginia', incomeTax: 0.0482, salesTax: 0.0657, minimumWage: 8.75, timezone: 'America/New_York' },
  WI: { name: 'Wisconsin', incomeTax: 0.053, salesTax: 0.057, minimumWage: 7.25, timezone: 'America/Chicago' },
  WY: { name: 'Wyoming', incomeTax: 0, salesTax: 0.0544, minimumWage: 7.25, timezone: 'America/Denver' },
};

export function stateCodeForName(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (STATES[n.toUpperCase()]) return n.toUpperCase();
  return Object.keys(STATES).find((k) => STATES[k].name.toLowerCase() === n);
}

// ---------------------------------------------------------------------------
// Climate heuristic
// ---------------------------------------------------------------------------
export function climateFor(center: LatLng): ClimateProfile {
  const { lat, lng } = center;
  if (lat > 56) return 'subarctic';
  if (lat < 26 || (lng < -150 && lat < 25)) return 'tropical';
  if (lng < -121 && lat >= 42) return 'marine_west_coast';
  if (lng < -116.5 && lat < 42 && lat >= 32) return 'mediterranean';
  if (lng >= -116.5 && lng < -104 && lat < 37) return 'hot_desert';
  if (lng < -97 && lat >= 37 && lng >= -121) return 'semi_arid';
  if (lng < -100 && lat < 37 && lng >= -104) return 'semi_arid';
  if (lat >= 39.5) return 'humid_continental';
  return 'humid_subtropical';
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
type Density = Region['density'];

function P(
  name: string,
  stateCode: string,
  lat: number,
  lng: number,
  costOfLiving: number,
  climate: ClimateProfile,
  salesTax: number,
  population: number,
  density: Density,
  transitQuality: number,
  walkability: number,
  crimeIndex: number,
  medianRent1br: number,
  medianHomePrice: number,
  minimumWage: number,
  culture: string,
  extra: Partial<Region> = {},
): Partial<Region> {
  const st = STATES[stateCode];
  return {
    name,
    state: st.name,
    stateCode,
    center: { lat, lng },
    timezone: st.timezone,
    costOfLiving,
    climate,
    salesTax,
    stateIncomeTax: st.incomeTax,
    population,
    density,
    transitQuality,
    walkability,
    crimeIndex,
    medianRent1br,
    medianHomePrice,
    minimumWage,
    culture,
    ...extra,
  };
}

export const REGION_PRESETS: Record<string, Partial<Region>> = {
  'new york, ny': P('New York', 'NY', 40.7128, -74.006, 1.85, 'humid_subtropical', 0.08875, 8300000, 'urban', 0.95, 0.95, 0.45, 3900, 780000, 17.0, 'Subway rush, bodegas on every corner, dollar slices, Broadway, rent that eats half your paycheck, and a million things happening tonight.'),
  'los angeles, ca': P('Los Angeles', 'CA', 34.0522, -118.2437, 1.6, 'mediterranean', 0.095, 3800000, 'urban', 0.5, 0.55, 0.5, 2450, 950000, 18.2, 'Freeways, taco trucks, the entertainment industry, beach mornings and canyon hikes, everyone has a side project.'),
  'chicago, il': P('Chicago', 'IL', 41.8781, -87.6298, 1.15, 'humid_continental', 0.1025, 2700000, 'urban', 0.8, 0.8, 0.6, 1900, 360000, 17.0, 'The L, deep dish vs. tavern-style, brutal winters, lakefront summers, neighborhood loyalty, Cubs or Sox.'),
  'houston, tx': P('Houston', 'TX', 29.7604, -95.3698, 0.97, 'humid_subtropical', 0.0825, 2300000, 'urban', 0.3, 0.35, 0.6, 1350, 335000, 7.25, 'Sprawl, humidity, the most diverse food scene in America, oil and medical center jobs, no zoning, hurricane season.'),
  'phoenix, az': P('Phoenix', 'AZ', 33.4484, -112.074, 1.05, 'hot_desert', 0.086, 1650000, 'urban', 0.3, 0.35, 0.5, 1450, 440000, 15.15, '115°F summers, pool culture, retirees and tech transplants, spring training baseball, everyone drives.'),
  'philadelphia, pa': P('Philadelphia', 'PA', 39.9526, -75.1652, 1.05, 'humid_subtropical', 0.08, 1550000, 'urban', 0.75, 0.8, 0.62, 1700, 270000, 7.25, 'Rowhouses, cheesesteak allegiances, Eagles fans, history on every block, blunt and proud of it.'),
  'san antonio, tx': P('San Antonio', 'TX', 29.4241, -98.4936, 0.92, 'humid_subtropical', 0.0825, 1500000, 'urban', 0.3, 0.3, 0.55, 1200, 300000, 7.25, 'Military city, the River Walk, Fiesta in April, puffy tacos, Spurs devotion, big Mexican-American heritage.'),
  'san diego, ca': P('San Diego', 'CA', 32.7157, -117.1611, 1.55, 'mediterranean', 0.0775, 1400000, 'urban', 0.45, 0.5, 0.35, 2500, 980000, 17.25, 'Perfect weather, Navy and biotech, fish tacos, craft beer, a laid-back beach pace and a border 20 minutes south.'),
  'dallas, tx': P('Dallas', 'TX', 32.7767, -96.797, 1.0, 'humid_subtropical', 0.0825, 1300000, 'urban', 0.35, 0.4, 0.55, 1450, 400000, 7.25, 'Big hair, big trucks, corporate HQs, Cowboys Sundays, Tex-Mex and barbecue, highways stacked five high.'),
  'austin, tx': P('Austin', 'TX', 30.2672, -97.7431, 1.03, 'humid_subtropical', 0.0825, 980000, 'urban', 0.35, 0.45, 0.4, 1450, 480000, 7.25, 'Live music, breakfast tacos, tech workers, college town energy, Barton Springs, "Keep Austin Weird".'),
  'san jose, ca': P('San Jose', 'CA', 37.3382, -121.8863, 1.8, 'mediterranean', 0.09375, 970000, 'suburban', 0.45, 0.45, 0.35, 2700, 1450000, 18.15, 'Silicon Valley suburbs, engineers everywhere, pho and banh mi, million-dollar ranch houses, tech shuttles.'),
  'jacksonville, fl': P('Jacksonville', 'FL', 30.3322, -81.6557, 0.95, 'humid_subtropical', 0.075, 985000, 'suburban', 0.25, 0.3, 0.5, 1350, 310000, 14.0, 'The biggest city by land area, Navy bases, beaches 20 minutes out, Jaguars football, Southern with a Florida twist.'),
  'fort worth, tx': P('Fort Worth', 'TX', 32.7555, -97.3308, 0.95, 'humid_subtropical', 0.0825, 980000, 'suburban', 0.25, 0.3, 0.5, 1350, 340000, 7.25, 'Where the West begins: the Stockyards, cattle drives for tourists, honky-tonks, museums, and Dallas envy.'),
  'columbus, oh': P('Columbus', 'OH', 39.9612, -82.9988, 0.92, 'humid_continental', 0.075, 915000, 'urban', 0.35, 0.4, 0.5, 1250, 300000, 11.0, 'Ohio State football religion, test-market city for every chain, growing fast, friendly, flat.'),
  'charlotte, nc': P('Charlotte', 'NC', 35.2271, -80.8431, 0.98, 'humid_subtropical', 0.0725, 900000, 'urban', 0.35, 0.35, 0.5, 1550, 410000, 7.25, 'Banking towers, NASCAR, new subdivisions everywhere, transplants from everywhere, Carolina barbecue.'),
  'indianapolis, in': P('Indianapolis', 'IN', 39.7684, -86.1581, 0.9, 'humid_continental', 0.07, 880000, 'urban', 0.25, 0.3, 0.6, 1150, 260000, 7.25, 'The 500, Colts, pork tenderloins bigger than the bun, affordable, midwestern polite, a lot of parking.'),
  'san francisco, ca': P('San Francisco', 'CA', 37.7749, -122.4194, 1.95, 'mediterranean', 0.08625, 810000, 'urban', 0.9, 0.95, 0.5, 3300, 1350000, 19.6, 'Fog, hills, tech money and homelessness side by side, burritos, cable cars, extremely walkable, extremely expensive.'),
  'seattle, wa': P('Seattle', 'WA', 47.6062, -122.3321, 1.55, 'marine_west_coast', 0.1035, 750000, 'urban', 0.7, 0.75, 0.5, 2100, 880000, 21.3, 'Rain nine months a year, coffee, Amazon and Boeing, the Seattle Freeze, mountains and water everywhere you look.'),
  'denver, co': P('Denver', 'CO', 39.7392, -104.9903, 1.2, 'semi_arid', 0.0881, 715000, 'urban', 0.5, 0.55, 0.5, 1750, 590000, 19.29, 'Mile high, 300 days of sun, everyone skis or hikes, craft breweries, dispensaries, Broncos, transplants from Texas and California.'),
  'nashville, tn': P('Nashville', 'TN', 36.1627, -86.7816, 1.02, 'humid_subtropical', 0.0925, 690000, 'urban', 0.3, 0.35, 0.5, 1600, 460000, 7.25, 'Music City: honky-tonks on Broadway, bachelorette parties, hot chicken, healthcare HQs, growing too fast for its roads.'),
  'oklahoma city, ok': P('Oklahoma City', 'OK', 35.4676, -97.5164, 0.85, 'humid_subtropical', 0.08625, 700000, 'suburban', 0.2, 0.25, 0.5, 1000, 245000, 7.25, 'Thunder basketball, oil and gas, tornado sirens in spring, cheap living, church on Sunday, wide open.'),
  'el paso, tx': P('El Paso', 'TX', 31.7619, -106.485, 0.82, 'hot_desert', 0.0825, 680000, 'suburban', 0.3, 0.3, 0.3, 950, 230000, 7.25, 'Border city with Juárez across the river, Fort Bliss, Franklin Mountains, bilingual everything, very safe, very affordable.'),
  'boston, ma': P('Boston', 'MA', 42.3601, -71.0589, 1.6, 'humid_continental', 0.0625, 650000, 'urban', 0.85, 0.9, 0.35, 3100, 800000, 15.0, 'Colleges everywhere, the T, Red Sox, Dunkin, brick and history, sports-mad, winters that test you, very high rent.'),
  'portland, or': P('Portland', 'OR', 45.5152, -122.6784, 1.25, 'marine_west_coast', 0, 640000, 'urban', 0.65, 0.7, 0.5, 1550, 540000, 16.7, 'Bikes, food carts, no sales tax, breweries, roses, rain, weirdness by design, Timbers Army.'),
  'las vegas, nv': P('Las Vegas', 'NV', 36.1699, -115.1398, 1.0, 'hot_desert', 0.08375, 660000, 'suburban', 0.3, 0.35, 0.5, 1350, 440000, 12.0, 'The Strip for tourists, sprawling suburbs for locals, 24-hour everything, hospitality jobs, Golden Knights, desert heat.'),
  'detroit, mi': P('Detroit', 'MI', 42.3314, -83.0458, 0.85, 'humid_continental', 0.06, 630000, 'urban', 0.3, 0.4, 0.7, 1050, 95000, 13.73, 'Motor City comeback, Coney dogs, techno, Lions and Tigers, block-by-block contrasts, cheap houses, tough winters.'),
  'memphis, tn': P('Memphis', 'TN', 35.1495, -90.049, 0.82, 'humid_subtropical', 0.0975, 620000, 'urban', 0.25, 0.3, 0.8, 1050, 200000, 7.25, 'Blues on Beale Street, dry-rub ribs, Graceland, FedEx hub, Grizzlies, deep history and deep struggles.'),
  'louisville, ky': P('Louisville', 'KY', 38.2527, -85.7585, 0.88, 'humid_subtropical', 0.06, 620000, 'urban', 0.3, 0.35, 0.55, 1100, 260000, 7.25, 'Derby, bourbon, Muhammad Ali, Southern hospitality with a Midwestern accent, affordable old neighborhoods.'),
  'baltimore, md': P('Baltimore', 'MD', 39.2904, -76.6122, 1.05, 'humid_subtropical', 0.06, 565000, 'urban', 0.55, 0.65, 0.75, 1500, 220000, 15.0, 'Crab cakes and Old Bay, rowhouses with marble steps, Orioles and Ravens, gritty and charming, DC commuters.'),
  'milwaukee, wi': P('Milwaukee', 'WI', 43.0389, -87.9065, 0.9, 'humid_continental', 0.059, 560000, 'urban', 0.4, 0.55, 0.6, 1150, 230000, 7.25, 'Beer, brats, Bucks, Friday fish fry, Summerfest on the lake, long winters, friendly and unpretentious.'),
  'albuquerque, nm': P('Albuquerque', 'NM', 35.0844, -106.6504, 0.9, 'semi_arid', 0.0775, 560000, 'suburban', 0.3, 0.35, 0.65, 1150, 340000, 12.0, 'Red or green chile, the Balloon Fiesta, Sandia Mountains, Breaking Bad tours, adobe and sun.'),
  'tucson, az': P('Tucson', 'AZ', 32.2226, -110.9747, 0.9, 'hot_desert', 0.087, 545000, 'suburban', 0.3, 0.35, 0.55, 1100, 340000, 15.5, 'Sonoran desert, saguaros, UNESCO city of gastronomy, University of Arizona, monsoon storms, a slower Arizona.'),
  'fresno, ca': P('Fresno', 'CA', 36.7378, -119.7871, 1.0, 'mediterranean', 0.0835, 545000, 'suburban', 0.25, 0.3, 0.55, 1300, 400000, 16.9, 'Central Valley ag capital, hot summers, gateway to Yosemite, affordable California, big Hmong and Mexican communities.'),
  'sacramento, ca': P('Sacramento', 'CA', 38.5816, -121.4944, 1.2, 'mediterranean', 0.0875, 525000, 'urban', 0.4, 0.45, 0.5, 1700, 500000, 16.9, 'State capital, government jobs, farm-to-fork dining, tree-lined streets, Bay Area refugees, Kings basketball.'),
  'kansas city, mo': P('Kansas City', 'MO', 39.0997, -94.5786, 0.88, 'humid_continental', 0.0885, 510000, 'urban', 0.3, 0.35, 0.65, 1150, 270000, 15.0, 'Barbecue capital, Chiefs mania, jazz history, fountains, affordable and friendly, two states in one metro.'),
  'mesa, az': P('Mesa', 'AZ', 33.4152, -111.8315, 1.0, 'hot_desert', 0.083, 510000, 'suburban', 0.25, 0.3, 0.4, 1400, 430000, 15.15, 'Phoenix suburb, LDS temple, Cubs spring training, retirees and young families, strip malls and mountains.'),
  'atlanta, ga': P('Atlanta', 'GA', 33.749, -84.388, 1.05, 'humid_subtropical', 0.089, 510000, 'urban', 0.5, 0.5, 0.6, 1650, 410000, 7.25, 'Hip-hop capital, the busiest airport, Black excellence, traffic legends, the Beltline, Waffle House at 3am.'),
  'omaha, ne': P('Omaha', 'NE', 41.2565, -95.9345, 0.88, 'humid_continental', 0.07, 490000, 'suburban', 0.25, 0.35, 0.45, 1100, 280000, 15.0, 'Warren Buffett, the College World Series, steakhouses, insurance and rail jobs, midwestern nice.'),
  'colorado springs, co': P('Colorado Springs', 'CO', 38.8339, -104.8214, 1.02, 'semi_arid', 0.082, 490000, 'suburban', 0.25, 0.3, 0.45, 1350, 460000, 15.16, "Pikes Peak, Air Force Academy, military families, megachurches, Garden of the Gods, conservative and outdoorsy."),
  'raleigh, nc': P('Raleigh', 'NC', 35.7796, -78.6382, 1.0, 'humid_subtropical', 0.0725, 480000, 'suburban', 0.3, 0.35, 0.4, 1450, 440000, 7.25, 'Research Triangle, universities, tech and biotech, oak trees, mild winters, college basketball rivalries.'),
  'miami, fl': P('Miami', 'FL', 25.7617, -80.1918, 1.35, 'tropical', 0.07, 450000, 'urban', 0.5, 0.7, 0.55, 2400, 600000, 14.0, 'Cuban coffee, Spanish first, South Beach, hurricanes, crypto bros and abuelas, no winter, flooding at high tide.'),
  'minneapolis, mn': P('Minneapolis', 'MN', 44.9778, -93.265, 1.05, 'humid_continental', 0.0903, 430000, 'urban', 0.55, 0.65, 0.55, 1400, 340000, 15.97, 'Lakes, bikes, skyways for the −20°F days, Prince, hotdish, Fortune 500s, Somali and Hmong communities, nice.'),
  'tampa, fl': P('Tampa', 'FL', 27.9506, -82.4572, 1.05, 'humid_subtropical', 0.075, 400000, 'urban', 0.3, 0.45, 0.45, 1650, 400000, 14.0, 'Cuban sandwiches, Gasparilla pirate fest, Bucs and Lightning, Gulf beaches, retirees and remote workers, storms.'),
  'new orleans, la': P('New Orleans', 'LA', 29.9511, -90.0715, 0.95, 'humid_subtropical', 0.0945, 365000, 'urban', 0.4, 0.55, 0.75, 1350, 280000, 7.25, 'Mardi Gras, second lines, gumbo and po-boys, below sea level, Saints, drinking on the street, hurricanes, joy anyway.'),
  'cleveland, oh': P('Cleveland', 'OH', 41.4993, -81.6944, 0.85, 'humid_continental', 0.08, 360000, 'urban', 0.4, 0.5, 0.7, 1050, 125000, 11.0, 'Rock Hall, the Cleveland Clinic, Browns loyalty against all evidence, pierogi, lake-effect snow, cheap houses.'),
  'honolulu, hi': P('Honolulu', 'HI', 21.3069, -157.8583, 1.75, 'tropical', 0.04712, 345000, 'urban', 0.6, 0.6, 0.35, 2100, 850000, 16.0, 'Aloha, plate lunch, surf before work, tourism and military, island time, everything shipped in and priced accordingly.'),
  'pittsburgh, pa': P('Pittsburgh', 'PA', 40.4406, -79.9959, 0.92, 'humid_continental', 0.07, 300000, 'urban', 0.5, 0.6, 0.45, 1300, 240000, 7.25, 'Steel City turned eds-and-meds and robotics, 446 bridges, pierogi, Steelers everywhere, hills, affordable.'),
  'salt lake city, ut': P('Salt Lake City', 'UT', 40.7608, -111.891, 1.05, 'semi_arid', 0.0775, 210000, 'urban', 0.5, 0.55, 0.5, 1400, 560000, 7.25, 'Wasatch skiing 30 minutes away, LDS culture and a growing counterculture, tech "Silicon Slopes", wide streets, inversions in winter.'),
  'boise, id': P('Boise', 'ID', 43.615, -116.2023, 1.0, 'semi_arid', 0.06, 240000, 'suburban', 0.2, 0.4, 0.3, 1350, 490000, 7.25, 'Foothills trails, the Greenbelt, fast growth from California transplants, Boise State blue turf, potatoes are real.'),
  'anchorage, ak': P('Anchorage', 'AK', 61.2181, -149.9003, 1.25, 'subarctic', 0, 290000, 'suburban', 0.3, 0.3, 0.6, 1300, 400000, 14.0, 'Moose in the yard, 19-hour summer days, 5-hour winter days, oil money, the PFD check, Costco runs, real wilderness ten minutes out.'),
  'washington, dc': P('Washington', 'DC', 38.9072, -77.0369, 1.55, 'humid_subtropical', 0.06, 680000, 'urban', 0.85, 0.85, 0.6, 2400, 650000, 17.95, 'Politics as industry, the Metro, free museums, go-go and mumbo sauce, brunch culture, badge-wearing at happy hour.'),
  'st. louis, mo': P('St. Louis', 'MO', 38.627, -90.1994, 0.85, 'humid_continental', 0.0968, 280000, 'urban', 0.4, 0.5, 0.8, 1050, 200000, 15.0, 'The Arch, Cardinals baseball, toasted ravioli, brick everything, Forest Park, "where did you go to high school?"'),
  'cincinnati, oh': P('Cincinnati', 'OH', 39.1031, -84.512, 0.88, 'humid_continental', 0.078, 310000, 'urban', 0.35, 0.5, 0.6, 1150, 250000, 11.0, 'Skyline chili, Reds and Bengals, Over-the-Rhine revival, German heritage, hills over the Ohio River.'),
  'orlando, fl': P('Orlando', 'FL', 28.5383, -81.3792, 1.02, 'humid_subtropical', 0.065, 320000, 'suburban', 0.3, 0.4, 0.5, 1650, 390000, 14.0, 'Theme parks, hospitality jobs, Puerto Rican community, afternoon thunderstorms, lakes and gators, tourists everywhere.'),
  'richmond, va': P('Richmond', 'VA', 37.5407, -77.436, 0.97, 'humid_subtropical', 0.06, 230000, 'urban', 0.35, 0.5, 0.55, 1350, 370000, 12.77, 'Historic capital, the James River rapids downtown, murals, VCU, craft beer, a food scene punching above its weight.'),
  'buffalo, ny': P('Buffalo', 'NY', 42.8864, -78.8784, 0.88, 'humid_continental', 0.0875, 275000, 'urban', 0.4, 0.55, 0.6, 1150, 230000, 16.0, 'Wings, Bills Mafia, lake-effect snow measured in feet, Niagara Falls next door, cheap and loyal.'),
  'marfa, tx': P('Marfa', 'TX', 30.3085, -104.0207, 0.9, 'semi_arid', 0.0825, 1800, 'rural', 0, 0.5, 0.15, 1100, 350000, 7.25, 'A tiny high-desert art town: minimalist galleries, the Marfa lights, ranchers and New York transplants, one grocery store, big sky.'),
  'bozeman, mt': P('Bozeman', 'MT', 45.677, -111.0429, 1.15, 'humid_continental', 0, 56000, 'suburban', 0.2, 0.45, 0.2, 1650, 720000, 10.85, 'Mountain college town near Yellowstone, fly fishing, ski bums and tech remote workers, housing priced like a coast.'),
  'burlington, vt': P('Burlington', 'VT', 44.4759, -73.2121, 1.1, 'humid_continental', 0.07, 45000, 'suburban', 0.4, 0.65, 0.3, 1700, 450000, 14.42, 'Lake Champlain, Church Street, Ben & Jerry\'s, UVM, maple everything, progressive politics, deep winter.'),
  'asheville, nc': P('Asheville', 'NC', 35.5951, -82.5515, 1.05, 'humid_subtropical', 0.07, 95000, 'suburban', 0.3, 0.5, 0.4, 1500, 470000, 7.25, 'Blue Ridge Mountains, breweries per capita, the Biltmore, buskers, hippies and retirees, a hurricane that rewrote the river.'),
  'ann arbor, mi': P('Ann Arbor', 'MI', 42.2808, -83.743, 1.1, 'humid_continental', 0.06, 125000, 'suburban', 0.5, 0.65, 0.25, 1650, 500000, 13.73, 'University of Michigan town: football Saturdays, Zingerman\'s, bookstores, bike lanes, and a hospital system employing half the county.'),
  'galveston, tx': P('Galveston', 'TX', 29.3013, -94.7977, 0.92, 'humid_subtropical', 0.0825, 53000, 'suburban', 0.2, 0.5, 0.5, 1250, 320000, 7.25, 'Island beach town on the Gulf: seawall, cruise ships, Victorian houses, hurricane memory, shrimp boats, humidity.'),
};

export const REGION_PRESET_KEYS = Object.keys(REGION_PRESETS);

// ---------------------------------------------------------------------------
// buildRegion
// ---------------------------------------------------------------------------
export interface BuildRegionInput {
  name: string;
  state?: string;
  stateCode?: string;
  center: LatLng;
}

export function presetKey(name: string, stateCode?: string): string {
  return `${name.trim().toLowerCase()}, ${(stateCode ?? '').trim().toLowerCase()}`;
}

/** Find a preset by "city, st" (or by city name alone when unambiguous). */
export function findPreset(name: string, stateCode?: string): Partial<Region> | undefined {
  const exact = REGION_PRESETS[presetKey(name, stateCode)];
  if (exact) return exact;
  const n = name.trim().toLowerCase();
  const matches = REGION_PRESET_KEYS.filter((k) => k.split(',')[0] === n);
  if (matches.length === 1) return REGION_PRESETS[matches[0]];
  return undefined;
}

function densityForPopulation(pop: number): Region['density'] {
  if (pop >= 300_000) return 'urban';
  if (pop >= 40_000) return 'suburban';
  return 'rural';
}

export function buildRegion(input: BuildRegionInput): Region {
  const code = (input.stateCode ?? (input.state ? stateCodeForName(input.state) : undefined) ?? '').toUpperCase();
  const preset = findPreset(input.name, code || undefined);
  if (preset) {
    return defaultRegion({ ...preset, center: input.center ?? preset.center });
  }
  const st = STATES[code] ?? STATES.TX;
  const stateCode = STATES[code] ? code : 'TX';
  const climate = climateFor(input.center);
  // cost-of-living proxy from state + climate (coastal/west more expensive)
  const colByState: Record<string, number> = { CA: 1.35, NY: 1.25, HI: 1.6, MA: 1.3, WA: 1.2, DC: 1.5, NJ: 1.2, CT: 1.15, CO: 1.1, OR: 1.1, MD: 1.1, AK: 1.2, VA: 1.05, NH: 1.05, VT: 1.05, FL: 1.0, AZ: 0.98, NV: 0.98, UT: 0.98, MN: 0.97, IL: 0.95, TX: 0.93, GA: 0.92, NC: 0.92, PA: 0.93, MI: 0.88, OH: 0.87, WI: 0.9, MO: 0.86, IN: 0.86, TN: 0.9, KY: 0.86, SC: 0.9, AL: 0.85, MS: 0.82, AR: 0.84, OK: 0.85, KS: 0.86, NE: 0.88, IA: 0.87, LA: 0.87, WV: 0.83, NM: 0.9, ID: 0.95, MT: 0.95, WY: 0.92, ND: 0.9, SD: 0.9, ME: 1.0, RI: 1.05, DE: 1.0 };
  const costOfLiving = colByState[stateCode] ?? 0.92;
  const population = 60_000;
  const rent = Math.round(1100 * costOfLiving);
  return defaultRegion({
    name: input.name,
    state: st.name,
    stateCode,
    center: input.center,
    timezone: st.timezone,
    costOfLiving,
    climate,
    salesTax: st.salesTax,
    stateIncomeTax: st.incomeTax,
    population,
    density: densityForPopulation(population),
    transitQuality: 0.2,
    walkability: 0.35,
    crimeIndex: 0.4,
    medianRent1br: rent,
    medianHomePrice: Math.round(280_000 * costOfLiving),
    minimumWage: st.minimumWage,
    culture: `A mid-sized ${st.name} town: chain restaurants by the highway, an old main street trying to come back, Friday night football, church on Sunday, and everyone knows a guy who can fix that.`,
  });
}
