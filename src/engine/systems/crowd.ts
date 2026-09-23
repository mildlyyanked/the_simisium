/**
 * Crowds: the people a place is full of who are not simulated one by one. A nightclub at midnight
 * on a Saturday holds a couple of hundred people; three of them may be real sims. The rest are an
 * ambient count derived from the archetype's crowd curve, the weekday, the weather and whether the
 * place is open, jittered per venue and day so two clubs on the same night differ. The Here tab
 * draws them as anonymous figures on the floor plan; picking one out turns them into a real person.
 */
import type { ContentCatalog } from '../content/types';
import { hourOf, minuteOfDay, weekdayAt } from '../core/clock';
import { makeQuery } from '../core/query';
import { RNG } from '../core/rng';
import type { LayoutRoom, Venue, VenueArchetype, VenueId, VenueLayout, WorldState } from '../core/types';
import { DAY } from '../core/util';
import { floorTilesOf, objectAt, type Tile } from '../space/nav';

export interface Crowd {
  /** ambient headcount, never below the real sims present */
  count: number;
  /** 0..1 */
  level: number;
  label: 'nearly empty' | 'quiet' | 'moderately busy' | 'busy' | 'packed';
}

export function crowdLabel(level: number): Crowd['label'] {
  if (level < 0.15) return 'nearly empty';
  if (level < 0.4) return 'quiet';
  if (level < 0.7) return 'moderately busy';
  if (level < 0.9) return 'busy';
  return 'packed';
}

const WET = /rain|storm|snow|sleet|hail|thunder/;
/** back-of-house and private rooms the crowd mostly stays out of */
const QUIET_ROOM = /rest|toilet|bath|office|back|kitchen|staff|storage|stock|closet|private|booth|cell|ward|lab/;
const HALF_ROOM = /vip|patio|balcony|yard|hall|lobby/;

/** How full a venue is right now, and roughly how many people that is. */
export function crowdAt(state: WorldState, content: ContentCatalog, venueId: VenueId, minute = state.time.minute): Crowd {
  const venue = state.venues[venueId];
  const real = Object.values(state.sims).filter((s) => s.body.alive && s.location.venueId === venueId && !s.travel && !state.player.controlledSimIds.includes(s.id)).length;
  if (!venue || venue.archetype === 'home' || venue.archetype === 'apartment_building') return { count: real, level: 0, label: 'nearly empty' };
  const arch = content.archetypes[venue.archetype];
  const curve = arch?.crowdByHour;
  const mod = minuteOfDay(minute);
  const h = hourOf(minute);
  const f = (mod % 60) / 60;
  let level = curve ? curve[h] * (1 - f) + curve[(h + 1) % 24] * f : 0.3;
  const query = makeQuery(state, content);
  const alwaysOpen = venue.archetype === 'park' || venue.archetype === 'transit_stop';
  if (!alwaysOpen && !query.isVenueOpen(venueId, minute)) level *= 0.03;
  const wd = weekdayAt(state.epoch, minute);
  const tags = arch?.tags ?? [];
  const evening = h >= 18 || h < 4;
  if (tags.includes('nightlife')) level *= wd === 5 || wd === 6 ? 1.2 : wd === 4 ? 1 : 0.6;
  else if (evening && (tags.includes('social') || tags.includes('food') || tags.includes('alcohol'))) level *= wd === 5 || wd === 6 ? 1.15 : 0.9;
  else if (!evening && (wd === 0 || wd === 6) && (tags.includes('shop') || tags.includes('outdoor') || tags.includes('leisure'))) level *= 1.15;
  const cond = String(state.weather.current.condition ?? '');
  if (WET.test(cond) && (tags.includes('outdoor') || venue.archetype === 'park')) level *= 0.4;
  const day = Math.floor(minute / DAY);
  const jitter = new RNG(`crowd:${venueId}:${day}`).range(0.85, 1.15);
  level = Math.max(0, Math.min(1, level * jitter));
  const capacity = venue.capacity || arch?.capacity || 40;
  const count = Math.max(real, Math.round(capacity * level));
  return { count, level: count > real ? level : Math.min(level, real / Math.max(1, capacity)), label: crowdLabel(count > real ? level : real / Math.max(1, capacity)) };
}

export interface Extra extends Tile {
  /** stable per-figure variety (hue, glyph) */
  seed: number;
  roomId: string;
}

/**
 * Where the anonymous crowd stands on the floor plan: seeded per venue and half hour so the figures
 * shuffle slowly, kept mostly out of back rooms, never on objects or the real people's tiles.
 */
export function extrasAt(layout: VenueLayout, crowd: Crowd, occupied: Tile[], minute: number, maxExtras = 48): Extra[] {
  const taken = new Set(occupied.map((t) => `${t.x},${t.y}`));
  const rooms: { room: LayoutRoom; tiles: Tile[]; weight: number }[] = layout.rooms.map((room) => {
    const n = room.name.toLowerCase();
    const weight = QUIET_ROOM.test(n) ? 0.08 : HALF_ROOM.test(n) ? 0.45 : 1;
    const tiles = floorTilesOf(layout, room).filter((t) => !objectAt(layout, t.x, t.y) && !taken.has(`${t.x},${t.y}`));
    return { room, tiles, weight };
  });
  const floor = rooms.reduce((s, r) => s + r.tiles.length, 0);
  const wanted = Math.min(maxExtras, Math.floor(floor * 0.45), Math.max(0, crowd.count - occupied.length));
  if (wanted <= 0) return [];
  const rng = new RNG(`extras:${layout.venueId}:${Math.floor(minute / 30)}`);
  const scored: { tile: Tile; roomId: string; score: number; seed: number }[] = [];
  for (const r of rooms) for (const tile of r.tiles) scored.push({ tile, roomId: r.room.id, score: rng.next() * r.weight, seed: rng.int(0, 1_000_000) });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, wanted).map((s) => ({ x: s.tile.x, y: s.tile.y, seed: s.seed, roomId: s.roomId }));
}

/** Who you would bump into at this kind of place. */
export function strangerAgeRange(archetype: VenueArchetype, arch?: { tags?: string[] }): [number, number] {
  const tags = arch?.tags ?? [];
  if (archetype === 'nightclub') return [21, 36];
  if (archetype === 'bar' || tags.includes('alcohol')) return [21, 58];
  if (archetype === 'college' || archetype === 'library') return [18, 40];
  if (archetype === 'gym') return [18, 55];
  if (archetype === 'park' || archetype === 'playground') return [19, 70];
  return [19, 68];
}

/** "on the dance floor", "in the kitchen" */
export function whereLabel(room: { name: string } | undefined, venue?: Venue): string {
  if (!room) return venue ? `at ${venue.name}` : 'somewhere inside';
  const n = room.name.toLowerCase();
  const on = /floor|patio|yard|roof|deck|terrace|court|field|track|range|lanes|grounds|trail|balcony|beach|pier|bridge|platform|stage|rink/.test(n);
  return `${on ? 'on' : 'in'} the ${n}`;
}
