/**
 * Formatting helpers shared by screens and components (UI-only; the engine has its own).
 */
import type { OpeningPeriod, Weekday } from '@engine/core/types';
import { formatClock, minuteOfDay, weekdayAt, dateAtMinute, weekdayName, monthName } from '@engine/core/clock';

export function money(amount: number, opts: { cents?: boolean; sign?: boolean; compact?: boolean } = {}): string {
  const abs = Math.abs(amount);
  let str: string;
  if (opts.compact && abs >= 10000) str = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : `${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  else if (opts.cents === false || (opts.compact && abs >= 1000)) str = Math.round(abs).toLocaleString('en-US');
  else str = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = amount < 0 ? '−' : opts.sign && amount > 0 ? '+' : '';
  return `${sign}$${str}`;
}

export function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}

export function clock(minute: number): string {
  return formatClock(minute);
}

export function clockShort(minute: number): string {
  const mod = minuteOfDay(minute);
  const h = Math.floor(mod / 60);
  const m = mod % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function dayLabel(epoch: string, minute: number): string {
  const d = dateAtMinute(epoch, minute);
  const w = d.getUTCDay() as Weekday;
  return `${weekdayName(w)}, ${monthName(d.getUTCMonth() + 1)} ${d.getUTCDate()}`;
}

export function dayLabelShort(epoch: string, minute: number): string {
  const d = dateAtMinute(epoch, minute);
  const w = d.getUTCDay() as Weekday;
  return `${weekdayName(w, true)} ${monthName(d.getUTCMonth() + 1, true)} ${d.getUTCDate()}`;
}

export function relativeMinutes(now: number, at: number): string {
  const diff = at - now;
  const abs = Math.abs(diff);
  if (abs < 1) return 'now';
  const s = duration(abs);
  return diff > 0 ? `in ${s}` : `${s} ago`;
}

export function dayNumber(minute: number): number {
  return Math.floor(minute / 1440) + 1;
}

/** Describe today's opening window from Google periods: 'Open · closes 9 PM' / 'Closed · opens 7 AM' */
export function openStatus(periods: OpeningPeriod[] | undefined, epoch: string, minute: number, isOpen: boolean): { open: boolean; label: string } {
  if (!periods || periods.length === 0) return { open: isOpen, label: isOpen ? 'Open' : 'Closed' };
  const wd = weekdayAt(epoch, minute);
  const mod = minuteOfDay(minute);
  const fmt = (m: number) => clockShort(m % 1440);
  // find current period
  for (const p of periods) {
    if (p.day === wd && mod >= p.open && mod < p.close) return { open: true, label: `Open · closes ${fmt(p.close)}` };
    const prev = ((wd + 6) % 7) as Weekday;
    if (p.day === prev && p.close > 1440 && mod < p.close - 1440) return { open: true, label: `Open · closes ${fmt(p.close)}` };
  }
  // next opening today
  const today = periods.filter((p) => p.day === wd && p.open > mod).sort((a, b) => a.open - b.open)[0];
  if (today) return { open: false, label: `Closed · opens ${fmt(today.open)}` };
  for (let i = 1; i <= 7; i++) {
    const d = ((wd + i) % 7) as Weekday;
    const next = periods.filter((p) => p.day === d).sort((a, b) => a.open - b.open)[0];
    if (next) return { open: false, label: i === 1 ? `Closed · opens ${fmt(next.open)} tomorrow` : `Closed · opens ${weekdayName(d, true)} ${fmt(next.open)}` };
  }
  return { open: isOpen, label: isOpen ? 'Open' : 'Closed' };
}

export function hoursByDay(periods: OpeningPeriod[] | undefined): { day: string; hours: string }[] {
  const days: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
  return days.map((d) => {
    const ps = (periods ?? []).filter((p) => p.day === d).sort((a, b) => a.open - b.open);
    if (!ps.length) return { day: weekdayName(d, true), hours: periods && periods.length ? 'Closed' : '—' };
    if (ps.some((p) => p.open === 0 && p.close >= 1439)) return { day: weekdayName(d, true), hours: 'Open 24 hours' };
    return { day: weekdayName(d, true), hours: ps.map((p) => `${clockShort(p.open)} – ${clockShort(p.close % 1440)}`).join(', ') };
  });
}

export function km(distanceKm: number): string {
  const mi = distanceKm * 0.621371;
  if (mi < 0.1) return 'right here';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function pct(v: number): string {
  return `${Math.round(v)}%`;
}

export function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function priceLevel(level?: number): string {
  if (level === undefined || level === null) return '';
  if (level <= 0) return 'Free';
  return '$'.repeat(Math.min(4, level));
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
