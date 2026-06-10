import 'server-only';

import { unstable_cache } from 'next/cache';

import { prefixFor } from '@/lib/admissions/_shared';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

export type ReasonCount = { reason: string; count: number };
export type TerminalReasonRollup = {
  overall: ReasonCount[];
  byLevel: { level: string; count: number; reasons: ReasonCount[] }[];
  total: number;
};

type TerminalRow = {
  applicationTerminalReason: string | null;
  levelApplied: string | null;
};

const UNSPECIFIED = 'Unspecified';

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function toSortedCounts(map: Map<string, number>): ReasonCount[] {
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Aggregate terminal (cancelled/withdrawn-application) reasons overall + by level. */
export function rollupTerminalReasons(
  rows: TerminalRow[]
): TerminalReasonRollup {
  const overall = new Map<string, number>();
  const perLevel = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const reason = (r.applicationTerminalReason ?? '').trim() || UNSPECIFIED;
    const level = (r.levelApplied ?? '').trim() || 'Unknown';
    bump(overall, reason);
    if (!perLevel.has(level)) perLevel.set(level, new Map());
    bump(perLevel.get(level)!, reason);
  }
  const byLevel = [...perLevel.entries()]
    .map(([level, m]) => {
      const reasons = toSortedCounts(m);
      return {
        level,
        count: reasons.reduce((s, x) => s + x.count, 0),
        reasons,
      };
    })
    .sort((a, b) => b.count - a.count || a.level.localeCompare(b.level));
  return { overall: toSortedCounts(overall), byLevel, total: rows.length };
}

export { growthDelta, type Growth } from '@/lib/dashboard/growth';

const CACHE_TTL_SECONDS = 60;

async function loadTerminalReasonsUncached(
  ayCode: string
): Promise<TerminalReasonRollup> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();
  // Closed/terminal applications carry applicationTerminalReason on _enrolment_status;
  // levelApplied lives on _enrolment_applications. Join on enroleeNumber.
  // NOTE: applicationTerminalReason is a case-sensitive camelCase Postgres column —
  // it MUST be double-quoted in the PostgREST select (unquoted identifiers fold to
  // lowercase and would silently miss the column). Mirrors LIST_STATUS_COLUMNS in
  // lib/sis/queries.ts.
  const { data: statusRows, error } = await supabase
    .from(`${prefix}_enrolment_status`)
    .select('enroleeNumber, "applicationTerminalReason"')
    .not('applicationTerminalReason', 'is', null);
  if (error || !statusRows) return { overall: [], byLevel: [], total: 0 };
  const enroleeNumbers = statusRows
    .map((r) => (r as { enroleeNumber: string | null }).enroleeNumber)
    .filter((n): n is string => !!n);
  const levelByEnrolee = new Map<string, string | null>();
  if (enroleeNumbers.length > 0) {
    const { data: appRows } = await supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, levelApplied')
      .in('enroleeNumber', enroleeNumbers);
    for (const a of (appRows ?? []) as {
      enroleeNumber: string;
      levelApplied: string | null;
    }[]) {
      levelByEnrolee.set(a.enroleeNumber, a.levelApplied);
    }
  }
  const rows = (
    statusRows as {
      enroleeNumber: string | null;
      applicationTerminalReason: string | null;
    }[]
  ).map((r) => ({
    applicationTerminalReason: r.applicationTerminalReason,
    levelApplied: r.enroleeNumber
      ? (levelByEnrolee.get(r.enroleeNumber) ?? null)
      : null,
  }));
  return rollupTerminalReasons(rows);
}

export function getAdmissionsTerminalReasons(
  ayCode: string
): Promise<TerminalReasonRollup> {
  return unstable_cache(
    () => loadTerminalReasonsUncached(ayCode),
    ['admissions-insights', 'terminal-reasons', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['admissions-dashboard', `admissions-dashboard:${ayCode}`],
    }
  )();
}
