/**
 * Deterministic floor plans. A venue's rooms are packed into rows of a tile grid (walls
 * shared, every row the same height so vertical neighbours always share a wall), doors are
 * cut between neighbours so the plan is fully connected, and each object gets a tile in its
 * room, along the walls first. Seeded by venue id, so the same venue always gets the same plan.
 */
import { RNG } from '../core/rng';
import type { ObjectId, ObjectInstance, Venue, VenueLayout, LayoutRoom } from '../core/types';

export const LAYOUT_VERSION = 1;
const MAX_ROW_WIDTH = 26;

const SIZES: [RegExp, number, number][] = [
  [/bath|restroom|toilet|shower/, 4, 4],
  [/closet|pantry|utility|mail/, 4, 4],
  [/bed|dorm|cell|holding|room\b/, 6, 5],
  [/kitchen|laundry|counter|checkout|clerk|booking|intake|office|break/, 6, 5],
  [/living|dining|seating|lounge|lobby|waiting|studio|reading|patio|yard|courtyard|balcony|conference|visitation/, 8, 6],
  [/bar|deli|produce|stalls|weights|cardio|galler|classroom|lab|imaging|ward|emergency|floor|court|hall|sanctuary|auditor|concourse|stack|aisle|main|sales|grounds|trail|playground|quad|food|anchor|pool|fitness|rope|boulder|training|garage|bay|field|rink|lanes|range|track/, 10, 7],
];

function baseSize(name: string): [number, number] {
  const n = name.toLowerCase();
  for (const [re, w, h] of SIZES) if (re.test(n)) return [w, h];
  return [7, 6];
}

function sizeFor(name: string, objectCount: number): [number, number] {
  let [w, h] = baseSize(name);
  // keep at least half the interior free for walking
  let grow = 0;
  while ((w - 2) * (h - 2) < objectCount * 2 + 6) {
    if (grow % 2 === 0) w += 1;
    else h += 1;
    grow++;
    if (w > MAX_ROW_WIDTH) {
      w = MAX_ROW_WIDTH;
      h += 1;
    }
  }
  return [w, h];
}

/** True when every free interior tile of the room can reach every other one (no boxed-in corners). */
function floorConnected(r: LayoutRoom, occupied: Set<string>): boolean {
  const free: string[] = [];
  for (let ty = r.y + 1; ty <= r.y + r.h - 2; ty++) for (let tx = r.x + 1; tx <= r.x + r.w - 2; tx++) if (!occupied.has(`${tx},${ty}`)) free.push(`${tx},${ty}`);
  if (free.length <= 1) return true;
  const freeSet = new Set(free);
  const seen = new Set<string>([free[0]]);
  const stack = [free[0]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${cx + dx},${cy + dy}`;
      if (freeSet.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push(k);
      }
    }
  }
  return seen.size === free.length;
}

/** Generate (or regenerate) the layout for a venue from its rooms and the objects in them. */
export function generateLayout(venue: Venue, objects: Record<ObjectId, ObjectInstance>): VenueLayout {
  const rng = new RNG(`layout:${venue.id}:${LAYOUT_VERSION}`);
  const roomDefs = venue.rooms.length ? venue.rooms : [{ id: 'main', name: 'Main floor', objectIds: [] as ObjectId[] }];
  // objects by room (objects without a room go to the first room)
  const byRoom = new Map<string, ObjectId[]>();
  for (const r of roomDefs) byRoom.set(r.id, []);
  for (const oid of venue.objectIds) {
    const o = objects[oid];
    if (!o || o.carriedBy) continue;
    const key = o.roomId && byRoom.has(o.roomId) ? o.roomId : roomDefs[0].id;
    byRoom.get(key)!.push(oid);
  }

  // ---- pack rooms into rows; aim for a roughly square plan so small places read at a glance
  const sizes = roomDefs.map((r) => sizeFor(r.name, byRoom.get(r.id)!.length));
  const totalArea = sizes.reduce((a, [w, h]) => a + w * h, 0);
  const rowWidth = Math.max(12, Math.min(MAX_ROW_WIDTH, Math.ceil(Math.sqrt(totalArea) * 1.25)));
  const rooms: LayoutRoom[] = [];
  const rows: LayoutRoom[][] = [];
  let x = 0;
  let y = 0;
  let row: LayoutRoom[] = [];
  for (let ri = 0; ri < roomDefs.length; ri++) {
    const r = roomDefs[ri];
    const [w, h] = sizes[ri];
    if (row.length && x + w > rowWidth) {
      rows.push(row);
      const rowH = Math.max(...row.map((q) => q.h));
      for (const q of row) q.h = rowH;
      y += rowH - 1;
      x = 0;
      row = [];
    }
    const lr: LayoutRoom = { id: r.id, name: r.name, x, y, w, h };
    row.push(lr);
    rooms.push(lr);
    x += w - 1;
  }
  if (row.length) {
    rows.push(row);
    const rowH = Math.max(...row.map((q) => q.h));
    for (const q of row) q.h = rowH;
  }
  const width = Math.max(...rooms.map((r) => r.x + r.w));
  const height = Math.max(...rooms.map((r) => r.y + r.h));

  // ---- doors: horizontal neighbours share a wall column; vertical neighbours share a wall row
  const doors: { x: number; y: number }[] = [];
  const doorKey = new Set<string>();
  const addDoor = (dx: number, dy: number): void => {
    const k = `${dx},${dy}`;
    if (doorKey.has(k)) return;
    doorKey.add(k);
    doors.push({ x: dx, y: dy });
  };
  for (const r of rows) {
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1];
      const b = r[i];
      const cx = a.x + a.w - 1;
      const y0 = Math.max(a.y, b.y) + 1;
      const y1 = Math.min(a.y + a.h, b.y + b.h) - 2;
      if (y1 >= y0) addDoor(cx, y0 + Math.floor((y1 - y0) / 2));
    }
  }
  for (let ri = 1; ri < rows.length; ri++) {
    for (const b of rows[ri]) {
      let linked = false;
      for (const a of rows[ri - 1]) {
        if (a.y + a.h - 1 !== b.y) continue;
        const x0 = Math.max(a.x, b.x) + 1;
        const x1 = Math.min(a.x + a.w, b.x + b.w) - 2;
        if (x1 >= x0) {
          addDoor(x0 + Math.floor((x1 - x0) / 2), b.y);
          linked = true;
          break;
        }
      }
      if (!linked && rows[ri - 1].length) {
        // should not happen with equal row heights, but never leave a room unreachable
        const a = rows[ri - 1][0];
        addDoor(Math.min(a.x + 1, b.x + 1), b.y);
      }
    }
  }
  // entrance on the left wall of the first room
  const first = rooms[0];
  const entrance = { x: first.x, y: first.y + Math.floor(first.h / 2) };
  const entranceInside = { x: first.x + 1, y: entrance.y };
  addDoor(entrance.x, entrance.y);

  // ---- objects: along the walls first, never in front of a door
  const blocked = new Set<string>();
  for (const d of doors) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) blocked.add(`${d.x + dx},${d.y + dy}`);
  blocked.add(`${entranceInside.x},${entranceInside.y}`);
  const objPos: Record<ObjectId, { x: number; y: number }> = {};
  for (const r of rooms) {
    const ids = byRoom.get(r.id) ?? [];
    if (!ids.length) continue;
    const ring: { x: number; y: number }[] = [];
    const inner: { x: number; y: number }[] = [];
    for (let ty = r.y + 1; ty <= r.y + r.h - 2; ty++) {
      for (let tx = r.x + 1; tx <= r.x + r.w - 2; tx++) {
        if (blocked.has(`${tx},${ty}`)) continue;
        const onRing = ty === r.y + 1 || ty === r.y + r.h - 2 || tx === r.x + 1 || tx === r.x + r.w - 2;
        (onRing ? ring : inner).push({ x: tx, y: ty });
      }
    }
    const spots = [...rng.shuffle(ring), ...rng.shuffle(inner)];
    const occupied = new Set<string>();
    for (const oid of ids) {
      let placed = false;
      for (const spot of spots) {
        const k = `${spot.x},${spot.y}`;
        if (occupied.has(k)) continue;
        occupied.add(k);
        if (floorConnected(r, occupied)) {
          objPos[oid] = spot;
          placed = true;
          break;
        }
        occupied.delete(k);
      }
      if (!placed) {
        // out of good spots: share a tile rather than block the room
        const spot = spots[0];
        if (spot) objPos[oid] = spot;
      }
    }
  }

  return { venueId: venue.id, version: LAYOUT_VERSION, width, height, rooms, doors, entrance, entranceInside, objects: objPos };
}

/** Add positions for objects that appeared after the layout was made (a purchase, a delivery). */
export function placeNewObjects(layout: VenueLayout, venue: Venue, objects: Record<ObjectId, ObjectInstance>): boolean {
  const rng = new RNG(`layout:${venue.id}:${LAYOUT_VERSION}:late:${venue.objectIds.length}`);
  let changed = false;
  const taken = new Set(Object.values(layout.objects).map((p) => `${p.x},${p.y}`));
  const doorNeighbours = new Set<string>();
  for (const d of layout.doors) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) doorNeighbours.add(`${d.x + dx},${d.y + dy}`);
  for (const oid of venue.objectIds) {
    if (layout.objects[oid]) continue;
    const o = objects[oid];
    if (!o || o.carriedBy) continue;
    const room = layout.rooms.find((r) => r.id === o.roomId) ?? layout.rooms[0];
    const free: { x: number; y: number }[] = [];
    for (let ty = room.y + 1; ty <= room.y + room.h - 2; ty++) for (let tx = room.x + 1; tx <= room.x + room.w - 2; tx++) if (!taken.has(`${tx},${ty}`) && !doorNeighbours.has(`${tx},${ty}`)) free.push({ x: tx, y: ty });
    if (!free.length) continue;
    const order = rng.shuffle(free);
    const occupied = new Set([...taken].filter((k) => { const [kx, ky] = k.split(',').map(Number); return kx > room.x && kx < room.x + room.w - 1 && ky > room.y && ky < room.y + room.h - 1; }));
    const spot = order.find((t) => { const k = `${t.x},${t.y}`; occupied.add(k); const ok = floorConnected(room, occupied); if (!ok) occupied.delete(k); return ok; }) ?? order[0];
    layout.objects[oid] = spot;
    taken.add(`${spot.x},${spot.y}`);
    changed = true;
  }
  // drop positions of objects that left the venue
  for (const oid of Object.keys(layout.objects) as ObjectId[]) {
    const o = objects[oid];
    if (!o || o.venueId !== venue.id || o.carriedBy) {
      delete layout.objects[oid];
      changed = true;
    }
  }
  return changed;
}
