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
    current: { submissionPct: 68, submitted: 55, expected: 90 },
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
    current: {
      applicationsInRange: 35,
      enrolledInRange: 12,
      conversionPct: 34,
    },
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 812 },
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
    expect(markbook.chart).toEqual({ kind: 'bar', pct: 82 });
    expect(markbook.statLabel).toBe('41 of 50 sheets locked');
    const sisAdmin = cards.find((c) => c.module === 'SIS Admin')!;
    expect(sisAdmin.chart).toEqual({ kind: 'bar', pct: (6 / 7) * 100 });
  });

  it('gives academic_coordinator the operational Admissions number, not conversion', async () => {
    const cards = await getModuleCards(
      'academic_coordinator',
      'AY2026',
      'user-3'
    );
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('35');
    expect(admissions.statLabel).toBe('New (7d)');
  });

  it('gives school_admin the oversight Admissions number (conversion %)', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const admissions = cards.find((c) => c.module === 'Admissions')!;
    expect(admissions.statValue).toBe('34%');
    expect(admissions.statLabel).toBe('12 of 35 applications enrolled');
  });

  it('shows the real sheets-locked fraction on the Markbook card', async () => {
    const { getMarkbookKpisRange } = await import('@/lib/markbook/dashboard');
    (getMarkbookKpisRange as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      current: { lockedPct: 82, sheetsLocked: 41, sheetsTotal: 50 },
    });
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const markbook = cards.find((c) => c.module === 'Markbook')!;
    expect(markbook.statLabel).toBe('41 of 50 sheets locked');
    expect(markbook.chart).toEqual({ kind: 'bar', pct: 82 });
  });

  it('shows the real AY-setup fraction on the SIS Admin card', async () => {
    const cards = await getModuleCards('school_admin', 'AY2026', 'user-2');
    const sisAdmin = cards.find((c) => c.module === 'SIS Admin')!;
    expect(sisAdmin.statValue).toBe('6/7');
    expect(sisAdmin.statLabel).toBe('AY setup steps complete');
    expect(sisAdmin.chart).toEqual({
      kind: 'bar',
      pct: (6 / 7) * 100,
    });
  });
});
