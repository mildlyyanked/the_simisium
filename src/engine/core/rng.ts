/**
 * Seeded PRNG (xoshiro128**) so every world is reproducible from its seed.
 * State is 4 uint32 numbers, serialized into WorldState.rngState.
 */
export class RNG {
  private s: [number, number, number, number];

  constructor(seed: string | number[] ) {
    if (Array.isArray(seed)) {
      this.s = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
    } else {
      // splitmix32 to expand the string hash into 4 words
      let h = RNG.hashString(seed) >>> 0;
      const next = () => {
        h = (h + 0x9e3779b9) >>> 0;
        let z = h;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
        return (z ^ (z >>> 16)) >>> 0;
      };
      this.s = [next(), next(), next(), next()];
      if (this.s.every((x) => x === 0)) this.s[0] = 1;
    }
  }

  static hashString(str: string): number {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  getState(): number[] {
    return [...this.s];
  }

  setState(state: number[]): void {
    this.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0];
  }

  /** uint32 */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(RNG.rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = RNG.rotl(s[3], 11);
    return result;
  }

  private static rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  /** [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** [min, max) float */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] integer inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('RNG.pick on empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  pickN<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    const out: T[] = [];
    while (out.length < n && copy.length > 0) {
      const i = Math.floor(this.next() * copy.length);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  weighted<T>(items: readonly { weight: number; value: T }[]): T {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    if (total <= 0) return items[0].value;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, it.weight);
      if (r <= 0) return it.value;
    }
    return items[items.length - 1].value;
  }

  /** approx normal via Box–Muller */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** clamped normal */
  normalClamped(mean: number, sd: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.normal(mean, sd)));
  }

  /** derive an independent child RNG (for content generation that shouldn't perturb the world stream) */
  fork(label: string): RNG {
    return new RNG(`${label}:${this.nextU32()}`);
  }

  uuidLike(): string {
    const a = this.nextU32().toString(36);
    const b = this.nextU32().toString(36);
    return (a + b).slice(0, 12).padEnd(12, '0');
  }
}
