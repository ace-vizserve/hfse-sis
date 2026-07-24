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
  // Real shape: PriorityPayload — there is no `overdueCount` field. The
  // function's `headline.value` is overdue-count + due-within-14-days count
  // combined (see lib/p-files/dashboard.ts::getPFilesPriority), so the stat
  // row below reads `headline.value`, not a nonexistent `overdueCount`.
  getPFilesPriority: vi.fn(() => Promise.resolve({ headline: { value: 3 } })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getOutdatedApplications: vi.fn(() => Promise.resolve(new Array(5).fill({}))),
}));

import { getThisTermStats } from '@/lib/account/this-term-stats';
import { getMarkbookKpisRange } from '@/lib/markbook/dashboard';
import { getPFilesKpisRange, getPFilesPriority } from '@/lib/p-files/dashboard';
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

  it('superadmin: active staff count', async () => {
    const rows = await getThisTermStats({ ...base, role: 'superadmin' });
    expect(rows).toEqual([{ label: 'Active staff accounts', value: 28 }]);
  });

  it('p_file_officer: expiring-soon count + priority headline (real getPFilesPriority shape)', async () => {
    const rows = await getThisTermStats({ ...base, role: 'p_file_officer' });
    expect(rows).toEqual([
      { label: 'Expiring within 30 days', value: 12, tone: 'warning' },
      { label: 'Needs urgent attention', value: 3, tone: 'warning' },
    ]);
    // Real PFilesPriorityInput is { ayCode: string } — not a bare string.
    expect(getPFilesPriority).toHaveBeenCalledWith({ ayCode: 'AY2026' });
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

  it('omits a role branch row entirely when its underlying call throws (no fake zero)', async () => {
    vi.mocked(getStaffCount).mockRejectedValueOnce(new Error('boom'));
    const rows = await getThisTermStats({ ...base, role: 'superadmin' });
    expect(rows).toEqual([]);
  });
});
