import { describe, expect, it, vi } from 'vitest';

// Regression test for the KD #88 slot_index ceiling guard in
// POST /api/change-requests. Migration 080 dropped
// subject_configs.level_id; the guard's lookup used to filter on that
// dropped column, so `configRow` silently resolved to null and the whole
// ceiling check became a no-op (a teacher could file a change request for
// a WW/PT slot index beyond the subject's real ww_max_slots/pt_max_slots
// with zero guard). This test exercises the real POST handler end-to-end
// and asserts the 422 fires again.

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-registrar', email: 'registrar@hfse.test' },
      role: 'registrar',
    })
  ),
}));

// zod's .uuid() enforces the RFC-4122 variant nibble (8/9/a/b in the third
// group's leading hex digit) — plain repeated-digit strings like
// '11111111-1111-1111-1111-111111111111' fail validation.
const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const APPROVER_1 = '33333333-3333-4333-8333-333333333333';
const APPROVER_2 = '44444444-4444-4444-8444-444444444444';

vi.mock('@/lib/sis/approvers/queries', () => ({
  listApproversForFlow: vi.fn(() =>
    Promise.resolve([
      { user_id: APPROVER_1, email: 'a1@hfse.test', display_name: 'A1' },
      { user_id: APPROVER_2, email: 'a2@hfse.test', display_name: 'A2' },
    ])
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(() =>
    Promise.resolve({ student_label: null, sheet_label: null })
  ),
  fetchRegistrarEmails: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyRequestFiled: vi.fn(() => Promise.resolve({ sent: 0, failed: 0 })),
  notifyApprovedNotApplied: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => Promise.resolve({ data: [] }) }),
        }),
      }),
    })
  ),
}));

const SECTION_ROW = {
  id: 'section-1',
  level_id: 'level-1',
  academic_year_id: 'ay-1',
};
// ww_max_slots = 3 — valid slot indices are 0..2. The test files a
// request for slot_index 3 (schema max is 4, so it's a legal payload but
// beyond this subject's real max), which must 422.
const CONFIG_ROW = { ww_max_slots: 3, pt_max_slots: 5 };

vi.mock('@/lib/supabase/service', () => {
  const single = (data: unknown) => ({
    single: () => Promise.resolve({ data, error: null }),
  });
  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'grading_sheets') {
          return {
            select: () => ({
              eq: () =>
                single({
                  id: 'sheet-1',
                  section_id: 'section-1',
                  subject_id: 'subject-1',
                  is_locked: true,
                }),
            }),
          };
        }
        if (table === 'grade_entries') {
          return {
            select: () => ({
              eq: () =>
                single({
                  id: 'entry-1',
                  grading_sheet_id: 'sheet-1',
                  ww_scores: [8, 9],
                  pt_scores: [7, 8, 9],
                  qa_score: 20,
                  letter_grade: null,
                  is_na: false,
                }),
            }),
          };
        }
        if (table === 'sections') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: SECTION_ROW, error: null }),
              }),
            }),
          };
        }
        if (table === 'subject_configs') {
          // Pattern B: filtered by academic_year_id + subject_id only —
          // no level_id chain link. Any number of .eq() calls resolves
          // to the same canned row so the test doesn't hard-code the
          // exact chain shape.
          const chain = {
            eq: () => chain,
            maybeSingle: () =>
              Promise.resolve({ data: CONFIG_ROW, error: null }),
          };
          return { select: () => chain };
        }
        if (table === 'grade_change_requests') {
          return {
            insert: () => ({
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: 'req-1' },
                    error: null,
                  }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        }
        throw new Error(`unexpected table in test mock: ${table}`);
      },
    })),
  };
});

import { POST } from '@/app/api/change-requests/route';

function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/change-requests', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

describe('POST /api/change-requests — slot_index ceiling guard', () => {
  it('422s when slot_index is beyond the subject config max (post-080 lookup restored)', async () => {
    // Cast: `NextResponse.json(...) | undefined` is TS's inferred return
    // type for both handlers in this route file (a pre-existing quirk —
    // verified via a standalone probe against the unmodified GET handler
    // too, not something introduced by this fix) even though every code
    // path returns a real Response at runtime.
    const res = (await POST(
      buildRequest({
        grading_sheet_id: SHEET_ID,
        grade_entry_id: ENTRY_ID,
        field_changed: 'ww_scores',
        slot_index: 3,
        current_value: null,
        proposed_value: '85',
        reason_category: 'regrading',
        justification: 'Re-scored after a re-check of the raw paper.',
        primary_approver_id: APPROVER_1,
        secondary_approver_id: APPROVER_2,
      })
    )) as Response;
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('slot 4');
    expect(body.error).toContain('maximum is 3');
  });

  it('lets a request through when slot_index is within the subject config max', async () => {
    const res = (await POST(
      buildRequest({
        grading_sheet_id: SHEET_ID,
        grade_entry_id: ENTRY_ID,
        field_changed: 'ww_scores',
        slot_index: 1,
        current_value: null,
        proposed_value: '85',
        reason_category: 'regrading',
        justification: 'Re-scored after a re-check of the raw paper.',
        primary_approver_id: APPROVER_1,
        secondary_approver_id: APPROVER_2,
      })
    )) as Response;
    expect(res.status).toBe(201);
  });
});
