import type { CalendarDay, HolidayId, Season, Weekday } from './types';
import { DAY, HOUR } from './util';

/** Parse "YYYY-MM-DD" into a UTC Date at 00:00. We treat all sim-local times as UTC internally. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function dateAtMinute(epochIso: string, minute: number): Date {
  const d = parseIsoDate(epochIso);
  return new Date(d.getTime() + minute * 60_000);
}

export function minuteOfDay(minute: number): number {
  return ((minute % DAY) + DAY) % DAY;
}

export function dayIndex(minute: number): number {
  return Math.floor(minute / DAY);
}

export function hourOf(minute: number): number {
  return Math.floor(minuteOfDay(minute) / HOUR);
}

export function weekdayAt(epochIso: string, minute: number): Weekday {
  return dateAtMinute(epochIso, minute).getUTCDay() as Weekday;
}

export function isoDateAt(epochIso: string, minute: number): string {
  return toIsoDate(dateAtMinute(epochIso, minute));
}

export function seasonForMonth(month: number, lat = 30): Season {
  const north = lat >= 0;
  const m = north ? month : ((month + 5) % 12) + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'fall';
  return 'winter';
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86_400_000);
}

/** Approx sunrise/sunset (minutes since midnight) for a latitude and day of year. */
export function daylight(lat: number, doy: number): { sunrise: number; sunset: number } {
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81)) * (Math.PI / 180);
  const latR = (lat * Math.PI) / 180;
  let cosH = -Math.tan(latR) * Math.tan(decl);
  cosH = Math.max(-1, Math.min(1, cosH));
  const H = (Math.acos(cosH) * 180) / Math.PI; // degrees
  const dayLenMin = (H / 15) * 2 * 60;
  const solarNoon = 12 * 60 + 15; // slight DST-ish offset for realism
  return { sunrise: Math.round(solarNoon - dayLenMin / 2), sunset: Math.round(solarNoon + dayLenMin / 2) };
}

export function formatClock(minute: number, opts: { hour12?: boolean } = {}): string {
  const mod = minuteOfDay(minute);
  const h = Math.floor(mod / 60);
  const m = mod % 60;
  const mm = m.toString().padStart(2, '0');
  if (opts.hour12 === false) return `${h.toString().padStart(2, '0')}:${mm}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekdayName(w: Weekday, short = false): string {
  const n = WEEKDAY_NAMES[w];
  return short ? n.slice(0, 3) : n;
}

export function monthName(m: number, short = false): string {
  const n = MONTH_NAMES[m - 1];
  return short ? n.slice(0, 3) : n;
}

export function formatDate(epochIso: string, minute: number, opts: { short?: boolean } = {}): string {
  const d = dateAtMinute(epochIso, minute);
  const w = d.getUTCDay() as Weekday;
  const mo = d.getUTCMonth() + 1;
  return opts.short
    ? `${weekdayName(w, true)}, ${monthName(mo, true)} ${d.getUTCDate()}`
    : `${weekdayName(w)}, ${monthName(mo)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(epochIso: string, minute: number): string {
  return `${formatDate(epochIso, minute, { short: true })} · ${formatClock(minute)}`;
}

export function ageAt(birthIso: string, epochIso: string, minute: number): number {
  const b = parseIsoDate(birthIso);
  const now = dateAtMinute(epochIso, minute);
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function birthDateForAge(epochIso: string, age: number, rngFrac: number): string {
  const d = parseIsoDate(epochIso);
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - Math.floor(rngFrac * 364));
  return toIsoDate(d);
}

export type HolidayResolver = (day: { year: number; month: number; day: number; weekday: Weekday; dayOfYear: number }) => HolidayId[];

export interface ClockInfo {
  minute: number;
  minuteOfDay: number;
  hour: number;
  date: Date;
  isoDate: string;
  weekday: Weekday;
  season: Season;
  day: CalendarDay;
  sunrise: number;
  sunset: number;
  isDaylight: boolean;
  timeLabel: string;
  dateLabel: string;
  partOfDay: 'late_night' | 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
}

export function partOfDay(mod: number): ClockInfo['partOfDay'] {
  const h = mod / 60;
  if (h < 5) return 'late_night';
  if (h < 8) return 'early_morning';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 17.5) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

export function clockInfo(epochIso: string, minute: number, lat: number, holidays: HolidayResolver, schoolDayResolver?: (day: CalendarDay) => boolean): ClockInfo {
  const date = dateAtMinute(epochIso, minute);
  const weekday = date.getUTCDay() as Weekday;
  const month = date.getUTCMonth() + 1;
  const doy = dayOfYear(date);
  const season = seasonForMonth(month, lat);
  const base = { year: date.getUTCFullYear(), month, day: date.getUTCDate(), weekday, dayOfYear: doy };
  const hol = holidays(base);
  const isWeekend = weekday === 0 || weekday === 6;
  const federal = hol.some((h) => FEDERAL_HOLIDAYS.has(h));
  const day: CalendarDay = {
    isoDate: toIsoDate(date),
    ...base,
    season,
    holidays: hol,
    isWeekend,
    isFederalHoliday: federal,
    isSchoolDay: false,
  };
  day.isSchoolDay = schoolDayResolver ? schoolDayResolver(day) : !isWeekend && !federal && !(month === 7) && !(month === 6 && day.day > 5) && !(month === 8 && day.day < 15) && !(month === 12 && day.day > 19) && !(month === 1 && day.day < 5);
  const mod = minuteOfDay(minute);
  const { sunrise, sunset } = daylight(lat, doy);
  return {
    minute,
    minuteOfDay: mod,
    hour: Math.floor(mod / 60),
    date,
    isoDate: day.isoDate,
    weekday,
    season,
    day,
    sunrise,
    sunset,
    isDaylight: mod >= sunrise && mod < sunset,
    timeLabel: formatClock(minute),
    dateLabel: formatDate(epochIso, minute),
    partOfDay: partOfDay(mod),
  };
}

export const FEDERAL_HOLIDAYS = new Set<HolidayId>([
  'new_years_day',
  'mlk_day',
  'presidents_day',
  'memorial_day',
  'juneteenth',
  'independence_day',
  'labor_day',
  'columbus_day',
  'veterans_day',
  'thanksgiving',
  'christmas',
]);
