import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 1048 },
  })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: {
      attendancePct: 96.2,
      encodedDays: 500,
      present: 460,
      late: 15,
      excused: 5,
      absent: 20,
      nc: 0,
    },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 68.4 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 184,
    pending: 10,
    rejected: 4,
    missing: 2,
  })),
}));
vi.mock('@/lib/sis/health', () => ({
  getSystemHealth: vi.fn(async () => ({
    approverFlows: [{ ok: true }, { ok: false }],
  })),
}));

import { getHomeKpis } from '@/lib/home/kpis';

describe('getHomeKpis', () => {
  it('returns no KPIs for teacher', async () => {
    expect(await getHomeKpis('teacher', 'AY2026')).toEqual([]);
  });

  it('returns active students + attendance + write-ups for academic_coordinator', async () => {
    const kpis = await getHomeKpis('academic_coordinator', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      {
        value: '96%',
        label: 'Attendance rate, today',
        fraction: '480 of 500 marked as attending',
      },
      { value: '68%', label: 'Write-ups submitted, this term' },
    ]);
  });

  it('returns active students + attendance + docs-on-file for school_admin', async () => {
    const kpis = await getHomeKpis('school_admin', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      {
        value: '96%',
        label: 'Attendance rate, today',
        fraction: '480 of 500 marked as attending',
      },
      {
        value: '92%',
        label: 'Documents on file',
        fraction: '184 of 200 documents',
      },
    ]);
  });

  it('returns active students + system health + attendance for superadmin', async () => {
    const kpis = await getHomeKpis('superadmin', 'AY2026');
    expect(kpis).toEqual([
      { value: '1,048', label: 'Active students, AY2026' },
      { value: '1', label: 'System issues flagged' },
      {
        value: '96%',
        label: 'Attendance rate, today',
        fraction: '480 of 500 marked as attending',
      },
    ]);
  });

  it('shows an honest empty state when nothing is marked yet today, not a fake 0%', async () => {
    const { getAttendanceKpisRange } =
      await import('@/lib/attendance/dashboard');
    (getAttendanceKpisRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      current: {
        attendancePct: 0,
        encodedDays: 0,
        present: 0,
        late: 0,
        excused: 0,
        absent: 0,
        nc: 0,
      },
    });
    const kpis = await getHomeKpis('school_admin', 'AY2026');
    const attendance = kpis.find((k) => k.label === 'Attendance rate, today')!;
    expect(attendance.value).toBe('—');
    expect(attendance.fraction).toBe('Not yet marked today');
  });
});
