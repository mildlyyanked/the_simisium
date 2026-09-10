export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const clamp100 = (v: number): number => clamp(v, 0, 100);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

export const MINUTE = 1;
export const HOUR = 60;
export const DAY = 1440;
export const WEEK = DAY * 7;

export function formatMoney(amount: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const cents = opts.cents ?? true;
  const abs = Math.abs(amount);
  const str = cents ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(abs).toLocaleString('en-US');
  const sign = amount < 0 ? '-' : opts.sign && amount > 0 ? '+' : '';
  return `${sign}$${str}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const kmToMiles = (km: number): number => km * 0.621371;

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function pickKeys<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

/** deep clone via structured JSON (state is JSON-safe by design) */
export function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function sumBy<T>(arr: readonly T[], f: (t: T) => number): number {
  let s = 0;
  for (const a of arr) s += f(a);
  return s;
}

export function groupBy<T, K extends string | number>(arr: readonly T[], f: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const a of arr) {
    const k = f(a);
    (out[k] ||= []).push(a);
  }
  return out;
}

export function assertNever(x: never, msg = 'unexpected'): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
