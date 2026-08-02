/**
 * PATCH /api/grading-sheets/[id]/totals — the recompute half.
 *
 * The route's recompute was extracted into lib/grading/recompute-sheet.ts so
 * the config-level fan-out could share it. The extraction was claimed to be
 * behaviour-preserving, and nothing proved that: totals-editor.test.tsx covers
 * the client component, and no test had ever exercised the route's write path.
 *
 * So this pins what the route actually writes to grade_entries when a
 * denominator moves — the thing a report card prints.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-coord', email: 'coord@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/audit/log-grade-change', () => ({
  buildTotalsAuditRows: vi.fn(() => []),
  writeAuditRows: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY9999')),
}));

type SbRow = Record<string, unknown>;

const SHEET_ID = '11111111-1111-4111-8111-111111111111';

let sheetRow: SbRow;
let entryRows: SbRow[];
let sheetPatches: SbRow[];
let entryPatches: Array<{ id: string; patch: SbRow }>;

function buildService() {
  return {
    from(table: string) {
      if (table === 'grading_sheets') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: sheetRow, error: null }),
            }),
          }),
          update: (patch: SbRow) => {
            sheetPatches.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'grade_entries') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: entryRows, error: null }),
            }),
          }),
          update: (patch: SbRow) => ({
            eq: (_col: string, id: string) => {
              entryPatches.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

function patchRequest(body: SbRow) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import('next/server').NextRequest;
}

const params = Promise.resolve({ id: SHEET_ID });

describe('totals route — recompute on a denominator change', () => {
  beforeEach(() => {
    sheetPatches = [];
    entryPatches = [];
    sheetRow = {
      id: SHEET_ID,
      ww_totals: [10, 10],
      pt_totals: [10, 10, 10],
      qa_total: 30,
      is_locked: false,
      subject_config: {
        ww_weight: 0.4,
        pt_weight: 0.4,
        qa_weight: 0.2,
        ww_max_slots: 5,
        pt_max_slots: 5,
      },
    };
    // The canonical Hard Rule #1 student: 93 under the current totals.
    entryRows = [
      {
        id: 'e-1',
        ww_scores: [10, 10],
        pt_scores: [6, 10, 10],
        qa_score: 22,
        ww_ps: 100,
        pt_ps: 86.6667,
        qa_ps: 73.3333,
        initial_grade: 89.3333,
        quarterly_grade: 93,
      },
    ];
  });

  it('rewrites the derived grade when qa_total changes', async () => {
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    const res = await PATCH(patchRequest({ qa_total: 60 }), { params });
    // `?.` only for tsc — an undefined response still fails this assertion.
    expect(res?.status).toBe(200);

    expect(sheetPatches[0].qa_total).toBe(60);
    expect(entryPatches).toHaveLength(1);
    // 22/60 instead of 22/30 — the grade must fall.
    expect(entryPatches[0].patch.quarterly_grade).not.toBe(93);
    expect(Number(entryPatches[0].patch.qa_ps)).toBeCloseTo(36.6667, 3);
  });

  it('resizes score arrays when a slot is added, padding with null', async () => {
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    await PATCH(patchRequest({ ww_totals: [10, 10, 10] }), { params });

    expect(entryPatches[0].patch.ww_scores).toEqual([10, 10, null]);
    // A null slot is excluded from both sums — Hard Rule #3 — so the grade
    // must NOT move just because a slot was added.
    expect(entryPatches[0].patch.quarterly_grade).toBe(93);
  });

  it('writes nothing to entries when the totals are unchanged', async () => {
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    await PATCH(patchRequest({ qa_total: 30 }), { params });
    expect(entryPatches).toEqual([]);
  });

  it('never writes letter_grade or is_na', async () => {
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    await PATCH(patchRequest({ qa_total: 60 }), { params });

    expect(entryPatches[0].patch).not.toHaveProperty('letter_grade');
    expect(entryPatches[0].patch).not.toHaveProperty('is_na');
  });

  it('still refuses a post-lock edit with no correction reason', async () => {
    sheetRow.is_locked = true;
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    const res = await PATCH(patchRequest({ qa_total: 60 }), { params });

    expect(res?.status).toBe(400);
    // Hard Rule #5 — nothing may be written without an approval reference.
    expect(sheetPatches).toEqual([]);
    expect(entryPatches).toEqual([]);
  });
});
