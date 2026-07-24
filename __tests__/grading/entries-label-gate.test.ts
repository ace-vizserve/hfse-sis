import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── First-score label gate — server-side enforcement on the entries route ──
// This gate must be its own independent `if (!sheet.is_locked)` block — NOT
// tied to which write-branch executes later (Path B correction lands in the
// same `else` write-branch as a genuinely-unlocked direct write, since
// `appliedChangeRequest` is null for Path B). Tests 7 + 8 below are the
// regression guard for that property: they set up a locked sheet with an
// unlabeled slot receiving its first-ever score (a scenario that WOULD 422
// if the gate ran) and assert both that the response is a clean 200 AND
// that the gate's roster-fetch never happened.

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-coordinator', email: 'coordinator@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY9999')),
}));

vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyRequestApplied: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchApproverEmails: vi.fn(() => Promise.resolve([])),
  fetchLabels: vi.fn(() =>
    Promise.resolve({ student_label: null, sheet_label: null })
  ),
}));

// ── Minimal chainable Supabase service-client stub ─────────────────────────
// Mirrors the pattern in __tests__/change-requests/slot-index-ceiling.test.ts
// (a per-table `from(table)` switch returning canned chains) but built with
// a mutable `currentService` so each `it()` can supply its own scenario —
// necessary here since 8 distinct scenarios share one route under test.

type SbRow = Record<string, unknown>;

function buildService(opts: {
  sheet: SbRow;
  entry: SbRow;
  roster?: SbRow[];
  changeRequest?: SbRow | null;
}) {
  const calls = {
    rosterFetchCount: 0,
    sheetLabelUpdatePatches: [] as SbRow[],
    entryUpdatePatches: [] as SbRow[],
    updateOrder: [] as string[],
  };

  const service = {
    from(table: string) {
      if (table === 'grading_sheets') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: opts.sheet, error: null }),
            }),
          }),
          update: (patch: SbRow) => {
            calls.sheetLabelUpdatePatches.push(patch);
            calls.updateOrder.push('sheet-label');
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'grade_entries') {
        return {
          select: (_cols: string) => ({
            eq: (col: string) => {
              if (col === 'id') {
                return {
                  single: () =>
                    Promise.resolve({ data: opts.entry, error: null }),
                };
              }
              if (col === 'grading_sheet_id') {
                calls.rosterFetchCount += 1;
                return Promise.resolve({
                  data: opts.roster ?? [],
                  error: null,
                });
              }
              throw new Error(
                `unexpected eq col on grade_entries select: ${col}`
              );
            },
          }),
          update: (patch: SbRow) => {
            calls.entryUpdatePatches.push(patch);
            calls.updateOrder.push('entry-score');
            return {
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { ...opts.entry, ...patch },
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
      }
      if (table === 'grade_change_requests') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  opts.changeRequest
                    ? { data: opts.changeRequest, error: null }
                    : { data: null, error: { message: 'not found' } }
                ),
            }),
          }),
        };
      }
      if (table === 'grade_audit_log') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    },
    rpc: (_name: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data: null, error: null }),
  };

  return { service, calls };
}

let currentService: unknown = null;
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => currentService,
}));

import { PATCH } from '@/app/api/grading-sheets/[id]/entries/[entryId]/route';

const SHEET_ID = 'sheet-1';
const ENTRY_ID = 'entry-1';

function baseSheet(overrides: SbRow = {}): SbRow {
  return {
    id: SHEET_ID,
    ww_totals: [100, 100],
    pt_totals: [100, 100, 100],
    qa_total: 100,
    is_locked: false,
    slot_labels: null,
    subject: { is_examinable: true },
    subject_config: { ww_weight: 40, pt_weight: 40, qa_weight: 20 },
    ...overrides,
  };
}

function baseEntry(overrides: SbRow = {}): SbRow {
  return {
    id: ENTRY_ID,
    grading_sheet_id: SHEET_ID,
    ww_scores: [null, null],
    pt_scores: [null, null, null],
    qa_score: null,
    letter_grade: null,
    is_na: false,
    ...overrides,
  };
}

function buildRequest(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/grading-sheets/${SHEET_ID}/entries/${ENTRY_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  ) as unknown as import('next/server').NextRequest;
}

function callPatch(body: Record<string, unknown>) {
  return PATCH(buildRequest(body), {
    params: Promise.resolve({ id: SHEET_ID, entryId: ENTRY_ID }),
  }) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentService = null;
});

describe('entries route — first-score label gate', () => {
  it('unlocked sheet, genuine first WW score, no label, no slot_label supplied -> 422 label_required', async () => {
    const { service } = buildService({
      sheet: baseSheet(),
      entry: baseEntry(),
      roster: [],
    });
    currentService = service;

    const res = await callPatch({ ww_scores: [85, null] });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('label_required');
    expect(body.slots).toEqual(['WW1']);
    expect(body.error).toContain('date administered');
  });

  it('unlocked sheet, genuine first WW score, valid slot_label supplied -> 200, label merged before the score write', async () => {
    const { service, calls } = buildService({
      sheet: baseSheet(),
      entry: baseEntry(),
      roster: [],
    });
    currentService = service;

    const res = await callPatch({
      ww_scores: [85, null],
      slot_label: {
        kind: 'ww',
        index: 0,
        meta: { label: 'Quiz 1', date: '2026-01-10' },
      },
    });
    expect(res.status).toBe(200);
    // Label merged before the score write — same order the gate block runs in.
    expect(calls.updateOrder).toEqual(['sheet-label', 'entry-score']);
    expect(calls.sheetLabelUpdatePatches).toHaveLength(1);
    const merged = calls.sheetLabelUpdatePatches[0].slot_labels as {
      ww: ({
        label: string | null;
        date: string | null;
        page: string | null;
      } | null)[];
    };
    expect(merged.ww[0]).toEqual({
      label: 'Quiz 1',
      date: '2026-01-10',
      page: null,
    });
  });

  it('unlocked sheet, slot already scored by another roster row -> 200, no gate even with no label', async () => {
    const { service } = buildService({
      sheet: baseSheet(), // slot_labels: null — no label anywhere
      entry: baseEntry(), // this entry's ww[0] still null
      roster: [
        {
          id: 'entry-2',
          ww_scores: [77, null],
          pt_scores: [null, null, null],
          qa_score: null,
        },
      ],
    });
    currentService = service;

    const res = await callPatch({ ww_scores: [85, null] });
    expect(res.status).toBe(200);
  });

  it("unlocked sheet, editing THIS entry's own existing non-null score -> 200, no gate", async () => {
    const { service } = buildService({
      sheet: baseSheet(), // no label — would matter only for a genuine first score
      entry: baseEntry({ ww_scores: [70, null] }),
      roster: [],
    });
    currentService = service;

    const res = await callPatch({ ww_scores: [90, null] });
    expect(res.status).toBe(200);
  });

  it('unlocked sheet, slot_labels already satisfies the slot -> 200, no gate, no slot_label needed', async () => {
    const { service, calls } = buildService({
      sheet: baseSheet({
        slot_labels: {
          ww: [{ label: 'Quiz 1', date: '2026-01-10', page: null }],
          pt: [],
          qa: null,
        },
      }),
      entry: baseEntry(),
      roster: [],
    });
    currentService = service;

    const res = await callPatch({ ww_scores: [85, null] });
    expect(res.status).toBe(200);
    // No slot_label was supplied and none was needed — no label merge write.
    expect(calls.sheetLabelUpdatePatches).toHaveLength(0);
  });

  it('QA slot: needs only a label, no date required', async () => {
    const { service, calls } = buildService({
      sheet: baseSheet(),
      entry: baseEntry(),
      roster: [],
    });
    currentService = service;

    // No `date` field at all in the supplied meta — QA must still be
    // satisfied by label alone (unlike WW/PT, which also need a date).
    const res = await callPatch({
      qa_score: 20,
      slot_label: {
        kind: 'qa',
        index: null,
        meta: { label: 'Quarterly Assessment' },
      },
    });
    expect(res.status).toBe(200);
    const merged = calls.sheetLabelUpdatePatches[0].slot_labels as {
      qa: string | null;
    };
    expect(merged.qa).toBe('Quarterly Assessment');
  });

  it('locked sheet, Path A change-request apply -> gate never runs (no label_required possible)', async () => {
    const changeRequest = {
      id: 'req-1',
      status: 'approved',
      grading_sheet_id: SHEET_ID,
      grade_entry_id: ENTRY_ID,
      field_changed: 'qa_score',
      slot_index: null,
      proposed_value: '88',
      current_value: null,
      reason_category: 'regrading',
      justification: 'Re-checked the paper and corrected the total.',
      requested_by_email: 'teacher@hfse.test',
      requested_at: '2026-01-01T00:00:00.000Z',
      reviewed_by_email: 'admin@hfse.test',
      primary_reviewed_by_email: 'admin@hfse.test',
      reviewed_at: '2026-01-02T00:00:00.000Z',
      decision_note: null,
    };
    // Deliberately set up as if the gate WOULD fire if it ran: locked
    // sheet, no slot_labels anywhere, entry's qa_score currently null (a
    // genuine "first score" from the gate's point of view).
    const { service, calls } = buildService({
      sheet: baseSheet({ is_locked: true, slot_labels: null }),
      entry: baseEntry({ qa_score: null }),
      roster: [],
      changeRequest,
    });
    currentService = service;

    const res = await callPatch({
      change_request_id: 'req-1',
      patch_target: { field: 'qa_score' },
      qa_score: 88,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).not.toBe('label_required');
    // The proof: the gate's roster-fetch never fired on a locked sheet.
    expect(calls.rosterFetchCount).toBe(0);
  });

  it('locked sheet, Path B correction -> gate never runs', async () => {
    const { service, calls } = buildService({
      sheet: baseSheet({ is_locked: true, slot_labels: null }),
      entry: baseEntry({ qa_score: null }),
      roster: [],
    });
    currentService = service;

    const res = await callPatch({
      correction_reason: 'typo',
      correction_justification: 'Corrected a mis-keyed score after review.',
      qa_score: 88,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).not.toBe('label_required');
    // The proof: the gate's roster-fetch never fired on a locked sheet.
    expect(calls.rosterFetchCount).toBe(0);
  });
});
