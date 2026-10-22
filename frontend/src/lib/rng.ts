export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private r: () => number;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  next(): number {
    return this.r();
  }
  int(min: number, max: number): number {
    return Math.floor(this.r() * (max - min + 1)) + min;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.r() * list.length)];
  }
  weight<T>(entries: readonly [T, number][]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let roll = this.r() * total;
    for (const [value, w] of entries) {
      roll -= w;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }
  chance(p: number): boolean {
    return this.r() < p;
  }
  shuffle<T>(list: T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  sample<T>(list: readonly T[], n: number): T[] {
    return this.shuffle([...list]).slice(0, n);
  }
}
