import { isRouteAllowed, type Role } from '@/lib/auth/roles';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSidebarChangeRequestCount } from '@/lib/change-requests/sidebar-counts';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getAyReadiness } from '@/lib/sis/readiness';
import { getAdmissionsKpisRange } from '@/lib/admissions/dashboard';
import { getRecordsKpisRange } from '@/lib/sis/dashboard';
import { createServiceClient } from '@/lib/supabase/service';
import { sgToday } from '@/lib/dates';

export type ModuleCardChart =
  | { kind: 'sparkline'; points: number[] }
  | { kind: 'ring'; pct: number }
  | { kind: 'dots'; done: number; total: number }
  | { kind: 'none' };

export type ModuleCard = {
  module: string;
  href: string;
  statValue: string;
  statLabel: string;
  fraction?: string;
  chart: ModuleCardChart;
  badge?: { label: string; tone: 'success' | 'warning' };
};

// Every module a role *could* see, in the same lifecycle order as
// lib/sidebar/registry.ts::MODULE_ORDER — isRouteAllowed narrows this down
// per-role, so the card set can never drift from the real access table.
const ALL_MODULES: Array<{ module: string; href: string }> = [
  { module: 'Admissions', href: '/admissions' },
  { module: 'Records', href: '/records' },
  { module: 'P-Files', href: '/p-files' },
  { module: 'Markbook', href: '/markbook' },
  { module: 'Attendance', href: '/attendance' },
  { module: 'Evaluation', href: '/evaluation' },
  { module: 'SIS Admin', href: '/sis' },
];

const OPERATIONAL_ROLES: Role[] = ['academic_coordinator'];

async function buildAdmissionsCard(
  role: Role,
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const isOperational = OPERATIONAL_ROLES.includes(role);
  const today = sgToday();
  const sevenDaysAgo = new Date(
    Date.parse(`${today}T00:00:00+08:00`) - 7 * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const { current } = await getAdmissionsKpisRange({
    ayCode,
    from: isOperational ? sevenDaysAgo : range.from,
    to: isOperational ? today : range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return isOperational
    ? {
        module: 'Admissions',
        href: '/admissions',
        statValue: String(current.applicationsInRange),
        statLabel: 'New (7d)',
        chart: { kind: 'none' },
      }
    : {
        module: 'Admissions',
        href: '/admissions',
        statValue: `${Math.round(current.conversionPct)}%`,
        statLabel: 'Conversion',
        fraction: `${current.enrolledInRange} of ${current.applicationsInRange} applications enrolled`,
        chart: { kind: 'none' },
      };
}

async function buildRecordsCard(
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getRecordsKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    module: 'Records',
    href: '/records',
    statValue: current.activeEnrolled.toLocaleString('en-SG'),
    statLabel: 'Enrolled',
    chart: { kind: 'none' },
  };
}

async function buildMarkbookCard(
  role: Role,
  ayCode: string,
  userId: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getMarkbookKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  const card: ModuleCard = {
    module: 'Markbook',
    href: '/markbook',
    statValue: `${Math.round(current.lockedPct)}%`,
    statLabel: 'Sheets locked',
    fraction: `${current.sheetsLocked} of ${current.sheetsTotal} sheets locked`,
    chart: { kind: 'ring', pct: current.lockedPct },
  };
  // Only teacher's own pending change-request count belongs on the card —
  // school_admin/academic_coordinator's CR numbers already live in the
  // to-do panel (lib/home/todos.ts); repeating them here would duplicate
  // the same count in two places on one page.
  if (role === 'teacher') {
    const service = createServiceClient();
    const pending = await getSidebarChangeRequestCount(
      service,
      'teacher',
      userId
    );
    if (pending > 0) {
      card.badge = {
        label: `${pending} ${pending === 1 ? 'CR' : 'CRs'} pending`,
        tone: 'warning',
      };
    }
  }
  return card;
}

async function buildAttendanceCard(ayCode: string): Promise<ModuleCard> {
  const today = sgToday();
  const sevenDaysAgo = new Date(
    Date.parse(`${today}T00:00:00+08:00`) - 6 * 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  const { current } = await getAttendanceKpisRange({
    ayCode,
    from: sevenDaysAgo,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  });
  if (current.encodedDays === 0) {
    return {
      module: 'Attendance',
      href: '/attendance',
      statValue: '—',
      statLabel: "Last 7 days' rate",
      fraction: 'Nothing marked in the last 7 days',
      chart: { kind: 'none' },
    };
  }
  const attending = current.present + current.late + current.excused;
  return {
    module: 'Attendance',
    href: '/attendance',
    statValue: `${Math.round(current.attendancePct)}%`,
    statLabel: "Last 7 days' rate",
    fraction: `${attending} of ${current.encodedDays} marked as attending`,
    // Single aggregate point stands in for the trend until Task 6 wires a
    // real daily series via getDailyAttendanceRange — see Task 6 note.
    chart: { kind: 'sparkline', points: [current.attendancePct] },
  };
}

async function buildEvaluationCard(
  ayCode: string,
  range: { from: string; to: string }
): Promise<ModuleCard> {
  const { current } = await getEvaluationKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    module: 'Evaluation',
    href: '/evaluation',
    statValue: `${Math.round(current.submissionPct)}%`,
    statLabel: 'Submitted, this term',
    fraction: `${current.submitted} of ${current.expected} write-ups submitted`,
    chart: { kind: 'ring', pct: current.submissionPct },
  };
}

async function buildSisAdminCard(ayCode: string): Promise<ModuleCard> {
  const readiness = await getAyReadiness(ayCode);
  return {
    module: 'SIS Admin',
    href: '/sis',
    statValue: `${readiness.complete}/${readiness.total}`,
    statLabel: 'AY readiness',
    fraction: `${readiness.complete} of ${readiness.total} setup steps complete`,
    chart: {
      kind: 'dots',
      done: readiness.complete,
      total: readiness.total,
    },
  };
}

/**
 * Per-role module card grid for the home page. The card *set* is always
 * exactly isRouteAllowed(href, role) — never hardcode a per-role module
 * list (see __tests__/auth/home-route-consistency.test.ts). Card *content*
 * follows the same operational-vs-oversight split each module's own
 * dashboard already applies for these roles (KD #74) — this file adds no
 * new access rule, only composes existing per-module numbers.
 */
export async function getModuleCards(
  role: Role,
  ayCode: string,
  userId: string
): Promise<ModuleCard[]> {
  const allowed = ALL_MODULES.filter((m) => isRouteAllowed(m.href, role));
  const windows = await getDashboardWindows(ayCode);
  const range = windows.ay.thisAY ?? {
    from: `${ayCode.replace(/^AY/i, '')}-01-01`,
    to: sgToday(),
  };

  const cards = await Promise.all(
    allowed.map(async ({ module }): Promise<ModuleCard> => {
      switch (module) {
        case 'Admissions':
          return buildAdmissionsCard(role, ayCode, range);
        case 'Records':
          return buildRecordsCard(ayCode, range);
        case 'P-Files': {
          const { getSlotStatusMix } = await import('@/lib/p-files/dashboard');
          const mix = await getSlotStatusMix(ayCode);
          const total = mix.valid + mix.pending + mix.rejected + mix.missing;
          const pctOnFile = total === 0 ? 0 : (mix.valid / total) * 100;
          return {
            module: 'P-Files',
            href: '/p-files',
            statValue: `${Math.round(pctOnFile)}%`,
            statLabel: 'Docs on file',
            fraction: `${mix.valid} of ${total} documents on file`,
            chart: { kind: 'none' },
          };
        }
        case 'Markbook':
          return buildMarkbookCard(role, ayCode, userId, range);
        case 'Attendance':
          return buildAttendanceCard(ayCode);
        case 'Evaluation':
          return buildEvaluationCard(ayCode, range);
        case 'SIS Admin':
          return buildSisAdminCard(ayCode);
        default:
          throw new Error(`unknown module: ${module}`);
      }
    })
  );

  return cards;
}
