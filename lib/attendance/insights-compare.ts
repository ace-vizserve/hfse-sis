import 'server-only';

/**
 * Pure helpers for the Attendance Insights page comparison logic.
 *
 * Extracted so the hero badge and Section-1 card use the identical signal,
 * and the decision is independently unit-testable. Pure helpers like
 * `rateBadge` and `shapeRateTrendPoints` have no server-only imports and are
 * unit-tested directly.
 */

import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  kpisFor,
  loadDailyRows,
  sliceDailyRows,
} from '@/lib/attendance/dashboard';
import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';

export type BadgeTone = 'muted' | 'mint' | 'amber';

export interface RateBadge {
  label: string;
  tone: BadgeTone;
}

/**
 * Produce the hero badge for the Attendance Insights rate comparison.
 *
 * Decision table (mirrors `comparisonCardState` + Section-1 card logic):
 *
 * - `hasRateData` is false (no comparison AY, or that AY has zero encoded
 *   days) → `{ label: 'Building history', tone: 'muted' }`
 * - `hasRateData` is true and rate >= priorRate → mint "rate% vs prior% in AY"
 * - `hasRateData` is true and rate <  priorRate → amber "rate% vs prior% in AY"
 *
 * `priorRate` MUST be non-null when `hasRateData` is true (the caller already
 * guarantees this — `priorRate` is derived from `priorKpis` which is non-null
 * exactly when `compareAy` is set, and `hasRateData` additionally requires
 * `encodedDays > 0`). If `priorRate` is null despite `hasRateData` being true
 * (defensive branch only), we fall back to the building-history badge.
 */
export function rateBadge(
  rate: number,
  priorRate: number | null,
  hasRateData: boolean,
  compareAy: string | null
): RateBadge {
  if (!hasRateData || priorRate === null || compareAy === null) {
    return { label: 'Building history', tone: 'muted' };
  }
  return {
    label: `${rate}% vs ${priorRate}% in ${compareAy}`,
    tone: rate >= priorRate ? 'mint' : 'amber',
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Per-term attendance rate trend — for the two-AY overlay chart.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pure shaping helper: given a map of AY → per-term rates (keyed by term
 * number 1–4), produce the flat `AyTrendPoint[]` array that `buildAyTrend`
 * expects. Separated so it can be unit-tested without hitting the DB.
 *
 * `ratesByAy`: Map<ayCode, Map<termNumber, attendancePct | null>>
 */
export function shapeRateTrendPoints(
  ratesByAy: Map<string, Map<number, number | null>>
): AyTrendPoint[] {
  const points: AyTrendPoint[] = [];
  for (const [ayCode, termMap] of ratesByAy) {
    for (const [termNumber, value] of termMap) {
      points.push({
        periodLabel: `T${termNumber}`,
        ayCode,
        value,
      });
    }
  }
  return points;
}

/**
 * For each AY in `ays`, load its cached daily rows and slice them per each
 * term window (T1–T4). Returns one `AyTrendPoint` per (AY × term).
 *
 * Terms with no encoded rows produce `value: null` so the chart renders a gap
 * rather than a misleading zero (recharts `connectNulls={false}`).
 *
 * Data source: `loadDailyRows(ay)` (cached per-AY, 300s TTL) sliced per term
 * windows from `getDashboardWindows(ay).term.byNumber`.
 */
export async function getAttendanceRateTrendByAy(
  ays: string[]
): Promise<AyTrendPoint[]> {
  if (ays.length === 0) return [];

  // Fan out: one loadDailyRows + one getDashboardWindows per AY in parallel.
  const results = await Promise.all(
    ays.map(async (ayCode) => {
      const [rows, windows] = await Promise.all([
        loadDailyRows(ayCode),
        getDashboardWindows(ayCode),
      ]);
      return { ayCode, rows, windows };
    })
  );

  const ratesByAy = new Map<string, Map<number, number | null>>();

  for (const { ayCode, rows, windows } of results) {
    const termMap = new Map<number, number | null>();

    for (let t = 1; t <= 4; t++) {
      const range = windows.term.byNumber[t as 1 | 2 | 3 | 4];
      if (!range) {
        // Term not configured for this AY — skip (won't produce a null point
        // so the chart doesn't show an empty T3/T4 slot for a partial AY).
        continue;
      }
      const sliced = sliceDailyRows(rows, range.from, range.to);
      const kpis = kpisFor(sliced);
      // Treat zero encoded days as null so the chart renders a gap, not 0%.
      termMap.set(t, kpis.encodedDays > 0 ? kpis.attendancePct : null);
    }

    ratesByAy.set(ayCode, termMap);
  }

  return shapeRateTrendPoints(ratesByAy);
}

// ──────────────────────────────────────────────────────────────────────────
// Per-term P/L/EX/A composition — for the stacked-bar chart.
// ──────────────────────────────────────────────────────────────────────────

export type AttendanceTermMixPoint = {
  /** Term label, e.g. 'T1'..'T4' — reuses AttritionStackedBarChart's
   *  hardcoded "level" category-axis key so no component change is needed. */
  level: string;
  Present: number;
  Late: number;
  Excused: number;
  Absent: number;
};

export type AttendanceTermCounts = {
  present: number;
  late: number;
  excused: number;
  absent: number;
  encodedDays: number;
};

/**
 * Pure shaping helper: term-number-keyed sub-counts → `AttendanceTermMixPoint[]`
 * for `AttritionStackedBarChart`. Terms with zero encoded days are skipped
 * entirely (no all-zero bar), mirroring `shapeRateTrendPoints`'s
 * null-for-empty-term treatment. Separated so it's unit-testable without
 * touching the DB — same convention as `shapeRateTrendPoints` above.
 */
export function shapeAttendanceMixPoints(
  countsByTerm: Map<number, AttendanceTermCounts>
): AttendanceTermMixPoint[] {
  const points: AttendanceTermMixPoint[] = [];
  for (const [term, c] of countsByTerm) {
    if (c.encodedDays === 0) continue;
    points.push({
      level: `T${term}`,
      Present: c.present,
      Late: c.late,
      Excused: c.excused,
      Absent: c.absent,
    });
  }
  return points;
}

/**
 * Per-term Present/Late/Excused/Absent counts for one AY, shaped for
 * `AttritionStackedBarChart`. Complements `getAttendanceRateTrendByAy` (which
 * keeps only the derived rate) — this keeps the sub-counts that loader
 * discards, from the SAME `React.cache()`-deduped `loadDailyRows(ay)` call,
 * so this adds no extra Supabase round-trip when both are used on one page
 * render.
 */
export async function getAttendanceMixByTerm(
  ay: string
): Promise<AttendanceTermMixPoint[]> {
  const [rows, windows] = await Promise.all([
    loadDailyRows(ay),
    getDashboardWindows(ay),
  ]);

  const countsByTerm = new Map<number, AttendanceTermCounts>();
  for (let t = 1; t <= 4; t++) {
    const range = windows.term.byNumber[t as 1 | 2 | 3 | 4];
    if (!range) continue;
    countsByTerm.set(t, kpisFor(sliceDailyRows(rows, range.from, range.to)));
  }
  return shapeAttendanceMixPoints(countsByTerm);
}
