/**
 * PATCH /api/grading-sheets/[id]/sheet-type — the route half of "Switch sheet
 * type" (KD #230 update, 2026-10-08). The switch itself is one database call
 * (migration 185, covered by supabase/tests/term4_framework_test.sql); this
 * pins what the route does around it: validation, the refusal status, and the
 * one audit row that keeps every cleared score.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  loadOneSheetAuditLabels: vi.fn(() =>
    Promise.resolve({ subject_name: 'Maths', term_label: 'Term 4' })
  ),
}));

const invalidateDrillTags = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...a: unknown[]) => invalidateDrillTags(...a),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
let rpcResult: {
  data: unknown;
  error: { code: string; message: string } | null;
};
const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) =>
  Promise.resolve(rpcResult)
);

function single(data: unknown) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }),
    }),
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
    from: (table: string) =>
      table === 'grading_sheets'
        ? single({
            term_id: 't4',
            section_id: 'sec',
            subject_id: 'sub',
            section: { academic_year_id: 'ay' },
          })
        : single({ ay_code: 'AY2026' }),
  }),
}));

import { PATCH } from '@/app/api/grading-sheets/[id]/sheet-type/route';

const call = async (body: unknown) => {
  const res = await PATCH(
    new NextRequest(`http://x/api/grading-sheets/${SHEET_ID}/sheet-type`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: SHEET_ID }) }
  );
  if (!res) throw new Error('no response');
  return res;
};

describe('PATCH /api/grading-sheets/[id]/sheet-type', () => {
  beforeEach(() => {
    logAction.mockClear();
    rpc.mockClear();
    invalidateDrillTags.mockClear();
    rpcResult = {
      data: {
        from: 'standard',
        to: 'term4_framework',
        cleared_count: 1,
        cleared: [{ entry_id: 'e1', ww_scores: [8, 9], qa_score: 20 }],
        slot_labels: null,
      },
      error: null,
    };
  });

  it('refuses an unknown type without touching the database', async () => {
    const res = await call({ sheet_type: 'holistic' });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('switches, and keeps every cleared score in one audit row', async () => {
    const res = await call({ sheet_type: 'term4_framework' });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('switch_grading_sheet_type', {
      p_sheet_id: SHEET_ID,
      p_sheet_type: 'term4_framework',
    });
    expect(logAction).toHaveBeenCalledTimes(1);
    const row = logAction.mock.calls[0][0] as {
      action: string;
      context: Record<string, unknown>;
    };
    expect(row.action).toBe('sheet.switch_type');
    expect(row.context).toMatchObject({
      subject_name: 'Maths',
      from: 'standard',
      to: 'term4_framework',
      cleared_count: 1,
      cleared: [{ entry_id: 'e1', ww_scores: [8, 9], qa_score: 20 }],
      ay_code: 'AY2026',
    });
    expect(invalidateDrillTags).toHaveBeenCalledWith('markbook', 'AY2026');
  });

  it("a refusal (HFT4F) is a 400 with the database's own words, and no audit row", async () => {
    rpcResult = {
      data: null,
      error: {
        code: 'HFT4F',
        message: 'Unlock the sheet before switching its type.',
      },
    };
    const res = await call({ sheet_type: 'standard' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Unlock the sheet before switching its type.',
    });
    expect(logAction).not.toHaveBeenCalled();
  });

  it('any other database error is a 500', async () => {
    rpcResult = { data: null, error: { code: 'XX000', message: 'boom' } };
    const res = await call({ sheet_type: 'standard' });
    expect(res.status).toBe(500);
  });
});
