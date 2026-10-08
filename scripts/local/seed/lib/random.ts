// Deterministic randomness for the LOCAL seeder. Ported from the deleted
// test-environment seeder (`git show 56d00da9^:lib/sis/seeder/random.ts`).
//
// Every phase draws from its own stream, keyed on a string, so adding a draw
// in one phase never shifts the data another phase produces.

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

/** FNV-1a. Stable across runs and platforms. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Rng = {
  /** [0, 1) */
  next: () => number;
  /** Integer in [min, max], both inclusive. */
  int: (min: number, max: number) => number;
  /** True with probability p. */
  chance: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
};

/** A seeded stream. Same key → same sequence, every run. */
export function rng(key: string): Rng {
  const next = mulberry32(hashString(key));
  const self: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[Math.floor(next() * items.length)];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return self;
}

/**
 * A stable v4-shaped UUID derived from a key. Lets the seeder give rows (and
 * auth users) the same id on every rebuild, so two runs are comparable row
 * for row and a bookmarked local URL keeps working.
 */
export function uuidFrom(key: string): string {
  const r = mulberry32(hashString(`uuid:${key}`));
  const bytes = Array.from({ length: 16 }, () => Math.floor(r() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
