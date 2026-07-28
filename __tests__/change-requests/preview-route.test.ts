import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'user-1', email: 'teacher@hfse.test' },
      role: 'teacher',
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

const previewMock = vi.fn(async () => [
  {
    id: 'cr-1',
    field_changed: 'ww_scores',
    reason_category: 'regrading',
    requested_at: '2026-07-27T00:00:00.000Z',
    grading_sheet_id: 'sheet-1',
    grade_entry_id: 'entry-1',
    student_label: 'Tan, Grace (STU-001)',
    sheet_label: 'P4 Obedience · English · Term 1',
  },
]);
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestPreview: (...args: unknown[]) => previewMock(...args),
}));

import { GET } from '@/app/api/change-requests/preview/route';

describe('GET /api/change-requests/preview', () => {
  it('returns rows scoped to the caller role/id, capped at 5', async () => {
    const res = await GET(
      new Request('http://localhost/api/change-requests/preview') as never
    );
    const body = await res.json();

    expect(previewMock).toHaveBeenCalledWith(
      expect.anything(),
      'teacher',
      'user-1',
      5
    );
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe('cr-1');
  });
});
