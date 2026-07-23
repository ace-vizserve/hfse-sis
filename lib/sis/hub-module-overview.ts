// lib/sis/hub-module-overview.ts
//
// Composed per-module "at a glance" row for the SIS Admin hub: one live KPI
// per operational module (Admissions/Records/Attendance/Markbook/Evaluation/
// P-Files), each drawn from that module's own already-cached loader. Follows
// the KD #46 cache-wrapper pattern (hoist the uncached composition, wrap
// per-call with `unstable_cache`) — the same choice `lib/sis/hub-snapshot.ts`
// makes when it composes `getLevelDistribution` (itself already cached)
// inside its own `unstable_cache`. Re-wrapping here is deliberate, not
// redundant: it gives this specific ayCode fan-out its own short-lived cache
// entry instead of re-running all 6 module calls (each already cheap thanks
// to their own cache, but still 6 round-trips) on every hub render.
//
// Records deliberately does NOT show `enrolledStudents` — that number is
// already the hub's own "Enrolled students" stat tile (with its own
// growth-delta chip), so repeating it here would be pure duplication with
// no new information. Instead this card surfaces the unsynced-students
// backlog (KD #90) — a genuinely different, actionable Records signal.
import 'server-only';
import { unstable_cache } from 'next/cache';

import { getAdmissionsKpisRange } from '@/lib/admissions/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getPFilesKpisRange } from '@/lib/p-files/dashboard';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';
import { sgToday } from '@/lib/dates';
import type { RangeInput } from '@/lib/dashboard/range';

export type HubModuleOverviewRow = {
  key: string;
  label: string;
  value: string;
  /** Plain-English description of what `value` counts — the module name
   * alone ("Records") doesn't say whether 404 means students, applications,
   * or something else, so every row carries an explicit descriptor. */
  sub: string;
  href: string;
  tone: 'indigo' | 'amber';
};

function isoDaysAgo(days: number, todayIso: string): string {
  const d = new Date(
    Date.UTC(
      Number(todayIso.slice(0, 4)),
      Number(todayIso.slice(5, 7)) - 1,
      Number(todayIso.slice(8, 10))
    )
  );
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadHubModuleOverviewUncached(
  ayCode: string
): Promise<HubModuleOverviewRow[]> {
  const today = sgToday();
  const weekAgo = isoDaysAgo(6, today);

  const weekRange: RangeInput = {
    ayCode,
    from: weekAgo,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };
  const todayRange: RangeInput = {
    ayCode,
    from: today,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  };

  const [admissions, attendance, markbook, evaluation, pfiles, unsyncedCount] =
    await Promise.all([
      getAdmissionsKpisRange(weekRange),
      getAttendanceKpisRange(todayRange),
      getMarkbookKpisRange(weekRange),
      getEvaluationKpisRange(weekRange),
      getPFilesKpisRange(weekRange),
      countUnsyncedEnrolledStudents(ayCode),
    ]);

  return [
    {
      key: 'admissions',
      label: 'Admissions',
      value: `${admissions.current.applicationsInRange}`,
      sub: 'New applications this week',
      href: '/admissions',
      tone: 'indigo',
    },
    {
      key: 'records',
      label: 'Records',
      value: `${unsyncedCount}`,
      sub: 'Pending sync from Admissions',
      href: '/records/unsynced',
      tone: unsyncedCount > 0 ? 'amber' : 'indigo',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      value: `${attendance.current.attendancePct.toFixed(1)}%`,
      sub: 'Attendance rate today',
      href: '/attendance',
      tone: 'indigo',
    },
    {
      key: 'markbook',
      label: 'Markbook',
      value: `${markbook.current.lockedPct.toFixed(0)}%`,
      sub: 'Grading sheets locked',
      href: '/markbook',
      tone: 'indigo',
    },
    {
      key: 'evaluation',
      label: 'Evaluation',
      value: `${evaluation.current.submissionPct.toFixed(0)}%`,
      sub: 'Write-ups submitted',
      href: '/evaluation',
      tone: 'indigo',
    },
    {
      key: 'p-files',
      label: 'P-Files',
      value: `${pfiles.current.expiringSoon30}`,
      sub: 'Docs expiring within 30 days',
      href: '/p-files',
      tone: pfiles.current.expiringSoon30 > 0 ? 'amber' : 'indigo',
    },
  ];
}

export function getHubModuleOverview(
  ayCode: string
): Promise<HubModuleOverviewRow[]> {
  return unstable_cache(
    () => loadHubModuleOverviewUncached(ayCode),
    ['sis-hub-module-overview', ayCode],
    { tags: ['sis', `sis:${ayCode}`], revalidate: 120 }
  )();
}
