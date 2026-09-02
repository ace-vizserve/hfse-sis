/**
 * A form class adviser must not be able to encode grades.
 *
 * The adviser deliberately READS every subject in their section — that is what
 * `is_teacher_for_sheet` grants in migration 005, so they can monitor the class.
 * But advising is not teaching, and the score-entry route had no
 * teacher_assignments check at all: `requireRole(['teacher', ...])` was the
 * entire authorization, so any user holding the `teacher` role could PATCH any
 * grade entry on any unlocked sheet in the school.
 *
 * Two reasons a unit test on the predicate alone would not have caught this:
 *
 *   1. The gap was an ABSENCE. `isSubjectTeacher` was already correct and
 *      already used by the two sibling paths on the same sheet —
 *      `PATCH .../labels` and `POST /api/change-requests` both 403 with
 *      'not assigned to this sheet'. Scores were the one path that never
 *      called it. Only exercising the real handler proves it now does.
 *   2. RLS cannot be the backstop here. Migration 005 is SELECT-only — its
 *      header states writes are denied to `authenticated` and "the app uses
 *      the service-role client for every write path" — and this route holds a
 *      service client. The route IS the enforcement layer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const SHEET_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';
const TEACHER_ID = 'u-teacher';

// Which assignment rows the cookie client returns for the acting teacher.
// Mutated per test before invoking the handler.
type AssignmentRow = {
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
  relief_teacher_user_id?: string | null;
};
let assignmentRows: AssignmentRow[] = [];

// Cover this teacher is working (migration 117). Empty for every case below
// except the relief ones, which prove a substitute passes the same gate.
//
// Since cover is a COLUMN on teacher_assignments, these rows come back from
// the same query as the held ones — `teacher_user_id` names the absent
// colleague and `relief_teacher_user_id` names the acting teacher. The loader
// tells the two apart by which column matches the caller.
let reliefRows: AssignmentRow[] = [];

// Set to true when the sheet under test is locked.
let sheetLocked = false;

// Spy proving no write reached grade_entries when the gate rejects.
//
// ⚠ THE CHAIN GOES `.update().eq().select().single()`, not `.update().eq()`.
// The shorter shape was enough while every test using it asserted the spy was
// NEVER called — nothing ever consumed the return value. The oversight suite at
// the foot of this file lets a write through on purpose, so the mock now models
// the real chain; `single()` answers with the row the handler expects to get
// back. `.eq()` still resolves on its own for any caller that stops there.
const entryUpdate = vi.fn(() => {
  const result = Promise.resolve({
    data: {
      id: ENTRY_ID,
      grading_sheet_id: SHEET_ID,
      ww_scores: [null, null],
      pt_scores: [null, null, null],
      qa_score: null,
      letter_grade: null,
      is_na: true,
    },
    error: null,
  });
  return {
    eq: () => ({
      select: () => ({ single: () => result }),
      then: (...args: Parameters<Promise<unknown>['then']>) =>
        result.then(...args),
    }),
  };
});

// Which role the JWT carries for the request under test. `'teacher'` for every
// case in the first suite; the second suite raises it to `'school_admin'` to
// pin what the route does for an OVERSIGHT account — see the header there.
//
// Read inside the returned function rather than in the factory body, so the
// value is whatever the test staged, exactly like `assignmentRows` below.
let actingRole: 'teacher' | 'school_admin' = 'teacher';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: TEACHER_ID, email: 'adviser@hfse.test' },
      role: actingRole,
    })
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/audit/log-grade-change', () => ({
  buildAuditRows: vi.fn(() => []),
  writeAuditRows: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));

vi.mock('@/lib/change-requests/labels', () => ({
  fetchLabels: vi.fn(() =>
    Promise.resolve({ student_label: null, sheet_label: null })
  ),
  fetchApproverEmails: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/notifications/email-change-request', () => ({
  notifyRequestApplied: vi.fn(() => Promise.resolve()),
}));

// The cookie-scoped client is used only by loadEffectiveAssignmentsForUser.
// Return whatever the test staged, so the REAL loader and the REAL
// isSubjectTeacher predicate run — the point is to test the wiring, not a
// stubbed decision.
//
// Since migration 117 that is ONE query with an `.or()` across two columns of
// this table — held rows and covered rows come back together — so the stub
// answers `.select().or()` with both sets concatenated.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: (table: string) => {
        if (table === 'teacher_assignments') {
          return {
            select: () => ({
              or: () =>
                Promise.resolve({
                  data: [...assignmentRows, ...reliefRows],
                  error: null,
                }),
              eq: () => Promise.resolve({ data: assignmentRows, error: null }),
            }),
          };
        }
        throw new Error(`unexpected cookie-client table: ${table}`);
      },
    })
  ),
}));

vi.mock('@/lib/supabase/service', () => {
  const single = (data: unknown) => ({
    single: () => Promise.resolve({ data, error: null }),
  });
  return {
    createServiceClient: vi.fn(() => ({
      from: (table: string) => {
        if (table === 'grading_sheets') {
          return {
            select: () => ({
              eq: () =>
                single({
                  id: SHEET_ID,
                  section_id: SECTION_ID,
                  subject_id: SUBJECT_ID,
                  ww_totals: [10, 10],
                  pt_totals: [10, 10, 10],
                  qa_total: 30,
                  is_locked: sheetLocked,
                  slot_labels: null,
                  subject: { is_examinable: true },
                  subject_config: {
                    ww_weight: 0.4,
                    pt_weight: 0.4,
                    qa_weight: 0.2,
                  },
                }),
            }),
          };
        }
        if (table === 'grade_entries') {
          return {
            select: () => ({
              eq: () =>
                single({
                  id: ENTRY_ID,
                  grading_sheet_id: SHEET_ID,
                  ww_scores: [null, null],
                  pt_scores: [null, null, null],
                  qa_score: null,
                  letter_grade: null,
                  is_na: false,
                }),
            }),
            update: entryUpdate,
          };
        }
        throw new Error(`unexpected service table: ${table}`);
      },
    })),
  };
});

import { PATCH } from '@/app/api/grading-sheets/[id]/entries/[entryId]/route';

function buildRequest(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/grading-sheets/${SHEET_ID}/entries/${ENTRY_ID}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  ) as unknown as import('next/server').NextRequest;
}

function invoke(body: Record<string, unknown>) {
  return PATCH(buildRequest(body), {
    params: Promise.resolve({ id: SHEET_ID, entryId: ENTRY_ID }),
  }) as unknown as Promise<Response>;
}

describe('PATCH grade entry — subject-teacher gate', () => {
  beforeEach(() => {
    entryUpdate.mockClear();
    sheetLocked = false;
    reliefRows = [];
    actingRole = 'teacher';
  });

  it('403s a form class adviser on an UNLOCKED sheet in their own section', async () => {
    // The exact real-world case: adviser for the section, assigned to no
    // subject on it. Previously this wrote the score.
    assignmentRows = [
      {
        id: 'a-1',
        teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: null,
        role: 'form_adviser',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'not assigned to this sheet',
    });
  });

  // Relief teachers (migrations 112/113). Entering marks is the substitute's
  // whole job, so the gate must let them through on a slot they are covering —
  // while the sheet header keeps naming the regular teacher, because that is
  // resolved from teacher_assignments and cover never writes to it.
  it('lets a substitute covering this slot enter a score', async () => {
    assignmentRows = []; // holds nothing of their own
    reliefRows = [
      {
        id: 'a-9',
        teacher_user_id: 'the-absent-teacher',
        relief_teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        role: 'subject_teacher',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    // Past the gate. It stops at the slot-label rule (KD #105 — a score needs
    // its activity described first), which is an ordinary business rule that
    // applies to the regular teacher identically. What matters here is that it
    // is NOT the 403 an unassigned teacher gets.
    expect(res.status).not.toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'label_required' });
  });

  it('403s a substitute whose cover is for a different subject', async () => {
    // Cover is per assignment, not per person. Standing in for one teacher's
    // Maths does not open another teacher's Science on the same class.
    assignmentRows = [];
    reliefRows = [
      {
        id: 'a-9',
        teacher_user_id: 'the-absent-teacher',
        relief_teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: 'some-other-subject',
        role: 'subject_teacher',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    expect(res.status).toBe(403);
    expect(entryUpdate).not.toHaveBeenCalled();
  });

  it('writes nothing when the gate rejects', async () => {
    assignmentRows = [
      {
        id: 'a-1',
        teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: null,
        role: 'form_adviser',
      },
    ];

    // Deliberately `is_na`, not a score. Scores are separately intercepted by
    // the first-score label gate (KD #105), which 422s an unlabelled slot — so
    // asserting "no write" on a score payload passes even with this gate
    // removed, i.e. for the wrong reason. `is_na` is not a score, reaches the
    // write, and so isolates THIS gate as the only thing that can stop it.
    await invoke({ is_na: true });

    expect(entryUpdate).not.toHaveBeenCalled();
  });

  it('403s a teacher who teaches the subject in a DIFFERENT section', async () => {
    // Guards the wider hole the same absence left open: role alone was the
    // authorization, so assignment to any section was enough to reach any sheet.
    assignmentRows = [
      {
        id: 'a-2',
        teacher_user_id: TEACHER_ID,
        section_id: 'some-other-section',
        subject_id: SUBJECT_ID,
        role: 'subject_teacher',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'not assigned to this sheet',
    });
  });

  it('lets the assigned subject teacher through the gate', async () => {
    // Proves the gate is not simply blocking everyone. The sheet is LOCKED, so
    // this request still 403s — but at the lock gate, with a different message.
    // Distinguishing the two messages shows the assignment check passed without
    // needing to mock the entire compute-and-write path.
    sheetLocked = true;
    assignmentRows = [
      {
        id: 'a-3',
        teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        role: 'subject_teacher',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'sheet is locked',
    });
  });

  it('lets a teacher who is BOTH adviser and subject teacher through', async () => {
    // Common at HFSE: the adviser also teaches one subject to their own class.
    // Narrowing the gate must not cost them their own sheet.
    sheetLocked = true;
    assignmentRows = [
      {
        id: 'a-4',
        teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: null,
        role: 'form_adviser',
      },
      {
        id: 'a-5',
        teacher_user_id: TEACHER_ID,
        section_id: SECTION_ID,
        subject_id: SUBJECT_ID,
        role: 'subject_teacher',
      },
    ];

    const res = await invoke({ qa_score: 25 });

    await expect(res.json()).resolves.toMatchObject({
      error: 'sheet is locked',
    });
  });
});

/**
 * THE MISSING LEG OF THE PAGE↔ROUTE DIRECTION ARGUMENT.
 *
 * `__tests__/markbook/grading-lens-direction.test.ts` proves the Teacher lens
 * can only ever make `/markbook/grading/[id]` MORE restrictive than the same
 * page renders for the account role. On its own that proves the page cannot
 * become more permissive than ITSELF. The argument reaches the route through
 * one further premise:
 *
 *   > the page already agreed with the route before the lens existed, and the
 *   > route's answer is CONSTANT with respect to the view — it decides on the
 *   > JWT role, which no lens can touch.
 *
 * Nothing checked that premise, and it is the leg the whole thing stands on.
 * This suite checks it, in the only place it can be checked honestly: by
 * driving the REAL handler with an OVERSIGHT role and showing it accepts
 * exactly the requests the Teacher view has just refused.
 *
 * ⚠ THE ASYMMETRY IS THE POINT, not a defect. The route runs its
 * subject-teacher check under `if (role === 'teacher')`, so for a
 * `school_admin` it does not run at all. The page in the Teacher view refuses
 * anyway. Page stricter than route is safe; the reverse is editable inputs and
 * a 403 on save, which is a regression this codebase has shipped before.
 */
describe('the route accepts what the Teacher view refuses', () => {
  beforeEach(() => {
    entryUpdate.mockClear();
    sheetLocked = false;
    reliefRows = [];
    assignmentRows = [];
    actingRole = 'school_admin';
  });

  it('an UNLOCKED sheet: oversight passes the subject-teacher gate holding no assignment', async () => {
    // The page's Teacher view calls this read-only —
    // `readOnly = viewRole === 'teacher' && !isAssignedTeacher`. The route does
    // not even ask: the assignment check is teacher-only.
    const res = await invoke({ qa_score: 25 });

    expect(res.status).not.toBe(403);
    // Stops at the ordinary slot-label rule (KD #105), which applies to every
    // role identically — NOT at the assignment gate. Distinguishing the two is
    // what shows the gate was passed rather than skipped by accident.
    await expect(res.json()).resolves.toMatchObject({ code: 'label_required' });
  });

  it('an UNLOCKED sheet: oversight actually reaches the write', async () => {
    // `is_na` is not a score, so it is not intercepted by the label rule above
    // and reaches `grade_entries.update`. The strongest form of the premise:
    // the route does not merely decline to 403, it performs the write the
    // Teacher view was refusing to offer.
    await invoke({ is_na: true });

    expect(entryUpdate).toHaveBeenCalled();
  });

  it('a LOCKED sheet: oversight is not turned away by the teacher lock', async () => {
    // The Teacher view makes a locked sheet read-only for her
    // (`isLocked && !canManage`). The route's lock branch refuses only
    // `role === 'teacher'`; for oversight it falls through to the post-lock
    // correction rule, which is a DIFFERENT refusal with a different message.
    sheetLocked = true;

    const res = await invoke({ qa_score: 25 });

    const body = (await res.json()) as { error?: string };
    expect(body.error).not.toBe('sheet is locked');
    expect(body.error).toMatch(/post-lock edits require exactly one of/);
  });

  it('and a real teacher in the identical situation IS turned away', async () => {
    // Non-vacuous, and it pins the asymmetry rather than assuming it: the same
    // request, the same sheet, the same absence of an assignment — refused,
    // because the JWT role is `teacher`. If the route ever stopped branching on
    // role, this test goes red and the direction argument needs re-deriving.
    //
    // The refusal is the ASSIGNMENT gate rather than the lock gate, because the
    // assignment check runs first — which is the same gate the oversight case
    // above walked straight past.
    actingRole = 'teacher';
    sheetLocked = true;

    const res = await invoke({ qa_score: 25 });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'not assigned to this sheet',
    });
  });
});
