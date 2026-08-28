import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadActivityPage, pageEvents, SOURCE_CAP } from '@/lib/activity/feed';
import type { ActivityEvent } from '@/lib/activity/events';

// `loadActivityPage` resolves display names outside the `service` client it's
// given — this stubs that lookup so the mark-change scoping tests below don't
// need real staff data, only the query shape.
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: () => Promise.resolve([]),
}));

// F2 — `loadDeclarationSide` hangs its ladder detail on `loadStaffDeclarations`
// (lib/declarations/staff.ts), which itself fans out into students/sections/
// terms/vacation-usage queries that have nothing to do with what F2 tests.
// Stubbed to one fixed, pending-on-the-viewer filing so the "waiting is
// identical across tabs" test below only has to shape the two queries that
// actually decide scope: `teacher_assignments` and `approval_request_stages`.
vi.mock('@/lib/declarations/staff', () => ({
  loadStaffDeclarations: () =>
    Promise.resolve([
      {
        id: 'dec-1',
        filingGroupId: 'group-1',
        declarationType: 'travel',
        studentId: 'student-1',
        studentNumber: 'STU-001',
        studentName: 'Amelia Ng',
        sectionId: 'sec-a',
        className: 'P2 Diligence',
        levelCode: 'P2',
        startDate: '2026-09-03',
        endDate: '2026-09-03',
        dayCount: 1,
        withMedical: null,
        evidenceUrl: null,
        evidenceLinkUrl: null,
        destinationCountry: 'Malaysia',
        destinationCity: null,
        parentNote: null,
        filedByEmail: 'parent@example.com',
        filedAt: '2026-08-27T00:00:00.000Z',
        status: 'pending',
        statusLabel: 'Pending',
        registerWrittenAt: null,
        registerDaysWritten: null,
        registerWriteError: null,
        vacationUsage: null,
        siblings: [],
        ladder: {
          requestId: 'dec-1',
          flow: 'student_declaration',
          subjectType: 'student_declaration',
          subjectId: 'dec-1',
          status: 'pending',
          currentStageOrder: 1,
          filedByEmail: 'parent@example.com',
          filedAt: '2026-08-27T00:00:00.000Z',
          decidedAt: null,
          stages: [
            {
              stageOrder: 1,
              label: 'Form class adviser',
              resolver: 'form_adviser',
              status: 'pending',
              sectionId: 'sec-a',
              approverPool: [],
              decidedBy: null,
              decidedByEmail: null,
              decidedAt: null,
              decisionNote: null,
            },
          ],
        },
      },
    ]),
}));

function ev(id: string, at: string): ActivityEvent {
  return {
    id,
    flow: 'grade_change',
    requestId: id,
    at,
    tone: 'started',
    actorLabel: 'Someone',
    actorInitials: 'S',
    predicate: 'did a thing.',
    details: null,
    href: '#',
  };
}

describe('pageEvents', () => {
  const all = [
    ev('a', '2026-08-28T05:00:00.000Z'),
    ev('b', '2026-08-28T04:00:00.000Z'),
    ev('c', '2026-08-28T03:00:00.000Z'),
    ev('d', '2026-08-28T02:00:00.000Z'),
    ev('e', '2026-08-28T01:00:00.000Z'),
  ];

  it('returns the newest page first and a cursor for the next', () => {
    const page = pageEvents(all, null, 2);

    expect(page.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).toEqual({
      at: '2026-08-28T04:00:00.000Z',
      id: 'b',
    });
  });

  it('continues from the cursor without repeating or skipping', () => {
    const first = pageEvents(all, null, 2);
    const second = pageEvents(all, first.nextCursor, 2);
    const third = pageEvents(all, second.nextCursor, 2);

    expect(second.events.map((e) => e.id)).toEqual(['c', 'd']);
    expect(third.events.map((e) => e.id)).toEqual(['e']);
    expect(third.nextCursor).toBeNull();
  });

  // The bug this guards: two sources that both emitted at the same instant.
  //
  // ⚠ THE TIED IDS ARE DELIBERATELY OUT OF ORDER IN THE ARRAY ('y' before
  // 'x'), and that is the whole point. `Array.prototype.sort` is stable, so a
  // fixture where the tied ids already happen to sit in ascending order (or
  // in their original input order) would pass this test even with NO id
  // tiebreak at all in `sortEventsNewestFirst` — it would just be relying on
  // sort stability by accident. Putting 'y' before 'x' in the input, while
  // the correct output orders 'x' before 'y', means only the real tiebreak
  // (`|| a.id.localeCompare(b.id)`) can produce the expected pages.
  it('does not lose an event that shares a timestamp with the cursor', () => {
    const tied = [
      ev('w', '2026-08-28T05:00:00.000Z'),
      ev('y', '2026-08-28T04:00:00.000Z'),
      ev('x', '2026-08-28T04:00:00.000Z'),
      ev('v', '2026-08-28T03:00:00.000Z'),
    ];

    const first = pageEvents(tied, null, 2);
    const second = pageEvents(tied, first.nextCursor, 2);

    expect(first.events.map((e) => e.id)).toEqual(['w', 'x']);
    expect(second.events.map((e) => e.id)).toEqual(['y', 'v']);
  });

  it('reports no next cursor when the last page exactly fills', () => {
    expect(pageEvents(all.slice(0, 2), null, 2).nextCursor).toBeNull();
  });

  it('caps each source well above anything this school produces', () => {
    expect(SOURCE_CAP).toBeGreaterThanOrEqual(400);
  });

  // F5 — the cursor comparison shares `compareStringsAsc` with
  // `sortEventsNewestFirst` (events.ts) precisely so this can't drift back to
  // `localeCompare`. PostgREST's trimmed-zero-fraction timestamps
  // (`'...:00+00:00'` vs `'...:00.5+00:00'`) are exactly the shape that
  // inverts under locale-aware comparison.
  it('pages a mixed-precision pair in the right order', () => {
    const bare = ev('bare', '2026-08-27T02:00:00+00:00');
    const fractional = ev('fractional', '2026-08-27T02:00:00.5+00:00');

    const page = pageEvents([bare, fractional], null, 10);

    expect(page.events.map((e) => e.id)).toEqual(['fractional', 'bare']);
  });
});

/**
 * F3. `loadDeclarationSide` runs on the SERVICE client, so migration 129's
 * RLS is bypassed entirely and the `.or()` built here is the only thing
 * standing between one adviser and every other section's filings — exactly
 * as load-bearing as the mark-change leak guard just below, which already had
 * a query-shape test. This is that same shape of test for the declaration
 * side: a fake Supabase client whose `.or()` records what it was asked, and a
 * `teacher_assignments` fixture shaped like
 * `__tests__/approvals/inbox-scope.test.ts:160`'s relief-cover cases so a
 * co-adviser and a LIVE relief cover both widen the `section_id.in.(...)`
 * arm while a booked-but-not-yet-live cover does not.
 */
function makeDeclarationScopeService(
  captured: { orClauses: string[] },
  assignments: unknown[]
): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'teacher_assignments') {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.in = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) => resolve({ data: assignments, error: null });
        return builder;
      }
      if (table === 'approval_request_stages') {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.eq = chain;
        builder.order = chain;
        builder.limit = chain;
        builder.or = (clause: string) => {
          captured.orClauses.push(clause);
          return builder;
        };
        // No filings need to actually resolve for this test — it only
        // asserts the query's SHAPE, mirroring the mark-change leak-guard
        // tests below. An empty result also skips `loadStaffDeclarations`
        // entirely (`loadDeclarationSide` short-circuits when
        // `declarationIds.length === 0`), so no further table needs a stub.
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) => resolve({ data: [], error: null });
        return builder;
      }
      if (table === 'grade_change_requests') {
        // F2 made `loadActivityPage` always fetch both sides regardless of
        // `tab`, so a declaration-only test must still answer this query.
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.order = chain;
        builder.limit = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) => resolve({ data: [], error: null });
        return builder;
      }
      throw new Error(
        `F3 declaration-scope fixture queried an unexpected table: ${table}`
      );
    },
  } as unknown as SupabaseClient;
}

describe('loadActivityPage — declaration scope, the leak guard (F3)', () => {
  const TODAY = '2026-09-10';
  const SECTION_CO = 'aaaaaaaa-0000-0000-0000-0000000000c0';
  const SECTION_LIVE = 'bbbbbbbb-0000-0000-0000-00000000011e';
  const SECTION_BOOKED = 'cccccccc-0000-0000-0000-00000000b00c';

  it('carries the approver-pool arm and widens the section arm for a co-adviser and a live relief cover, but not a booked-but-not-live one', async () => {
    const userId = 'adviser-1';
    const captured = { orClauses: [] as string[] };
    const assignments = [
      // A co-adviser holds the role directly — no relief window at all.
      {
        section_id: SECTION_CO,
        teacher_user_id: userId,
        relief_teacher_user_id: null,
        relief_started_on: null,
        relief_ended_on: null,
      },
      // Covering right now: TODAY falls inside the window.
      {
        section_id: SECTION_LIVE,
        teacher_user_id: 'someone-else-1',
        relief_teacher_user_id: userId,
        relief_started_on: '2026-09-07',
        relief_ended_on: '2026-09-11',
      },
      // Booked for a future week — TODAY is before the window starts.
      {
        section_id: SECTION_BOOKED,
        teacher_user_id: 'someone-else-2',
        relief_teacher_user_id: userId,
        relief_started_on: '2026-09-20',
        relief_ended_on: '2026-09-25',
      },
    ];

    await loadActivityPage(makeDeclarationScopeService(captured, assignments), {
      userId,
      role: 'teacher',
      tab: 'student_declaration',
      cursor: null,
      limit: 20,
      today: TODAY,
    });

    expect(captured.orClauses).toHaveLength(1);
    const clause = captured.orClauses[0];
    expect(clause).toContain(`approver_pool.cs.{${userId}}`);
    expect(clause).toContain(`section_id.in.(${SECTION_CO},${SECTION_LIVE})`);
    expect(clause).not.toContain(SECTION_BOOKED);
  });
});

/**
 * `grade_change_requests` is readable by ANY authenticated account holding a
 * role (migration 009) — the `.or()` scope built inside `loadMarkChangeSide`
 * is the ONLY thing standing between one teacher and the whole school's mark
 * changes. This asserts the shape of the query that guard produces, not its
 * results: a fake Supabase client whose `.or()` records what it was called
 * with, so a future edit that "simplifies" the filter away, or moves the
 * narrowing into a `.filter()` applied after the fetch, fails a test instead
 * of shipping a leak.
 */
function makeMarkChangeService(
  captured: { orClauses: string[] },
  // ⚠ Extended for F1: the two original tests only cared what was asked for,
  // never what came back, so `rows` defaulted to `[]`. F1 needs a real row to
  // resolve so `page.events[0]`/`page.waiting[0]` exist to assert `href` on.
  rows: unknown[] = []
): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'grade_change_requests') {
        throw new Error(
          `mark-change scoping test queried an unexpected table: ${table}`
        );
      }
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.or = (clause: string) => {
        captured.orClauses.push(clause);
        return builder;
      };
      builder.then = (
        resolve: (value: { data: unknown; error: null }) => unknown
      ) => resolve({ data: rows, error: null });
      return builder;
    },
  } as unknown as SupabaseClient;
}

/**
 * One mark-change row, shaped to survive `loadMarkChangeSide`'s row parsing
 * (the nested `grade_entry.section_student.student` embed) — reused by F1 and
 * F2 below. `secondary_approver_id` is set to `'viewer-1'`, the `userId` both
 * F1 tests pass, so the row lands in `waiting` regardless of which role is
 * under test — role only ever decides the `href`, never who it's "for".
 */
const MARK_CHANGE_ROW = {
  id: 'gcr-1',
  // ⚠ F6 — `field_changed` is constrained to exactly five values
  // (009_change_requests.sql:31-33); 'written_work' is not one of them and
  // could never appear in a real row. `ww_scores` + a non-null `slot_index`
  // is the shape the same migration's slot-shape check requires.
  field_changed: 'ww_scores',
  slot_index: 3,
  current_value: '18',
  proposed_value: '21',
  status: 'pending',
  requested_by: 'u-teacher',
  requested_by_email: 'grace.lim@hfse.edu.sg',
  requested_at: '2026-08-27T00:47:00.000Z',
  primary_approver_id: null,
  secondary_approver_id: 'viewer-1',
  reviewed_by: null,
  reviewed_by_email: null,
  reviewed_at: null,
  decision_note: null,
  applied_by: null,
  applied_at: null,
  grade_entry: {
    section_student: {
      student: {
        first_name: 'Samira',
        last_name: 'Bakhtiari',
        student_number: 'STU-099',
      },
    },
  },
};

describe('loadActivityPage — mark-change scoping (the leak guard)', () => {
  it('a teacher is scoped to their own requested/approver rows, nothing broader', async () => {
    const captured = { orClauses: [] as string[] };
    await loadActivityPage(makeMarkChangeService(captured), {
      userId: 'teacher-1',
      role: 'teacher',
      tab: 'grade_change',
      cursor: null,
      limit: 20,
    });

    // Exactly one `.or()` call — the query never falls through to an
    // unfiltered fetch that gets narrowed afterward in JavaScript.
    expect(captured.orClauses).toHaveLength(1);
    const clause = captured.orClauses[0];
    expect(clause).toContain('requested_by.eq.teacher-1');
    expect(clause).toContain('primary_approver_id.eq.teacher-1');
    expect(clause).toContain('secondary_approver_id.eq.teacher-1');
    // F4 — whoever applied a change sees their own action, every role.
    expect(clause).toContain('applied_by.eq.teacher-1');
    // ⚠ The legacy-null arm is gated to school_admin (next test). An
    // unconditional version here would hand a teacher every pending mark
    // change from before migration 013 had approver columns at all.
    expect(clause).not.toContain('is.null');
    // F4 — the coordinator arm is gated to academic_coordinator (see below).
    // A teacher must never get the whole school's approved queue just
    // because it happens to share the `status.eq.approved` shape.
    expect(clause).not.toContain('status.eq.approved');
  });

  // An oversight role reads the whole school, exactly as it does on the queue
  // page. The proof is the ABSENCE of a scoping `.or()` — not a wider one.
  it.each(['school_admin', 'academic_coordinator', 'superadmin'] as const)(
    'issues no scoping filter at all for %s, who sees the whole school',
    async (role) => {
      const captured = { orClauses: [] as string[] };
      await loadActivityPage(makeMarkChangeService(captured), {
        userId: 'oversight-1',
        role,
        tab: 'grade_change',
        cursor: null,
        limit: 20,
      });

      expect(captured.orClauses).toHaveLength(0);
    }
  );
});

/**
 * The feed shipped scoped to personal involvement for EVERY role, and the
 * result was a superadmin whose `/markbook/change-requests` listed rows while
 * the panel beside it said nothing had happened — the same complaint for
 * declarations, where an oversight reader saw only the filings they happened
 * to sit on. Every other surface in this product treats these three roles as
 * seeing everything.
 *
 * ⚠ THE WIDENING IS THE LOG ONLY. "Waiting for you" is built from
 * `canDecide`-shaped checks against this same person further down, so an
 * oversight reader still owes exactly what they owed before. That is the
 * property these two tests exist to hold apart.
 */
describe('loadActivityPage — oversight widens the log, never the to-do list', () => {
  it('does not put another person’s pending work in an oversight reader’s waiting list', async () => {
    const captured = { orClauses: [] as string[] };
    const page = await loadActivityPage(makeMarkChangeService(captured), {
      userId: 'oversight-1',
      role: 'superadmin',
      tab: 'grade_change',
      cursor: null,
      limit: 20,
    });

    // The fixture's row names somebody else as approver, so it is somebody
    // else's job — visible in the log, absent from what this reader owes.
    expect(page.waiting).toHaveLength(0);
  });

  it('still scopes a teacher to their own involvement', async () => {
    const captured = { orClauses: [] as string[] };
    await loadActivityPage(makeMarkChangeService(captured), {
      userId: 'teacher-2',
      role: 'teacher',
      tab: 'grade_change',
      cursor: null,
      limit: 20,
    });

    expect(captured.orClauses).toHaveLength(1);
    const clause = captured.orClauses[0];
    expect(clause).toContain('requested_by.eq.teacher-2');
    expect(clause).toContain('applied_by.eq.teacher-2');
    expect(clause).not.toContain('status.eq.approved');
    expect(clause).not.toContain('is.null');
  });
});

/**
 * F1 — fix round 1. `loadMarkChangeSide` (feed.ts:376-379) sends a teacher to
 * their own list and everyone else to the gated deep-link. Nothing asserted
 * this before: `events.test.ts` takes `href` as a fixture INPUT to
 * `buildGradeChangeEvents`, so it would pass unchanged even if `feed.ts`
 * handed every role the deep-link — and `/markbook/change-requests` is gated
 * to school_admin | superadmin | academic_coordinator
 * (app/(markbook)/markbook/change-requests/page.tsx), so a teacher hitting it
 * gets redirected away from their own row. This regressed once already.
 */
describe('loadActivityPage — mark-change href by role', () => {
  it('sends a teacher to their own list, not the gated deep-link', async () => {
    const page = await loadActivityPage(
      makeMarkChangeService({ orClauses: [] }, [MARK_CHANGE_ROW]),
      {
        userId: 'viewer-1',
        role: 'teacher',
        tab: 'grade_change',
        cursor: null,
        limit: 20,
      }
    );

    expect(page.events[0]?.href).toBe('/markbook/grading/requests');
    expect(page.waiting[0]?.href).toBe('/markbook/grading/requests');
  });

  it('sends every other gate role to the deep-linked queue', async () => {
    const page = await loadActivityPage(
      makeMarkChangeService({ orClauses: [] }, [MARK_CHANGE_ROW]),
      {
        userId: 'viewer-1',
        role: 'school_admin',
        tab: 'grade_change',
        cursor: null,
        limit: 20,
      }
    );

    expect(page.events[0]?.href).toBe('/markbook/change-requests?req=gcr-1');
    expect(page.waiting[0]?.href).toBe('/markbook/change-requests?req=gcr-1');
  });
});

/**
 * F2 — fix round 1. `loadActivityPage` (feed.ts:112-138) fetches both sides
 * with `Promise.allSettled` specifically so one source going down does not
 * blank the other — an empty panel reads as "nothing waiting", which is a
 * worse answer than a shorter list. Both pre-existing `loadActivityPage`
 * tests pass `tab: 'grade_change'`, which short-circuits the declaration side
 * to an already-resolved empty result (`loadActivityPage`'s `wantDeclarations`
 * guard) — the rejection branch was never entered and nothing asserted
 * `partial`. This drives `tab: 'general'`, the only tab that awaits both
 * sides, and fails the declaration side for real by making its own
 * `teacher_assignments` query (the one `loadAdvisedSectionIds` runs before
 * `approval_request_stages` is ever reached) return a Postgres error.
 */
function makeGeneralService(markChangeRows: unknown[]): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'grade_change_requests') {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.order = chain;
        builder.limit = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) => resolve({ data: markChangeRows, error: null });
        return builder;
      }
      if (table === 'teacher_assignments') {
        // This is the failure F2 exercises — loadAdvisedSectionIds's own
        // query errors, so the whole declaration side rejects before it ever
        // reaches approval_request_stages.
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.in = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: {
            data: unknown;
            error: { message: string };
          }) => unknown
        ) =>
          resolve({
            data: null,
            error: { message: 'teacher_assignments unreachable' },
          });
        return builder;
      }
      throw new Error(`F2 fixture queried an unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe('loadActivityPage — one source fails, the other survives', () => {
  it('reports partial and still returns the mark-change side', async () => {
    const page = await loadActivityPage(makeGeneralService([MARK_CHANGE_ROW]), {
      userId: 'viewer-1',
      role: 'school_admin',
      tab: 'general',
      cursor: null,
      limit: 20,
    });

    expect(page.partial).toBe(true);
    expect(page.events.length).toBeGreaterThan(0);
  });
});

/**
 * Final fix wave, F2. Spec §5: "Pinned above the tab strip, not inside
 * General. What you owe someone does not change with the tab you are
 * reading." Before this fix, `loadActivityPage` gated BOTH the fetch and the
 * `waiting` list behind the same `wantDeclarations`/`wantMarkChanges` switch
 * as `events` — so an adviser with a filing waiting who tapped the "Mark
 * changes" tab saw their pinned to-do list disappear while the badge beside
 * it kept reading the true count. This drives one viewer who has a pending
 * mark change AND a pending declaration, across all three tabs, and asserts
 * `waiting` never changes — only `events` may.
 */
function makeWaitingAcrossTabsService(userId: string): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'grade_change_requests') {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.order = chain;
        builder.limit = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) => resolve({ data: [MARK_CHANGE_ROW], error: null });
        return builder;
      }
      if (table === 'teacher_assignments') {
        // Makes the viewer the form adviser of 'sec-a' — the section the
        // mocked declaration ladder's pending stage names — so the
        // declaration also lands in `waiting`.
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.in = chain;
        builder.or = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) =>
          resolve({
            data: [
              {
                section_id: 'sec-a',
                teacher_user_id: userId,
                relief_teacher_user_id: null,
                relief_started_on: null,
                relief_ended_on: null,
              },
            ],
            error: null,
          });
        return builder;
      }
      if (table === 'approval_request_stages') {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.eq = chain;
        builder.or = chain;
        builder.order = chain;
        builder.limit = chain;
        builder.then = (
          resolve: (value: { data: unknown; error: null }) => unknown
        ) =>
          resolve({
            data: [
              {
                request_id: 'dec-1',
                approval_requests: {
                  subject_id: 'dec-1',
                  created_at: '2026-08-27T00:00:00.000Z',
                },
              },
            ],
            error: null,
          });
        return builder;
      }
      throw new Error(
        `waiting-across-tabs fixture queried an unexpected table: ${table}`
      );
    },
  } as unknown as SupabaseClient;
}

describe('loadActivityPage — waiting is pinned above the tab strip (F2)', () => {
  it('is identical for general, grade_change and student_declaration', async () => {
    const userId = 'viewer-1'; // matches MARK_CHANGE_ROW's secondary_approver_id
    const load = (tab: 'general' | 'grade_change' | 'student_declaration') =>
      loadActivityPage(makeWaitingAcrossTabsService(userId), {
        userId,
        role: 'school_admin',
        tab,
        cursor: null,
        limit: 20,
      });

    const [general, markChangeTab, declarationTab] = await Promise.all([
      load('general'),
      load('grade_change'),
      load('student_declaration'),
    ]);

    // Both sources contributed — this would be 1, not 2, if either the mark
    // change or the declaration side had been silently skipped.
    expect(general.waiting).toHaveLength(2);
    expect(markChangeTab.waiting).toEqual(general.waiting);
    expect(declarationTab.waiting).toEqual(general.waiting);

    // The events list, unlike waiting, DOES follow the tab.
    expect(markChangeTab.events.every((e) => e.flow === 'grade_change')).toBe(
      true
    );
    expect(
      declarationTab.events.every((e) => e.flow === 'student_declaration')
    ).toBe(true);
  });
});
