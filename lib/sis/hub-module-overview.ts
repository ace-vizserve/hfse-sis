// lib/sis/hub-module-overview.ts
//
// Composed per-module "at a glance" row for the SIS Admin hub: one live KPI
// per operational module (Admissions/Records/Attendance/Markbook/Evaluation/
// P-Files), each drawn from that module's own already-cached `get*KpisRange`
// loader (or `getHubKpis` for Records). Follows the KD #46 cache-wrapper
// pattern (hoist the uncached composition, wrap per-call with
// `unstable_cache`) — the same choice `lib/sis/hub-snapshot.ts` makes when it
// composes `getLevelDistribution` (itself already cached) inside its own
// `unstable_cache`. Re-wrapping here is deliberate, not redundant: it gives
// this specific (ayCode, compareAyCode) fan-out its own short-lived cache
// entry instead of re-running all 6 module calls (each already cheap thanks
// to their own cache, but still 6 round-trips) on every hub render.
import 'server-only';
import { unstable_cache } from 'next/cache';

import { getAdmissionsKpisRange } from '@/lib/admissions/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getPFilesKpisRange } from '@/lib/p-files/dashboard';
import { getHubKpis } from '@/lib/sis/dashboard';
import { growthDelta } from '@/lib/dashboard/growth';
import { sgToday } from '@/lib/dates';
import type { RangeInput } from '@/lib/dashboard/range';

export type HubModuleOverviewRow = {
  key: string;
  label: string;
  value: string;
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
  ayCode: string,
  compareAyCode: string | null
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

  const [
    admissions,
    attendance,
    markbook,
    evaluation,
    pfiles,
    hubKpis,
    priorHubKpis,
  ] = await Promise.all([
    getAdmissionsKpisRange(weekRange),
    getAttendanceKpisRange(todayRange),
    getMarkbookKpisRange(weekRange),
    getEvaluationKpisRange(weekRange),
    getPFilesKpisRange(weekRange),
    getHubKpis(ayCode),
    compareAyCode ? getHubKpis(compareAyCode) : Promise.resolve(null),
  ]);

  const enrolledGrowth = growthDelta(
    hubKpis.enrolledStudents,
    priorHubKpis?.enrolledStudents ?? null
  );
  const enrolledSuffix =
    enrolledGrowth.pct != null
      ? `${enrolledGrowth.pct >= 0 ? '+' : ''}${Math.round(hubKpis.enrolledStudents - (priorHubKpis?.enrolledStudents ?? 0))} YoY`
      : '';

  return [
    {
      key: 'admissions',
      label: 'Admissions',
      value: `${admissions.current.applicationsInRange}`,
      href: '/admissions',
      tone: 'indigo',
    },
    {
      key: 'records',
      label: 'Records',
      value: `${hubKpis.enrolledStudents}${enrolledSuffix ? `, ${enrolledSuffix}` : ''}`,
      href: '/records',
      tone: 'indigo',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      value: `${attendance.current.attendancePct.toFixed(1)}%`,
      href: '/attendance',
      tone: 'indigo',
    },
    {
      key: 'markbook',
      label: 'Markbook',
      value: `${markbook.current.lockedPct.toFixed(0)}%`,
      href: '/markbook',
      tone: 'indigo',
    },
    {
      key: 'evaluation',
      label: 'Evaluation',
      value: `${evaluation.current.submissionPct.toFixed(0)}%`,
      href: '/evaluation',
      tone: 'indigo',
    },
    {
      key: 'p-files',
      label: 'P-Files',
      value: `${pfiles.current.expiringSoon30}`,
      href: '/p-files',
      tone: pfiles.current.expiringSoon30 > 0 ? 'amber' : 'indigo',
    },
  ];
}

export function getHubModuleOverview(
  ayCode: string,
  compareAyCode: string | null
): Promise<HubModuleOverviewRow[]> {
  return unstable_cache(
    () => loadHubModuleOverviewUncached(ayCode, compareAyCode),
    ['sis-hub-module-overview', ayCode, compareAyCode ?? ''],
    { tags: ['sis', `sis:${ayCode}`], revalidate: 120 }
  )();
}
