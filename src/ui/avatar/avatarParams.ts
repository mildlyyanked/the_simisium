/**
 * Avatar parameter helpers (UI-side; the engine's factories own the canonical defaults).
 */
import type { AvatarParams, Gender } from '@engine/core/types';

export const SKIN_TONES = ['#F6D5B8', '#EFC3A0', '#D9A579', '#C68B59', '#A46B3C', '#7A4A24', '#5A3419'];
export const HAIR_COLORS = ['#1E1B18', '#3B2A20', '#6A4A2F', '#A5713C', '#D9B26A', '#B8B8B8', '#7F2F22', '#E0D7C6', '#3B5BDB', '#C2255C'];
export const EYE_COLORS = ['#3A2A1D', '#5B3E2B', '#2E5C8A', '#3F7A4E', '#7A7A7A', '#6C4B2B'];
export const CLOTHING_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#64748B', '#0EA5E9', '#F97316', '#F5B84A', '#1F2937'];

export const HAIR_STYLE_NAMES = ['Crop', 'Side part', 'Curls', 'Long', 'Bob', 'Bun', 'Afro', 'Ponytail'];
export const FACE_SHAPE_NAMES = ['Round', 'Oval', 'Square', 'Heart'];
export const ACCESSORY_NAMES = ['None', 'Earrings', 'Headband', 'Beanie', 'Necklace'];
export const FACIAL_HAIR_NAMES = ['Clean', 'Stubble', 'Mustache', 'Beard'];

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Small seeded PRNG (mulberry32) so avatars can be randomized deterministically in the UI. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomAvatar(gender: Gender = 'nonbinary', seed?: number): AvatarParams {
  const r = seed !== undefined ? seededRandom(seed) : Math.random;
  return {
    skin: pick(SKIN_TONES, r),
    hair: pick(HAIR_COLORS.slice(0, 8), r),
    hairStyle: Math.floor(r() * 8),
    eye: pick(EYE_COLORS, r),
    faceShape: Math.floor(r() * 4),
    accessory: r() < 0.5 ? 0 : Math.floor(r() * 5),
    clothing: pick(CLOTHING_COLORS, r),
    facialHair: gender === 'male' && r() < 0.45 ? 1 + Math.floor(r() * 3) : 0,
    glasses: r() < 0.28,
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function avatarFor(seed: string, gender: Gender = 'nonbinary'): AvatarParams {
  return randomAvatar(gender, hashString(seed));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** amount in −1..1: negative darkens, positive lightens */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
