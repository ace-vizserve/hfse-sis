/**
 * POST /api/grading-sheets — the Term 4 framework paths (KD #230).
 *
 * Creating a section makes a standard sheet for every subject × term, so a
 * class's Term 4 sheet usually exists before anyone asks for a framework one.
 * The route converts that sheet in place when nothing was entered on it, and
 * refuses in plain English otherwise.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-coord', email: 'coord@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

const logAction = vi.fn((_args: Record<string, unknown>) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: Record<string, unknown>) => logAction(args),
}));

vi.mock('@/lib/grading/sheet-audit-labels', () => ({
  loadOneSheetAuditLabels: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

let removable = true;
vi.mock('@/lib/grading/sheet-removal', () => ({
  loadSheetRemovability: vi.fn((_s: unknown, sheets: Array<{ id: string }>) =>
    Promise.resolve(
      new Map(
        sheets.map((s) => [
          s.id,
          removable
            ? { removable: true, reason: null, entryCount: 2 }
            : {
                removable: false,
                block: 'entered',
                reason: 'x',
                entryCount: 2,
              },
        ])
      )
    )
  ),
}));

type Op = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

let ops: Op[];
let termNumber: number;
let existingSheet: Record<string, unknown> | null;
let insertError: { code?: string; message: string } | null;

function resolve(q: Op): { data: unknown; error: unknown } {
  switch (q.table) {
    case 'sections':
      return {
        data: { id: 'sec', level_id: 'lvl', academic_year_id: 'ay' },
        error: null,
      };
    case 'subject_configs':
      return {
        data: { id: 'cfg', ww_max_slots: 5, pt_max_slots: 5 },
        error: null,
      };
    case 'subjects':
      return { data: { is_examinable: true }, error: null };
    case 'terms':
      return { data: { term_number: termNumber }, error: null };
    case 'academic_years':
      return { data: { ay_code: 'AY2026' }, error: null };
    case 'section_students':
      return { data: [], error: null };
    case 'grade_entries':
      return { data: [{ id: 'e1' }, { id: 'e2' }], error: null };
    case 'grading_sheets':
      if (q.op === 'insert')
        return insertError
          ? { data: null, error: insertError }
          : { data: { id: 'new-sheet' }, error: null };
      if (q.op === 'update') return { data: null, error: null };
      return { data: existingSheet, error: null };
  }
  return { data: null, error: null };
}

function buildService() {
  return {
    from(table: string) {
      const q: Op = { table, op: 'select', filters: [] };
      ops.push(q);
      const b: Record<string, unknown> = {};
      const chain = () => b;
      b.select = (..._a: unknown[]) => {
        return b;
      };
      b.insert = (payload: unknown) => {
        q.op = 'insert';
        q.payload = payload;
        return b;
      };
      b.update = (payload: unknown) => {
        q.op = 'update';
        q.payload = payload;
        return b;
      };
      b.eq = (col: string, v: unknown) => {
        q.filters.push([col, v]);
        return b;
      };
      b.in = chain;
      b.order = chain;
      b.single = () => Promise.resolve(resolve(q));
      b.maybeSingle = () => Promise.resolve(resolve(q));
      b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(q)).then(ok, bad);
      return b;
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

import { POST } from '@/app/api/grading-sheets/route';

function req(body: Record<string, unknown>): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

async function post(r: NextRequest) {
  const res = await POST(r);
  if (!res) throw new Error('no response');
  return res;
}

const base = { term_id: 't4', section_id: 'sec', subject_id: 'subj' };

beforeEach(() => {
  ops = [];
  termNumber = 4;
  existingSheet = null;
  insertError = null;
  removable = true;
  logAction.mockClear();
});

describe('POST /api/grading-sheets — Term 4 framework', () => {
  it('refuses a framework sheet on a term other than Term 4', async () => {
    termNumber = 2;
    const res = await post(req({ ...base, sheet_type: 'term4_framework' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'A Term 4 framework sheet is only for Term 4.'
    );
  });

  it('refuses when the class already has a framework sheet', async () => {
    existingSheet = {
      id: 'old',
      sheet_type: 'term4_framework',
      is_locked: false,
    };
    const res = await post(req({ ...base, sheet_type: 'term4_framework' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'This class already has a Term 4 framework sheet for this subject.'
    );
  });

  it('refuses when the existing standard sheet has scores', async () => {
    existingSheet = { id: 'old', sheet_type: 'standard', is_locked: false };
    removable = false;
    const res = await post(req({ ...base, sheet_type: 'term4_framework' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/with scores in it/);
    expect(ops.some((o) => o.op === 'update')).toBe(false);
  });

  it('converts an empty standard sheet in place', async () => {
    existingSheet = {
      id: 'old',
      sheet_type: 'standard',
      is_locked: false,
      ww_totals: [10, 10],
      pt_totals: [10],
      qa_total: 30,
    };
    const res = await post(req({ ...base, sheet_type: 'term4_framework' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'old' });

    const sheetUpdate = ops.find(
      (o) => o.table === 'grading_sheets' && o.op === 'update'
    );
    expect(sheetUpdate?.payload).toMatchObject({
      sheet_type: 'term4_framework',
      ww_totals: [100],
      pt_totals: [30],
      qa_total: 100,
      ww_weight: 0.5,
      pt_weight: 0.2,
      qa_weight: 0.3,
    });
    const entryReset = ops.find(
      (o) => o.table === 'grade_entries' && o.op === 'update'
    );
    expect(entryReset?.payload).toEqual({
      ww_scores: [],
      pt_scores: [],
      qa_score: null,
    });
    expect(entryReset?.filters).toContainEqual(['grading_sheet_id', 'old']);
    expect(ops.some((o) => o.op === 'insert')).toBe(false);

    expect(logAction).toHaveBeenCalledTimes(1);
    const ctx = logAction.mock.calls[0][0].context as Record<string, unknown>;
    expect(logAction.mock.calls[0][0].action).toBe('sheet.create');
    expect(ctx.converted_from).toBe('standard');
    expect(ctx.entries_reset).toBe(2);
  });

  it('logs the enforced shape, not what the client sent', async () => {
    const res = await post(
      req({
        ...base,
        sheet_type: 'term4_framework',
        ww_totals: [10, 10],
        pt_totals: [5],
        qa_total: 40,
      })
    );
    expect(res.status).toBe(200);
    const ctx = logAction.mock.calls[0][0].context as Record<string, unknown>;
    expect(ctx.ww_totals).toEqual([100]);
    expect(ctx.pt_totals).toEqual([30]);
    expect(ctx.qa_total).toBe(100);
  });

  it('answers a duplicate standard sheet in plain English', async () => {
    insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    const res = await post(
      req({ ...base, ww_totals: [10], pt_totals: [10], qa_total: 30 })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'This class already has a sheet for this subject in this term.'
    );
  });
});
