/**
 * PATCH /api/sis/admin/subjects/[configId] — the recompute that was missing.
 *
 * `sync_grading_sheets_from_config` moves the denominators on every unlocked
 * sheet for a config and cannot recompute the grades hanging off them, because
 * a SQL function can't call lib/compute/quarterly.ts. The stored
 * quarterly_grade is what the report card prints, so the gap produced wrong
 * printed grades that stayed wrong until someone happened to re-save a score.
 *
 * These tests pin the four properties the fix rests on: the recompute runs,
 * it runs before AND after migration 107 lands, a sheet locked mid-flight is
 * never touched, and a failure is loud rather than a green toast over bad data.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-admin', email: 'admin@hfse.test' },
      role: 'school_admin',
    })
  ),
}));

const logAction = vi.fn((_c: { context: Record<string, unknown> }) =>
  Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (c: { context: Record<string, unknown> }) => logAction(c),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

type SbRow = Record<string, unknown>;

const CONFIG_ID = '11111111-1111-4111-8111-111111111111';
const SHEET_OPEN = 'aaaaaaaa-1111-4111-8111-111111111111';
const SHEET_LOCKED = 'bbbbbbbb-2222-4222-8222-222222222222';

let rpcResult: SbRow | null;
let rpcError: { message: string } | null;
let sheetsById: Record<string, SbRow>;
let fallbackSheetIds: string[];
let entryUpdates: Array<{ id: string; patch: SbRow }>;
let sheetUpdates: Array<{ id: string; patch: SbRow }>;
let entryReadFailure: string | null;
// Three separate reads take the `.eq(config).eq(is_locked)` shape: the
// truncation scan, the prior-qa snapshot, and — only when the RPC gives no
// `sheet_ids` — the sheet-id fallback. Counting is how we tell whether the
// fallback ran, since all three select the same way.
let sheetEqQueries: number;
const BASELINE_SHEET_QUERIES = 2;

const CONFIG_ROW = {
  id: CONFIG_ID,
  academic_year_id: 'ay-1',
  subject_id: 'subj-1',
  ww_weight: 0.4,
  pt_weight: 0.4,
  qa_weight: 0.2,
  ww_max_slots: 2,
  pt_max_slots: 3,
  qa_max: 60,
  weights_confirmed: true,
};

// Canonical Hard Rule #1 student, stored against qa_total 30.
const ENTRY = {
  id: 'e-1',
  ww_scores: [10, 10],
  pt_scores: [6, 10, 10],
  qa_score: 22,
  ww_ps: 100,
  pt_ps: 86.6667,
  qa_ps: 73.3333,
  initial_grade: 89.3333,
  quarterly_grade: 93,
};

function buildService() {
  return {
    rpc: (_name: string, _args: SbRow) =>
      Promise.resolve({ data: rpcResult, error: rpcError }),
    from(table: string) {
      if (table === 'subject_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: CONFIG_ROW, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'grading_sheets') {
        return {
          // Rule 2 writes qa_total here when a sheet adopts the new default.
          update: (patch: SbRow) => ({
            eq: (_col: string, id: string) => {
              sheetUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
          select: () => ({
            // `.in('id', ids)` — the re-read that catches a mid-flight lock.
            in: (_col: string, ids: string[]) =>
              Promise.resolve({
                data: ids.map((id) => sheetsById[id]).filter(Boolean),
                error: null,
              }),
            // `.eq('subject_config_id', ...).eq('is_locked', false)` — used by
            // the sheet-id fallback, the truncation scan, and the prior-qa
            // snapshot. Carries qa_total so the snapshot is meaningful.
            eq: () => ({
              eq: () => {
                sheetEqQueries += 1;
                return Promise.resolve({
                  data: fallbackSheetIds.map((id) => ({
                    id,
                    qa_total:
                      (sheetsById[id] as { qa_total?: number } | undefined)
                        ?.qa_total ?? null,
                  })),
                  error: null,
                });
              },
            }),
          }),
        };
      }
      if (table === 'grade_entries') {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve(
                  entryReadFailure
                    ? { data: null, error: { message: entryReadFailure } }
                    : { data: [ENTRY], error: null }
                ),
            }),
            // findTruncationBlockers — scans for marks in slots that would be
            // dropped. ENTRY fills exactly the slots the config allows, so
            // this returns no blockers and the save proceeds.
            in: () =>
              Promise.resolve({
                data: [
                  {
                    grading_sheet_id: SHEET_OPEN,
                    ww_scores: ENTRY.ww_scores,
                    pt_scores: ENTRY.pt_scores,
                  },
                ],
                error: null,
              }),
          }),
          update: (patch: SbRow) => ({
            eq: (_col: string, id: string) => {
              entryUpdates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'academic_years') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { ay_code: 'AY9999' }, error: null }),
            }),
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
  return { json: () => Promise.resolve(body) } as unknown as Request;
}

const params = Promise.resolve({ configId: CONFIG_ID });

// A real change vs CONFIG_ROW, so the no-op guard doesn't short-circuit.
const CHANGED_BODY = {
  ww_weight: 40,
  pt_weight: 40,
  qa_weight: 20,
  ww_max_slots: 2,
  pt_max_slots: 3,
  qa_max: 100,
};

async function callPatch(body: SbRow = CHANGED_BODY) {
  const { PATCH } =
    await import('@/app/api/sis/admin/subjects/[configId]/route');
  return PATCH(patchRequest(body) as never, { params });
}

describe('subject-config save — grading sheets are recomputed, not just resized', () => {
  beforeEach(() => {
    logAction.mockClear();
    entryUpdates = [];
    sheetUpdates = [];
    entryReadFailure = null;
    sheetEqQueries = 0;
    rpcError = null;
    rpcResult = {
      updated_sheets: 1,
      updated_entries: 1,
      sheet_ids: [SHEET_OPEN],
    };
    fallbackSheetIds = [SHEET_OPEN];
    sheetsById = {
      [SHEET_OPEN]: {
        id: SHEET_OPEN,
        is_locked: false,
        ww_totals: [10, 10],
        pt_totals: [10, 10, 10],
        qa_total: 60, // moved from 30 — every grade must be rewritten
      },
      [SHEET_LOCKED]: {
        id: SHEET_LOCKED,
        is_locked: true,
        ww_totals: [10, 10],
        pt_totals: [10, 10, 10],
        qa_total: 60,
      },
    };
  });

  it('recomputes the sheets the RPC reports touching', async () => {
    const res = await callPatch();
    expect(res?.status).toBe(200);

    expect(entryUpdates).toHaveLength(1);
    // qa moved 30 -> 60, so the stored 93 cannot survive.
    expect(entryUpdates[0].patch.quarterly_grade).not.toBe(93);
  });

  it('falls back to its own query when the RPC predates migration 107', async () => {
    // Deploy-order safety: the code must work before 107 adds `sheet_ids`.
    rpcResult = { updated_sheets: 1, updated_entries: 1 };

    await callPatch();

    expect(sheetEqQueries).toBe(BASELINE_SHEET_QUERIES + 1);
    expect(entryUpdates).toHaveLength(1);
  });

  it('does NOT run the fallback query when the RPC supplies sheet_ids', async () => {
    // The inverse. Reading the ids from the RPC is what closes the race where
    // a sheet locked mid-flight gets resized but never recomputed.
    await callPatch();
    expect(sheetEqQueries).toBe(BASELINE_SHEET_QUERIES);
  });

  it('never touches a sheet that got locked mid-flight', async () => {
    // Hard Rule #5 — a background recompute must not be a post-lock edit.
    // The RPC saw it unlocked; by the re-read it is locked.
    rpcResult = {
      updated_sheets: 1,
      updated_entries: 1,
      sheet_ids: [SHEET_LOCKED],
    };

    await callPatch();

    expect(entryUpdates).toEqual([]);
    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.sheets_skipped_locked).toBe(1);
    expect(ctx.sheets_synced).toBe(0);
  });

  it('leaves a section-specific exam total alone (Rule 2)', async () => {
    // The sheet holds 140 while the subject default was 60 — someone set that
    // deliberately for this class. Raising qa_max to 100 for the SOW must not
    // revert it, and the recompute must use 140, not 100.
    sheetsById[SHEET_OPEN].qa_total = 140;
    fallbackSheetIds = [SHEET_OPEN];

    await callPatch();

    const qaWrites = sheetUpdates.filter((u) => 'qa_total' in u.patch);
    expect(qaWrites).toEqual([]);

    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.qa_totals_preserved).toBe(1);
    expect(ctx.qa_totals_applied).toBe(0);
  });

  it('adopts the new exam total on an uncustomised sheet (Rule 2)', async () => {
    // Still sitting at the old subject default of 60, so it follows the SOW
    // up to 100.
    sheetsById[SHEET_OPEN].qa_total = 60;

    await callPatch();

    const qaWrites = sheetUpdates.filter((u) => 'qa_total' in u.patch);
    expect(qaWrites).toHaveLength(1);
    expect(qaWrites[0].patch.qa_total).toBe(100);

    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.qa_totals_applied).toBe(1);
  });

  it('reports the recompute counts in the audit row', async () => {
    await callPatch();
    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.sheets_synced).toBe(1);
    expect(ctx.entries_scanned).toBe(1);
    expect(ctx.entries_recomputed).toBe(1);
  });

  it('fails loudly when the recompute breaks, and still writes an audit row', async () => {
    // The old behaviour was console.error + a 200. That is a green toast over
    // silently-wrong report cards.
    entryReadFailure = 'connection reset';

    const res = await callPatch();
    expect(res?.status).toBe(500);

    const body = await res!.json();
    expect(body.config_updated).toBe(true);
    expect(body.sync_failed).toBe(true);
    expect(body.resync_href).toContain('/resync');

    // The trail must still record that the config moved and the sync did not.
    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.sync_error).toContain('connection reset');
  });

  it('does nothing at all when the config is unchanged', async () => {
    const res = await callPatch({
      ww_weight: 40,
      pt_weight: 40,
      qa_weight: 20,
      ww_max_slots: 2,
      pt_max_slots: 3,
      qa_max: 60,
    });

    expect(res?.status).toBe(200);
    expect(await res!.json()).toMatchObject({ ok: true, changed: false });
    expect(entryUpdates).toEqual([]);
    expect(logAction).not.toHaveBeenCalled();
  });
});
