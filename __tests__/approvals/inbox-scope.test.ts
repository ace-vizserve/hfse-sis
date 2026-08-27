import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { listInboxStages } from '@/lib/approvals/inbox';

/**
 * Who sees what in the declarations queue.
 *
 * ⚠ THIS IS THE TEST THE OTHER FLOW NEVER GOT. Its scope predicate is written
 * out by hand in six places, three of them already disagree about what a
 * superadmin sees, and the parity test that exists compares only three of the
 * six. A queue and its count that disagree send somebody to an empty screen —
 * a bug this codebase has shipped once already. One helper, tested here.
 */

const ADVISER = 'adviser-1';
const OIC = 'oic-1';
const SECTION_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SECTION_B = 'bbbbbbbb-0000-0000-0000-000000000002';

type StageRow = {
  id: string;
  request_id: string;
  stage_order: number;
  label: string;
  resolver: 'named' | 'form_adviser';
  approver_pool: string[] | null;
  section_id: string | null;
  status: 'pending';
  approval_requests: {
    subject_type: string;
    subject_id: string;
    status: 'pending';
    filed_by_email: string;
    created_at: string;
  };
};

function stage(overrides: Partial<StageRow> = {}): StageRow {
  return {
    id: 'stage-row-1',
    request_id: 'request-1',
    stage_order: 1,
    label: 'Form class adviser',
    resolver: 'form_adviser',
    approver_pool: [],
    section_id: SECTION_A,
    status: 'pending',
    approval_requests: {
      subject_type: 'student_declaration',
      subject_id: 'declaration-1',
      status: 'pending',
      filed_by_email: 'parent@example.com',
      created_at: '2026-09-01T00:00:00Z',
    },
    ...overrides,
  };
}

/**
 * A chainable stub that records the filters it was given, so the test can
 * assert on the QUERY as well as the result — the scoping is the query.
 */
function makeService(opts: {
  assignments: Array<{
    section_id: string;
    teacher_user_id: string;
    relief_teacher_user_id: string | null;
    relief_started_on: string | null;
    relief_ended_on: string | null;
  }>;
  stages: StageRow[];
  captured: { orClauses: string[] };
}): SupabaseClient {
  const service = {
    from(table: string) {
      const rows =
        table === 'teacher_assignments' ? opts.assignments : opts.stages;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.order = chain;
      builder.or = (clause: string) => {
        if (table === 'approval_request_stages') {
          opts.captured.orClauses.push(clause);
        }
        return builder;
      };
      // Awaiting the builder resolves the query.
      builder.then = (
        resolve: (value: { data: unknown; error: null }) => unknown
      ) => resolve({ data: rows, error: null });
      return builder;
    },
  };
  return service as unknown as SupabaseClient;
}

const TODAY = '2026-09-10';

describe('listInboxStages — scope', () => {
  it('an oversight role sees everything, with no ownership filter', async () => {
    const captured = { orClauses: [] as string[] };
    const rows = await listInboxStages(
      makeService({ assignments: [], stages: [stage()], captured }),
      {
        flow: 'attendance.student_declaration',
        userId: 'coordinator-1',
        role: 'academic_coordinator',
        today: TODAY,
      }
    );
    expect(captured.orClauses).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it('but an oversight role may not DECIDE what it can see', async () => {
    // ⚠ Seeing and acting are different questions. Showing a coordinator
    // buttons that would then 403 is the bug /markbook/change-requests still
    // has for superadmins.
    const captured = { orClauses: [] as string[] };
    const [row] = await listInboxStages(
      makeService({ assignments: [], stages: [stage()], captured }),
      {
        flow: 'attendance.student_declaration',
        userId: 'coordinator-1',
        role: 'school_admin',
        today: TODAY,
      }
    );
    expect(row.canDecide).toBe(false);
  });

  it('a teacher is filtered to their own pool and their own sections', async () => {
    const captured = { orClauses: [] as string[] };
    await listInboxStages(
      makeService({
        assignments: [
          {
            section_id: SECTION_A,
            teacher_user_id: ADVISER,
            relief_teacher_user_id: null,
            relief_started_on: null,
            relief_ended_on: null,
          },
        ],
        stages: [stage()],
        captured,
      }),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(captured.orClauses).toHaveLength(1);
    expect(captured.orClauses[0]).toContain(`approver_pool.cs.{${ADVISER}}`);
    expect(captured.orClauses[0]).toContain(`section_id.in.(${SECTION_A})`);
  });

  it('omits the section arm entirely when the person advises nothing', async () => {
    // ⚠ `section_id.in.()` is not valid PostgREST. A named approver who
    // advises no class — an officer in charge, say — must still get a working
    // query, not a 400.
    const captured = { orClauses: [] as string[] };
    await listInboxStages(
      makeService({ assignments: [], stages: [], captured }),
      {
        flow: 'attendance.student_declaration',
        userId: OIC,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(captured.orClauses).toEqual([`approver_pool.cs.{${OIC}}`]);
  });

  it('a named approver can decide their own step', async () => {
    const captured = { orClauses: [] as string[] };
    const [row] = await listInboxStages(
      makeService({
        assignments: [],
        stages: [
          stage({
            resolver: 'named',
            approver_pool: [OIC],
            section_id: null,
            stage_order: 2,
            label: 'Officer in charge',
          }),
        ],
        captured,
      }),
      {
        flow: 'attendance.student_declaration',
        userId: OIC,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(row.canDecide).toBe(true);
  });
});

describe('listInboxStages — relief cover', () => {
  const covered = {
    section_id: SECTION_B,
    teacher_user_id: 'someone-else',
    relief_teacher_user_id: ADVISER,
    relief_started_on: '2026-09-07',
    relief_ended_on: '2026-09-11',
  };

  it('a substitute inside the window gets the covered class', async () => {
    const captured = { orClauses: [] as string[] };
    const [row] = await listInboxStages(
      makeService({
        assignments: [covered],
        stages: [stage({ section_id: SECTION_B })],
        captured,
      }),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(row.canDecide).toBe(true);
  });

  it('and loses it once the cover has ended', async () => {
    // The whole reason a derived step resolves LIVE rather than freezing a
    // pool: a filing must reach whoever is actually standing in front of the
    // class this week.
    const captured = { orClauses: [] as string[] };
    const [row] = await listInboxStages(
      makeService({
        assignments: [covered],
        stages: [stage({ section_id: SECTION_B })],
        captured,
      }),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: '2026-09-20',
      }
    );
    expect(row.canDecide).toBe(false);
  });

  it('and does not have it yet before the cover starts', async () => {
    const captured = { orClauses: [] as string[] };
    const [row] = await listInboxStages(
      makeService({
        assignments: [covered],
        stages: [stage({ section_id: SECTION_B })],
        captured,
      }),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: '2026-09-01',
      }
    );
    expect(row.canDecide).toBe(false);
  });
});
