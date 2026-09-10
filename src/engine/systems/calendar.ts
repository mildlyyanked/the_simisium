/**
 * Calendar system: holidays, birthdays, festivals, DST, school breaks, holiday closures.
 *
 * Exports
 *  - `holidayResolver` — `HolidayResolver` for the Engine (day → HolidayId[]), built from content/holidays.ts.
 *  - `calendarSystem`  — the System (id 'calendar', hourly).
 *  - `isHolidayClosed(state, venue, holidayIds)` — whether a venue is shut for the day's holidays.
 *
 * Events emitted:  calendar:holiday, calendar:birthday, entertainment:event (kind 'festival'), venue:closed
 * Events consumed: world:new_game, world:loaded, time:day, time:month, scheduled:fired (kind 'festival' / '_festival_end'), action:completed
 * Action ids:      holiday:<holidayId>:<index>, festival:<festivalId>:<index>
 *
 * World flags set (`state.flags`):
 *  - `dstOffset`            0 | 1  — 1 while daylight saving time is in effect (0 always in AZ/HI)
 *  - `schoolBreak`          '' | 'winter' | 'spring' | 'summer' | 'thanksgiving'
 *  - `holidayToday`         comma-joined holiday ids for today ('' when none)
 *  - `festival:<id>`        venueId while the festival is active (deleted when it ends)
 *  - `festival_until:<id>`  minute the active festival ends
 *  - `calendar:festivalsMonth` 'YYYY-MM' last month festivals were scheduled for
 *
 * Venue tags set: 'holiday_closed' on venues shut by a `businessesClosed: 'most'` holiday (removed the next day);
 * 'festival' while a festival is running there. The UI should show "Closed for <holiday>" from the tag;
 * `query.isVenueOpen` does not consult tags.
 */
import type { HolidayResolver } from '../core/clock';
import { parseIsoDate } from '../core/clock';
import type { System, SystemContext } from '../core/systems';
import type { ActionDef, EmotionId, HolidayId, Requirement, Sim, Venue, VenueArchetype, VenueId, WorldState } from '../core/types';
import { DAY, HOUR, round2 } from '../core/util';
import { FESTIVALS } from '../content/festivals';
import { HOLIDAYS, HOLIDAY_IDS, isHolidayOn, nthWeekday, thanksgivingDay } from '../content/holidays';
import type { FestivalDef, HolidayDef } from '../content/types';

// ---------------------------------------------------------------------------
// Holiday resolver
// ---------------------------------------------------------------------------
const resolverCache = new Map<string, HolidayId[]>();

export const holidayResolver: HolidayResolver = (day) => {
  const key = `${day.year}-${day.month}-${day.day}`;
  const hit = resolverCache.get(key);
  if (hit) return hit;
  const out: HolidayId[] = [];
  for (const id of HOLIDAY_IDS) {
    const def = HOLIDAYS[id];
    if (def && isHolidayOn(def, day.year, day.month, day.day)) out.push(id);
  }
  if (resolverCache.size > 2000) resolverCache.clear();
  resolverCache.set(key, out);
  return out;
};

/** Convenience: holidays on an ISO date. */
export function holidaysOn(isoDate: string): HolidayId[] {
  const d = parseIsoDate(isoDate);
  return holidayResolver({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6, dayOfYear: 0 });
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------
/** Archetypes that stay open even on "most businesses closed" holidays. */
const ALWAYS_OPEN: Set<VenueArchetype> = new Set([
  'home', 'apartment_building', 'park', 'playground', 'trail', 'beach', 'hospital', 'police', 'fire_station', 'jail', 'gas_station', 'convenience',
  'hotel', 'airport', 'transit_stop', 'train_station', 'bus_station', 'atm', 'ev_charger', 'parking', 'cinema', 'church', 'casino', 'cemetery', 'shelter', 'pharmacy',
]);

export function isHolidayClosed(state: WorldState, venue: Venue, holidayIds: HolidayId[]): boolean {
  if (!holidayIds.length) return false;
  if (ALWAYS_OPEN.has(venue.archetype)) return false;
  if (venue.tags.includes('open_holidays')) return false;
  const closes = holidayIds.some((id) => state && HOLIDAYS[id]?.businessesClosed === 'most');
  if (!closes) return false;
  // restaurants: about a third stay open (deterministic by id)
  if (venue.archetype === 'restaurant' || venue.archetype === 'fast_food' || venue.archetype === 'cafe') {
    const h = venue.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
    return h % 3 !== 0;
  }
  return true;
}

// ---------------------------------------------------------------------------
// DST / school breaks
// ---------------------------------------------------------------------------
export function isDstActive(year: number, month: number, day: number, stateCode: string): boolean {
  if (stateCode === 'AZ' || stateCode === 'HI') return false;
  const start = Date.UTC(year, 2, nthWeekday(year, 3, 0, 2));
  const end = Date.UTC(year, 10, nthWeekday(year, 11, 0, 1));
  const t = Date.UTC(year, month - 1, day);
  return t >= start && t < end;
}

export function schoolBreakFor(year: number, month: number, day: number): '' | 'winter' | 'spring' | 'summer' | 'thanksgiving' {
  if ((month === 12 && day >= 20) || (month === 1 && day <= 4)) return 'winter';
  if (month === 6 && day > 5) return 'summer';
  if (month === 7) return 'summer';
  if (month === 8 && day < 15) return 'summer';
  if (month === 3) {
    const mon = nthWeekday(year, 3, 1, 2);
    if (day >= mon && day < mon + 7) return 'spring';
  }
  if (month === 11) {
    const tg = thanksgivingDay(year).day;
    if (day >= tg - 1 && day <= tg + 1) return 'thanksgiving';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------
const NIGHT_TAGS = ['nightlife', 'drinking', 'party'];

function festivalVenue(ctx: SystemContext, def: FestivalDef): Venue | undefined {
  for (const arch of def.venues) {
    const list = ctx.query.venuesByArchetype(arch).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (list.length) return ctx.rng.pick(list);
  }
  return undefined;
}

function scheduleFestivalsForMonth(ctx: SystemContext, year: number, month: number): void {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  if (ctx.state.flags['calendar:festivalsMonth'] === key) return;
  ctx.state.flags['calendar:festivalsMonth'] = key;
  const today = ctx.clock.day;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (const def of Object.values(FESTIVALS)) {
    if (def.month !== month) continue;
    if (ctx.state.scheduled.some((e) => e.kind === 'festival' && e.payload?.festivalId === def.id)) continue;
    const venue = festivalVenue(ctx, def);
    if (!venue) continue;
    const minDay = today.year === year && today.month === month ? today.day : 1;
    const latest = Math.max(minDay, daysInMonth - def.durationDays);
    const day = ctx.rng.int(minDay, latest);
    const startHour = def.tags.some((t) => NIGHT_TAGS.includes(t)) ? 17 : 10;
    const dayDelta = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000);
    const startMinute = Math.floor(ctx.state.time.minute / DAY) * DAY + dayDelta * DAY + startHour * HOUR;
    const endMinute = startMinute + def.durationDays * DAY - (startHour - 1) * HOUR; // ends ~01:00 after the last day for night events, 23:00 for day events
    const at = Math.max(ctx.state.time.minute + 1, startMinute);
    ctx.schedule({ atMinute: at, kind: 'festival', label: def.name, venueId: venue.id, payload: { festivalId: def.id, endMinute: Math.max(at + HOUR, endMinute) } });
  }
}

function activateFestival(ctx: SystemContext, festivalId: string, venueId: VenueId, endMinute: number): void {
  const def = FESTIVALS[festivalId];
  const venue = ctx.query.venueMaybe(venueId);
  if (!def || !venue) return;
  ctx.state.flags[`festival:${festivalId}`] = venueId;
  ctx.state.flags[`festival_until:${festivalId}`] = endMinute;
  if (!venue.tags.includes('festival')) venue.tags.push('festival');
  venue.noise = Math.max(venue.noise, Math.round(40 + def.crowd * 40));
  ctx.schedule({ atMinute: endMinute, kind: '_festival_end', label: `${def.name} ends`, venueId, payload: { festivalId } });
  ctx.emit({ type: 'entertainment:event', venueId, kind: 'festival', label: def.name, at: ctx.state.time.minute });
  const days = def.durationDays > 1 ? ` It runs for ${def.durationDays} days.` : '';
  for (const s of ctx.query.controlledSims()) {
    ctx.log({ text: `${def.name} is on at ${venue.name}.${days} ${def.description}`, kind: 'event', simId: s.id, venueId, importance: 2 });
  }
}

function deactivateFestival(ctx: SystemContext, festivalId: string): void {
  const venueId = ctx.state.flags[`festival:${festivalId}`];
  delete ctx.state.flags[`festival:${festivalId}`];
  delete ctx.state.flags[`festival_until:${festivalId}`];
  if (typeof venueId === 'string') {
    const venue = ctx.query.venueMaybe(venueId as VenueId);
    if (venue) venue.tags = venue.tags.filter((t) => t !== 'festival');
  }
}

/** Festivals currently active at a venue. */
export function activeFestivalsAt(state: WorldState, venueId: VenueId): FestivalDef[] {
  const out: FestivalDef[] = [];
  for (const [k, v] of Object.entries(state.flags)) {
    if (!k.startsWith('festival:') || v !== venueId) continue;
    const id = k.slice('festival:'.length);
    const until = Number(state.flags[`festival_until:${id}`] ?? 0);
    if (until > state.time.minute && FESTIVALS[id]) out.push(FESTIVALS[id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function holidayActions(ctx: SystemContext, sim: Sim, venue: Venue, home: Venue | undefined): ActionDef[] {
  const out: ActionDef[] = [];
  const col = ctx.state.region.costOfLiving;
  for (const hid of ctx.clock.day.holidays) {
    const def = HOLIDAYS[hid];
    if (!def) continue;
    def.activities.forEach((act, idx) => {
      const atHome = !!home && venue.id === home.id;
      const fits = act.venue === undefined || (act.venue === 'home' ? atHome : venue.archetype === act.venue);
      if (!fits) return;
      const mult = act.venue === 'home' || act.venue === undefined ? col : venue.priceMultiplier * col;
      const cost = round2(act.cost * mult);
      const reqs: Requirement[] = [];
      if (cost > 0) reqs.push({ kind: 'money', reason: `Costs $${cost.toFixed(2)}`, params: { amount: cost } });
      if (act.venue && act.venue !== 'home') reqs.push({ kind: 'venue_open', reason: `${venue.name} is closed`, params: { venueId: venue.id } });
      const moodlet = def.moodlet ? [{ emotion: def.moodlet.emotion as EmotionId, label: def.moodlet.label, intensity: Math.abs(def.moodlet.intensity) + 4, durationMinutes: 480, id: `holiday_${hid}` }] : [];
      out.push({
        id: `holiday:${hid}:${idx}`,
        label: act.label,
        description: `${def.name}: ${def.description}`,
        category: def.tags.includes('family') ? 'family' : 'entertainment',
        icon: 'calendar',
        durationMinutes: act.durationMinutes,
        cost: cost > 0 ? { amount: cost, memo: `${act.label} (${def.name})`, category: 'entertainment', counterparty: act.venue === 'home' ? undefined : venue.name } : undefined,
        requirements: reqs,
        effects: {
          needs: { fun: act.fun, social: act.social, hunger: def.tags.includes('food') ? 15 : 0 },
          moodlets: moodlet,
          memories: [{ kind: 'event', text: `${act.label} on ${def.name}`, salience: 45, valence: act.fun > 0 ? 0.5 : -0.2, tags: ['holiday', hid] }],
        },
        satisfies: ['fun', 'social'],
        autonomyWeight: 1.5,
        interruptible: true,
        group: def.name,
      });
    });
  }
  return out;
}

function festivalActions(ctx: SystemContext, sim: Sim, venue: Venue): ActionDef[] {
  const out: ActionDef[] = [];
  const col = ctx.state.region.costOfLiving;
  for (const def of activeFestivalsAt(ctx.state, venue.id)) {
    def.activities.forEach((act, idx) => {
      const cost = round2((act.cost + (idx === 0 ? def.ticketPrice : 0)) * col);
      const reqs: Requirement[] = [];
      if (cost > 0) reqs.push({ kind: 'money', reason: `Costs $${cost.toFixed(2)}`, params: { amount: cost } });
      out.push({
        id: `festival:${def.id}:${idx}`,
        label: act.label,
        description: `${def.name}: ${def.description}`,
        category: 'entertainment',
        icon: 'ticket',
        target: { kind: 'venue', id: venue.id, name: venue.name },
        durationMinutes: act.durationMinutes,
        cost: cost > 0 ? { amount: cost, memo: `${act.label} (${def.name})`, category: 'entertainment', counterparty: def.name } : undefined,
        requirements: reqs,
        effects: {
          needs: { fun: act.fun, social: act.social, energy: -Math.round(act.durationMinutes / 30), hunger: def.tags.includes('food') ? 20 : 0 },
          skills: act.skillId ? { [act.skillId]: 10 } : undefined,
          moodlets: [{ emotion: 'happy', label: def.name, intensity: 6 + Math.round(def.crowd * 4), durationMinutes: 360, id: `festival_${def.id}` }],
          memories: [{ kind: 'event', text: `${act.label} at ${def.name}`, salience: 50, valence: 0.6, tags: ['festival', def.id] }],
          venue: [{ venueId: venue.id, noise: 2 }],
        },
        satisfies: ['fun', 'social'],
        autonomyWeight: 2,
        interruptible: true,
        group: def.name,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Day rollover
// ---------------------------------------------------------------------------
function applyDayState(ctx: SystemContext, announce: boolean): void {
  const { state, clock } = ctx;
  const day = clock.day;
  state.flags.dstOffset = isDstActive(day.year, day.month, day.day, state.region.stateCode) ? 1 : 0;
  state.flags.schoolBreak = schoolBreakFor(day.year, day.month, day.day);
  state.flags.holidayToday = day.holidays.join(',');

  // holiday closures
  for (const venue of Object.values(state.venues)) {
    const wasClosed = venue.tags.includes('holiday_closed');
    const closed = isHolidayClosed(state, venue, day.holidays);
    if (closed && !wasClosed) {
      venue.tags.push('holiday_closed');
      if (venue.discovered) ctx.emit({ type: 'venue:closed', venueId: venue.id, reason: HOLIDAYS[day.holidays.find((h) => HOLIDAYS[h]?.businessesClosed === 'most') ?? '']?.name ?? 'holiday' });
    } else if (!closed && wasClosed) {
      venue.tags = venue.tags.filter((t) => t !== 'holiday_closed');
    }
  }

  if (!announce) return;
  for (const hid of day.holidays) {
    const def = HOLIDAYS[hid];
    if (!def) continue;
    ctx.emit({ type: 'calendar:holiday', holidayId: hid, label: def.name });
    if (def.moodlet) {
      for (const sim of ctx.query.simulatedSims()) {
        ctx.applyEffects(sim.id, { moodlets: [{ emotion: def.moodlet.emotion as EmotionId, label: def.moodlet.label, intensity: def.moodlet.intensity, durationMinutes: DAY, id: `holiday_${hid}` }] }, 'calendar');
      }
    }
  }
  // birthdays
  const md = `${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  for (const sim of ctx.query.aliveSims()) {
    if (sim.identity.birthDate.slice(5) !== md) continue;
    const age = ctx.query.ageOf(sim);
    ctx.emit({ type: 'calendar:birthday', simId: sim.id, age });
    if (sim.lod !== 'far') ctx.applyEffects(sim.id, { moodlets: [{ emotion: 'happy', label: 'Birthday', intensity: 8, durationMinutes: DAY, id: 'birthday' }] }, 'calendar');
  }
}

function morningNarration(ctx: SystemContext): void {
  const day = ctx.clock.day;
  const controlled = ctx.query.controlledSims();
  if (!controlled.length) return;
  const md = `${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  for (const sim of controlled) {
    for (const hid of day.holidays) {
      const def = HOLIDAYS[hid];
      if (!def || def.tags.includes('system')) continue;
      const closed = def.businessesClosed === 'most' ? ' Most businesses are closed today.' : def.businessesClosed === 'some' ? ' Banks and government offices are closed.' : '';
      ctx.log({ text: `Today is ${def.name}. ${def.description}${closed}`, kind: 'event', simId: sim.id, importance: 2 });
    }
    if (day.holidays.includes('daylight_saving_start')) ctx.log({ text: 'Clocks sprang forward overnight. You lost an hour of sleep.', kind: 'system', simId: sim.id, importance: 1 });
    if (day.holidays.includes('daylight_saving_end')) ctx.log({ text: 'Clocks fell back overnight. An extra hour, and it will be dark by dinner.', kind: 'system', simId: sim.id, importance: 1 });
    if (sim.identity.birthDate.slice(5) === md) ctx.log({ text: `It's your birthday. You are ${ctx.query.ageOf(sim)} today.`, kind: 'event', simId: sim.id, importance: 3 });
    for (const otherId of Object.keys(sim.relationships)) {
      const other = ctx.state.sims[otherId as Sim['id']];
      if (!other || !other.body.alive || other.identity.birthDate.slice(5) !== md) continue;
      const rel = sim.relationships[other.id];
      if (rel.familiarity < 20 && !rel.flags.some((f) => ['parent', 'child', 'sibling', 'partner', 'married', 'dating', 'friend', 'good_friend', 'best_friend'].includes(f))) continue;
      ctx.log({ text: `It's ${other.identity.firstName} ${other.identity.lastName}'s birthday today (${ctx.query.ageOf(other)}).`, kind: 'event', simId: sim.id, importance: 1 });
    }
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
export const calendarSystem: System = {
  id: 'calendar',
  intervalMinutes: 60,

  onInit(ctx) {
    applyDayState(ctx, false);
  },

  onTick(ctx) {
    if (ctx.clock.hour === 7) morningNarration(ctx);
    // safety: keep day-state flags in sync even if a day event was missed (e.g. load mid-day)
    if (ctx.state.flags.holidayToday === undefined) applyDayState(ctx, false);
  },

  onEvent(ctx, e) {
    switch (e.type) {
      case 'world:new_game': {
        applyDayState(ctx, false);
        const d = ctx.clock.day;
        scheduleFestivalsForMonth(ctx, d.year, d.month);
        for (const s of ctx.query.controlledSims()) {
          for (const hid of d.holidays) {
            const def = HOLIDAYS[hid];
            if (def && !def.tags.includes('system')) ctx.log({ text: `Today is ${def.name}. ${def.description}`, kind: 'event', simId: s.id, importance: 2 });
          }
        }
        break;
      }
      case 'world:loaded':
        applyDayState(ctx, false);
        break;
      case 'time:day':
        applyDayState(ctx, true);
        break;
      case 'time:month':
        scheduleFestivalsForMonth(ctx, e.year, e.month);
        break;
      case 'scheduled:fired': {
        const ev = e.event;
        if (ev.kind === 'festival' && ev.payload?.festivalId && ev.venueId) {
          activateFestival(ctx, String(ev.payload.festivalId), ev.venueId, Number(ev.payload.endMinute ?? ctx.state.time.minute + DAY));
        } else if (ev.kind === '_festival_end' && ev.payload?.festivalId) {
          deactivateFestival(ctx, String(ev.payload.festivalId));
        }
        break;
      }
      case 'action:completed': {
        if (e.actionId.startsWith('festival:')) {
          const fid = e.actionId.split(':')[1];
          const def = FESTIVALS[fid];
          if (def) ctx.emit({ type: 'entertainment:watched', simId: e.simId, title: def.name, kind: 'festival' });
        }
        break;
      }
      default:
        break;
    }
  },

  actions(ctx, simId) {
    const sim = ctx.query.simMaybe(simId);
    if (!sim) return [];
    const venue = ctx.query.venueMaybe(sim.location.venueId);
    if (!venue) return [];
    const home = ctx.query.homeOf(simId);
    return [...holidayActions(ctx, sim, venue, home), ...festivalActions(ctx, sim, venue)];
  },

  handles(actionId) {
    return actionId.startsWith('holiday:') || actionId.startsWith('festival:');
  },

  execute(ctx, simId, action) {
    const sim = ctx.query.sim(simId);
    const controlled = ctx.query.isControlled(simId);
    const who = controlled ? 'You' : sim.identity.firstName;
    const [kind, id] = action.id.split(':');
    const name = kind === 'holiday' ? HOLIDAYS[id]?.name : FESTIVALS[id]?.name;
    const text = `${who} ${controlled ? 'spend' : 'spends'} ${action.durationMinutes >= 120 ? 'a few hours' : 'a while'} on "${action.label}"${name ? ` for ${name}` : ''}.`;
    if (kind === 'festival') ctx.state.stats.placesVisited += 0; // no-op: keeps stats shape explicit
    return { ok: true, text };
  },
};

/** Exported for tests & UI: today's holidays with defs. */
export function todaysHolidays(ctx: SystemContext): HolidayDef[] {
  return ctx.clock.day.holidays.map((h) => HOLIDAYS[h]).filter((d): d is HolidayDef => !!d);
}
