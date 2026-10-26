import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Waiting for you" for schemes of work (Task 10).
 *
 * Pinned:
 *   1. The queue lists only schemes whose LIVE step names the viewer — not a
 *      later step they also sit on, not somebody else's step, and not the
 *      whole school for an office role that is on no step.
 *   2. Once the step is decided it drops off the viewer's queue and appears
 *      on the next step's person's, with "waiting since" moved to when the
 *      step before it was decided.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: () =>
    Promise.resolve([
      ['teacher-1', 'Ms Teacher'],
      ['head-1', 'Mr Head'],
      ['oic-1', 'Ms OIC'],
    ]),
}));

import { SOW_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';
import { SOW_APPROVAL_SUBJECT_TYPE as SOW_SUBJECT_TYPE } from '@/lib/sow/access';
import { listSowReviewQueue } from '@/lib/sow/review';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** Reads `a.b.c` from a row, through embedded objects (and one-item arrays). */
function pick(row: Row, path: string): unknown {
  let v: unknown = row;
  for (const key of path.split('.')) {
    if (Array.isArray(v)) v = v[0];
    v = (v as Row | undefined)?.[key];
  }
  return v;
}

/** One PostgREST `or` arm: `col.cs.{x}`, `col.in.(a,b)` or `col.eq.x`. */
function arm(clause: string): (r: Row) => boolean {
  const [col, op, ...rest] = clause.split('.');
  const value = rest.join('.');
  if (op === 'cs') {
    const id = value.replace(/[{}]/g, '');
    return (r) => ((r[col] as string[] | null) ?? []).includes(id);
  }
  if (op === 'in') {
    const ids = value.replace(/[()]/g, '').split(',');
    return (r) => ids.includes(r[col] as string);
  }
  return (r) => r[col] === value;
}

/** A just-enough read-only fake of the query builder. */
function fakeService(tables: Tables): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const run = () => ({
        data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
        error: null,
      });
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (col: string, v: unknown) => {
          filters.push((r) => pick(r, col) === v);
          return q;
        },
        in: (col: string, vs: unknown[]) => {
          filters.push((r) => vs.includes(pick(r, col)));
          return q;
        },
        or: (clause: string) => {
          const arms = clause.split(',').reduce<string[]>((acc, part) => {
            // `section_id.in.(a,b)` splits on its own commas; glue it back.
            if (acc.length > 0 && /\.in\.\([^)]*$/.test(acc[acc.length - 1])) {
              acc[acc.length - 1] += `,${part}`;
            } else acc.push(part);
            return acc;
          }, []);
          const tests = arms.map(arm);
          filters.push((r) => tests.some((t) => t(r)));
          return q;
        },
        maybeSingle: () => {
          const { data } = run();
          return Promise.resolve({ data: data[0] ?? null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const REQUEST = (id: string, submissionId: string) => ({
  id,
  flow: SOW_APPROVAL_FLOW,
  subject_type: SOW_SUBJECT_TYPE,
  subject_id: submissionId,
  status: 'pending',
  current_stage_order: 1,
  filed_by: 'teacher-1',
  filed_by_email: 't@x.sg',
  created_at: '2026-03-09T02:00:00Z',
  decided_at: null,
});

function stageRow(
  request: ReturnType<typeof REQUEST>,
  order: number,
  label: string,
  pool: string[],
  status: string
): Row {
  return {
    id: `${request.id}-s${order}`,
    request_id: request.id,
    stage_order: order,
    label,
    resolver: 'named',
    approval_rule: 'any',
    approver_pool: pool,
    section_id: null,
    status,
    decided_by: null,
    decided_by_email: null,
    decided_at: null,
    decision_note: null,
    approval_requests: request,
  };
}

let tables: Tables;

beforeEach(() => {
  const reqA = REQUEST('req-a', 'sub-a');
  const reqB = REQUEST('req-b', 'sub-b');
  tables = {
    teacher_assignments: [],
    approval_request_stage_decisions: [],
    approval_requests: [reqA, reqB],
    approval_request_stages: [
      // Scheme A waits on the subject head; the OIC is the step after.
      stageRow(reqA, 1, 'Subject head', ['head-1'], 'pending'),
      stageRow(reqA, 2, 'OIC', ['oic-1'], 'waiting'),
      // Scheme B waits on somebody else entirely.
      stageRow(reqB, 1, 'Subject head', ['head-2'], 'pending'),
      stageRow(reqB, 2, 'OIC', ['oic-1'], 'waiting'),
    ],
    scheme_of_work_submissions: [
      { id: 'sub-a', sow_id: 'sow-a', submitted_by: 'teacher-1' },
      { id: 'sub-b', sow_id: 'sow-b', submitted_by: 'teacher-1' },
    ],
    schemes_of_work: [
      {
        id: 'sow-a',
        state: 'in_review',
        current_submission_id: 'sub-a',
        subject_id: 'sci',
        level_id: 'sec1',
        term_id: 't2',
        track: 'Standard',
        scheme_of_work_classes: [{ section_id: 'd1' }, { section_id: 'd2' }],
      },
      {
        id: 'sow-b',
        state: 'in_review',
        current_submission_id: 'sub-b',
        subject_id: 'sci',
        level_id: 'sec2',
        term_id: 't2',
        track: 'Global',
        scheme_of_work_classes: [{ section_id: 'g1' }],
      },
    ],
    subjects: [{ id: 'sci', name: 'Science' }],
    levels: [
      { id: 'sec1', label: 'Secondary 1' },
      { id: 'sec2', label: 'Secondary 2' },
    ],
    terms: [{ id: 't2', term_number: 2 }],
    sections: [
      { id: 'd1', name: 'Discipline 1' },
      { id: 'd2', name: 'Discipline 2' },
      { id: 'g1', name: 'Global 1' },
    ],
  };
});

describe('listSowReviewQueue', () => {
  it('lists only the schemes whose live step the viewer is on', async () => {
    const rows = await listSowReviewQueue(fakeService(tables), {
      userId: 'head-1',
      role: 'teacher',
    });
    expect(rows).toEqual([
      {
        sowId: 'sow-a',
        requestId: 'req-a',
        subjectName: 'Science',
        levelLabel: 'Secondary 1',
        track: 'Standard',
        termNumber: 2,
        classes: ['Discipline 1', 'Discipline 2'],
        teacher: 'Ms Teacher',
        step: 'Subject head',
        waitingSince: '2026-03-09T02:00:00Z',
      },
    ]);
  });

  it('a later step the viewer sits on is not waiting for them yet', async () => {
    const rows = await listSowReviewQueue(fakeService(tables), {
      userId: 'oic-1',
      role: 'teacher',
    });
    expect(rows).toEqual([]);
  });

  it('an office role on no step sees an empty queue, not the school', async () => {
    const rows = await listSowReviewQueue(fakeService(tables), {
      userId: 'coordinator-1',
      role: 'academic_coordinator',
    });
    expect(rows).toEqual([]);
  });

  it('a decided step drops off, and the next step picks it up', async () => {
    const stages = tables.approval_request_stages;
    const s1 = stages.find((s) => s.id === 'req-a-s1')!;
    const s2 = stages.find((s) => s.id === 'req-a-s2')!;
    Object.assign(s1, {
      status: 'approved',
      decided_by: 'head-1',
      decided_at: '2026-03-11T03:00:00Z',
    });
    s2.status = 'pending';

    const head = await listSowReviewQueue(fakeService(tables), {
      userId: 'head-1',
      role: 'teacher',
    });
    expect(head).toEqual([]);

    const oic = await listSowReviewQueue(fakeService(tables), {
      userId: 'oic-1',
      role: 'teacher',
    });
    expect(oic.map((r) => [r.sowId, r.step, r.waitingSince])).toEqual([
      ['sow-a', 'OIC', '2026-03-11T03:00:00Z'],
    ]);
  });

  it('a scheme that has moved on from that submission is not listed', async () => {
    // Sent again since: the old submission's request is stale.
    tables.schemes_of_work[0].current_submission_id = 'sub-newer';
    const rows = await listSowReviewQueue(fakeService(tables), {
      userId: 'head-1',
      role: 'teacher',
    });
    expect(rows).toEqual([]);
  });
});
