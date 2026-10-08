import type { Rng } from './random';

/**
 * A categorical distribution as production has it: value → weight. Weights
 * are raw counts or percentages, they need not sum to anything. Production's
 * mess (spelling variants, `null`, junk values) goes in as ordinary entries.
 *
 *   const nationality = pickFrom(r, [['Filipino', 412], ['filipino', 9], [null, 31]]);
 */
export type Distribution<T> = ReadonlyArray<readonly [T, number]>;

export function pickFrom<T>(r: Rng, dist: Distribution<T>): T {
  let total = 0;
  for (const [, w] of dist) {
    if (w < 0) throw new Error('pickFrom: negative weight');
    total += w;
  }
  if (total <= 0) throw new Error('pickFrom: distribution has no weight');
  let roll = r.next() * total;
  for (const [value, w] of dist) {
    roll -= w;
    if (roll < 0) return value;
  }
  return dist[dist.length - 1][0];
}

/**
 * Exact quotas rather than independent draws: `n` items split as close to
 * the weights as integers allow, then shuffled. Use when the COUNT matters
 * (e.g. exactly 18 withdrawn out of 240) rather than just the rate.
 */
export function allocate<T>(r: Rng, dist: Distribution<T>, n: number): T[] {
  const total = dist.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) throw new Error('allocate: distribution has no weight');
  const raw = dist.map(([v, w]) => ({ v, exact: (w / total) * n }));
  const out: T[] = [];
  for (const x of raw) {
    for (let i = 0; i < Math.floor(x.exact); i++) out.push(x.v);
  }
  // Hand the remainder to the largest fractional parts, ties by order.
  const rest = [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; out.length < n; i++) out.push(rest[i % rest.length].v);
  return r.shuffle(out);
}
