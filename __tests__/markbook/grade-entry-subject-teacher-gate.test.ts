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
let assignmentRows: Array<{
  id: string;
  teacher_user_id: string;
  section_id: string;
  subject_id: string | null;
  role: 'form_adviser' | 'subject_teacher';
}> = [];

// Active cover this teacher is working (migration 112). Empty for every case
// below except the relief one, which proves a substitute passes the same gate.
let reliefRows: Array<{
  id: string;
  relief_teacher_user_id: string;
  assignment: {
    id: string;
    teacher_user_id: string;
    section_id: string;
    subject_id: string | null;
    role: 'form_adviser' | 'subject_teacher';
  };
}> = [];

// Set to true when the sheet under test is locked.
let sheetLocked = false;

// Spy proving no write reached grade_entries when the gate rejects.
const entryUpdate = vi.fn(() => ({
  eq: () => Promise.resolve({ data: null, error: null }),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: TEACHER_ID, email: 'adviser@hfse.test' },
      role: 'teacher',
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
// `assignment_reliefs` is the second half of that loader (migration 112): it
// asks which classes this teacher is currently covering for an absent
// colleague. These cases stage no cover, so it answers with nothing — but it
// must ANSWER. The loader deliberately does not swallow an error there, because
// a silent empty result would read as "covers nothing" and lock a substitute
// out of the class they were asked to take.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: (table: string) => {
        if (table === 'teacher_assignments') {
          return {
            select: () => ({
              eq: () => Promise.resolve({ data: assignmentRows, error: null }),
            }),
          };
        }
        if (table === 'assignment_reliefs') {
          // `.eq().lte().or()` — the cover query is date-windowed (migration
          // 115), so it filters on started_on and ended_on rather than just
          // testing ended_on for null.
          return {
            select: () => ({
              eq: () => ({
                lte: () => ({
                  or: () => Promise.resolve({ data: reliefRows, error: null }),
                }),
              }),
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
        id: 'relief-1',
        relief_teacher_user_id: TEACHER_ID,
        assignment: {
          id: 'a-9',
          teacher_user_id: 'the-absent-teacher',
          section_id: SECTION_ID,
          subject_id: SUBJECT_ID,
          role: 'subject_teacher',
        },
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
        id: 'relief-2',
        relief_teacher_user_id: TEACHER_ID,
        assignment: {
          id: 'a-9',
          teacher_user_id: 'the-absent-teacher',
          section_id: SECTION_ID,
          subject_id: 'some-other-subject',
          role: 'subject_teacher',
        },
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
