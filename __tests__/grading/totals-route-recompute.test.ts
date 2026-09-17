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

const logAction = vi.fn((_args: Record<string, unknown>) => Promise.resolve());
const logActions = vi.fn(
  (_service: unknown, _actor: unknown, _rows: Array<Record<string, unknown>>) =>
    Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: Record<string, unknown>) => logAction(args),
  logActions: (
    service: unknown,
    actor: unknown,
    rows: Array<Record<string, unknown>>
  ) => logActions(service, actor, rows),
}));

// The REAL diff builder, so the tests below see real totals rows; only the
// grade_audit_log insert is stubbed.
const writeAuditRows = vi.fn((_s: unknown, _rows: unknown[]) =>
  Promise.resolve(true)
);
vi.mock('@/lib/audit/log-grade-change', async () => {
  const real = await vi.importActual<
    typeof import('@/lib/audit/log-grade-change')
  >('@/lib/audit/log-grade-change');
  return {
    buildTotalsAuditRows: real.buildTotalsAuditRows,
    writeAuditRows: (s: unknown, rows: unknown[]) => writeAuditRows(s, rows),
  };
});

vi.mock('@/lib/grading/sheet-audit-labels', () => ({
  loadOneSheetAuditLabels: vi.fn(() =>
    Promise.resolve({
      subject_name: 'Maths',
      section_name: 'Diamond',
      level_label: 'Primary 5',
      term_label: 'Term 2',
    })
  ),
  loadEntryStudentLabels: vi.fn((_s: unknown, ids: string[]) =>
    Promise.resolve(
      new Map(
        ids.map((id) => [
          id,
          { student_number: `S-${id}`, student_name: `Student ${id}` },
        ])
      )
    )
  ),
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
/** Entry ids whose UPDATE should fail, to stage a half-finished recompute. */
let failingEntryIds: Set<string>;

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
              if (failingEntryIds.has(id))
                return Promise.resolve({ error: { message: 'boom' } });
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
    vi.clearAllMocks();
    sheetPatches = [];
    entryPatches = [];
    failingEntryIds = new Set();
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

  it('removing a slot logs every mark it cleared, per student', async () => {
    entryRows.push({
      id: 'e-2',
      ww_scores: [9, null],
      pt_scores: [5, 5, 5],
      qa_score: null,
    });
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    const res = await PATCH(patchRequest({ ww_totals: [10] }), { params });
    expect(res?.status).toBe(200);

    // e-1 had 10 in WW2; e-2's WW2 was blank, and a blank lost is nothing lost.
    expect(logActions).toHaveBeenCalledTimes(1);
    const rows = logActions.mock.calls[0][2];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'entry.update',
      entityType: 'grade_entry',
      entityId: 'e-1',
      context: {
        field: 'ww_scores[1]',
        old: '10',
        new: null,
        cleared_by_slot_removal: true,
        student_number: 'S-e-1',
        section_name: 'Diamond',
        was_locked: false,
      },
    });
    // Unlocked: the post-lock table is not written.
    expect(writeAuditRows).not.toHaveBeenCalled();
    // And the slot going away is its own totals row.
    expect(
      logAction.mock.calls.some(
        (c) => (c[0].context as SbRow).field === 'ww_totals[1]'
      )
    ).toBe(true);
  });

  it('after a lock, cleared marks also land in grade_audit_log with the reference', async () => {
    sheetRow.is_locked = true;
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    const res = await PATCH(
      patchRequest({
        ww_totals: [10],
        correction_reason: 'formula_fix',
        correction_justification: 'The second written work was never given.',
      }),
      { params }
    );
    expect(res?.status).toBe(200);

    const clearedWrite = writeAuditRows.mock.calls
      .map((c) => c[1] as SbRow[])
      .find((rows) =>
        rows.some(
          (r) =>
            r.grade_entry_id === 'e-1' &&
            r.new_value === null &&
            r.field_changed === 'ww_scores[1]'
        )
      );
    expect(clearedWrite).toBeDefined();
    expect(clearedWrite![0].approval_reference).toMatch(
      /^Data entry correction/
    );
    expect(logActions.mock.calls[0][2][0]).toMatchObject({
      action: 'grade_correction',
    });
  });

  it('logs a totals change on a sheet nobody has scored yet', async () => {
    entryRows = [];
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    await PATCH(patchRequest({ qa_total: 60 }), { params });

    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'totals.update',
      context: { field: 'qa_total', old: '30', new: '60' },
    });
  });

  it('a failed recompute still logs what was saved, then answers 500', async () => {
    entryRows.push({
      id: 'e-2',
      ww_scores: [9, 7],
      pt_scores: [5, 5, 5],
      qa_score: null,
    });
    failingEntryIds = new Set(['e-2']);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { PATCH } =
      await import('@/app/api/grading-sheets/[id]/totals/route');
    const res = await PATCH(patchRequest({ ww_totals: [10] }), { params });
    expect(res?.status).toBe(500);

    const totalsRow = logAction.mock.calls.find(
      (c) => (c[0].context as SbRow).field === 'ww_totals[1]'
    );
    expect(totalsRow?.[0].context).toMatchObject({
      partial: true,
      failed_step: 'recompute',
    });
    // e-1's write landed, so its cleared mark is logged; e-2's did not.
    const cleared = logActions.mock.calls[0][2];
    expect(cleared.map((r) => r.entityId)).toEqual(['e-1']);
    errors.mockRestore();
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
