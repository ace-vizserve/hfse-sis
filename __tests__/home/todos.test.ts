import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookTeacherPriority: vi.fn(async () => ({
    headline: { value: 6, label: 'unscored slots' },
    chips: [],
    cta: { label: 'Review', href: '/markbook/grading' },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationTeacherPriority: vi.fn(async () => ({
    headline: { value: 4, label: 'write-ups still in draft' },
    chips: [],
    cta: { label: 'Review', href: '/evaluation' },
  })),
}));
vi.mock('@/lib/admissions/document-validation', () => ({
  countPendingDocValidation: vi.fn(async () => 5),
}));
vi.mock('@/lib/sis/unsynced-students', () => ({
  countUnsyncedEnrolledStudents: vi.fn(async () => 2),
}));
vi.mock('@/lib/p-files/document-validation', () => ({
  countAwaitingVerification: vi.fn(async () => 6),
}));
// The step-by-step half of the change-request source (migration 144). Empty by
// default, so every existing expectation below is about the legacy half alone;
// the tests at the bottom put a step in front of the viewer.
const { inboxStagesMock, crQueryCalls } = vi.hoisted(() => ({
  inboxStagesMock: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  crQueryCalls: [] as string[],
}));
vi.mock('@/lib/approvals/inbox', () => ({
  listInboxStagesAcrossFlows: (...args: unknown[]) => inboxStagesMock(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn(function (this: unknown) {
        crQueryCalls.push('or');
        return this;
      }),
      in: vi.fn(function (this: unknown) {
        crQueryCalls.push('in');
        return this;
      }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({
        data: [
          {
            id: 'cr-1',
            requested_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            grading_sheet: {
              section: { academic_year_id: 'ay-id' },
              subject: { name: 'Science' },
              term: { label: 'T2' },
            },
            requested_by_email: 'teacher@hfse.test',
          },
        ],
        error: null,
      })),
      maybeSingle: vi.fn(async () => ({ data: { id: 'ay-id' }, error: null })),
    })),
  })),
}));
vi.mock('@/lib/markbook/comment-completeness', () => ({
  cumulativeCommentGaps: vi.fn(async () => []),
}));

import {
  DEFAULT_ROLE_CAPABILITIES,
  type Capability,
} from '@/lib/auth/capabilities';
import { NO_TEACHING_PROFILE } from '@/lib/sidebar/module-visibility';
import { getHomeTodos, HOME_TODO_SOURCES } from '@/lib/home/todos';

// The real grants, not a literal — the point of the capability gate is that it
// agrees with what the destination page will ask, and these are the same
// defaults that seed `role_permissions`.
const CAPS = DEFAULT_ROLE_CAPABILITIES;

const MARKBOOK_ROW = {
  id: 'markbook-priority',
  module: 'Markbook',
  text: '6 unscored slots',
  href: '/markbook/grading',
  kind: 'review',
};
const EVALUATION_ROW = {
  id: 'evaluation-priority',
  module: 'Evaluation',
  text: '4 write-ups still in draft',
  href: '/evaluation',
  kind: 'review',
};

beforeEach(() => {
  inboxStagesMock.mockReset();
  inboxStagesMock.mockImplementation(async () => []);
  crQueryCalls.length = 0;
});

describe('getHomeTodos', () => {
  it('gives teacher review-only rows from the teacher priority payloads', async () => {
    const todos = await getHomeTodos('teacher', 'AY2026', 'teacher-1', {
      advises: true,
      advisesSubstantively: true,
      teachesSubject: true,
    });
    expect(todos).toEqual([MARKBOOK_ROW, EVALUATION_ROW]);
  });

  // The two teacher rows belong to different jobs. Grading is subject-teacher
  // work; write-ups are adviser work. Offering either to someone who does not
  // hold that job is the same defect as the "Enter grades" quick action a form
  // adviser used to be shown, one panel up.
  it('gives a form adviser the write-up row only', async () => {
    const todos = await getHomeTodos('teacher', 'AY2026', 'teacher-1', {
      advises: true,
      advisesSubstantively: true,
      teachesSubject: false,
    });
    expect(todos).toEqual([EVALUATION_ROW]);
  });

  it('gives a subject teacher the grading row only', async () => {
    const todos = await getHomeTodos('teacher', 'AY2026', 'teacher-1', {
      advises: false,
      advisesSubstantively: false,
      teachesSubject: true,
    });
    expect(todos).toEqual([MARKBOOK_ROW]);
  });

  it('gives a teacher with no assignments nothing', async () => {
    // Also the default when a caller omits the profile — the safe direction for
    // a panel: show nothing rather than the wrong work.
    expect(await getHomeTodos('teacher', 'AY2026', 'teacher-1')).toEqual([]);
  });

  // She is NOT offered the admissions document-validation row any more. That
  // page redirects anyone without `documents_pre_enrolment.read` to `/`, and
  // migration 106 took that capability off her — so the row sat on the page she
  // was bounced to and clicking it looped (KD #173).
  it('gives academic_coordinator the unsynced row only — never the doc-validation loop', async () => {
    const todos = await getHomeTodos(
      'academic_coordinator',
      'AY2026',
      'coord-1',
      NO_TEACHING_PROFILE,
      CAPS.academic_coordinator
    );
    expect(todos.every((t) => t.kind === 'review')).toBe(true);
    expect(todos.map((t) => t.module)).toEqual(['Records']);
    expect(todos.some((t) => t.id === 'admissions-doc-validation')).toBe(false);
  });

  it('gives school_admin change-request rows with a requestId', async () => {
    const todos = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      CAPS.school_admin
    );
    const cr = todos.find((t) => t.kind === 'change-request');
    expect(cr).toBeDefined();
    expect(cr?.requestId).toBe('cr-1');
    expect(cr?.aging).toEqual({ label: '2 days', tone: 'success' });
    // Unchanged for her: she holds the capability, so the row still appears.
    expect(todos.some((t) => t.id === 'admissions-doc-validation')).toBe(true);
  });

  // The capability gate is load-bearing ON ITS OWN, not just a comment beside
  // the roles list: grants are DATA a superadmin edits at /sis/admin/roles, so
  // a role that is still listed here can lose access without any code change —
  // exactly what happened to the academic coordinator in migration 106.
  it('drops the doc-validation row for a listed role that lost the capability', async () => {
    const withoutDocRead = CAPS.school_admin.filter(
      (c) => c !== 'documents_pre_enrolment.read'
    ) as Capability[];

    const source = HOME_TODO_SOURCES.find(
      (s) => s.id === 'admissions-doc-validation'
    );
    expect(source?.roles).toContain('school_admin'); // still listed…

    const todos = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      withoutDocRead
    );
    expect(todos.some((t) => t.id === 'admissions-doc-validation')).toBe(false); // …and still dropped
    // Only that row goes — the rest of her panel is untouched.
    expect(todos.some((t) => t.kind === 'change-request')).toBe(true);
    expect(todos.some((t) => t.id === 'records-unsynced')).toBe(true);
  });

  it('never gives superadmin change-request rows (KD #41 — not in the approver pool)', async () => {
    const todos = await getHomeTodos(
      'superadmin',
      'AY2026',
      'super-1',
      NO_TEACHING_PROFILE,
      CAPS.superadmin
    );
    expect(todos.some((t) => t.kind === 'change-request')).toBe(false);
    expect(todos.map((t) => t.module)).toContain('P-Files');
  });
});

// ─── the active-role lens (role-switcher Phase 3b) ──────────────────────────
//
// One role picks the rows AND checks them. A switch is a real role change now,
// so a teaching admin working as a teacher arrives here as `'teacher'` and gets
// a teacher's panel — the marks and write-ups she owes, and not the approvals
// her admin role owes, because the two cannot both be in force.
describe('getHomeTodos — one role picks the rows and checks them', () => {
  const BOTH_JOBS = {
    advises: true,
    advisesSubstantively: true,
    teachesSubject: true,
  };

  it('a teacher gets a teacher’s panel and no approvals on it', async () => {
    const todos = await getHomeTodos(
      'teacher',
      'AY2026',
      'teacher-1',
      BOTH_JOBS,
      CAPS.teacher
    );
    expect(todos).toEqual([MARKBOOK_ROW, EVALUATION_ROW]);
    expect(todos.some((t) => t.kind === 'change-request')).toBe(false);
  });

  it('a school_admin gets the approvals', async () => {
    const admin = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      BOTH_JOBS,
      CAPS.school_admin
    );
    expect(admin.some((t) => t.kind === 'change-request')).toBe(true);
  });

  it('⚠ and the CAPABILITY check reads that same role’s grants', async () => {
    // The invariant, stated as the thing that would break. `capabilities`
    // answers what the destination page will ask on arrival, so a row whose
    // grant has been taken away must not be offered.
    const withoutDocRead = CAPS.school_admin.filter(
      (c: Capability) => c !== 'documents_pre_enrolment.read'
    );
    const todos = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      withoutDocRead
    );
    expect(todos.some((t) => t.id === 'admissions-doc-validation')).toBe(false);
    // Not vacuous: with the grant in place the same call does offer it.
    const withDocRead = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      CAPS.school_admin
    );
    expect(withDocRead.some((t) => t.id === 'admissions-doc-validation')).toBe(
      true
    );
  });
});

// ─── grade changes decided step by step (migration 144) ────────────────────
//
// The legacy half fires for school_admin alone. The step-by-step half fires for
// whoever may decide the live step — data, not a role — so a board member on a
// teacher account gets the row, and nobody gets a row they cannot decide.
describe('getHomeTodos — step-by-step grade changes', () => {
  const stepFor = (canDecide: boolean) => ({
    requestId: 'appr-1',
    subjectType: 'grade_change_request',
    subjectId: 'cr-1',
    canDecide,
  });

  it('a teacher on the live step gets a change-request row that approves through the engine', async () => {
    inboxStagesMock.mockImplementation(async () => [stepFor(true)]);
    const todos = await getHomeTodos(
      'teacher',
      'AY2026',
      'teacher-1',
      NO_TEACHING_PROFILE,
      CAPS.teacher
    );
    const cr = todos.find((t) => t.kind === 'change-request');
    expect(cr).toMatchObject({
      requestId: 'cr-1',
      approvalRequestId: 'appr-1',
      href: '/markbook/change-requests?req=cr-1',
    });
    // Only the step-by-step query ran — never the legacy approver scope.
    expect(crQueryCalls).toEqual(['in']);
  });

  it('asks the inbox as nobody-in-particular, over both grade-change flows', async () => {
    await getHomeTodos(
      'superadmin',
      'AY2026',
      'super-1',
      NO_TEACHING_PROFILE,
      CAPS.superadmin
    );
    const scope = inboxStagesMock.mock.calls[0]?.[1] as {
      flows: string[];
      role: unknown;
      userId: string;
    };
    expect([...scope.flows].sort()).toEqual([
      'markbook.grade_change',
      'markbook.grade_change_aeb',
    ]);
    // An oversight role widens what the inbox RETURNS, never what anyone may
    // decide — and this list is only the second.
    expect(scope.role).toBeNull();
    expect(scope.userId).toBe('super-1');
  });

  it('a step the viewer cannot decide produces no row', async () => {
    inboxStagesMock.mockImplementation(async () => [stepFor(false)]);
    const todos = await getHomeTodos(
      'academic_coordinator',
      'AY2026',
      'coord-1',
      NO_TEACHING_PROFILE,
      CAPS.academic_coordinator
    );
    expect(todos.some((t) => t.kind === 'change-request')).toBe(false);
    expect(crQueryCalls).toEqual([]);
  });

  it('a school_admin’s legacy row carries no engine id', async () => {
    const todos = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      CAPS.school_admin
    );
    const cr = todos.find((t) => t.kind === 'change-request');
    expect(cr?.requestId).toBe('cr-1');
    expect(cr).not.toHaveProperty('approvalRequestId');
  });

  it('a request both halves return is listed once', async () => {
    // Cannot happen with real rows — a request is legacy or it is not — but
    // the list must not double a row if it ever did.
    inboxStagesMock.mockImplementation(async () => [stepFor(true)]);
    const todos = await getHomeTodos(
      'school_admin',
      'AY2026',
      'admin-1',
      NO_TEACHING_PROFILE,
      CAPS.school_admin
    );
    expect(todos.filter((t) => t.kind === 'change-request')).toHaveLength(1);
  });
});
