/**
 * US holiday catalog (owned by the calendar builder). Every id in docs/IDS.md is present.
 *
 * Rules:
 *  - `fixed`       : same month/day every year.
 *  - `nth_weekday` : e.g. 3rd Monday of January (n = -1 → last).
 *  - `computed`    : function of the year (Easter computus, Election Day, lookup tables for
 *                    lunar / religious calendars 2026–2032, DST, Super Bowl, Black Friday…).
 *  - `range`       : a fixed span of days inside one month (Kwanzaa, back-to-school week).
 *
 * Multi-day holidays that start on a computed date (Hanukkah) use `HOLIDAY_SPANS` (days after the
 * start date that still count as the holiday). The calendar system's `holidayResolver` reads both.
 */
import type { Weekday } from '../core/types';
import type { HolidayDef } from './types';

// ---------------------------------------------------------------------------
// Date helpers (pure, UTC)
// ---------------------------------------------------------------------------
export function weekdayOf(year: number, month: number, day: number): Weekday {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** nth weekday of a month (n = 1..5, or -1 for last). Returns day-of-month. */
export function nthWeekday(year: number, month: number, weekday: Weekday, n: number): number {
  if (n < 0) {
    const last = daysInMonth(year, month);
    const lastWd = weekdayOf(year, month, last);
    return last - ((lastWd - weekday + 7) % 7);
  }
  const first = weekdayOf(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Add days to a (year, month, day) triple. */
export function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day) + delta * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Gregorian Easter (Anonymous / Meeus-Jones-Butcher algorithm). */
export function easterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** First Tuesday after the first Monday in November. */
export function electionDay(year: number): { month: number; day: number } {
  const firstMonday = nthWeekday(year, 11, 1, 1);
  return { month: 11, day: firstMonday + 1 };
}

/** Thanksgiving: 4th Thursday of November. */
export function thanksgivingDay(year: number): { month: number; day: number } {
  return { month: 11, day: nthWeekday(year, 11, 4, 4) };
}

type MD = { month: number; day: number };

/**
 * Lookup tables 2026–2032 for calendars the engine does not compute (lunar / lunisolar).
 * Outside the table range we fall back to the nearest table year (the game rarely runs that long).
 */
const LUNAR_NEW_YEAR: Record<number, MD> = {
  2026: { month: 2, day: 17 },
  2027: { month: 2, day: 6 },
  2028: { month: 1, day: 26 },
  2029: { month: 2, day: 13 },
  2030: { month: 2, day: 3 },
  2031: { month: 1, day: 23 },
  2032: { month: 2, day: 11 },
};
const DIWALI: Record<number, MD> = {
  2026: { month: 11, day: 8 },
  2027: { month: 10, day: 29 },
  2028: { month: 10, day: 17 },
  2029: { month: 11, day: 5 },
  2030: { month: 10, day: 26 },
  2031: { month: 11, day: 14 },
  2032: { month: 11, day: 2 },
};
const RAMADAN_START: Record<number, MD> = {
  2026: { month: 2, day: 18 },
  2027: { month: 2, day: 8 },
  2028: { month: 1, day: 28 },
  2029: { month: 1, day: 16 },
  2030: { month: 1, day: 5 },
  2031: { month: 12, day: 15 },
  2032: { month: 12, day: 4 },
};
const EID_AL_FITR: Record<number, MD> = {
  2026: { month: 3, day: 20 },
  2027: { month: 3, day: 9 },
  2028: { month: 2, day: 26 },
  2029: { month: 2, day: 14 },
  2030: { month: 2, day: 4 },
  2031: { month: 1, day: 24 },
  2032: { month: 1, day: 14 },
};
/** First full day of Hanukkah (candles are lit the evening before). */
const HANUKKAH_START: Record<number, MD> = {
  2026: { month: 12, day: 5 },
  2027: { month: 12, day: 25 },
  2028: { month: 12, day: 13 },
  2029: { month: 12, day: 2 },
  2030: { month: 12, day: 21 },
  2031: { month: 12, day: 10 },
  2032: { month: 11, day: 28 },
};

function lookup(table: Record<number, MD>): (year: number) => MD {
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  return (year: number) => {
    if (table[year]) return table[year];
    const y = year < years[0] ? years[0] : years[years.length - 1];
    return table[y];
  };
}

/** Holidays that last more than one day starting at their rule date: id → total days. */
export const HOLIDAY_SPANS: Record<string, number> = {
  hanukkah: 8,
  lunar_new_year: 2,
  eid: 2,
};

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------
const H = (def: HolidayDef): HolidayDef => def;

export const HOLIDAYS: Record<string, HolidayDef> = {
  new_years_day: H({
    id: 'new_years_day',
    name: "New Year's Day",
    rule: { kind: 'fixed', month: 1, day: 1 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'most',
    activities: [
      { label: 'Sleep in and nurse the hangover', venue: 'home', cost: 0, fun: 10, social: 0, durationMinutes: 120 },
      { label: 'Write New Year resolutions', venue: 'home', cost: 0, fun: 8, social: 0, durationMinutes: 30 },
      { label: 'Polar plunge', venue: 'beach', cost: 0, fun: 30, social: 15, durationMinutes: 60 },
      { label: 'Watch the Rose Parade & bowl games', venue: 'home', cost: 0, fun: 15, social: 10, durationMinutes: 180 },
    ],
    description: 'The first day of the year. Most offices, banks and government buildings are closed; gyms are packed by the 2nd.',
    moodlet: { emotion: 'hopeful', label: 'Fresh start', intensity: 6 },
    tags: ['federal', 'winter'],
  }),
  mlk_day: H({
    id: 'mlk_day',
    name: 'Martin Luther King Jr. Day',
    rule: { kind: 'nth_weekday', month: 1, weekday: 1, n: 3 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Volunteer for a day of service', venue: 'community_center', cost: 0, fun: 10, social: 20, durationMinutes: 180 },
      { label: 'Attend the MLK march', venue: 'park', cost: 0, fun: 12, social: 18, durationMinutes: 120 },
    ],
    description: 'Federal holiday honoring Dr. King. Schools, banks and federal offices closed; most retail open.',
    moodlet: { emotion: 'inspired', label: 'Day of service', intensity: 4 },
    tags: ['federal', 'civic'],
  }),
  groundhog_day: H({
    id: 'groundhog_day',
    name: 'Groundhog Day',
    rule: { kind: 'fixed', month: 2, day: 2 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [{ label: 'Check whether Phil saw his shadow', venue: 'home', cost: 0, fun: 5, social: 3, durationMinutes: 10 }],
    description: 'Punxsutawney Phil predicts six more weeks of winter or an early spring. Everyone quotes the movie.',
    tags: ['minor', 'winter'],
  }),
  super_bowl_sunday: H({
    id: 'super_bowl_sunday',
    name: 'Super Bowl Sunday',
    rule: { kind: 'nth_weekday', month: 2, weekday: 0, n: 2 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Host a Super Bowl party', venue: 'home', cost: 85, fun: 30, social: 30, durationMinutes: 300 },
      { label: 'Watch the game at a sports bar', venue: 'bar', cost: 45, fun: 28, social: 25, durationMinutes: 270 },
      { label: 'Watch the halftime show', venue: 'home', cost: 0, fun: 12, social: 5, durationMinutes: 30 },
    ],
    description: 'The biggest TV day of the year: wings, commercials, the halftime show. Grocery stores are slammed the day before.',
    moodlet: { emotion: 'playful', label: 'Game day', intensity: 5 },
    spendingMultiplier: 1.3,
    tags: ['sports', 'party'],
  }),
  valentines_day: H({
    id: 'valentines_day',
    name: "Valentine's Day",
    rule: { kind: 'fixed', month: 2, day: 14 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Romantic dinner out', venue: 'restaurant', cost: 120, fun: 25, social: 30, durationMinutes: 120 },
      { label: 'Buy flowers', venue: 'florist', cost: 65, fun: 5, social: 10, durationMinutes: 20 },
      { label: "Galentine's night out", venue: 'bar', cost: 50, fun: 25, social: 25, durationMinutes: 180 },
      { label: 'Cook a candlelit dinner', venue: 'home', cost: 40, fun: 18, social: 22, durationMinutes: 120 },
    ],
    description: 'Restaurants fully booked, flowers triple in price, singles either celebrate or hide.',
    moodlet: { emotion: 'flirty', label: "Valentine's mood", intensity: 5 },
    spendingMultiplier: 1.5,
    tags: ['romance'],
  }),
  presidents_day: H({
    id: 'presidents_day',
    name: "Presidents' Day",
    rule: { kind: 'nth_weekday', month: 2, weekday: 1, n: 3 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Hit the Presidents Day sales', venue: 'mall', cost: 150, fun: 15, social: 8, durationMinutes: 150 },
      { label: 'Long-weekend road trip', venue: 'park', cost: 60, fun: 25, social: 15, durationMinutes: 300 },
    ],
    description: 'Federal holiday; banks and schools closed. Mostly known for mattress and car sales.',
    spendingMultiplier: 1.1,
    tags: ['federal', 'sales'],
  }),
  mardi_gras: H({
    id: 'mardi_gras',
    name: 'Mardi Gras',
    rule: {
      kind: 'computed',
      fn: (year) => {
        const e = easterDate(year);
        const d = addDays(year, e.month, e.day, -47);
        return { month: d.month, day: d.day };
      },
    },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Catch beads at the parade', venue: 'park', cost: 0, fun: 30, social: 25, durationMinutes: 180 },
      { label: 'Eat king cake', venue: 'bakery', cost: 28, fun: 12, social: 8, durationMinutes: 30 },
      { label: 'Fat Tuesday bar crawl', venue: 'bar', cost: 70, fun: 30, social: 30, durationMinutes: 240 },
    ],
    description: 'Fat Tuesday, the day before Lent. New Orleans shuts down for parades; elsewhere it is a bar night and a king cake.',
    moodlet: { emotion: 'playful', label: 'Laissez les bons temps rouler', intensity: 8 },
    tags: ['party', 'food'],
  }),
  st_patricks_day: H({
    id: 'st_patricks_day',
    name: "St. Patrick's Day",
    rule: { kind: 'fixed', month: 3, day: 17 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Green beer at the pub', venue: 'bar', cost: 40, fun: 25, social: 25, durationMinutes: 180 },
      { label: "Watch the St. Patrick's parade", venue: 'park', cost: 0, fun: 15, social: 15, durationMinutes: 120 },
      { label: 'Cook corned beef and cabbage', venue: 'home', cost: 25, fun: 10, social: 10, durationMinutes: 150 },
    ],
    description: 'Bars open at 7am, everyone wears green, and there is a parade downtown.',
    moodlet: { emotion: 'playful', label: 'Feeling lucky', intensity: 5 },
    tags: ['party', 'drinking'],
  }),
  april_fools: H({
    id: 'april_fools',
    name: "April Fools' Day",
    rule: { kind: 'fixed', month: 4, day: 1 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [{ label: 'Pull a prank', venue: 'home', cost: 0, fun: 15, social: 8, durationMinutes: 20 }],
    description: 'Brands post fake product launches; coworkers wrap desks in foil.',
    moodlet: { emotion: 'playful', label: 'Prank season', intensity: 3 },
    tags: ['minor'],
  }),
  easter: H({
    id: 'easter',
    name: 'Easter Sunday',
    rule: { kind: 'computed', fn: easterDate },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'some',
    activities: [
      { label: 'Attend Easter service', venue: 'church', cost: 0, fun: 8, social: 20, durationMinutes: 90 },
      { label: 'Easter egg hunt', venue: 'park', cost: 15, fun: 25, social: 20, durationMinutes: 90 },
      { label: 'Easter brunch', venue: 'restaurant', cost: 55, fun: 18, social: 22, durationMinutes: 120 },
      { label: 'Dye eggs and cook a ham', venue: 'home', cost: 45, fun: 15, social: 20, durationMinutes: 180 },
    ],
    description: 'Churches overflow, brunch reservations vanish, and most big-box stores are closed for the day.',
    moodlet: { emotion: 'grateful', label: 'Easter', intensity: 5 },
    spendingMultiplier: 1.15,
    tags: ['religious', 'family', 'spring'],
  }),
  earth_day: H({
    id: 'earth_day',
    name: 'Earth Day',
    rule: { kind: 'fixed', month: 4, day: 22 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Join a park cleanup', venue: 'park', cost: 0, fun: 10, social: 15, durationMinutes: 120 },
      { label: 'Plant something', venue: 'home', cost: 12, fun: 12, social: 0, durationMinutes: 60 },
    ],
    description: 'Community cleanups and tree plantings; the farmers market gives away seedlings.',
    moodlet: { emotion: 'inspired', label: 'Earth Day', intensity: 3 },
    tags: ['civic', 'outdoors'],
  }),
  tax_day: H({
    id: 'tax_day',
    name: 'Tax Day',
    rule: { kind: 'fixed', month: 4, day: 15 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [{ label: 'File taxes at the last minute', venue: 'home', cost: 0, fun: -10, social: 0, durationMinutes: 120 }],
    description: 'Federal income tax filing deadline. Post offices stay open late; accountants have not slept in weeks.',
    moodlet: { emotion: 'stressed', label: 'Tax Day', intensity: -5 },
    tags: ['finance', 'deadline'],
  }),
  cinco_de_mayo: H({
    id: 'cinco_de_mayo',
    name: 'Cinco de Mayo',
    rule: { kind: 'fixed', month: 5, day: 5 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Tacos and margaritas', venue: 'restaurant', cost: 45, fun: 22, social: 20, durationMinutes: 120 },
      { label: 'Cinco de Mayo street party', venue: 'park', cost: 10, fun: 28, social: 25, durationMinutes: 180 },
    ],
    description: 'Celebrated more in the US than in Mexico: mariachi, street festivals, and a lot of margaritas.',
    moodlet: { emotion: 'playful', label: 'Fiesta', intensity: 5 },
    tags: ['party', 'food', 'cultural'],
  }),
  mothers_day: H({
    id: 'mothers_day',
    name: "Mother's Day",
    rule: { kind: 'nth_weekday', month: 5, weekday: 0, n: 2 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: "Take Mom to brunch", venue: 'restaurant', cost: 90, fun: 15, social: 30, durationMinutes: 120 },
      { label: 'Call Mom', venue: 'home', cost: 0, fun: 5, social: 20, durationMinutes: 30 },
      { label: 'Buy flowers and a card', venue: 'florist', cost: 55, fun: 5, social: 10, durationMinutes: 20 },
    ],
    description: 'The busiest restaurant day of the year. Florists sell out by Saturday.',
    moodlet: { emotion: 'grateful', label: "Mother's Day", intensity: 4 },
    spendingMultiplier: 1.3,
    tags: ['family'],
  }),
  memorial_day: H({
    id: 'memorial_day',
    name: 'Memorial Day',
    rule: { kind: 'nth_weekday', month: 5, weekday: 1, n: -1 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Backyard barbecue', venue: 'home', cost: 60, fun: 25, social: 28, durationMinutes: 240 },
      { label: 'Visit the cemetery', venue: 'cemetery', cost: 0, fun: -5, social: 8, durationMinutes: 45 },
      { label: 'Pool opening day', venue: 'pool', cost: 8, fun: 25, social: 15, durationMinutes: 180 },
      { label: 'Lake or beach day', venue: 'beach', cost: 20, fun: 30, social: 18, durationMinutes: 300 },
    ],
    description: 'Unofficial start of summer: pools open, grills fire up, flags on graves. Banks and schools closed.',
    moodlet: { emotion: 'relaxed', label: 'Long weekend', intensity: 6 },
    spendingMultiplier: 1.15,
    tags: ['federal', 'summer', 'family'],
  }),
  fathers_day: H({
    id: 'fathers_day',
    name: "Father's Day",
    rule: { kind: 'nth_weekday', month: 6, weekday: 0, n: 3 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Grill with Dad', venue: 'home', cost: 45, fun: 18, social: 25, durationMinutes: 180 },
      { label: 'Call Dad', venue: 'home', cost: 0, fun: 5, social: 18, durationMinutes: 25 },
      { label: 'Take Dad to a game', venue: 'stadium', cost: 110, fun: 25, social: 25, durationMinutes: 200 },
    ],
    description: 'Grills, ties, and a phone call. Hardware stores run their biggest sale of the year.',
    moodlet: { emotion: 'grateful', label: "Father's Day", intensity: 4 },
    spendingMultiplier: 1.15,
    tags: ['family'],
  }),
  juneteenth: H({
    id: 'juneteenth',
    name: 'Juneteenth',
    rule: { kind: 'fixed', month: 6, day: 19 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Juneteenth celebration in the park', venue: 'park', cost: 0, fun: 25, social: 25, durationMinutes: 180 },
      { label: 'Red food cookout', venue: 'home', cost: 50, fun: 20, social: 25, durationMinutes: 200 },
    ],
    description: 'Freedom Day, a federal holiday since 2021. Parades, cookouts, live music, and Black-owned business markets.',
    moodlet: { emotion: 'proud', label: 'Juneteenth', intensity: 6 },
    tags: ['federal', 'cultural', 'summer'],
  }),
  pride: H({
    id: 'pride',
    name: 'Pride',
    rule: { kind: 'nth_weekday', month: 6, weekday: 0, n: -1 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'March in the Pride parade', venue: 'park', cost: 0, fun: 30, social: 30, durationMinutes: 240 },
      { label: 'Pride block party', venue: 'bar', cost: 45, fun: 30, social: 30, durationMinutes: 240 },
    ],
    description: 'The big Pride parade weekend closing out Pride Month: floats, drag brunches, rainbow everything.',
    moodlet: { emotion: 'proud', label: 'Pride', intensity: 7 },
    tags: ['party', 'cultural', 'summer'],
  }),
  independence_day: H({
    id: 'independence_day',
    name: 'Independence Day',
    rule: { kind: 'fixed', month: 7, day: 4 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'most',
    activities: [
      { label: 'Watch the fireworks', venue: 'park', cost: 0, fun: 32, social: 25, durationMinutes: 120 },
      { label: 'Fourth of July cookout', venue: 'home', cost: 70, fun: 28, social: 30, durationMinutes: 300 },
      { label: 'Set off fireworks (carefully)', venue: 'home', cost: 60, fun: 30, social: 15, durationMinutes: 60 },
      { label: 'Beach day', venue: 'beach', cost: 15, fun: 30, social: 18, durationMinutes: 300 },
    ],
    description: 'Fireworks, flags, hot dogs, and every parking lot near the river full by 6pm. Almost everything is closed.',
    moodlet: { emotion: 'happy', label: 'Fourth of July', intensity: 8 },
    spendingMultiplier: 1.2,
    tags: ['federal', 'summer', 'party'],
  }),
  labor_day: H({
    id: 'labor_day',
    name: 'Labor Day',
    rule: { kind: 'nth_weekday', month: 9, weekday: 1, n: 1 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Last barbecue of summer', venue: 'home', cost: 55, fun: 22, social: 25, durationMinutes: 240 },
      { label: 'Labor Day sales', venue: 'mall', cost: 120, fun: 12, social: 8, durationMinutes: 120 },
      { label: 'Last pool day', venue: 'pool', cost: 8, fun: 22, social: 12, durationMinutes: 180 },
    ],
    description: 'Unofficial end of summer. Pools close after today; retail runs big sales; banks and schools closed.',
    moodlet: { emotion: 'relaxed', label: 'Long weekend', intensity: 5 },
    spendingMultiplier: 1.1,
    tags: ['federal', 'summer'],
  }),
  back_to_school: H({
    id: 'back_to_school',
    name: 'Back to School',
    rule: { kind: 'range', month: 8, from: 15, to: 21 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Back-to-school shopping', venue: 'retail', cost: 140, fun: 5, social: 8, durationMinutes: 120 },
      { label: 'Meet the teacher night', venue: 'school', cost: 0, fun: 3, social: 15, durationMinutes: 90 },
    ],
    description: 'The week most districts start classes: supply lists, new sneakers, traffic around every school at 7:40am.',
    spendingMultiplier: 1.25,
    tags: ['school', 'shopping'],
  }),
  columbus_day: H({
    id: 'columbus_day',
    name: "Columbus Day / Indigenous Peoples' Day",
    rule: { kind: 'nth_weekday', month: 10, weekday: 1, n: 2 },
    federal: true,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [{ label: "Indigenous Peoples' Day gathering", venue: 'park', cost: 0, fun: 10, social: 15, durationMinutes: 120 }],
    description: 'Federal holiday (banks, post office closed) that most private employers and many schools ignore.',
    tags: ['federal', 'fall'],
  }),
  halloween: H({
    id: 'halloween',
    name: 'Halloween',
    rule: { kind: 'fixed', month: 10, day: 31 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Take the kids trick-or-treating', venue: 'home', cost: 0, fun: 25, social: 20, durationMinutes: 120 },
      { label: 'Hand out candy', venue: 'home', cost: 25, fun: 12, social: 15, durationMinutes: 150 },
      { label: 'Halloween costume party', venue: 'bar', cost: 60, fun: 32, social: 30, durationMinutes: 240 },
      { label: 'Haunted house', venue: 'amusement_park', cost: 35, fun: 28, social: 15, durationMinutes: 90 },
      { label: 'Carve pumpkins', venue: 'home', cost: 15, fun: 15, social: 12, durationMinutes: 60 },
    ],
    description: 'Costumes, candy, porch decorations that started going up in September. Bars are packed on the nearest Saturday.',
    moodlet: { emotion: 'playful', label: 'Spooky season', intensity: 6 },
    spendingMultiplier: 1.3,
    tags: ['party', 'family', 'fall'],
  }),
  election_day: H({
    id: 'election_day',
    name: 'Election Day',
    rule: { kind: 'computed', fn: electionDay },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Vote', venue: 'school', cost: 0, fun: 5, social: 8, durationMinutes: 45 },
      { label: 'Watch election returns', venue: 'home', cost: 0, fun: 5, social: 5, durationMinutes: 180 },
    ],
    description: 'Polls open 7am to 7pm at schools, churches and libraries. Many workplaces give a couple of hours off to vote.',
    moodlet: { emotion: 'tense', label: 'Election Day', intensity: -3 },
    tags: ['civic'],
  }),
  veterans_day: H({
    id: 'veterans_day',
    name: 'Veterans Day',
    rule: { kind: 'fixed', month: 11, day: 11 },
    federal: true,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [{ label: 'Veterans Day parade', venue: 'park', cost: 0, fun: 10, social: 12, durationMinutes: 90 }],
    description: 'Federal holiday honoring veterans; banks, post office and federal offices closed. Restaurants offer free meals to vets.',
    moodlet: { emotion: 'grateful', label: 'Veterans Day', intensity: 3 },
    tags: ['federal', 'civic'],
  }),
  thanksgiving: H({
    id: 'thanksgiving',
    name: 'Thanksgiving',
    rule: { kind: 'computed', fn: thanksgivingDay },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'most',
    activities: [
      { label: 'Cook Thanksgiving dinner', venue: 'home', cost: 110, fun: 15, social: 30, durationMinutes: 300 },
      { label: 'Watch the parade and football', venue: 'home', cost: 0, fun: 15, social: 10, durationMinutes: 240 },
      { label: 'Turkey trot 5K', venue: 'park', cost: 35, fun: 18, social: 15, durationMinutes: 90 },
      { label: 'Volunteer at a soup kitchen', venue: 'shelter', cost: 0, fun: 8, social: 20, durationMinutes: 180 },
    ],
    description: 'Fourth Thursday of November: turkey, family, football, and a nap. Nearly everything except gas stations and a few diners is closed.',
    moodlet: { emotion: 'grateful', label: 'Thanksgiving', intensity: 8 },
    spendingMultiplier: 1.4,
    tags: ['federal', 'family', 'food', 'fall'],
  }),
  black_friday: H({
    id: 'black_friday',
    name: 'Black Friday',
    rule: {
      kind: 'computed',
      fn: (year) => {
        const t = thanksgivingDay(year);
        const d = addDays(year, t.month, t.day, 1);
        return { month: d.month, day: d.day };
      },
    },
    federal: false,
    schoolClosed: true,
    businessesClosed: 'none',
    activities: [
      { label: 'Doorbuster shopping', venue: 'mall', cost: 250, fun: 15, social: 10, durationMinutes: 240 },
      { label: 'Shop electronics deals', venue: 'electronics', cost: 400, fun: 18, social: 5, durationMinutes: 120 },
      { label: 'Leftovers and avoid the mall', venue: 'home', cost: 0, fun: 12, social: 10, durationMinutes: 120 },
    ],
    description: 'The day after Thanksgiving. Stores open at 5am, parking lots are war zones, and it is the biggest shopping day of the year.',
    spendingMultiplier: 0.75,
    tags: ['shopping', 'sales'],
  }),
  hanukkah: H({
    id: 'hanukkah',
    name: 'Hanukkah',
    rule: { kind: 'computed', fn: lookup(HANUKKAH_START) },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Light the menorah', venue: 'home', cost: 0, fun: 10, social: 15, durationMinutes: 30 },
      { label: 'Fry latkes', venue: 'home', cost: 20, fun: 15, social: 15, durationMinutes: 90 },
      { label: 'Play dreidel', venue: 'home', cost: 5, fun: 15, social: 15, durationMinutes: 45 },
    ],
    description: 'Eight nights of candles, latkes, sufganiyot and small gifts.',
    moodlet: { emotion: 'grateful', label: 'Hanukkah', intensity: 5 },
    tags: ['religious', 'family', 'winter'],
  }),
  christmas_eve: H({
    id: 'christmas_eve',
    name: 'Christmas Eve',
    rule: { kind: 'fixed', month: 12, day: 24 },
    federal: false,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: 'Midnight Mass / Christmas Eve service', venue: 'church', cost: 0, fun: 8, social: 18, durationMinutes: 90 },
      { label: 'Last-minute gift run', venue: 'mall', cost: 90, fun: 0, social: 5, durationMinutes: 90 },
      { label: 'Wrap gifts and watch a Christmas movie', venue: 'home', cost: 0, fun: 18, social: 15, durationMinutes: 150 },
      { label: 'Feast of the Seven Fishes / tamales night', venue: 'home', cost: 80, fun: 18, social: 28, durationMinutes: 240 },
    ],
    description: 'Stores close early, churches fill up, and someone is still wrapping at midnight.',
    moodlet: { emotion: 'nostalgic', label: 'Christmas Eve', intensity: 6 },
    spendingMultiplier: 1.3,
    tags: ['family', 'winter', 'religious'],
  }),
  christmas: H({
    id: 'christmas',
    name: 'Christmas Day',
    rule: { kind: 'fixed', month: 12, day: 25 },
    federal: true,
    schoolClosed: true,
    businessesClosed: 'most',
    activities: [
      { label: 'Open presents', venue: 'home', cost: 0, fun: 30, social: 25, durationMinutes: 90 },
      { label: 'Christmas dinner', venue: 'home', cost: 95, fun: 18, social: 30, durationMinutes: 240 },
      { label: 'Chinese food and a movie', venue: 'restaurant', cost: 45, fun: 20, social: 15, durationMinutes: 180 },
      { label: 'Call far-away family', venue: 'home', cost: 0, fun: 8, social: 20, durationMinutes: 45 },
    ],
    description: 'Almost every business is closed. Families gather, presents get opened, and the only open restaurants are Chinese and the movie theater.',
    moodlet: { emotion: 'happy', label: 'Christmas', intensity: 10 },
    spendingMultiplier: 1.5,
    tags: ['federal', 'family', 'winter', 'religious'],
  }),
  kwanzaa: H({
    id: 'kwanzaa',
    name: 'Kwanzaa',
    rule: { kind: 'range', month: 12, from: 26, to: 31 },
    federal: false,
    schoolClosed: true,
    businessesClosed: 'none',
    activities: [
      { label: 'Light the kinara', venue: 'home', cost: 0, fun: 8, social: 15, durationMinutes: 30 },
      { label: 'Karamu feast', venue: 'community_center', cost: 30, fun: 20, social: 28, durationMinutes: 180 },
    ],
    description: 'A week-long celebration of African-American heritage: the seven principles, the kinara, and the karamu feast on Dec 31.',
    moodlet: { emotion: 'proud', label: 'Kwanzaa', intensity: 4 },
    tags: ['cultural', 'family', 'winter'],
  }),
  new_years_eve: H({
    id: 'new_years_eve',
    name: "New Year's Eve",
    rule: { kind: 'fixed', month: 12, day: 31 },
    federal: false,
    schoolClosed: true,
    businessesClosed: 'some',
    activities: [
      { label: "New Year's Eve party", venue: 'nightclub', cost: 120, fun: 35, social: 35, durationMinutes: 300 },
      { label: 'Champagne toast at midnight', venue: 'bar', cost: 60, fun: 25, social: 28, durationMinutes: 240 },
      { label: 'Watch the ball drop at home', venue: 'home', cost: 20, fun: 15, social: 15, durationMinutes: 180 },
      { label: 'Fireworks downtown', venue: 'park', cost: 0, fun: 25, social: 20, durationMinutes: 120 },
    ],
    description: 'Cover charges triple, rideshare surges after midnight, and everyone kisses someone at 12:00.',
    moodlet: { emotion: 'hopeful', label: "New Year's Eve", intensity: 7 },
    spendingMultiplier: 1.4,
    tags: ['party', 'winter'],
  }),
  lunar_new_year: H({
    id: 'lunar_new_year',
    name: 'Lunar New Year',
    rule: { kind: 'computed', fn: lookup(LUNAR_NEW_YEAR) },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Lunar New Year parade', venue: 'park', cost: 0, fun: 25, social: 22, durationMinutes: 150 },
      { label: 'Reunion dinner', venue: 'restaurant', cost: 65, fun: 18, social: 30, durationMinutes: 150 },
      { label: 'Make dumplings', venue: 'home', cost: 25, fun: 15, social: 20, durationMinutes: 120 },
    ],
    description: 'Lion dances, red envelopes, firecrackers, and reunion dinners. Chinatowns and Little Saigons celebrate for days.',
    moodlet: { emotion: 'hopeful', label: 'Lunar New Year', intensity: 6 },
    tags: ['cultural', 'family'],
  }),
  diwali: H({
    id: 'diwali',
    name: 'Diwali',
    rule: { kind: 'computed', fn: lookup(DIWALI) },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Light diyas and set off sparklers', venue: 'home', cost: 20, fun: 18, social: 18, durationMinutes: 90 },
      { label: 'Diwali mela', venue: 'community_center', cost: 15, fun: 25, social: 25, durationMinutes: 180 },
      { label: 'Sweets and a big family dinner', venue: 'home', cost: 60, fun: 18, social: 28, durationMinutes: 180 },
    ],
    description: 'The festival of lights: diyas, rangoli, sweets, new clothes, and fireworks. Many districts now close schools.',
    moodlet: { emotion: 'happy', label: 'Diwali', intensity: 7 },
    tags: ['religious', 'cultural', 'family'],
  }),
  ramadan_start: H({
    id: 'ramadan_start',
    name: 'First day of Ramadan',
    rule: { kind: 'computed', fn: lookup(RAMADAN_START) },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Iftar with the community', venue: 'church', cost: 0, fun: 12, social: 25, durationMinutes: 120 },
      { label: 'Pre-dawn suhoor', venue: 'home', cost: 10, fun: 5, social: 10, durationMinutes: 45 },
    ],
    description: 'The month of fasting begins: no food or drink from dawn to sunset, iftar dinners every evening.',
    moodlet: { emotion: 'focused', label: 'Ramadan', intensity: 3 },
    tags: ['religious'],
  }),
  eid: H({
    id: 'eid',
    name: 'Eid al-Fitr',
    rule: { kind: 'computed', fn: lookup(EID_AL_FITR) },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [
      { label: 'Eid prayer', venue: 'church', cost: 0, fun: 8, social: 22, durationMinutes: 90 },
      { label: 'Eid feast with family', venue: 'home', cost: 70, fun: 20, social: 30, durationMinutes: 240 },
      { label: 'Give Eidi to the kids', venue: 'home', cost: 40, fun: 12, social: 15, durationMinutes: 30 },
    ],
    description: 'The festival that ends Ramadan: morning prayers, new clothes, sweets, and gifts of money for children.',
    moodlet: { emotion: 'grateful', label: 'Eid Mubarak', intensity: 7 },
    tags: ['religious', 'family'],
  }),
  daylight_saving_start: H({
    id: 'daylight_saving_start',
    name: 'Daylight Saving Time begins',
    rule: { kind: 'nth_weekday', month: 3, weekday: 0, n: 2 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [],
    description: 'Clocks spring forward one hour at 2am. Everyone loses an hour of sleep and the Monday after is miserable.',
    moodlet: { emotion: 'tired', label: 'Lost an hour', intensity: -4 },
    tags: ['system'],
  }),
  daylight_saving_end: H({
    id: 'daylight_saving_end',
    name: 'Daylight Saving Time ends',
    rule: { kind: 'nth_weekday', month: 11, weekday: 0, n: 1 },
    federal: false,
    schoolClosed: false,
    businessesClosed: 'none',
    activities: [],
    description: 'Clocks fall back one hour at 2am. An extra hour of sleep, and sunset before 5pm from now on.',
    moodlet: { emotion: 'relaxed', label: 'Extra hour', intensity: 3 },
    tags: ['system'],
  }),
};

export const HOLIDAY_IDS = Object.keys(HOLIDAYS);

/** Resolve the (month, day) a holiday rule starts on in a given year; undefined for range rules. */
export function holidayStart(def: HolidayDef, year: number): MD | undefined {
  const r = def.rule;
  switch (r.kind) {
    case 'fixed':
      return { month: r.month, day: r.day };
    case 'nth_weekday':
      return { month: r.month, day: nthWeekday(year, r.month, r.weekday, r.n) };
    case 'computed':
      return r.fn(year);
    case 'range':
      return undefined;
  }
}

/** True when (year, month, day) falls on the holiday (including multi-day spans and ranges). */
export function isHolidayOn(def: HolidayDef, year: number, month: number, day: number): boolean {
  const r = def.rule;
  if (r.kind === 'range') return month === r.month && day >= r.from && day <= r.to;
  const span = HOLIDAY_SPANS[def.id] ?? 1;
  // check this year's occurrence, and last year's for spans crossing New Year
  for (const y of span > 1 ? [year, year - 1] : [year]) {
    const start = holidayStart(def, y);
    if (!start) continue;
    const t0 = Date.UTC(y, start.month - 1, start.day);
    const t = Date.UTC(year, month - 1, day);
    const diff = Math.round((t - t0) / 86_400_000);
    if (diff >= 0 && diff < span) return true;
  }
  return false;
}
