/**
 * Pure helpers for the Markbook Insights two-AY comparison feature.
 *
 * No server-only imports — safe to import from client components + unit tests.
 */

import type { HeroBadge } from '@/components/dashboard/dashboard-hero';

// ── topBandBadge ──────────────────────────────────────────────────────────────

/**
 * Compute the growth badge for the DashboardHero based on the share of grades
 * in the top bands (85–89 VS + 90–100 O) vs the comparison AY.
 *
 * Decision table:
 *  - compareAy === null                      → 'Building history' (muted)
 *  - compareTopBandPct === null              → 'No data for {compareAy}' (muted)
 *  - topBandPct === null                     → 'Building history' (muted)
 *  - delta >= 0                              → '▲ Npp vs {compareAy}' (mint)
 *  - delta < 0                               → '▼ |N|pp vs {compareAy}' (amber)
 *
 * `tone` is constrained to HeroBadge['tone'] which is 'default' | 'mint' | 'amber' | 'muted'.
 */
export function topBandBadge(
  topBandPct: number | null,
  compareTopBandPct: number | null,
  compareAy: string | null
): HeroBadge {
  if (compareAy === null) {
    return { label: 'Building history', tone: 'muted' };
  }
  if (compareTopBandPct === null) {
    return { label: `No data for ${compareAy}`, tone: 'muted' };
  }
  if (topBandPct === null) {
    return { label: 'Building history', tone: 'muted' };
  }
  const delta = Math.round(topBandPct - compareTopBandPct);
  if (delta >= 0) {
    return { label: `▲ ${delta}pp vs ${compareAy}`, tone: 'mint' };
  }
  return { label: `▼ ${Math.abs(delta)}pp vs ${compareAy}`, tone: 'amber' };
}

// ── buildMultiAyTrend ─────────────────────────────────────────────────────────

export type TrendPoint = {
  periodLabel: string;
  ayCode: string;
  subjectName: string;
  avgGrade: number | null;
};

export type MultiAyTrendResult = {
  data: Array<Record<string, string | number | null>>;
  series: Array<{ key: string; label: string }>;
};

/**
 * Convert flat trend points (from getSubjectPerformanceTrend) into the shape
 * MultiSeriesTrendChart expects: `data` rows keyed by period, `series` array
 * with one entry per (subject × AY) line.
 *
 * Key contract:
 *  - Each series key is namespaced `"{subjectName} · {ayCode}"` so the same
 *    subject in two AYs gets two distinct data columns (no collision).
 *  - When only one AY is present, labels are bare subject names (no AY suffix)
 *    for cleaner legends.
 *  - When two AYs are present, labels are `"{subjectName} ({ayCode})"`.
 *  - Subjects are sorted stably (alphabetical); within each subject, AYs follow
 *    the order given in the `ays` parameter (primary AY first).
 *  - Periods are the X axis; a missing (period, series) combination → null in
 *    the data row (recharts renders as a gap, connectNulls=false).
 */
export function buildMultiAyTrend(
  points: TrendPoint[],
  periods: string[],
  ays: string[]
): MultiAyTrendResult {
  const multiAy = ays.length > 1;

  // Collect the full subject set across all AYs, sorted alphabetically.
  const allSubjects = [...new Set(points.map((p) => p.subjectName))].sort();

  // Build the series array: for each subject × AY (in given order).
  const series: Array<{ key: string; label: string }> = [];
  for (const subjectName of allSubjects) {
    for (const ayCode of ays) {
      const key = `${subjectName} · ${ayCode}`;
      const label = multiAy ? `${subjectName} (${ayCode})` : subjectName;
      series.push({ key, label });
    }
  }

  // Build a lookup: (periodLabel, subjectName, ayCode) → avgGrade
  const lookup = new Map<string, number | null>();
  for (const p of points) {
    const k = `${p.periodLabel}\x00${p.subjectName}\x00${p.ayCode}`;
    lookup.set(k, p.avgGrade);
  }

  // Build the data rows, one per period.
  const data: Array<Record<string, string | number | null>> = periods.map(
    (period) => {
      const row: Record<string, string | number | null> = { x: period };
      for (const { key } of series) {
        // Reverse-engineer subjectName + ayCode from the namespaced key.
        // Key format: "{subjectName} · {ayCode}". We split on the last " · " + ayCode
        // by using the series list we built above (so no regex fragility).
        const dotIdx = key.lastIndexOf(' · ');
        const subjectName = key.slice(0, dotIdx);
        const ayCode = key.slice(dotIdx + 3);
        const lk = `${period}\x00${subjectName}\x00${ayCode}`;
        row[key] = lookup.has(lk) ? (lookup.get(lk) ?? null) : null;
      }
      return row;
    }
  );

  return { data, series };
}

// ── selectTopMovementSubjects ───────────────────────────────────────────────

/**
 * Select which subjects plot as lines on the Markbook Insights subject-
 * performance trend chart. MultiSeriesTrendChart reads cleanly with up to 5
 * distinct-hue series — beyond that, hues repeat and the chart becomes an
 * unreadable tangle — so we plot only the `limit` subjects that moved the
 * most, and note the rest in the section copy instead of hiding them silently.
 *
 * Movement = |avg at the first period with data − avg at the latest period
 * with data| for that subject (periods with a null avgGrade are skipped when
 * locating "first"/"latest"). A subject with only one period of data has
 * movement 0 — still eligible, just deprioritized against subjects that
 * actually moved.
 *
 * Ties resolve alphabetically by subject name — stable and deterministic,
 * matching buildMultiAyTrend's own subject ordering.
 */
export function selectTopMovementSubjects(
  points: TrendPoint[],
  periods: string[],
  limit = 5
): string[] {
  const subjects = [...new Set(points.map((p) => p.subjectName))];

  const withMovement = subjects.map((subjectName) => {
    const subjectPoints = points.filter((p) => p.subjectName === subjectName);

    let firstAvg: number | null = null;
    for (const period of periods) {
      const match = subjectPoints.find((p) => p.periodLabel === period);
      if (match && match.avgGrade !== null) {
        firstAvg = match.avgGrade;
        break;
      }
    }

    let lastAvg: number | null = null;
    for (let i = periods.length - 1; i >= 0; i -= 1) {
      const match = subjectPoints.find((p) => p.periodLabel === periods[i]);
      if (match && match.avgGrade !== null) {
        lastAvg = match.avgGrade;
        break;
      }
    }

    const movement =
      firstAvg !== null && lastAvg !== null ? Math.abs(lastAvg - firstAvg) : 0;
    return { subjectName, movement };
  });

  withMovement.sort((a, b) => {
    if (b.movement !== a.movement) return b.movement - a.movement;
    return a.subjectName.localeCompare(b.subjectName);
  });

  return withMovement.slice(0, limit).map((m) => m.subjectName);
}
