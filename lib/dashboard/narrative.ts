// Pure narrative helpers for the storytelling pass. No server-only imports —
// safe to import from client components + unit tests.

export type Extreme<T> = {
  /** The item holding the extreme finite value, or null when none exists. */
  item: T | null;
  value: number | null;
  /** No item had a finite value. */
  isEmpty: boolean;
  /** The top two items share the extreme value (don't claim a single "worst"). */
  isTie: boolean;
};

/** Pick the max/min item by a numeric accessor, skipping null/NaN, with
 *  empty + tie flags so callers can fall back to neutral copy. */
export function pickExtreme<T>(
  items: T[],
  valueFn: (t: T) => number | null,
  dir: 'max' | 'min'
): Extreme<T> {
  const scored = items
    .map((item) => ({ item, value: valueFn(item) }))
    .filter(
      (s): s is { item: T; value: number } =>
        s.value !== null && Number.isFinite(s.value)
    );
  if (scored.length === 0)
    return { item: null, value: null, isEmpty: true, isTie: false };
  scored.sort((a, b) =>
    dir === 'max' ? b.value - a.value : a.value - b.value
  );
  const top = scored[0];
  const isTie = scored.length > 1 && scored[1].value === top.value;
  return { item: top.item, value: top.value, isEmpty: false, isTie };
}

/** True only when value is finite and ≥ min — gate for rendering a claim. */
export function meetsThreshold(value: number | null, min: number): boolean {
  return value !== null && Number.isFinite(value) && value >= min;
}
