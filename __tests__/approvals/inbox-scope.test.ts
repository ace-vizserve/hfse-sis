import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { listDecidedStages, listInboxStages } from '@/lib/approvals/inbox';

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

/**
 * What already happened.
 *
 * ⚠ THE GAP THIS CLOSES: a filing used to vanish the moment it was decided.
 * The queue filtered to pending at the source, so an adviser who approved
 * something was never told whether the officer agreed, and there was nowhere
 * at all to look up a finished one.
 */
describe('listDecidedStages', () => {
  type AnyStage = Record<string, unknown>;

  const ladder = (
    requestStatus: 'approved' | 'rejected',
    stages: Array<{
      order: number;
      label: string;
      status: string;
      decidedBy?: string;
      pool?: string[];
      section?: string | null;
    }>
  ): AnyStage[] =>
    stages.map((s) => ({
      id: `stage-${s.order}`,
      request_id: 'request-1',
      stage_order: s.order,
      label: s.label,
      resolver: s.pool ? 'named' : 'form_adviser',
      approver_pool: s.pool ?? [],
      section_id: s.section === undefined ? SECTION_A : s.section,
      status: s.status,
      decided_by: s.decidedBy ?? null,
      decided_by_email: s.decidedBy ? `${s.decidedBy}@hfse.edu.sg` : null,
      decided_at: s.decidedBy ? '2026-09-05T02:00:00Z' : null,
      approval_requests: {
        subject_type: 'student_declaration',
        subject_id: 'declaration-1',
        status: requestStatus,
        filed_by_email: 'parent@example.com',
        created_at: '2026-09-01T00:00:00Z',
      },
    }));

  const service = (
    stages: AnyStage[],
    captured: { orClauses: string[] } = { orClauses: [] }
  ) =>
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
      stages: stages as never,
      captured,
    });

  it('represents a turned-down filing by the step that turned it down', async () => {
    // ⚠ NOT the last step, and this fixture is built so the two differ. A
    // rejection stops the ladder, so every step after it stays `waiting`
    // forever — take the last row and a rejected filing reports as "not
    // started", naming nobody. The adviser rejects at step 1 here precisely
    // so that "last step" would give the wrong answer and fail this test.
    const rows = await listDecidedStages(
      service(
        ladder('rejected', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'rejected',
            decidedBy: ADVISER,
          },
          {
            order: 2,
            label: 'Officer in charge',
            status: 'waiting',
            pool: [OIC],
            section: null,
          },
          {
            order: 3,
            label: 'Principal',
            status: 'waiting',
            pool: [OIC],
            section: null,
          },
        ])
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Form class adviser');
    expect(rows[0].decidedBy).toBe(ADVISER);
    expect(rows[0].requestStatus).toBe('rejected');
  });

  it('tells the adviser their approval was overturned, though they are not on that step', async () => {
    // The reason this is a separate function rather than a flag on the inbox
    // query: step 2 names neither the adviser nor their class, so scoping the
    // history the way the queue is scoped would hide the outcome from exactly
    // the person who acted on it.
    const rows = await listDecidedStages(
      service(
        ladder('rejected', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
          {
            order: 2,
            label: 'Officer in charge',
            status: 'rejected',
            decidedBy: OIC,
            pool: [OIC],
            section: null,
          },
        ])
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subjectId).toBe('declaration-1');
  });

  it('represents an approved filing by the approval that finished it', async () => {
    const rows = await listDecidedStages(
      service(
        ladder('approved', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
          {
            order: 2,
            label: 'Officer in charge',
            status: 'approved',
            decidedBy: OIC,
            pool: [OIC],
            section: null,
          },
        ])
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(rows[0].label).toBe('Officer in charge');
    expect(rows[0].decidedBy).toBe(OIC);
  });

  it('returns one row per filing, never one per step', async () => {
    const rows = await listDecidedStages(
      service(
        ladder('approved', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
          {
            order: 2,
            label: 'Officer in charge',
            status: 'approved',
            decidedBy: OIC,
            pool: [OIC],
            section: null,
          },
        ])
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(rows).toHaveLength(1);
  });

  it('never offers a finished filing as actionable', async () => {
    // An Approve button on something already decided is the worst outcome
    // here — it would 409 at best and re-decide at worst.
    const rows = await listDecidedStages(
      service(
        ladder('approved', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
        ])
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(rows.every((r) => r.canDecide === false)).toBe(true);
  });

  it('scopes a teacher by pool AND by the classes they advise', async () => {
    const captured = { orClauses: [] as string[] };
    await listDecidedStages(
      service(
        ladder('approved', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
        ]),
        captured
      ),
      {
        flow: 'attendance.student_declaration',
        userId: ADVISER,
        role: 'teacher',
        today: TODAY,
      }
    );
    expect(captured.orClauses).toHaveLength(1);
    expect(captured.orClauses[0]).toContain(`approver_pool.cs.{${ADVISER}}`);
    expect(captured.orClauses[0]).toContain(SECTION_A);
  });

  it('applies no ownership filter for an oversight role', async () => {
    const captured = { orClauses: [] as string[] };
    await listDecidedStages(
      service(
        ladder('approved', [
          {
            order: 1,
            label: 'Form class adviser',
            status: 'approved',
            decidedBy: ADVISER,
          },
        ]),
        captured
      ),
      {
        flow: 'attendance.student_declaration',
        userId: 'coordinator-1',
        role: 'academic_coordinator',
        today: TODAY,
      }
    );
    expect(captured.orClauses).toEqual([]);
  });
});
