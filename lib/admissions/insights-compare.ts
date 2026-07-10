import 'server-only';

/**
 * Pure + async helpers for the Admissions Insights page comparison logic.
 *
 * `getIntakeTrendByAy` — returns one AyTrendPoint per (AY, month) so the
 * §2 intake chart can overlay two AYs on a shared Jan…Nov x-axis.
 *
 * Design decisions:
 *  - Month labels are the 3-letter English abbreviations ('Jan'…'Nov').
 *    HFSE AYs run Jan–Nov (KD #13); December is outside the AY window
 *    and is deliberately omitted from the periods axis.
 *  - An in-AY month with 0 applications → value 0 (real zero, not a gap).
 *    A month outside the AY (e.g. December, or months that haven't
 *    occurred yet in the current AY) → value null (chart gap via
 *    connectNulls={false}).
 *  - Relies on `created_at` from ay{YYYY}_enrolment_applications, the
 *    same column used by `getApplicationsVelocityRange`.
 *  - Uses `unstable_cache` under the same admissions-dashboard tag so
 *    any existing mutation that revalidates that tag flushes this too.
 */

import { unstable_cache } from 'next/cache';

import type { AyTrendPoint } from '@/lib/dashboard/insights-trend';
import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/** HFSE AY months in order (Jan = 0 … Nov = 10). December is excluded — it
 *  falls outside the HFSE academic year window (KD #13). */
export const AY_MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
] as const;

export type AyMonthLabel = (typeof AY_MONTH_LABELS)[number];

/**
 * The in-progress month label for the DB-current AY's intake trend — the
 * month whose count is a PARTIAL total, not yet a complete month — or `null`
 * when `isCurrent` is false (a non-current AY, historical or future-coded,
 * has no partial month; it renders exactly what is saved, KD-honesty rule).
 *
 * Mirrors `computeIntakeTrendCutoffs`'s per-AY cutoff derivation exactly:
 * the cutoff month for the DB-current AY IS the in-progress one. Used by the
 * Insights caption's honesty guard (`summariseAyTrend`'s `inProgressPeriod`
 * option) so a few days into a month isn't compared against a full
 * historical month as a fabricated decline.
 *
 * `now` is injectable for tests; defaults to the real clock.
 */
export function currentInProgressMonthLabel(
  isCurrent: boolean,
  now: Date = new Date()
): AyMonthLabel | null {
  if (!isCurrent) return null;
  const currentMonth = now.getUTCMonth(); // 0-based
  if (currentMonth > 10) return null; // December — outside the HFSE AY window
  return AY_MONTH_LABELS[currentMonth];
}

const CACHE_TTL_SECONDS = 600;

function cacheTag(ayCode: string): string {
  return `admissions-dashboard:${ayCode}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure helper (unit-testable without DB)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reshape a flat list of `{ ayCode, createdAt }` rows into `AyTrendPoint[]`.
 *
 * - Months 0–10 (Jan–Nov) are included; month 11 (December) is skipped.
 * - An in-AY month with no applications → value `0` (the month happened,
 *   just quiet).
 * - `todayMonthIndex` (0-based JS month) is used so months that haven't
 *   arrived yet in the current AY (`ayCode === currentAy`) produce `null`
 *   (chart gap) rather than a misleading `0`. Pass `10` (November) for
 *   historical AYs to include all months.
 */
export function shapeIntakeTrendPoints(
  rows: { ayCode: string; createdAt: string | null }[],
  todayMonthByAy: Map<string, number>
): AyTrendPoint[] {
  // Bucket: Map<ayCode, Map<monthIndex, count>>
  const buckets = new Map<string, Map<number, number>>();

  for (const row of rows) {
    if (!row.createdAt) continue;
    // createdAt is a UTC ISO string; slicing to 'yyyy-MM' is safe for our
    // month-index derivation (application submissions are SGT business-hours,
    // so UTC vs SGT month rarely differs).
    const monthIndex = new Date(row.createdAt).getUTCMonth(); // 0-based
    if (monthIndex > 10) continue; // Skip December (outside HFSE AY)

    if (!buckets.has(row.ayCode)) buckets.set(row.ayCode, new Map());
    const ay = buckets.get(row.ayCode)!;
    ay.set(monthIndex, (ay.get(monthIndex) ?? 0) + 1);
  }

  const points: AyTrendPoint[] = [];

  for (const [ayCode, monthCounts] of buckets) {
    const cutoff = todayMonthByAy.get(ayCode) ?? 10; // inclusive upper bound
    for (let m = 0; m <= 10; m++) {
      const label = AY_MONTH_LABELS[m];
      if (m > cutoff) {
        // Month hasn't arrived yet in this AY → gap so the line doesn't
        // flatline to zero for future months.
        points.push({ periodLabel: label, ayCode, value: null });
      } else {
        points.push({
          periodLabel: label,
          ayCode,
          value: monthCounts.get(m) ?? 0,
        });
      }
    }
  }

  return points;
}

/** One AY the intake trend is requested for, plus whether the DB flags it
 *  `is_current` (`getCurrentAcademicYear`'s `ay_code`) — the clamp fix's
 *  single source of truth for "has this AY's calendar caught up to today." */
export type AyTrendRequest = { ayCode: string; isCurrent: boolean };

/**
 * Pure: for each requested AY, compute the cutoff month index (0-based,
 * inclusive) that `shapeIntakeTrendPoints` uses to null-out months that
 * haven't happened yet.
 *
 * - `isCurrent` → clamp to `Math.min(currentMonth, 10)` (unchanged behavior
 *   for the truly-current AY — today's real calendar month, not derived
 *   from the AY code's own digits).
 * - not current → cutoff `10` (NO clamp — every saved month renders,
 *   including honest zeros). This is the fix: the old ladder compared the
 *   AY-code's numeric year against today's calendar year, so a future-coded
 *   AY holding real data (the AY9999 test environment, seeded with
 *   2026-dated rows; or any early `is_current` rollover) always fell into
 *   the "future AY" branch and every month nulled out despite full rows in
 *   the DB. Clamping is now keyed on the DB `is_current` flag alone.
 */
export function computeIntakeTrendCutoffs(
  ays: AyTrendRequest[],
  currentMonth: number // 0-based UTC month, e.g. new Date().getUTCMonth()
): Map<string, number> {
  const todayMonthByAy = new Map<string, number>();
  for (const { ayCode, isCurrent } of ays) {
    todayMonthByAy.set(ayCode, isCurrent ? Math.min(currentMonth, 10) : 10);
  }
  return todayMonthByAy;
}

// ──────────────────────────────────────────────────────────────────────────────
// Data fetcher
// ──────────────────────────────────────────────────────────────────────────────

async function loadIntakeTrendByAyUncached(
  ays: AyTrendRequest[]
): Promise<AyTrendPoint[]> {
  if (ays.length === 0) return [];

  const supabase = createAdmissionsClient();

  // Fan out one fetch per AY in parallel.
  const perAyRows = await Promise.all(
    ays.map(async ({ ayCode }) => {
      const prefix = prefixFor(ayCode);
      const appsTable = `${prefix}_enrolment_applications`;
      type AppDateRow = { created_at: string | null };
      const rows = await fetchAllPages<AppDateRow>(
        (from, to) =>
          supabase
            .from(appsTable)
            .select('created_at')
            .range(from, to) as unknown as PromiseLike<{
            data: AppDateRow[] | null;
            error: { message: string } | null;
          }>
      );
      return rows.map((r) => ({ ayCode, createdAt: r.created_at }));
    })
  );

  const allRows = perAyRows.flat();

  // Determine the "today" month index for each AY so we can null-out
  // months that haven't occurred yet — clamped only for the DB-current AY.
  const currentMonth = new Date().getUTCMonth(); // 0-based
  const todayMonthByAy = computeIntakeTrendCutoffs(ays, currentMonth);

  return shapeIntakeTrendPoints(allRows, todayMonthByAy);
}

/**
 * Fetch per-month application counts for each AY, formatted as `AyTrendPoint[]`
 * for use with `buildAyTrend(points, AY_MONTH_LABELS, ays.map(a => a.ayCode))`.
 *
 * Cached per AY-list under each AY's `admissions-dashboard:${ay}` tag. The
 * cache key includes each AY's `isCurrent` flag so a current-AY result never
 * collides with a non-current (unclamped) result for the same AY code —
 * relevant right at an AY-rollover boundary.
 */
export function getIntakeTrendByAy(
  ays: AyTrendRequest[]
): Promise<AyTrendPoint[]> {
  const sortedKeys = [...ays].map((a) => `${a.ayCode}:${a.isCurrent}`).sort();
  return unstable_cache(
    () => loadIntakeTrendByAyUncached(ays),
    ['admissions', 'intake-trend-by-ay', ...sortedKeys],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ays.map((a) => cacheTag(a.ayCode)),
    }
  )();
}
