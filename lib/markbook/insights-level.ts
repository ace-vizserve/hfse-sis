/**
 * Pure helpers for the Markbook Insights "level breakdown" layer.
 *
 * Adds three diagnostic views on top of the existing school-wide subject
 * trend (getSubjectPerformanceTrend in compare.ts):
 *
 *  1. Per-(subject × level × term) average — locates weakness (curriculum-
 *     wide problem vs one-class problem).
 *  2. Term-over-term Δ per (subject × level) — "is it getting worse?"
 *  3. Per-subject failing-tail % — what share of entries landed in the two
 *     lowest bands (DNM < 75, FS 75–79) in the latest recorded term.
 *
 * No server-only imports — safe to import from client components + unit tests.
 */

import { GRADE_BANDS } from './dashboard';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single data point: one subject × one level × one term. */
export type SubjectLevelTrendPoint = {
  periodLabel: string; // "T1" | "T2" | "T3" | "T4"
  ayCode: string;
  termId: string;
  subjectName: string;
  /** Level code e.g. "P1", "S3" */
  levelCode: string;
  /** Average quarterly grade (1dp), null when no entries. */
  avgGrade: number | null;
  /** Number of grade entries used to compute this average (for confidence). */
  entryCount: number;
};

/** The slope descriptor for a (subject × level) pair across available terms. */
export type SubjectLevelDelta = {
  subjectName: string;
  levelCode: string;
  /** Average in the earliest term that has data. */
  firstAvg: number;
  /** Average in the latest term that has data. */
  lastAvg: number;
  /** lastAvg − firstAvg, signed (positive = improving). */
  delta: number;
  /** Number of distinct terms with data for this pair. */
  termCount: number;
  /** The period label of the earliest data point. */
  fromPeriod: string;
  /** The period label of the latest data point. */
  toPeriod: string;
};

/** Per-subject failing-tail entry for the latest term. */
export type SubjectFailingTail = {
  subjectName: string;
  /** Count of entries in DNM (< 75) + FS (75–79). */
  failingCount: number;
  /** Total entries in the latest term for this subject. */
  totalCount: number;
  /** failingCount / totalCount * 100, rounded to 1dp. */
  failingPct: number;
  /** The period label these counts are taken from. */
  periodLabel: string;
};

// ── Raw aggregation input (server-produced, client-consumed) ──────────────────

/**
 * Raw entry row shape as produced by the server loader
 * `loadSubjectLevelTrendUncached`. Carries the pre-aggregated sums so the
 * client-side pure functions can derive averages + deltas without DB access.
 */
export type SubjectLevelRawPoint = {
  periodLabel: string;
  ayCode: string;
  termId: string;
  subjectName: string;
  levelCode: string;
  sum: number;
  count: number;
  /** Count of entries in the two failing bands (DNM + FS). */
  failingCount: number;
};

// ── buildSubjectLevelPoints ───────────────────────────────────────────────────

/**
 * Convert raw aggregation points (sum/count per subject×level×term) into
 * typed `SubjectLevelTrendPoint`s with computed averages.
 *
 * Examinable-only and is_na exclusion are enforced at the server level (loader);
 * this function is a pure transform that trusts the input is already filtered.
 *
 * @param raw   Pre-aggregated points from the server loader.
 * @returns     Typed trend points with 1dp avgGrade.
 */
export function buildSubjectLevelPoints(
  raw: SubjectLevelRawPoint[]
): SubjectLevelTrendPoint[] {
  return raw.map((r) => ({
    periodLabel: r.periodLabel,
    ayCode: r.ayCode,
    termId: r.termId,
    subjectName: r.subjectName,
    levelCode: r.levelCode,
    avgGrade: r.count > 0 ? Math.round((r.sum / r.count) * 10) / 10 : null,
    entryCount: r.count,
  }));
}

// ── computeTermDelta ──────────────────────────────────────────────────────────

/** Canonical term ordering ("T1" < "T2" < …). */
function periodOrder(p: string): number {
  const n = parseInt(p.replace(/\D/g, ''), 10);
  return Number.isNaN(n) ? 999 : n;
}

/**
 * Compute term-over-term deltas for each unique (subject × level) pair.
 *
 * For each pair, takes the **earliest** and **latest** term that have a non-null
 * average and computes `latestAvg − earliestAvg`. Only pairs with ≥ 2 data
 * points are included (a single term has no delta).
 *
 * Results are sorted by `delta` ascending so the biggest regression appears first
 * — the primary diagnostic use-case.
 *
 * @param points   Subject-level trend points (primary AY only recommended).
 */
export function computeTermDelta(
  points: SubjectLevelTrendPoint[]
): SubjectLevelDelta[] {
  // Group by (subjectName, levelCode).
  const groups = new Map<
    string,
    { subjectName: string; levelCode: string; pts: SubjectLevelTrendPoint[] }
  >();

  for (const pt of points) {
    if (pt.avgGrade === null) continue;
    const key = `${pt.subjectName}\x00${pt.levelCode}`;
    const g = groups.get(key) ?? {
      subjectName: pt.subjectName,
      levelCode: pt.levelCode,
      pts: [],
    };
    g.pts.push(pt);
    groups.set(key, g);
  }

  const results: SubjectLevelDelta[] = [];
  for (const { subjectName, levelCode, pts } of groups.values()) {
    // Filter to non-null averages (already checked above, belt-and-suspenders).
    const valid = pts.filter((p) => p.avgGrade !== null);
    if (valid.length < 2) continue;

    // Sort by period order.
    const sorted = [...valid].sort(
      (a, b) => periodOrder(a.periodLabel) - periodOrder(b.periodLabel)
    );

    const firstPt = sorted[0];
    const lastPt = sorted[sorted.length - 1];
    const firstAvg = firstPt.avgGrade!;
    const lastAvg = lastPt.avgGrade!;
    const delta = Math.round((lastAvg - firstAvg) * 10) / 10;

    results.push({
      subjectName,
      levelCode,
      firstAvg,
      lastAvg,
      delta,
      termCount: sorted.length,
      fromPeriod: firstPt.periodLabel,
      toPeriod: lastPt.periodLabel,
    });
  }

  // Sort by delta ascending: biggest regression first.
  return results.sort((a, b) => a.delta - b.delta);
}

// ── computeFailingTailBySubject ───────────────────────────────────────────────

/** Keys for the two failing bands. */
const FAILING_BAND_KEYS = new Set(
  GRADE_BANDS.filter((b) => b.lo < 80).map((b) => b.key)
);

/**
 * Compute the per-subject failing-tail percentage for the latest term that
 * has data (primary AY only).
 *
 * Uses the `failingCount` and `count` fields from the raw aggregation points.
 * Subjects are ranked by `failingPct` descending so the worst-tail subject
 * appears first.
 *
 * @param rawPoints   Pre-aggregated points from the server loader (primary AY).
 * @param periods     All known period labels in order (e.g. ["T1","T2","T3","T4"]).
 * @returns           Per-subject tails, sorted worst first, for the latest term.
 */
export function computeFailingTailBySubject(
  rawPoints: SubjectLevelRawPoint[],
  periods: string[]
): SubjectFailingTail[] {
  if (rawPoints.length === 0 || periods.length === 0) return [];

  // Find the latest period that has any data.
  const periodsWithData = new Set(
    rawPoints.filter((r) => r.count > 0).map((r) => r.periodLabel)
  );
  const latestPeriod = [...periods]
    .reverse()
    .find((p) => periodsWithData.has(p));
  if (!latestPeriod) return [];

  // Aggregate across levels for the latest period (school-wide per subject).
  const bySubject = new Map<
    string,
    { totalCount: number; failingCount: number }
  >();
  for (const r of rawPoints) {
    if (r.periodLabel !== latestPeriod) continue;
    const entry = bySubject.get(r.subjectName) ?? {
      totalCount: 0,
      failingCount: 0,
    };
    entry.totalCount += r.count;
    entry.failingCount += r.failingCount;
    bySubject.set(r.subjectName, entry);
  }

  const results: SubjectFailingTail[] = [];
  for (const [subjectName, { totalCount, failingCount }] of bySubject) {
    if (totalCount === 0) continue;
    results.push({
      subjectName,
      failingCount,
      totalCount,
      failingPct: Math.round((failingCount / totalCount) * 1000) / 10, // 1dp
      periodLabel: latestPeriod,
    });
  }

  // Sort by failingPct descending: worst tail first.
  return results.sort((a, b) => b.failingPct - a.failingPct);
}

// ── getWatchRowsByLevel ───────────────────────────────────────────────────────

/**
 * Build the "Subjects to watch" rows with level breakdown.
 *
 * For each level, find the lowest-averaging subject in the latest period.
 * Returns rows sorted by avgGrade ascending within each level.
 *
 * @param points      Subject-level trend points (primary AY).
 * @param periods     All known periods in order.
 * @param maxPerLevel Max rows per level to return (default 3).
 */
export function getWatchRowsByLevel(
  points: SubjectLevelTrendPoint[],
  periods: string[],
  maxPerLevel = 3
): SubjectLevelTrendPoint[] {
  if (points.length === 0 || periods.length === 0) return [];

  // Latest period with any data.
  const periodsWithData = new Set(
    points.filter((p) => p.avgGrade !== null).map((p) => p.periodLabel)
  );
  const latestPeriod = [...periods]
    .reverse()
    .find((p) => periodsWithData.has(p));
  if (!latestPeriod) return [];

  // Group by level.
  const byLevel = new Map<string, SubjectLevelTrendPoint[]>();
  for (const pt of points) {
    if (pt.periodLabel !== latestPeriod || pt.avgGrade === null) continue;
    const rows = byLevel.get(pt.levelCode) ?? [];
    rows.push(pt);
    byLevel.set(pt.levelCode, rows);
  }

  // Sort levels naturally (P1..P6, S1..S4).
  const sortedLevels = [...byLevel.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  const result: SubjectLevelTrendPoint[] = [];
  for (const level of sortedLevels) {
    const rows = byLevel.get(level)!;
    const sorted = [...rows].sort(
      (a, b) => (a.avgGrade ?? 0) - (b.avgGrade ?? 0)
    );
    result.push(...sorted.slice(0, maxPerLevel));
  }
  return result;
}

// ── Re-export FAILING_BAND_KEYS for tests ────────────────────────────────────
export { FAILING_BAND_KEYS };
