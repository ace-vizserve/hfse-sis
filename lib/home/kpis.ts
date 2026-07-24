import type { Role } from '@/lib/auth/roles';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getRecordsKpisRange } from '@/lib/sis/dashboard';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { getEvaluationKpisRange } from '@/lib/evaluation/dashboard';
import { getSlotStatusMix } from '@/lib/p-files/dashboard';
import { getSystemHealth } from '@/lib/sis/health';
import { sgToday } from '@/lib/dates';

export type HomeKpi = { value: string; label: string };

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

async function activeStudentsKpi(
  ayCode: string,
  range: { from: string; to: string }
): Promise<HomeKpi> {
  const { current } = await getRecordsKpisRange({
    ayCode,
    from: range.from,
    to: range.to,
    cmpFrom: null,
    cmpTo: null,
  });
  return {
    value: current.activeEnrolled.toLocaleString('en-SG'),
    label: `Active students, ${ayCode}`,
  };
}

async function attendanceTodayKpi(ayCode: string): Promise<HomeKpi> {
  const today = sgToday();
  const { current } = await getAttendanceKpisRange({
    ayCode,
    from: today,
    to: today,
    cmpFrom: null,
    cmpTo: null,
  });
  return { value: pct(current.attendancePct), label: 'Attendance rate, today' };
}

/**
 * Role-scoped 3-KPI row for the home page. Every value reuses an existing
 * per-module dashboard loader (KD #46 pattern) — nothing here recomputes a
 * metric. Teacher gets none: nothing school-wide is meaningful at that
 * scope (see docs/superpowers/specs/2026-07-24-home-role-overview-design.md).
 */
export async function getHomeKpis(
  role: Role,
  ayCode: string
): Promise<HomeKpi[]> {
  if (
    role === 'teacher' ||
    role === 'p_file_officer' ||
    role === 'admissions'
  ) {
    return [];
  }

  const windows = await getDashboardWindows(ayCode);
  const range = windows.ay.thisAY ?? {
    from: `${ayCode.replace(/^AY/i, '')}-01-01`,
    to: sgToday(),
  };

  const [activeStudents, attendanceToday] = await Promise.all([
    activeStudentsKpi(ayCode, range),
    attendanceTodayKpi(ayCode),
  ]);

  if (role === 'academic_coordinator') {
    const { current } = await getEvaluationKpisRange({
      ayCode,
      from: range.from,
      to: range.to,
      cmpFrom: null,
      cmpTo: null,
    });
    return [
      activeStudents,
      attendanceToday,
      {
        value: pct(current.submissionPct),
        label: 'Write-ups submitted, this term',
      },
    ];
  }

  if (role === 'school_admin') {
    const mix = await getSlotStatusMix(ayCode);
    const total = mix.valid + mix.pending + mix.rejected + mix.missing;
    const onFilePct = total === 0 ? 0 : (mix.valid / total) * 100;
    return [
      activeStudents,
      attendanceToday,
      { value: pct(onFilePct), label: 'Documents on file' },
    ];
  }

  // superadmin
  const health = await getSystemHealth();
  const issuesFlagged = health.approverFlows.filter((f) => !f.ok).length;
  return [
    activeStudents,
    { value: String(issuesFlagged), label: 'System issues flagged' },
    attendanceToday,
  ];
}
