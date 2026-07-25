import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(async () => 1),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookKpisRange: vi.fn(async () => ({
    current: { lockedPct: 82, sheetsLocked: 41, sheetsTotal: 50 },
  })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: {
      attendancePct: 96,
      encodedDays: 50,
      present: 45,
      late: 2,
      excused: 1,
    },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 68, submitted: 34, expected: 50 },
  })),
}));
vi.mock('@/lib/sis/readiness', () => ({
  getAyReadiness: vi.fn(async () => ({
    ayCode: 'AY2026',
    steps: [],
    complete: 6,
    total: 7,
  })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getAdmissionsKpisRange: vi.fn(async () => ({
    current: { applicationsInRange: 8, enrolledInRange: 3, conversionPct: 34 },
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 812 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 92,
    pending: 5,
    rejected: 1,
    missing: 2,
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import { getModuleCards } from '@/lib/home/module-cards';

describe('getModuleCards', () => {
  it('returns only teacher-accessible modules for teacher', async () => {
    const cards = await getModuleCards('teacher', 'AY2026', 'user-1');
    expect(cards.map((c) => c.module)).toEqual([
      'Markbook',
      'Attendance',
      'Evaluation',
    ]);
    const markbook = cards.find((c) => c.module === 'Markbook')!;
    expect(markbook.badge).toEqual({ label: '1 CR pending', tone: 'warning' });
  });

  it('returns all 7 modules for school_admin, no CR badge on Markbook', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    expect(cards.map((c) => c.module)).toEqual([
      'Admissions',
      'Records',
      'P-Files',
      'Markbook',
      'Attendance',
      'Evaluation',
      'SIS Admin',
    ]);
    const markbook = cards.find((c) => c.module === 'Markbook')!;
    expect(markbook.badge).toBeUndefined();
    expect(markbook.chart).toEqual({ kind: 'ring', pct: 82 });
    expect(markbook.fraction).toBe('41 of 50 sheets locked');
    const sisAdmin = cards.find((c) => c.module === 'SIS Admin')!;
    expect(sisAdmin.chart).toEqual({ kind: 'dots', done: 6, total: 7 });
    expect(sisAdmin.fraction).toBe('6 of 7 setup steps complete');

    const attendance = cards.find((c) => c.module === 'Attendance')!;
    expect(attendance.fraction).toBe('48 of 50 marked as attending');
    const evaluation = cards.find((c) => c.module === 'Evaluation')!;
    expect(evaluation.fraction).toBe('34 of 50 write-ups submitted');
    const pFiles = cards.find((c) => c.module === 'P-Files')!;
    expect(pFiles.fraction).toBe('92 of 100 documents on file');
  });

  it('shows an honest empty state on the Attendance card when nothing is marked in the last 7 days', async () => {
    const { getAttendanceKpisRange } =
      await import('@/lib/attendance/dashboard');
    vi.mocked(getAttendanceKpisRange).mockResolvedValueOnce({
      current: {
        attendancePct: 0,
        encodedDays: 0,
        present: 0,
        late: 0,
        excused: 0,
      },
    } as never);
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const attendance = cards.find((c) => c.module === 'Attendance')!;
    expect(attendance.statValue).toBe('—');
    expect(attendance.fraction).toBe('Nothing marked in the last 7 days');
    expect(attendance.chart).toEqual({ kind: 'none' });
  });

  it('gives academic_coordinator the operational Admissions number, not conversion', async () => {
    const cards = await getModuleCards(
      'academic_coordinator',
      'AY2026',
      'user-3'
    );
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('8');
    expect(admissions.statLabel).toBe('New (7d)');
  });

  it('gives school_admin the oversight Admissions number (conversion %)', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('34%');
    expect(admissions.statLabel).toBe('Conversion');
    expect(admissions.fraction).toBe('3 of 8 applications enrolled');
  });
});
