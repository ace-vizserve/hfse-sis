/**
 * `resolveTeacherNavScope` under the active-role lens.
 *
 * One assignment read, two answers — and after Phase 3a the two are keyed on
 * DIFFERENT roles, which is the only thing in this file worth a test:
 *
 *   • `hiddenModules` ← the REAL role. Hiding a module only ever narrows a
 *     teacher; narrowing an admin would take Attendance or Evaluation off the
 *     module switcher, the home page, the account shortcuts and the palette at
 *     once, for someone whose account can open all of them.
 *   • `profile`      ← the VIEW role. In the Teacher view a teaching admin IS
 *     doing adviser or subject work, and an empty profile would leave her with
 *     a Teacher home page carrying none of the teacher actions.
 *
 * Getting the asymmetry backwards type-checks and runs, so it is asserted in
 * both directions rather than implied by one happy path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EffectiveAssignmentRow } from '@/lib/auth/teacher-assignments';

const loadMemo = vi.fn<() => Promise<EffectiveAssignmentRow[]>>();

vi.mock('@/lib/auth/assignments-cache', () => ({
  loadEffectiveAssignmentsForUserMemo: () => loadMemo(),
}));

const { resolveTeacherNavScope } =
  await import('@/lib/sidebar/resolve-hidden-modules');

const USER = 'u-1';

function adviser(sectionId = 'sec-1'): EffectiveAssignmentRow {
  return {
    id: `adv-${sectionId}`,
    teacher_user_id: USER,
    section_id: sectionId,
    subject_id: null,
    role: 'form_adviser',
    via: 'substantive',
  };
}

function subject(sectionId = 'sec-1'): EffectiveAssignmentRow {
  return {
    id: `sub-${sectionId}`,
    teacher_user_id: USER,
    section_id: sectionId,
    subject_id: 'subj-1',
    role: 'subject_teacher',
    via: 'substantive',
  };
}

beforeEach(() => {
  loadMemo.mockReset();
});

describe('the Admin view costs nothing and changes nothing', () => {
  it('a school_admin in her own view never touches the database', () => {
    // The short-circuit is what keeps `getViewContext()`'s new per-request
    // read from being joined by a second one on every module layout. If this
    // ever starts reading, five of the six roles pay for it on every page.
    loadMemo.mockResolvedValue([adviser()]);
    return resolveTeacherNavScope('school_admin', USER).then((scope) => {
      expect(loadMemo).not.toHaveBeenCalled();
      expect(scope).toEqual({
        hiddenModules: [],
        profile: {
          advises: false,
          advisesSubstantively: false,
          teachesSubject: false,
        },
      });
    });
  });

  it('passing the account role explicitly is the same as omitting it', async () => {
    loadMemo.mockResolvedValue([adviser()]);
    const implicit = await resolveTeacherNavScope('school_admin', USER);
    const explicit = await resolveTeacherNavScope(
      'school_admin',
      USER,
      'school_admin'
    );
    expect(explicit).toEqual(implicit);
  });
});

describe('the Teacher view gives a teaching admin a real profile', () => {
  it('an admin who advises a class advises in the Teacher view', async () => {
    loadMemo.mockResolvedValue([adviser()]);
    const scope = await resolveTeacherNavScope('school_admin', USER, 'teacher');
    expect(loadMemo).toHaveBeenCalledTimes(1);
    expect(scope.profile).toEqual({
      advises: true,
      advisesSubstantively: true,
      teachesSubject: false,
    });
  });

  it('and one who only teaches a subject gets only that job', async () => {
    loadMemo.mockResolvedValue([subject()]);
    const scope = await resolveTeacherNavScope('school_admin', USER, 'teacher');
    expect(scope.profile).toEqual({
      advises: false,
      advisesSubstantively: false,
      teachesSubject: true,
    });
  });

  it('⚠ but her ASSIGNMENTS never narrow her, whatever she is assigned', async () => {
    // The asymmetry, stated as the thing that would break. A subject-teacher
    // -only TEACHER loses Attendance and Evaluation from the switcher; the
    // same rows on a school_admin must take nothing away, because her account
    // can open both modules and the switcher is her way in.
    loadMemo.mockResolvedValue([subject()]);
    const admin = await resolveTeacherNavScope('school_admin', USER, 'teacher');
    expect(admin.hiddenModules).not.toContain('attendance');
    expect(admin.hiddenModules).not.toContain('evaluation');
    expect(admin.hiddenModules).not.toContain('markbook');
    expect(admin.hiddenModules).not.toContain('classroom');

    const teacher = await resolveTeacherNavScope('teacher', USER);
    expect(teacher.hiddenModules).toEqual(['attendance', 'evaluation']);
  });

  it('while the VIEW narrows her, on a completely different question', async () => {
    // Role-switcher Phase 3b. The list is now a union of two rules and they
    // must not be confused for one: assignments decide whether a module is
    // USEFUL (and only ever narrow a teacher), ROUTE_ACCESS decides whether the
    // view can OPEN it at all. `/sis`, `/records`, `/p-files` and `/admissions`
    // refuse a teacher, and filtering their sidebars through a teacher lens
    // would empty every group — so the tiles go instead of the trees.
    loadMemo.mockResolvedValue([subject()]);
    const admin = await resolveTeacherNavScope('school_admin', USER, 'teacher');
    expect(admin.hiddenModules).toEqual([
      'admissions',
      'records',
      'p-files',
      'sis',
    ]);
  });

  it('and gives every one of them back the moment she switches home', async () => {
    // Nothing about the hiding may persist — it is derived from the lens on
    // each request and from nothing else.
    loadMemo.mockResolvedValue([subject()]);
    const back = await resolveTeacherNavScope(
      'school_admin',
      USER,
      'school_admin'
    );
    expect(back.hiddenModules).toEqual([]);
  });
});

describe('a plain teacher is untouched', () => {
  it('behaves identically whether or not the lens is passed', async () => {
    loadMemo.mockResolvedValue([adviser(), subject('sec-2')]);
    const implicit = await resolveTeacherNavScope('teacher', USER);
    const explicit = await resolveTeacherNavScope('teacher', USER, 'teacher');
    expect(explicit).toEqual(implicit);
    expect(implicit.profile).toEqual({
      advises: true,
      advisesSubstantively: true,
      teachesSubject: true,
    });
    expect(implicit.hiddenModules).toEqual([]);
  });
});

describe('the read still fails OPEN, on both halves', () => {
  it('a failed read grants both jobs and hides nothing the READ would have hidden', async () => {
    // Unchanged by Phase 3a and asserted here because the new branch runs for
    // a role that never reached this catch before. An all-false profile would
    // strip the quick-action row while looking like a safe default.
    //
    // ⚠ AND PHASE 3b NARROWED WHAT "HIDES NOTHING" MEANS, ON PURPOSE. Fail-open
    // is a promise about the ASSIGNMENT READ: the two adviser-only modules stay
    // visible, because the query that would have taken them away did not
    // answer. The route-shaped half never asked the database, so it still holds
    // — putting `/sis` back here would offer a tile whose sidebar the Teacher
    // view cannot fill, on the strength of an unrelated failure.
    loadMemo.mockRejectedValue(new Error('connection reset'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = await resolveTeacherNavScope('school_admin', USER, 'teacher');
    expect(scope).toEqual({
      hiddenModules: ['admissions', 'records', 'p-files', 'sis'],
      profile: {
        advises: true,
        advisesSubstantively: true,
        teachesSubject: true,
      },
    });
    warn.mockRestore();
  });

  it('and a failed read for a real teacher still hides nothing at all', async () => {
    // The case the promise was written for, unchanged: no lens, so nothing
    // route-shaped to subtract, and a form adviser keeps Attendance.
    loadMemo.mockRejectedValue(new Error('connection reset'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scope = await resolveTeacherNavScope('teacher', USER);
    expect(scope.hiddenModules).toEqual([]);
    warn.mockRestore();
  });
});
