/**
 * The SIS audit overview's grade change pipeline counts APPROVED REQUESTS, not
 * approval rows.
 *
 * ⚠ A request decided step by step (migration 144) logs `grade_change_approved`
 * once per step, with `context.final` false on every step but the last. A
 * three-step approval is one approval. A row from the older two-approver flow
 * has no `final` key at all, and is one approval too — so the rule is "final
 * is not false", and the null case has to be spelled out because PostgREST's
 * `neq` is never true of null.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

type AuditRow = { action: string; context: Record<string, unknown> | null };

const { rows, orCalls } = vi.hoisted(() => ({
  rows: [] as AuditRow[],
  orCalls: [] as Array<{ action: string | null; clause: string }>,
}));

/**
 * Reads one `context->>key.op.value` arm the way PostgREST does: `->>` turns
 * the JSON value into text, and a missing key is null.
 */
function armMatches(row: AuditRow, arm: string): boolean {
  const match = /^context->>(\w+)\.(is|neq|eq)\.(.+)$/.exec(arm);
  if (!match) throw new Error(`unexpected filter arm: ${arm}`);
  const [, key, op, value] = match;
  const raw = row.context?.[key];
  const text = raw == null ? null : String(raw);
  if (op === 'is') return value === 'null' ? text === null : false;
  if (text === null) return false;
  return op === 'eq' ? text === value : text !== value;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'audit_log') throw new Error(`unexpected table ${table}`);
      let action: string | null = null;
      let clause: string | null = null;
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.gte = () => q;
      q.lte = () => q;
      q.eq = (column: string, value: string) => {
        if (column === 'action') action = value;
        return q;
      };
      q.or = (c: string) => {
        clause = c;
        orCalls.push({ action, clause: c });
        return q;
      };
      q.then = (resolve: (v: unknown) => unknown) => {
        const count = rows.filter(
          (r) =>
            r.action === action &&
            (clause == null ||
              clause.split(',').some((arm) => armMatches(r, arm)))
        ).length;
        return Promise.resolve({ count, error: null }).then(resolve);
      };
      return q;
    },
  }),
}));

import {
  FINAL_GRADE_CHANGE_APPROVAL_FILTER,
  getGradeChangePipeline,
} from '@/lib/sis/dashboard';

const RANGE = {
  ayCode: 'AY2026',
  from: '2026-09-01',
  to: '2026-09-30',
  cmpFrom: null,
  cmpTo: null,
};

describe('getGradeChangePipeline — approvals', () => {
  it('counts one approval per request, however many steps it had', async () => {
    rows.length = 0;
    orCalls.length = 0;
    rows.push(
      // A three-step request: two step approvals, then the last.
      {
        action: 'grade_change_approved',
        context: { final: false, stage_order: 1 },
      },
      {
        action: 'grade_change_approved',
        context: { final: false, stage_order: 2 },
      },
      {
        action: 'grade_change_approved',
        context: { final: true, stage_order: 3 },
      },
      // A request from before the steps — no `final` key.
      { action: 'grade_change_approved', context: { field: 'qa_score' } },
      // An old row with no context at all.
      { action: 'grade_change_approved', context: null },
      { action: 'grade_change_requested', context: { final: false } },
      { action: 'grade_change_rejected', context: { final: false } }
    );

    const pipeline = await getGradeChangePipeline(RANGE);

    expect(pipeline.approved).toBe(3);
    // The other stages are counted as before, `final` or not.
    expect(pipeline.submitted).toBe(1);
    expect(pipeline.rejected).toBe(1);
  });

  it('narrows only the approval count', async () => {
    orCalls.length = 0;
    await getGradeChangePipeline(RANGE);
    expect(orCalls).toEqual([
      {
        action: 'grade_change_approved',
        clause: FINAL_GRADE_CHANGE_APPROVAL_FILTER,
      },
    ]);
  });
});
