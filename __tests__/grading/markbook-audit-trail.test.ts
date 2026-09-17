/**
 * Markbook audit-trail gaps, closed.
 *
 * Each case here is a write that used to change data and leave no record, or a
 * record that could not say what it was about:
 *
 *   1. The first score typed for a student INSERTs their row (migration 156),
 *      and the audit trigger was AFTER UPDATE only. Migration 165 widens it.
 *   2. Removing a slot cut real marks off every student and logged only the
 *      maximum going blank — `clearedScoresFor` is what finds those marks.
 *   3. `writeAuditRows` threw AFTER the grade had saved, taking the remaining
 *      audit rows and the teacher's email down with it.
 *   4. The overdue-lock cron exported POST only; Vercel Cron calls GET. A
 *      failed chunk also left earlier locks with no batch row.
 *   5. The labels panel logged "labels updated" with no detail.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearedScoresFor } from '@/lib/grading/recompute-sheet';
import { diffSlotLabels } from '@/lib/grading/slot-label-sanitize';
import { writeAuditRows } from '@/lib/audit/log-grade-change';

describe('migration 165 — the first score is audited', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'supabase/migrations/165_grade_entries_audit_on_insert.sql'
    ),
    'utf8'
  );

  it('fires the audit trigger on INSERT as well as UPDATE', () => {
    expect(sql).toMatch(
      /create trigger grade_entries_audit_trg\s+after insert or update on public\.grade_entries/i
    );
  });

  it('never reads OLD on an insert', () => {
    // Every `old.` reference sits inside the UPDATE branch that copies it
    // into locals; the diff itself reads only the locals.
    const body = sql.slice(
      sql.indexOf('create or replace function public.grade_entries_audit')
    );
    const updateBranch = body.slice(
      body.indexOf("if tg_op = 'UPDATE' then"),
      body.indexOf('end if;', body.indexOf("if tg_op = 'UPDATE' then"))
    );
    const outside = body.replace(updateBranch, '');
    expect(outside).not.toMatch(/\bold\./i);
  });

  it('names the child on the audit row', () => {
    expect(sql).toMatch(/'student_number'/);
    expect(sql).toMatch(/'student_name'/);
  });
});

describe('clearedScoresFor — marks lost to a removed slot', () => {
  it('returns every real score past the new slot count, with its old value', () => {
    expect(
      clearedScoresFor(
        { id: 'e-1', ww_scores: [10, 8, 0], pt_scores: [6, 9] },
        { ww_totals: [10], pt_totals: [10] }
      )
    ).toEqual([
      { entryId: 'e-1', component: 'ww', slotIndex: 1, oldValue: 8 },
      // Zero is a score (Hard Rule #3) — clearing it loses something.
      { entryId: 'e-1', component: 'ww', slotIndex: 2, oldValue: 0 },
      { entryId: 'e-1', component: 'pt', slotIndex: 1, oldValue: 9 },
    ]);
  });

  it('ignores blanks, and a slot being added', () => {
    expect(
      clearedScoresFor(
        { id: 'e-1', ww_scores: [10, null], pt_scores: [6] },
        { ww_totals: [10], pt_totals: [10, 10] }
      )
    ).toEqual([]);
  });
});

describe('writeAuditRows never throws', () => {
  const row = {
    grading_sheet_id: 's',
    grade_entry_id: 'e',
    changed_by: 'x@hfse.test',
    field_changed: 'qa_score',
    old_value: '20',
    new_value: '24',
    approval_reference: 'ref',
  };

  it('answers false on a returned error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = {
      from: () => ({
        insert: async () => ({ error: { message: 'denied' } }),
      }),
    };
    await expect(writeAuditRows(service as never, [row])).resolves.toBe(false);
    errors.mockRestore();
  });

  it('answers false on a thrown error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = {
      from: () => ({
        insert: async () => {
          throw new Error('socket closed');
        },
      }),
    };
    await expect(writeAuditRows(service as never, [row])).resolves.toBe(false);
    errors.mockRestore();
  });

  it('answers true when the rows land', async () => {
    const service = {
      from: () => ({ insert: async () => ({ error: null }) }),
    };
    await expect(writeAuditRows(service as never, [row])).resolves.toBe(true);
  });
});

describe('diffSlotLabels — what the labels panel actually changed', () => {
  it('lists only the slots that moved, named the way a teacher names them', () => {
    const changes = diffSlotLabels(
      {
        ww: [
          { label: 'Worksheet 1', date: '2026-07-01', page: null },
          { label: 'Quiz', date: null, page: null },
        ],
        pt: [{ label: 'Poster', date: null, page: null }],
        qa: 'Exam',
      },
      {
        ww: [
          { label: 'Worksheet 1', date: '2026-07-01', page: null },
          { label: 'Quiz 2', date: null, page: null },
        ],
        pt: [{ label: 'Poster', date: null, page: null }],
        qa: 'Exam',
      }
    );
    expect(changes).toEqual([
      {
        slot: 'WW2',
        old: { label: 'Quiz', date: null, page: null },
        new: { label: 'Quiz 2', date: null, page: null },
      },
    ]);
  });

  it('treats an all-blank slot and a missing one as the same, and sees a QA rename', () => {
    expect(
      diffSlotLabels(
        { ww: [], qa: null },
        { ww: [{ label: null, date: null, page: null }], qa: 'Final exam' }
      )
    ).toEqual([{ slot: 'QA', old: null, new: 'Final exam' }]);
  });

  it('compares only the keys the save carried', () => {
    expect(diffSlotLabels({ pt: [{ label: 'Poster' }] }, { ww: [] })).toEqual(
      []
    );
  });
});

// ── The overdue-lock cron ─────────────────────────────────────────────────

const logAction = vi.fn(async (_a: Record<string, unknown>) => {});
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (a: Record<string, unknown>) => logAction(a),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));
vi.mock('@/lib/grading/sheet-audit-labels', () => ({
  loadSheetAuditLabels: vi.fn(
    async (_s: unknown, ids: string[]) =>
      new Map(
        ids.map((id) => [
          id,
          {
            subject_name: 'Maths',
            section_name: `Class ${id}`,
            level_label: 'Primary 5',
            term_label: 'Term 1',
          },
        ])
      )
  ),
}));

let lockCalls: string[][];
let failOnLockCall: number | null;
let sheetCount: number;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      if (table === 'terms') {
        return {
          select: () => ({
            lt: async () => ({
              data: [
                {
                  id: 't1',
                  label: 'Term 1',
                  academic_year_id: 'ay1',
                  grading_lock_date: '2026-01-01',
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'grading_sheets') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({
                data: Array.from({ length: sheetCount }, (_, i) => ({
                  id: `s${i}`,
                  term_id: 't1',
                })),
                error: null,
              }),
            }),
          }),
          update: () => ({
            in: async (_col: string, ids: string[]) => {
              lockCalls.push(ids);
              if (failOnLockCall === lockCalls.length)
                return { error: { message: 'timeout' } };
              return { error: null };
            },
          }),
        };
      }
      if (table === 'academic_years') {
        return {
          select: () => ({
            in: async () => ({
              data: [{ id: 'ay1', ay_code: 'AY2026' }],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function cronRequest(auth: string | null) {
  return {
    headers: { get: () => auth },
  } as unknown as import('next/server').NextRequest;
}

describe('lock-overdue cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalls = [];
    failOnLockCall = null;
    sheetCount = 3;
    process.env.CRON_SECRET = 'shh';
  });

  it('exports GET — the method Vercel Cron actually calls — and POST', async () => {
    const mod = await import('@/app/api/grading-sheets/lock-overdue/route');
    expect(typeof mod.GET).toBe('function');
    expect(typeof mod.POST).toBe('function');
  });

  it('GET still refuses without the cron secret', async () => {
    const { GET } = await import('@/app/api/grading-sheets/lock-overdue/route');
    const res = await GET(cronRequest(null));
    expect(res.status).toBe(401);
    expect(lockCalls).toEqual([]);
  });

  it('GET locks the overdue sheets and logs the batch with the classes named', async () => {
    const { GET } = await import('@/app/api/grading-sheets/lock-overdue/route');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await GET(cronRequest('Bearer shh'));
    expect(res.status).toBe(200);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'sheet.lock_overdue_batch',
      context: {
        locked_count: 3,
        sheet_ids: ['s0', 's1', 's2'],
        sheets: expect.arrayContaining([
          expect.objectContaining({
            grading_sheet_id: 's0',
            section_name: 'Class s0',
            term_label: 'Term 1',
          }),
        ]),
      },
    });
    info.mockRestore();
  });

  it('a failed chunk still logs the sheets already locked, then answers 500', async () => {
    sheetCount = 450; // three chunks of 200
    failOnLockCall = 2;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/grading-sheets/lock-overdue/route');
    const res = await GET(cronRequest('Bearer shh'));
    expect(res.status).toBe(500);
    expect(lockCalls).toHaveLength(2);
    expect(logAction).toHaveBeenCalledTimes(1);
    const context = logAction.mock.calls[0][0].context as Record<
      string,
      unknown
    >;
    expect(context).toMatchObject({
      locked_count: 200,
      partial: true,
      failed_step: 'lock',
      not_locked_count: 250,
    });
    expect((context.sheet_ids as string[])[0]).toBe('s0');
    expect((context.sheet_ids as string[]).includes('s200')).toBe(false);
    errors.mockRestore();
  });
});
