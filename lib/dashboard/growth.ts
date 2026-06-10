export type Growth = {
  current: number;
  prior: number | null;
  pct: number | null;
};

/** Period-over-period growth %; null/zero prior -> null pct (avoid /0). Pure. */
export function growthDelta(current: number, prior: number | null): Growth {
  if (prior === null || prior === 0) return { current, prior, pct: null };
  return {
    current,
    prior,
    pct: Math.round(((current - prior) / prior) * 1000) / 10,
  };
}
