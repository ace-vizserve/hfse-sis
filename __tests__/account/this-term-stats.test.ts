import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/account/sections', () => ({
  getTeacherSections: vi.fn(() =>
    Promise.resolve([
      { sectionName: 'A', roleTag: 'Form adviser' },
      { sectionName: 'B', roleTag: 'English' },
    ])
  ),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationTeacherPriority: vi.fn(() =>
    Promise.resolve({ headline: { value: 2 } })
  ),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookTeacherPriority: vi.fn(() =>
    Promise.resolve({ headline: { value: 1 } })
  ),
  // Real shape: RangeResult<MarkbookRangeKpis> — only `current` is read here.
  getMarkbookKpisRange: vi.fn(() =>
    Promise.resolve({ current: { changeRequestsPending: 4 } })
  ),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(() => Promise.resolve(3)),
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffCount: vi.fn(() => Promise.resolve(28)),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  // Real shape: RangeResult<PFilesRangeKpis> — only `current` is read here.
  getPFilesKpisRange: vi.fn(() =>
    Promise.resolve({ current: { expiringSoon30: 12 } })
  ),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  // Real shape: ExpiringDocRow[] (lib/sis/dashboard.ts::getExpiringDocuments).
  // Mix of overdue (negative daysUntilExpiry) and due-soon (non-negative) so
  // the "Already expired" row is provably filtered, not the combined total.
  getExpiringDocuments: vi.fn(() =>
    Promise.resolve([
      { daysUntilExpiry: -5 },
      { daysUntilExpiry: -1 },
      { daysUntilExpiry: 0 },
      { daysUntilExpiry: 10 },
      { daysUntilExpiry: 20 },
    ])
  ),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getOutdatedApplications: vi.fn(() => Promise.resolve(new Array(5).fill({}))),
}));

import { getThisTermStats } from '@/lib/account/this-term-stats';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getPFilesKpisRange } from '@/lib/p-files/dashboard';
import { getExpiringDocuments } from '@/lib/sis/dashboard';
import { getStaffCount } from '@/lib/auth/staff-list';

const base = {
  userId: 'u1',
  email: 'x@hfse.edu.sg',
  ayCode: 'AY2026',
  supabase: {} as never,
  service: {} as never,
};

describe('getThisTermStats', () => {
  it('teacher: sections count, outstanding write-ups, open grading sheets', async () => {
    const rows = await getThisTermStats({ ...base, role: 'teacher' });
    expect(rows).toEqual([
      { label: 'Sections', value: 2 },
      { label: 'Write-ups still needed', value: 2, tone: 'warning' },
      { label: 'Open grading sheets', value: 1 },
    ]);
  });

  it('academic_coordinator: system-wide pending change requests', async () => {
    const rows = await getThisTermStats({
      ...base,
      role: 'academic_coordinator',
    });
    expect(rows).toEqual([
      { label: 'Change requests pending', value: 4, tone: 'warning' },
    ]);
    // Real signature is RangeInput (ayCode, from, to, cmpFrom, cmpTo) — not
    // the bare { ayCode } the plan's research assumed. changeRequestsPending
    // is a live-state count (no date window applied internally), so any
    // valid range is correct here; this assertion only pins the parameter
    // SHAPE, not particular date values.
    expect(getMarkbookKpisRange).toHaveBeenCalledWith(
      expect.objectContaining({
        ayCode: 'AY2026',
        from: expect.any(String),
        to: expect.any(String),
        cmpFrom: null,
        cmpTo: null,
      })
    );
  });

  it('school_admin: change requests awaiting this user as approver', async () => {
    const rows = await getThisTermStats({ ...base, role: 'school_admin' });
    expect(rows).toEqual([
      { label: 'Awaiting your review', value: 3, tone: 'warning' },
    ]);
  });

  it('superadmin: active staff count + current AY', async () => {
    const rows = await getThisTermStats({ ...base, role: 'superadmin' });
    expect(rows).toEqual([
      { label: 'Active staff accounts', value: 28 },
      { label: 'Current AY', value: 'AY2026', tone: 'default' },
    ]);
  });

  it('p_file_officer: expiring-soon count + already-expired count (filtered from getExpiringDocuments, not the combined priority headline)', async () => {
    const rows = await getThisTermStats({ ...base, role: 'p_file_officer' });
    expect(rows).toEqual([
      { label: 'Expiring within 30 days', value: 12, tone: 'warning' },
      // Mock data has exactly 2 rows with daysUntilExpiry < 0 (-5, -1).
      { label: 'Already expired', value: 2, tone: 'warning' },
    ]);
    expect(getExpiringDocuments).toHaveBeenCalledWith('AY2026', 60, 10_000);
    expect(getPFilesKpisRange).toHaveBeenCalledWith(
      expect.objectContaining({
        ayCode: 'AY2026',
        from: expect.any(String),
        to: expect.any(String),
        cmpFrom: null,
        cmpTo: null,
      })
    );
  });

  it('admissions: applications needing follow-up', async () => {
    const rows = await getThisTermStats({ ...base, role: 'admissions' });
    expect(rows).toEqual([
      { label: 'Applications needing follow-up', value: 5, tone: 'warning' },
    ]);
  });

  it('omits a role branch row entirely when its underlying call throws (no fake zero) — sync rows still ship', async () => {
    vi.mocked(getStaffCount).mockRejectedValueOnce(new Error('boom'));
    const rows = await getThisTermStats({ ...base, role: 'superadmin' });
    // "Active staff accounts" is omitted (its push() threw); Current AY is a
    // plain synchronous fact with nothing that can throw, so it still ships.
    expect(rows).toEqual([
      { label: 'Current AY', value: 'AY2026', tone: 'default' },
    ]);
  });
});
