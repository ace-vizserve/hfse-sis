import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import {
  levelAsAppliedKey,
  OTHER_REASONS_BAR_KEY,
  reasonLabel,
  sortReasonCounts,
  terminalReasonKey,
  TOP_REASON_COUNT,
  UNSPECIFIED_REASON,
  type ReasonCount,
} from '@/lib/admissions/insights-predicates';
import { fetchAllPages } from '@/lib/supabase/paginate';

export { reasonLabel, TOP_REASON_COUNT, type ReasonCount };

export type TerminalReasonRollup = {
  overall: ReasonCount[];
  byLevel: { level: string; count: number; reasons: ReasonCount[] }[];
  total: number;
};

type TerminalRow = {
  applicationTerminalReason: string | null;
  levelApplied: string | null;
};

/** Aggregate terminal (cancelled/withdrawn-application) reasons overall + by
 *  level. Reason and level keys are the shared ones the `terminal-reason`
 *  drill filters with (KD #229). */
export function rollupTerminalReasons(
  rows: TerminalRow[]
): TerminalReasonRollup {
  const overallKeys: string[] = [];
  const perLevel = new Map<string, string[]>();
  for (const r of rows) {
    const reason =
      terminalReasonKey(r.applicationTerminalReason ?? '') ??
      UNSPECIFIED_REASON;
    const level = levelAsAppliedKey(r.levelApplied);
    overallKeys.push(reason);
    const list = perLevel.get(level) ?? [];
    list.push(reason);
    perLevel.set(level, list);
  }
  const byLevel = [...perLevel.entries()]
    .map(([level, keys]) => ({
      level,
      count: keys.length,
      reasons: sortReasonCounts(keys),
    }))
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
  return {
    overall: sortReasonCounts(overallKeys),
    byLevel,
    total: rows.length,
  };
}

/**
 * Application-first join — the drill row set's join: one row per application
 * with an applicant number whose LAST status row carries a reason (blank
 * counts, as 'Unspecified'). A status row with no application is not counted.
 * Pure — exported for unit tests.
 */
export function joinTerminalReasonRows(
  statusRows: {
    enroleeNumber: string | null;
    applicationTerminalReason: string | null;
  }[],
  appRows: { enroleeNumber: string | null; levelApplied: string | null }[]
): TerminalRow[] {
  const reasonByEnrolee = new Map<string, string | null>();
  for (const s of statusRows) {
    if (s.enroleeNumber) {
      reasonByEnrolee.set(s.enroleeNumber, s.applicationTerminalReason ?? null);
    }
  }
  const out: TerminalRow[] = [];
  for (const a of appRows) {
    if (!a.enroleeNumber) continue;
    const reason = reasonByEnrolee.get(a.enroleeNumber) ?? null;
    if (terminalReasonKey(reason) === null) continue;
    out.push({
      applicationTerminalReason: reason,
      levelApplied: a.levelApplied ?? null,
    });
  }
  return out;
}

export { growthDelta, type Growth } from '@/lib/dashboard/growth';

// ──────────────────────────────────────────────────────────────────────────
// Cancellation-reason presentation — shared between the Insights page's
// "Cancellation reasons" donut and its CSV export, so the top-N + overflow
// selection can never drift between the two (design-and-constraints.md's
// "never re-implement a selection rule" rule).
// ──────────────────────────────────────────────────────────────────────────

export type ReasonBar = { key: string; label: string; count: number };

/**
 * Top `TOP_REASON_COUNT` cancellation reasons + an overflow bucket, for the
 * sorted donut list. `overall` must already be sorted desc by count
 * (rollupTerminalReasons's own output). The overflow bucket carries a
 * sentinel key + the label "Other reasons" — deliberately distinct from the
 * real `other` reason code, whose display label is already "Other"
 * (APPLICATION_TERMINAL_REASON_LABELS) and which can legitimately rank in
 * the top N alongside the overflow row.
 */
export function selectTopReasonBars(overall: ReasonCount[]): ReasonBar[] {
  const topReasons = overall.slice(0, TOP_REASON_COUNT);
  const otherReasonsCount = overall
    .slice(TOP_REASON_COUNT)
    .reduce((s, r) => s + r.count, 0);
  return [
    ...topReasons.map((r) => ({
      key: r.reason,
      label: reasonLabel(r.reason),
      count: r.count,
    })),
    ...(otherReasonsCount > 0
      ? [
          {
            key: OTHER_REASONS_BAR_KEY,
            label: 'Other reasons',
            count: otherReasonsCount,
          },
        ]
      : []),
  ];
}

const CACHE_TTL_SECONDS = 60;

async function loadTerminalReasonsUncached(
  ayCode: string
): Promise<TerminalReasonRollup> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();
  type StatusRow = {
    enroleeNumber: string | null;
    applicationTerminalReason: string | null;
  };
  type AppRow = { enroleeNumber: string | null; levelApplied: string | null };
  type P<T> = PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>;
  // Paginated (the old single select stopped at PostgREST's 1,000-row cap)
  // and joined application-first like the drill (KD #229).
  // NOTE: applicationTerminalReason is a case-sensitive camelCase column —
  // double-quoted in the select, mirroring LIST_STATUS_COLUMNS in
  // lib/sis/queries.ts.
  try {
    const [statusRows, appRows] = await Promise.all([
      fetchAllPages<StatusRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_status`)
            .select('enroleeNumber, "applicationTerminalReason"')
            .range(from, to) as unknown as P<StatusRow>
      ),
      fetchAllPages<AppRow>(
        (from, to) =>
          supabase
            .from(`${prefix}_enrolment_applications`)
            .select('enroleeNumber, levelApplied')
            .range(from, to) as unknown as P<AppRow>
      ),
    ]);
    return rollupTerminalReasons(joinTerminalReasonRows(statusRows, appRows));
  } catch (err) {
    console.error('[admissions-insights] terminal reasons fetch failed:', err);
    return { overall: [], byLevel: [], total: 0 };
  }
}

export function getAdmissionsTerminalReasons(
  ayCode: string
): Promise<TerminalReasonRollup> {
  return unstable_cache(
    () => loadTerminalReasonsUncached(ayCode),
    ['admissions-insights', 'terminal-reasons-v2', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['admissions-dashboard', `admissions-dashboard:${ayCode}`],
    }
  )();
}
