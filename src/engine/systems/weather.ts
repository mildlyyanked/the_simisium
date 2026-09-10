/**
 * Weather system: climate-driven daily generation with day-to-day persistence, an hourly
 * temperature curve, a rolling 7-day forecast, severe events, and effects on sims.
 *
 * Events emitted:  weather:changed (condition changes), weather:alert (severe weather)
 * Events consumed: world:new_game, world:loaded
 * Action ids:      weather:shelter, weather:carry_on (interrupt options)
 *
 * World flags set (`state.flags`):
 *  - `heat`             0 | 1  — heat advisory in effect (temp ≥ 95°F or heat wave); needs/health may read it
 *  - `cold`             0 | 1  — hard freeze (temp ≤ 32°F)
 *  - `pollen`           0..1   — seasonal allergen level (health reads it for allergies)
 *  - `travelMultiplier` ≥ 1    — travel-time multiplier from weather; transport should multiply durations by it
 *  - `outdoorsBad`      0 | 1  — rain / storm / snow / hurricane / smoke right now (npcAI may prefer indoors)
 *  - `weather:day`      isoDate the current forecast[0] belongs to (internal)
 *  - `weather:anomaly`, `weather:wet`, `weather:event`, `weather:eventEnds`, `weather:rainStart`, `weather:rainEnd` (internal generator state)
 *
 * Sim flags: none. Moodlets: 'Soaked', 'Sweltering', 'Freezing', 'Beautiful day', 'Snow day', 'Stuck inside'.
 * Reads `state.flags.dstOffset` (set by calendar) for sunrise/sunset.
 */
import { daylight } from '../core/clock';
import type { System, SystemContext } from '../core/systems';
import type { ClimateProfile, Sim, VenueArchetype, WeatherCondition, WeatherState } from '../core/types';
import { clamp, DAY, HOUR } from '../core/util';
import { addDaysIso } from '../core/clock';

// ---------------------------------------------------------------------------
// Climate normals (monthly: hi/lo °F, precip days, humidity %, snow share of precip)
// ---------------------------------------------------------------------------
interface MonthNormal {
  hi: number;
  lo: number;
  precipDays: number;
  humidity: number;
  snow: number;
}

function normals(hi: number[], lo: number[], precip: number[], hum: number[], snow: number[]): MonthNormal[] {
  return hi.map((h, i) => ({ hi: h, lo: lo[i], precipDays: precip[i], humidity: hum[i], snow: snow[i] }));
}
const Z = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const CLIMATE_NORMALS: Record<ClimateProfile, MonthNormal[]> = {
  humid_subtropical: normals([62, 66, 73, 80, 87, 93, 96, 97, 90, 81, 70, 62], [42, 46, 52, 59, 67, 73, 75, 75, 69, 59, 49, 42], [7, 7, 8, 7, 9, 7, 5, 5, 7, 7, 7, 7], [65, 63, 62, 63, 68, 66, 60, 58, 64, 63, 65, 65], [0.08, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.03]),
  hot_desert: normals([67, 71, 78, 86, 95, 104, 106, 104, 100, 89, 76, 66], [46, 49, 54, 61, 70, 79, 84, 83, 77, 65, 53, 45], [3, 3, 3, 1, 1, 0, 4, 4, 2, 2, 2, 3], [40, 35, 30, 20, 15, 12, 30, 35, 30, 28, 35, 42], Z),
  mediterranean: normals([66, 67, 69, 72, 74, 78, 82, 83, 82, 78, 72, 66], [48, 49, 51, 54, 58, 61, 64, 65, 64, 59, 52, 47], [6, 6, 5, 3, 1, 0, 0, 0, 0, 2, 3, 5], [60, 62, 65, 65, 68, 70, 70, 70, 68, 65, 60, 58], Z),
  humid_continental: normals([32, 36, 47, 59, 70, 80, 84, 82, 75, 63, 48, 36], [18, 21, 31, 41, 51, 61, 67, 66, 57, 46, 34, 23], [10, 9, 11, 11, 11, 10, 9, 9, 8, 9, 10, 10], [72, 70, 66, 60, 60, 62, 64, 66, 66, 65, 70, 74], [0.85, 0.8, 0.45, 0.1, 0, 0, 0, 0, 0, 0.02, 0.3, 0.75]),
  marine_west_coast: normals([47, 50, 54, 59, 65, 70, 76, 76, 71, 60, 51, 46], [37, 38, 41, 44, 49, 53, 57, 57, 53, 46, 40, 36], [18, 15, 16, 13, 10, 8, 4, 5, 7, 13, 18, 18], [80, 76, 72, 68, 65, 63, 60, 62, 68, 76, 80, 82], [0.15, 0.1, 0.03, 0, 0, 0, 0, 0, 0, 0, 0.03, 0.12]),
  semi_arid: normals([45, 48, 55, 62, 71, 83, 90, 88, 80, 66, 53, 44], [18, 21, 27, 34, 44, 53, 59, 57, 48, 36, 25, 17], [5, 6, 7, 9, 11, 8, 8, 9, 7, 6, 5, 5], [50, 50, 48, 45, 48, 45, 42, 45, 45, 45, 52, 52], [0.85, 0.8, 0.6, 0.35, 0.05, 0, 0, 0, 0.05, 0.35, 0.7, 0.85]),
  tropical: normals([76, 78, 80, 83, 87, 89, 91, 91, 89, 86, 81, 78], [60, 62, 65, 68, 73, 76, 77, 77, 76, 72, 67, 62], [7, 6, 7, 7, 10, 15, 16, 17, 17, 12, 8, 7], [72, 70, 70, 68, 72, 76, 75, 76, 78, 75, 73, 72], Z),
  subarctic: normals([23, 27, 34, 44, 56, 63, 66, 64, 56, 41, 28, 25], [11, 14, 20, 30, 40, 48, 53, 50, 42, 29, 16, 13], [8, 7, 7, 6, 7, 9, 12, 14, 15, 12, 10, 10], [75, 72, 68, 62, 58, 62, 68, 72, 74, 75, 78, 78], [0.95, 0.95, 0.85, 0.4, 0.02, 0, 0, 0, 0.05, 0.5, 0.9, 0.95]),
};

/** Extreme envelope used by tests: generated temps stay within normals ± this. */
export const TEMP_ENVELOPE_F = 30;

const HURRICANE_STATES = new Set(['TX', 'LA', 'MS', 'AL', 'FL', 'GA', 'SC', 'NC', 'VA']);
const TORNADO_STATES = new Set(['TX', 'OK', 'KS', 'NE', 'IA', 'MO', 'AR', 'MS', 'AL', 'TN', 'IL', 'IN', 'SD']);
const WILDFIRE_STATES = new Set(['CA', 'OR', 'WA', 'ID', 'MT', 'NV', 'AZ', 'CO', 'UT', 'NM', 'WY']);

export const OUTDOOR_ARCHETYPES: Set<VenueArchetype> = new Set(['park', 'playground', 'trail', 'beach', 'sports_field', 'golf', 'farmers_market', 'cemetery', 'zoo', 'amusement_park', 'transit_stop', 'parking', 'pool', 'ev_charger']);

const RAINY: Set<WeatherCondition> = new Set(['rain', 'heavy_rain', 'thunderstorm', 'sleet', 'hurricane', 'tornado_watch']);
const BAD_OUTDOORS: Set<WeatherCondition> = new Set(['rain', 'heavy_rain', 'thunderstorm', 'sleet', 'hurricane', 'tornado_watch', 'snow', 'smoke']);

// ---------------------------------------------------------------------------
// Daily generation
// ---------------------------------------------------------------------------
interface GenState {
  anomaly: number;
  wet: boolean;
  event: '' | 'heat_wave' | 'cold_snap' | 'hurricane' | 'smoke';
  eventEnds: number; // absolute day index (from epoch) the event ends (exclusive)
}

function readGen(ctx: SystemContext): GenState {
  const f = ctx.state.flags;
  return {
    anomaly: Number(f['weather:anomaly'] ?? 0),
    wet: f['weather:wet'] === 1,
    event: (f['weather:event'] as GenState['event']) ?? '',
    eventEnds: Number(f['weather:eventEnds'] ?? 0),
  };
}

function writeGen(ctx: SystemContext, g: GenState): void {
  const f = ctx.state.flags;
  f['weather:anomaly'] = Math.round(g.anomaly * 10) / 10;
  f['weather:wet'] = g.wet ? 1 : 0;
  f['weather:event'] = g.event;
  f['weather:eventEnds'] = g.eventEnds;
}

type ForecastDay = WeatherState['forecast'][number];

/** Generate one forecast day for `isoDate` (dayIndex = days since epoch), mutating generator state. */
function generateDay(ctx: SystemContext, g: GenState, isoDate: string, dayIndex: number): ForecastDay {
  const { rng, state } = ctx;
  const month = Number(isoDate.slice(5, 7));
  const n = CLIMATE_NORMALS[state.region.climate][month - 1];
  const summer = month >= 6 && month <= 8;
  const winter = month === 12 || month <= 2;
  const spring = month >= 3 && month <= 5;
  const code = state.region.stateCode;

  // multi-day events
  if (g.event && dayIndex >= g.eventEnds) g.event = '';
  if (!g.event) {
    if (summer && n.hi >= 85 && rng.chance(0.035)) {
      g.event = 'heat_wave';
      g.eventEnds = dayIndex + rng.int(3, 6);
    } else if (winter && n.lo <= 30 && rng.chance(0.03)) {
      g.event = 'cold_snap';
      g.eventEnds = dayIndex + rng.int(2, 5);
    } else if (HURRICANE_STATES.has(code) && month >= 8 && month <= 10 && rng.chance(0.006)) {
      g.event = 'hurricane';
      g.eventEnds = dayIndex + rng.int(2, 3);
    } else if (WILDFIRE_STATES.has(code) && month >= 7 && month <= 9 && rng.chance(0.02)) {
      g.event = 'smoke';
      g.eventEnds = dayIndex + rng.int(2, 5);
    }
  }

  // temperature anomaly with persistence
  g.anomaly = clamp(0.6 * g.anomaly + rng.normal(0, 4.5), -22, 22);
  let hi = n.hi + g.anomaly;
  let lo = n.lo + g.anomaly * 0.8;
  if (g.event === 'heat_wave') {
    hi += 9;
    lo += 6;
  }
  if (g.event === 'cold_snap') {
    hi -= 14;
    lo -= 16;
  }

  // precipitation (Markov on wet/dry)
  let pWet = n.precipDays / 30;
  pWet *= g.wet ? 1.7 : 0.75;
  pWet = clamp(pWet, 0.03, 0.9);
  if (g.event === 'hurricane') pWet = 1;
  if (g.event === 'heat_wave') pWet *= 0.3;
  const wet = rng.chance(pWet);
  g.wet = wet;
  let condition: WeatherCondition;
  let precipChance = wet ? clamp(0.6 + rng.range(0, 0.35), 0, 1) : clamp(pWet * 0.5, 0.02, 0.35);
  if (g.event === 'hurricane') {
    condition = 'hurricane';
    hi -= 6;
    precipChance = 1;
  } else if (g.event === 'smoke' && !wet) {
    condition = 'smoke';
  } else if (wet) {
    hi -= rng.range(3, 7);
    const snowy = rng.chance(n.snow) && hi <= 36;
    if (snowy) condition = hi >= 33 && rng.chance(0.4) ? 'sleet' : 'snow';
    else if ((summer || spring) && n.humidity >= 55 && hi >= 70 && rng.chance(0.45)) condition = 'thunderstorm';
    else condition = rng.chance(0.22) ? 'heavy_rain' : 'rain';
    if (condition === 'thunderstorm' && spring && TORNADO_STATES.has(code) && rng.chance(0.18)) condition = 'tornado_watch';
  } else if (g.event === 'heat_wave') {
    condition = 'heat_wave';
  } else {
    const cloudBias = (n.humidity - 40) / 60; // 0..~0.7
    const marine = state.region.climate === 'marine_west_coast' || state.region.climate === 'mediterranean';
    if (marine && (winter || month >= 9) && rng.chance(0.12)) condition = 'fog';
    else if ((state.region.climate === 'semi_arid' || TORNADO_STATES.has(code)) && spring && rng.chance(0.1)) condition = 'windy';
    else {
      const r = rng.next();
      condition = r < 0.45 - cloudBias * 0.3 ? 'clear' : r < 0.8 - cloudBias * 0.1 ? 'partly_cloudy' : 'cloudy';
    }
  }
  if (condition !== 'heat_wave' && hi >= 100 && !wet && summer && rng.chance(0.5)) condition = 'heat_wave';

  hi = Math.round(clamp(hi, n.hi - TEMP_ENVELOPE_F, n.hi + TEMP_ENVELOPE_F));
  lo = Math.round(clamp(Math.min(lo, hi - 4), n.lo - TEMP_ENVELOPE_F, n.lo + TEMP_ENVELOPE_F));
  return { isoDate, hi, lo, condition, precipChance: Math.round(precipChance * 100) / 100 };
}

function epochDayIndex(ctx: SystemContext): number {
  return Math.floor(ctx.state.time.minute / DAY);
}

/** Ensure forecast[0] is today; roll the forecast forward as days pass. */
function ensureForecast(ctx: SystemContext): boolean {
  const { state, clock } = ctx;
  const today = clock.isoDate;
  if (state.flags['weather:day'] === today && state.weather.forecast.length >= 7 && state.weather.forecast[0]?.isoDate === today) return false;
  const g = readGen(ctx);
  let fc = state.weather.forecast.filter((d) => d.isoDate >= today);
  // if forecast is empty or the first day is not today, rebuild from today
  if (!fc.length || fc[0].isoDate !== today) fc = [];
  let base = fc.length ? fc[fc.length - 1].isoDate : addDaysIso(today, -1);
  let idx = epochDayIndex(ctx) + fc.length;
  while (fc.length < 7) {
    base = addDaysIso(base, 1);
    fc.push(generateDay(ctx, g, base, idx));
    idx++;
  }
  state.weather.forecast = fc;
  writeGen(ctx, g);
  state.flags['weather:day'] = today;
  // per-day rain window
  const d = fc[0];
  if (RAINY.has(d.condition) && d.condition !== 'hurricane') {
    const start = d.condition === 'thunderstorm' || d.condition === 'tornado_watch' ? ctx.rng.int(13, 17) : ctx.rng.int(5, 18);
    const len = d.condition === 'heavy_rain' ? ctx.rng.int(5, 10) : ctx.rng.int(2, 6);
    state.flags['weather:rainStart'] = start;
    state.flags['weather:rainEnd'] = Math.min(24, start + len);
  } else {
    state.flags['weather:rainStart'] = 0;
    state.flags['weather:rainEnd'] = 0;
  }
  state.flags['weather:beautiful'] = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Hourly state
// ---------------------------------------------------------------------------
function hourlyCondition(ctx: SystemContext, day: ForecastDay, hour: number): WeatherCondition {
  const c = day.condition;
  const rs = Number(ctx.state.flags['weather:rainStart'] ?? 0);
  const re = Number(ctx.state.flags['weather:rainEnd'] ?? 0);
  if (c === 'fog') return hour < 10 ? 'fog' : hour < 16 ? 'partly_cloudy' : 'cloudy';
  if (RAINY.has(c) && c !== 'hurricane') {
    if (hour >= rs && hour < re) return c;
    if (c === 'thunderstorm' || c === 'tornado_watch') return hour < rs ? 'partly_cloudy' : 'cloudy';
    return hour < rs ? 'cloudy' : 'partly_cloudy';
  }
  return c;
}

function hourlyTemp(day: ForecastDay, hour: number, minute: number): number {
  let h = hour + minute / 60;
  if (h < 5) h += 24;
  const f = h <= 15 ? 0.5 - 0.5 * Math.cos((Math.PI * (h - 5)) / 10) : 0.5 + 0.5 * Math.cos((Math.PI * (h - 15)) / 14);
  return Math.round(day.lo + (day.hi - day.lo) * f);
}

function updateCurrent(ctx: SystemContext): WeatherCondition | undefined {
  const { state, clock } = ctx;
  const day = state.weather.forecast[0];
  if (!day) return undefined;
  const prev = state.weather.current.condition;
  const condition = hourlyCondition(ctx, day, clock.hour);
  const month = Number(day.isoDate.slice(5, 7));
  const n = CLIMATE_NORMALS[state.region.climate][month - 1];
  const dst = state.flags.dstOffset === 1 ? 60 : 0;
  const dl = daylight(state.region.center.lat, clock.day.dayOfYear);
  const raining = RAINY.has(condition) || condition === 'snow';
  const windBase = condition === 'hurricane' ? 55 : condition === 'tornado_watch' ? 28 : condition === 'windy' ? 24 : condition === 'thunderstorm' ? 18 : condition === 'heavy_rain' ? 14 : 8;
  const cloud = condition === 'clear' ? 0 : condition === 'partly_cloudy' ? 0.4 : 0.85;
  const solar = clock.isDaylight ? Math.sin((Math.PI * (clock.minuteOfDay - dl.sunrise)) / Math.max(1, dl.sunset - dl.sunrise)) : 0;
  const seasonUv = 4 + 6 * Math.max(0, Math.cos(((month - 7) / 12) * 2 * Math.PI));
  state.weather.current = {
    condition,
    tempF: hourlyTemp(day, clock.hour, clock.minuteOfDay % 60) + (condition === 'heat_wave' ? 2 : 0),
    humidity: Math.round(clamp(n.humidity + (raining ? 20 : condition === 'clear' ? -8 : 0) + (clock.hour < 8 ? 8 : clock.hour > 13 && clock.hour < 18 ? -8 : 0), 10, 100)),
    windMph: Math.round(windBase + ctx.rng.range(-3, 5)),
    precipChance: day.precipChance,
    uv: Math.round(clamp(seasonUv * solar * (1 - cloud * 0.7), 0, 11)),
    sunriseMinute: dl.sunrise - 15 + dst,
    sunsetMinute: dl.sunset - 15 + dst,
    alert: state.weather.current.alert,
  };
  return condition !== prev ? condition : undefined;
}

function severeAlert(day: ForecastDay): { text: string; severity: number } | undefined {
  switch (day.condition) {
    case 'hurricane':
      return { text: `Hurricane warning: tropical-storm-force winds and flooding rain expected. Stay indoors and away from the coast.`, severity: 3 };
    case 'tornado_watch':
      return { text: `Tornado watch this afternoon and evening. Know where your shelter is and keep your phone charged.`, severity: 2 };
    case 'heat_wave':
      return { text: `Excessive heat warning: highs near ${day.hi}°F. Drink water, avoid the sun midday, and check on neighbors.`, severity: 2 };
    case 'smoke':
      return { text: `Air quality alert: wildfire smoke. Unhealthy for sensitive groups; limit time outdoors.`, severity: 2 };
    case 'snow':
      return day.hi <= 22 ? { text: `Winter storm warning: heavy snow and dangerous cold (high ${day.hi}°F). Roads will be slow.`, severity: 2 } : { text: `Snow expected through the day. Allow extra travel time.`, severity: 1 };
    case 'thunderstorm':
      return { text: `Severe thunderstorms possible this afternoon with lightning and gusty winds.`, severity: 1 };
    default:
      if (day.lo <= 5) return { text: `Extreme cold warning: lows near ${day.lo}°F. Frostbite in minutes on exposed skin.`, severity: 2 };
      return undefined;
  }
}

function describeCondition(c: WeatherCondition): string {
  switch (c) {
    case 'clear': return 'Clear';
    case 'partly_cloudy': return 'Partly cloudy';
    case 'cloudy': return 'Overcast';
    case 'rain': return 'Rain';
    case 'heavy_rain': return 'Heavy rain';
    case 'thunderstorm': return 'Thunderstorms';
    case 'snow': return 'Snow';
    case 'sleet': return 'Sleet';
    case 'fog': return 'Fog';
    case 'windy': return 'Windy';
    case 'heat_wave': return 'Blazing sun';
    case 'hurricane': return 'Hurricane conditions';
    case 'tornado_watch': return 'Tornado watch';
    case 'smoke': return 'Smoky haze';
  }
}

export function morningWeatherLine(ctx: SystemContext): string {
  const day = ctx.state.weather.forecast[0];
  const cur = ctx.state.weather.current;
  if (!day) return `${describeCondition(cur.condition)}, ${cur.tempF}°F.`;
  const rs = Number(ctx.state.flags['weather:rainStart'] ?? 0);
  const re = Number(ctx.state.flags['weather:rainEnd'] ?? 0);
  let note = `high of ${day.hi}°F`;
  if (RAINY.has(day.condition) && day.condition !== 'hurricane') {
    const what = day.condition === 'thunderstorm' || day.condition === 'tornado_watch' ? 'storms' : day.condition === 'sleet' ? 'sleet' : 'rain';
    note = rs <= 7 ? `${what} ${re > 12 ? 'most of the day' : 'this morning'}` : rs < 12 ? `${what} by late morning` : rs < 17 ? `${what} by afternoon` : `${what} this evening`;
  } else if (day.condition === 'snow') note = `snow through the day, high of ${day.hi}°F`;
  else if (day.condition === 'heat_wave') note = `highs near ${day.hi}°F, heat advisory`;
  else if (day.condition === 'hurricane') note = `hurricane conditions all day`;
  else if (day.condition === 'fog') note = `fog burning off by mid-morning, high of ${day.hi}°F`;
  else if (day.condition === 'smoke') note = `smoke from wildfires, high of ${day.hi}°F`;
  else if (day.lo <= 32 && day.hi > 32) note = `freezing this morning, high of ${day.hi}°F`;
  return `${describeCondition(hourlyCondition(ctx, day, 7))}, ${cur.tempF}°F, ${note}.`;
}

// ---------------------------------------------------------------------------
// Effects on sims
// ---------------------------------------------------------------------------
function isOutdoors(ctx: SystemContext, sim: Sim): boolean {
  if (sim.travel) return sim.travel.mode === 'walk' || sim.travel.mode === 'bike' || sim.travel.mode === 'scooter';
  const v = ctx.query.venueMaybe(sim.location.venueId);
  return !!v && OUTDOOR_ARCHETYPES.has(v.archetype);
}

function applySimEffects(ctx: SystemContext, changed: boolean): void {
  const { state, clock } = ctx;
  const cur = state.weather.current;
  const t = cur.tempF;
  const heat = t >= 95 || cur.condition === 'heat_wave';
  const cold = t <= 32;
  const nice = (cur.condition === 'clear' || cur.condition === 'partly_cloudy') && t >= 62 && t <= 82 && clock.isDaylight;
  const beautifulDone = state.flags['weather:beautiful'] === 1;
  for (const sim of ctx.query.simulatedSims()) {
    if (sim.lod !== 'full') continue;
    const out = isOutdoors(ctx, sim);
    if (out) {
      if (RAINY.has(cur.condition)) {
        const umbrella = (sim.inventory.consumables.umbrella ?? 0) > 0;
        if (!umbrella) ctx.applyEffects(sim.id, { needs: { comfort: -8, hygiene: -4 }, moodlets: [{ emotion: 'uncomfortable', label: 'Soaked', intensity: -10, durationMinutes: 120, id: 'wx_soaked' }] }, 'weather');
        else ctx.applyEffects(sim.id, { needs: { comfort: -2 } }, 'weather');
      }
      if (heat) {
        ctx.applyEffects(sim.id, { needs: { comfort: -4, thirst: -3, hygiene: -2 }, moodlets: [{ emotion: 'uncomfortable', label: 'Sweltering', intensity: -8, durationMinutes: 90, id: 'wx_heat' }] }, 'weather');
      }
      if (cold) {
        const coat = sim.inventory.wearing.some((w) => w.includes('winter') || w.includes('coat'));
        ctx.applyEffects(sim.id, { needs: { comfort: coat ? -2 : -5 }, moodlets: [{ emotion: 'uncomfortable', label: 'Freezing', intensity: coat ? -4 : -8, durationMinutes: 90, id: 'wx_cold' }] }, 'weather');
      }
      if (cur.condition === 'snow') ctx.applyEffects(sim.id, { needs: { comfort: -3, fun: 3 }, moodlets: [{ emotion: 'playful', label: 'Snow day', intensity: 4, durationMinutes: 120, id: 'wx_snow' }] }, 'weather');
      if (cur.condition === 'smoke') ctx.applyEffects(sim.id, { needs: { comfort: -3 }, health: -0.3 }, 'weather');
      if (nice) ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'happy', label: 'Beautiful day', intensity: 8, durationMinutes: 180, id: 'wx_nice' }] }, 'weather');
    } else if (nice && !beautifulDone && clock.hour >= 9 && clock.hour <= 16) {
      ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'happy', label: 'Beautiful day', intensity: 5, durationMinutes: 240, id: 'wx_nice' }] }, 'weather');
    } else if (cur.condition === 'hurricane' && changed) {
      ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'anxious', label: 'Stuck inside', intensity: -5, durationMinutes: 240, id: 'wx_stuck' }] }, 'weather');
    }
  }
  if (nice && clock.hour >= 9 && clock.hour <= 16) state.flags['weather:beautiful'] = 1;
}

function updateFlags(ctx: SystemContext): void {
  const { state } = ctx;
  const cur = state.weather.current;
  const month = Number(ctx.clock.isoDate.slice(5, 7));
  state.flags.heat = cur.tempF >= 95 || cur.condition === 'heat_wave' ? 1 : 0;
  state.flags.cold = cur.tempF <= 32 ? 1 : 0;
  state.flags.outdoorsBad = BAD_OUTDOORS.has(cur.condition) ? 1 : 0;
  const mult = cur.condition === 'hurricane' ? 2 : cur.condition === 'snow' ? 1.6 : cur.condition === 'sleet' ? 1.5 : cur.condition === 'thunderstorm' || cur.condition === 'tornado_watch' ? 1.3 : cur.condition === 'heavy_rain' ? 1.25 : cur.condition === 'fog' ? 1.15 : cur.condition === 'rain' ? 1.1 : 1;
  state.flags.travelMultiplier = mult;
  // pollen: tree pollen in spring, grass early summer, ragweed in fall; rain knocks it down
  const climate = state.region.climate;
  let pollen = 0;
  if (climate === 'humid_subtropical') pollen = month <= 2 ? 0.7 : month <= 4 ? 0.9 : month === 5 ? 0.5 : month === 9 || month === 10 ? 0.5 : 0.1;
  else if (climate === 'humid_continental' || climate === 'semi_arid' || climate === 'marine_west_coast') pollen = month === 4 || month === 5 ? 0.85 : month === 6 ? 0.5 : month === 9 ? 0.5 : month === 3 ? 0.3 : 0.05;
  else if (climate === 'mediterranean') pollen = month >= 2 && month <= 5 ? 0.8 : month === 6 ? 0.4 : 0.15;
  else if (climate === 'hot_desert') pollen = month >= 2 && month <= 4 ? 0.6 : 0.1;
  else if (climate === 'tropical') pollen = 0.3;
  else pollen = month === 5 || month === 6 ? 0.6 : 0.05;
  if (RAINY.has(cur.condition) || cur.condition === 'snow') pollen *= 0.25;
  state.flags.pollen = Math.round(pollen * 100) / 100;
}

function raiseAlerts(ctx: SystemContext): void {
  const day = ctx.state.weather.forecast[0];
  if (!day) return;
  const a = severeAlert(day);
  ctx.state.weather.current.alert = a?.text;
  if (!a) return;
  ctx.emit({ type: 'weather:alert', text: a.text, severity: a.severity });
  for (const s of ctx.query.controlledSims()) ctx.log({ text: a.text, kind: 'alert', simId: s.id, importance: a.severity >= 2 ? 2 : 1 });
  if (a.severity >= 3 || day.condition === 'tornado_watch') {
    const active = ctx.query.controlledSims()[0];
    if (active) {
      ctx.interrupt({
        kind: 'weather',
        title: day.condition === 'hurricane' ? 'Hurricane warning' : 'Tornado watch',
        body: a.text,
        simId: active.id,
        options: [
          { label: 'Shelter in place', actionId: 'weather:shelter' },
          { label: 'Carry on', actionId: 'weather:carry_on' },
        ],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const weatherSystem: System = {
  id: 'weather',
  intervalMinutes: 60,

  onInit(ctx) {
    ensureForecast(ctx);
    updateCurrent(ctx);
    updateFlags(ctx);
  },

  onTick(ctx) {
    const newDay = ensureForecast(ctx);
    if (newDay) raiseAlerts(ctx);
    const changed = updateCurrent(ctx);
    updateFlags(ctx);
    if (changed) ctx.emit({ type: 'weather:changed', weather: ctx.state.weather.current });
    if (ctx.clock.hour === 7) {
      const line = morningWeatherLine(ctx);
      for (const s of ctx.query.controlledSims()) ctx.log({ text: line, kind: 'system', simId: s.id, importance: 1, meta: { weather: true } });
    }
    applySimEffects(ctx, !!changed);
  },

  onEvent(ctx, e) {
    if (e.type === 'world:new_game' || e.type === 'world:loaded') {
      ensureForecast(ctx);
      updateCurrent(ctx);
      updateFlags(ctx);
      if (e.type === 'world:new_game') {
        const line = morningWeatherLine(ctx);
        for (const s of ctx.query.controlledSims()) ctx.log({ text: line, kind: 'system', simId: s.id, importance: 1, meta: { weather: true } });
      }
    }
  },

  actions() {
    return [];
  },

  handles(actionId) {
    return actionId.startsWith('weather:');
  },

  execute(ctx, simId, action) {
    if (action.id === 'weather:shelter') {
      ctx.applyEffects(simId, { needs: { comfort: 5, fun: -5 }, stress: -5, moodlets: [{ emotion: 'relaxed', label: 'Safe inside', intensity: 3, durationMinutes: 180, id: 'wx_shelter' }] }, 'weather');
      return { ok: true, text: 'You hunker down and wait it out.', durationMinutes: 120 };
    }
    if (action.id === 'weather:carry_on') {
      ctx.applyEffects(simId, { stress: 4 }, 'weather');
      return { ok: true, text: 'You decide to carry on and keep an eye on the sky.', durationMinutes: 0 };
    }
    return { ok: false, text: 'Unknown weather action' };
  },
};

/** ActionDefs for the interrupt options (the UI performs them with an override). */
export const WEATHER_INTERRUPT_ACTIONS: Record<string, import('../core/types').ActionDef> = {
  'weather:shelter': { id: 'weather:shelter', label: 'Shelter in place', category: 'system', durationMinutes: 120, effects: {}, interruptible: false },
  'weather:carry_on': { id: 'weather:carry_on', label: 'Carry on', category: 'system', durationMinutes: 0, effects: {} },
};
