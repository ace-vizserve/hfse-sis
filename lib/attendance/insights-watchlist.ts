/**
 * Pure helpers for the Attendance Insights watchlist + A/EX mix signal.
 *
 * Kept pure (no I/O) so they are unit-testable without DB mocks.
 *
 * Split rule (intervene vs monitor):
 *
 *   A student appears in the watchlist only when they have ≥1 unexplained
 *   absence. Among those, the split is:
 *
 *   INTERVENE — unexplained absences (A) make up MORE THAN HALF of their
 *   total away-days (A + EX). These students are away largely without excuse;
 *   truancy follow-up is warranted.
 *
 *   MONITOR — unexplained absences are HALF OR LESS of their total away-days,
 *   i.e. most of their absences are covered by an excuse (MC/vacation/
 *   compassionate). The registrar should stay aware but the medical narrative
 *   is plausible — no immediate truancy signal.
 *
 * Why "more than half" rather than a fixed count or a rate vs school days?
 *   • Fixed counts (e.g. ≥3 A) require threshold tuning per AY length.
 *   • Rate vs school days conflates the two populations (a sick student with
 *     10 EX and 2 A looks fine by rate but has real unexplained absences).
 *   • The away-mix (A ÷ (A + EX)) is agnostic to class size, term length,
 *     and calendar composition — it purely answers "when this student is away,
 *     is it explained?". >50% unexplained is the natural majority threshold.
 */

import type { TopAbsentDrillRow } from '@/lib/attendance/drill';

// ─── Watchlist split ─────────────────────────────────────────────────────────

export type WatchlistEntry = TopAbsentDrillRow & {
  awayDays: number; // absences + excused
  unexplainedPct: number; // absences / awayDays * 100, rounded
};

export type WatchlistSplit = {
  intervene: WatchlistEntry[];
  monitor: WatchlistEntry[];
};

/**
 * Split `topAbsent` rows (must all have absences > 0) into intervene/monitor
 * buckets.
 *
 * Both lists are sorted by `absences` descending (same as the input order),
 * so the highest-risk students float to the top of each bucket.
 *
 * @param rows - Full `rollupTopAbsent` output (unsorted or pre-sorted by
 *   absences desc). Only rows with absences > 0 are processed; callers
 *   typically pre-filter, but this function is safe either way.
 * @param limit - Optional cap per bucket (e.g. 10 per list). Applies after
 *   sorting, so the most-at-risk are always included.
 */
export function splitWatchlist(
  rows: TopAbsentDrillRow[],
  limit?: number
): WatchlistSplit {
  const intervene: WatchlistEntry[] = [];
  const monitor: WatchlistEntry[] = [];

  for (const r of rows) {
    if (r.absences === 0) continue;
    const awayDays = r.absences + r.excused;
    const unexplainedPct =
      awayDays > 0 ? Math.round((r.absences / awayDays) * 100) : 100;
    const entry: WatchlistEntry = { ...r, awayDays, unexplainedPct };

    // Majority unexplained → truancy signal → intervene.
    if (r.absences > r.excused) {
      intervene.push(entry);
    } else {
      monitor.push(entry);
    }
  }

  // Both lists already arrive sorted by absences desc from rollupTopAbsent.
  // Re-sort within each bucket by absences desc to make the cap deterministic
  // (in case the caller passed an unsorted array).
  intervene.sort((a, b) => b.absences - a.absences || b.lates - a.lates);
  monitor.sort((a, b) => b.absences - a.absences || b.lates - a.lates);

  if (limit != null) {
    return {
      intervene: intervene.slice(0, limit),
      monitor: monitor.slice(0, limit),
    };
  }
  return { intervene, monitor };
}

// ─── A/EX mix ────────────────────────────────────────────────────────────────

export type AbsenceMix = {
  unexplained: number; // raw count of A days
  excused: number; // raw count of EX days
  awayDays: number; // unexplained + excused
  unexplainedPct: number; // 0–100, rounded
  excusedPct: number; // 0–100, rounded
};

/**
 * Compute the school-wide A-vs-EX mix from KPI counts.
 *
 * @param absentCount  - kpis.current.absent (unexplained A days)
 * @param excusedCount - kpis.current.excused (EX days)
 */
export function computeAbsenceMix(
  absentCount: number,
  excusedCount: number
): AbsenceMix {
  const awayDays = absentCount + excusedCount;
  if (awayDays === 0) {
    return {
      unexplained: 0,
      excused: 0,
      awayDays: 0,
      unexplainedPct: 0,
      excusedPct: 0,
    };
  }
  const unexplainedPct = Math.round((absentCount / awayDays) * 100);
  // Keep the two percentages summing exactly to 100 by deriving the second.
  const excusedPct = 100 - unexplainedPct;
  return {
    unexplained: absentCount,
    excused: excusedCount,
    awayDays,
    unexplainedPct,
    excusedPct,
  };
}

// ─── Quota approaching tier ──────────────────────────────────────────────────

/**
 * Returns true when a student has used their full allowance this term but is
 * not formally over quota (i.e. `remaining === 0`). Used by the vacation-leave
 * approaching tier to surface pre-breach warnings.
 *
 * For compassionate leave, `remaining` maps to `allowance - used`.
 * For vacation leave, `remaining` maps to `remainingThisTerm`.
 */
export function isAtQuota(remaining: number, isOver: boolean): boolean {
  return !isOver && remaining === 0;
}

/**
 * Approaching tier: used up their allowance this term but not formally over
 * (remaining === 0). For vacation leave only — compassionate at-quota is less
 * actionable (per-year, so being at 5/5 at T2 is fine; only >5 is the signal).
 */
export function isApproachingVlQuota(
  remainingThisTerm: number,
  isOverTermQuota: boolean
): boolean {
  return isAtQuota(remainingThisTerm, isOverTermQuota);
}
