/** Seeded PRNG (mulberry32). Deterministic across platforms for a given seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mixes several integers into one 32-bit seed so sub-generators do not correlate. */
export function mixSeed(...parts: readonly number[]): number {
  return parts.reduce((acc, part) => {
    const h = Math.imul(acc ^ (part >>> 0), 0x9e3779b1) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }, 0x811c9dc5);
}

export interface Rng {
  readonly next: () => number;
  /** Integer in [min, max] inclusive. */
  readonly int: (min: number, max: number) => number;
  readonly pick: <T>(items: readonly T[]) => T;
  readonly hex: (length: number) => string;
  readonly chance: (probability: number) => boolean;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error("createRng.pick: cannot pick from an empty list");
    }
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("createRng.pick: index out of range");
    }
    return item;
  };
  const hex = (length: number): string =>
    Array.from({ length }, () => "0123456789abcdef"[int(0, 15)]).join("");
  const chance = (probability: number): boolean => next() < probability;
  return { next, int, pick, hex, chance };
}
