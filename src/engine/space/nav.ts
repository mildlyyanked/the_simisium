/**
 * Tile navigation over a VenueLayout: walkability, BFS paths, adjacent free tiles, and the
 * effective position of a sim (stored when they moved or acted; derived deterministically otherwise).
 */
import type { LayoutRoom, ObjectId, Sim, SimId, VenueLayout, WorldState } from '../core/types';

export type Tile = { x: number; y: number };
export type CellKind = 'void' | 'wall' | 'floor' | 'door' | 'object';

const gridCache = new WeakMap<VenueLayout, { key: string; grid: CellKind[][] }>();

function cacheKey(layout: VenueLayout): string {
  return `${layout.rooms.length}|${layout.doors.length}|${Object.keys(layout.objects).length}`;
}

/** 2-D grid of cell kinds, cached per layout object (recomputed when objects/doors change). */
export function gridOf(layout: VenueLayout): CellKind[][] {
  const key = cacheKey(layout);
  const hit = gridCache.get(layout);
  if (hit && hit.key === key) return hit.grid;
  const grid: CellKind[][] = Array.from({ length: layout.height }, () => Array.from({ length: layout.width }, () => 'void' as CellKind));
  for (const r of layout.rooms) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const wall = y === r.y || y === r.y + r.h - 1 || x === r.x || x === r.x + r.w - 1;
        if (wall) {
          if (grid[y][x] !== 'floor') grid[y][x] = 'wall';
        } else grid[y][x] = 'floor';
      }
    }
  }
  for (const d of layout.doors) if (grid[d.y]?.[d.x] !== undefined) grid[d.y][d.x] = 'door';
  for (const p of Object.values(layout.objects)) if (grid[p.y]?.[p.x] === 'floor') grid[p.y][p.x] = 'object';
  gridCache.set(layout, { key, grid });
  return grid;
}

export function cellAt(layout: VenueLayout, x: number, y: number): CellKind {
  return gridOf(layout)[y]?.[x] ?? 'void';
}

export function isWalkable(layout: VenueLayout, x: number, y: number): boolean {
  const c = cellAt(layout, x, y);
  return c === 'floor' || c === 'door';
}

export function roomAt(layout: VenueLayout, x: number, y: number): LayoutRoom | undefined {
  // interior first, then a room whose wall/door this is
  for (const r of layout.rooms) if (x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1) return r;
  for (const r of layout.rooms) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  return undefined;
}

export function objectAt(layout: VenueLayout, x: number, y: number): ObjectId | undefined {
  for (const [id, p] of Object.entries(layout.objects)) if (p.x === x && p.y === y) return id as ObjectId;
  return undefined;
}

const DIRS: Tile[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

/** Walkable tiles next to (x, y), in a stable order (below, right, left, above). */
export function adjacentFree(layout: VenueLayout, x: number, y: number): Tile[] {
  const out: Tile[] = [];
  for (const d of DIRS) if (isWalkable(layout, x + d.x, y + d.y)) out.push({ x: x + d.x, y: y + d.y });
  return out;
}

/** Shortest walking path (4-neighbour BFS); the result excludes the start tile. */
export function findPath(layout: VenueLayout, from: Tile, to: Tile): Tile[] | undefined {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isWalkable(layout, to.x, to.y)) return undefined;
  const w = layout.width;
  const h = layout.height;
  const prev = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const idx = (t: Tile) => t.y * w + t.x;
  const queue: Tile[] = [from];
  seen[idx(from)] = 1;
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (const d of DIRS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const i = ny * w + nx;
      if (seen[i] || !isWalkable(layout, nx, ny)) continue;
      seen[i] = 1;
      prev[i] = idx(cur);
      if (nx === to.x && ny === to.y) {
        const path: Tile[] = [];
        let c = i;
        while (c !== idx(from)) {
          path.push({ x: c % w, y: Math.floor(c / w) });
          c = prev[c];
        }
        return path.reverse();
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return undefined;
}

/** Nearest walkable tile to (x, y) (for taps on walls or objects). */
export function nearestWalkable(layout: VenueLayout, x: number, y: number, maxRadius = 3): Tile | undefined {
  if (isWalkable(layout, x, y)) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(layout, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return undefined;
}

export function floorTilesOf(layout: VenueLayout, room: LayoutRoom): Tile[] {
  const out: Tile[] = [];
  for (let y = room.y + 1; y <= room.y + room.h - 2; y++) for (let x = room.x + 1; x <= room.x + room.w - 2; x++) if (cellAt(layout, x, y) === 'floor') out.push({ x, y });
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Where a sim stands right now. Stored positions win; a sim using an object stands next to it;
 * controlled sims otherwise wait just inside the entrance; NPCs get a stable idle spot in a room
 * (their remembered room if any), so the same person is in the same corner every time you look.
 */
export function positionOf(state: WorldState, layout: VenueLayout, sim: Sim): Tile & { roomId?: string } {
  const p = sim.location.pos;
  if (p && sim.location.venueId === layout.venueId && (isWalkable(layout, p.x, p.y) || cellAt(layout, p.x, p.y) === 'object')) return { ...p, roomId: roomAt(layout, p.x, p.y)?.id };
  const targetId = sim.currentAction?.targetId as ObjectId | undefined;
  if (targetId && layout.objects[targetId]) {
    const o = layout.objects[targetId];
    const adj = adjacentFree(layout, o.x, o.y)[0];
    if (adj) return { ...adj, roomId: roomAt(layout, adj.x, adj.y)?.id };
    return { ...o, roomId: roomAt(layout, o.x, o.y)?.id };
  }
  if (state.player.controlledSimIds.includes(sim.id)) {
    const e = layout.entranceInside;
    return { ...e, roomId: roomAt(layout, e.x, e.y)?.id };
  }
  const h = hash(`${sim.id}:${layout.venueId}`);
  const room = layout.rooms.find((r) => r.id === sim.location.roomId) ?? layout.rooms[h % layout.rooms.length];
  const tiles = floorTilesOf(layout, room);
  if (!tiles.length) return { ...layout.entranceInside, roomId: room.id };
  const t = tiles[(h >>> 8) % tiles.length];
  return { ...t, roomId: room.id };
}

export function simsInRoom(state: WorldState, layout: VenueLayout, roomId: string, exclude?: SimId): Sim[] {
  return Object.values(state.sims).filter((s) => s.id !== exclude && s.body.alive && !s.travel && s.location.venueId === layout.venueId && positionOf(state, layout, s).roomId === roomId);
}

/** Minutes a walk of `tiles` steps takes indoors (a few seconds per tile; short hops are free). */
export function walkMinutes(tiles: number): number {
  return tiles <= 3 ? 0 : Math.ceil(tiles / 20);
}
