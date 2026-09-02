import { describe, expect, it } from 'vitest';

import {
  canManageAnyDisciplineRecord,
  canReadAttendance,
  canReadReportCard,
  canReadRoster,
  canReadWriteups,
  capabilityForSection,
  resolveClassroomScope,
  type ClassroomCapability,
} from '@/lib/classroom/scope';
import type { AssignmentRow } from '@/lib/auth/teacher-assignments';
import { ROLES, type Role } from '@/lib/auth/roles';

const SECTION_A = 'sec-a';
const SECTION_B = 'sec-b';

function adviserRow(sectionId: string): AssignmentRow {
  return {
    id: `adv-${sectionId}`,
    teacher_user_id: 'u-1',
    section_id: sectionId,
    subject_id: null,
    role: 'form_adviser',
  };
}

function subjectRow(sectionId: string, subjectId: string): AssignmentRow {
  return {
    id: `sub-${sectionId}-${subjectId}`,
    teacher_user_id: 'u-1',
    section_id: sectionId,
    subject_id: subjectId,
    role: 'subject_teacher',
  };
}

describe('resolveClassroomScope — oversight roles', () => {
  it.each(['academic_coordinator', 'school_admin', 'superadmin'] as const)(
    '%s sees every section (sectionIds null, not empty)',
    (role) => {
      const scope = resolveClassroomScope(role, []);
      expect(scope.isOversight).toBe(true);
      expect(scope.sectionIds).toBeNull();
    }
  );

  it('oversight ignores assignments entirely', () => {
    const scope = resolveClassroomScope('academic_coordinator', [
      subjectRow(SECTION_A, 'subj-1'),
    ]);
    expect(scope.sectionIds).toBeNull();
    expect(capabilityForSection(scope, 'any-section-at-all')).toBe('oversight');
  });
});

describe('resolveClassroomScope — non-teaching roles', () => {
  it.each(['admissions', 'p_file_officer'] as const)(
    '%s gets no classes (empty array, distinct from null)',
    (role) => {
      const scope = resolveClassroomScope(role, [adviserRow(SECTION_A)]);
      expect(scope.isOversight).toBe(false);
      expect(scope.sectionIds).toEqual([]);
      expect(capabilityForSection(scope, SECTION_A)).toBeNull();
    }
  );

  it('a null role gets no classes', () => {
    const scope = resolveClassroomScope(null, [adviserRow(SECTION_A)]);
    expect(scope.sectionIds).toEqual([]);
  });

  // Guards the empty-vs-null distinction: a caller that treats [] as
  // "unscoped" would show every class to admissions.
  it('empty scope is never null', () => {
    expect(resolveClassroomScope('admissions', []).sectionIds).not.toBeNull();
  });
});

describe('resolveClassroomScope — teacher', () => {
  it('a form adviser gets adviser capability on their section', () => {
    const scope = resolveClassroomScope('teacher', [adviserRow(SECTION_A)]);
    expect(scope.sectionIds).toEqual([SECTION_A]);
    expect(capabilityForSection(scope, SECTION_A)).toBe('adviser');
  });

  it('a subject teacher gets subject capability', () => {
    const scope = resolveClassroomScope('teacher', [
      subjectRow(SECTION_A, 'subj-1'),
    ]);
    expect(capabilityForSection(scope, SECTION_A)).toBe('subject');
  });

  it('a section the teacher has no assignment for yields null capability', () => {
    const scope = resolveClassroomScope('teacher', [adviserRow(SECTION_A)]);
    expect(capabilityForSection(scope, SECTION_B)).toBeNull();
  });

  it('dedupes multiple subject assignments in one section', () => {
    const scope = resolveClassroomScope('teacher', [
      subjectRow(SECTION_A, 'subj-1'),
      subjectRow(SECTION_A, 'subj-2'),
    ]);
    expect(scope.sectionIds).toEqual([SECTION_A]);
  });

  it('spans multiple sections', () => {
    const scope = resolveClassroomScope('teacher', [
      adviserRow(SECTION_A),
      subjectRow(SECTION_B, 'subj-1'),
    ]);
    expect(scope.sectionIds?.sort()).toEqual([SECTION_A, SECTION_B]);
    expect(capabilityForSection(scope, SECTION_A)).toBe('adviser');
    expect(capabilityForSection(scope, SECTION_B)).toBe('subject');
  });

  // Order-independence matters: assignment rows come back in arbitrary DB
  // order, and an adviser must never be downgraded to 'subject' just
  // because the subject row happened to be read second.
  it('adviser wins over subject in the same section, in either row order', () => {
    const adviserFirst = resolveClassroomScope('teacher', [
      adviserRow(SECTION_A),
      subjectRow(SECTION_A, 'subj-1'),
    ]);
    const subjectFirst = resolveClassroomScope('teacher', [
      subjectRow(SECTION_A, 'subj-1'),
      adviserRow(SECTION_A),
    ]);
    expect(capabilityForSection(adviserFirst, SECTION_A)).toBe('adviser');
    expect(capabilityForSection(subjectFirst, SECTION_A)).toBe('adviser');
  });
});

describe('capability gates mirror RLS', () => {
  // The load-bearing invariant of this whole feature: attendance and
  // write-ups are is_adviser_for_section at the DB level, so a subject
  // teacher must never be offered them.
  it('subject capability grants roster but NOT attendance or write-ups', () => {
    expect(canReadRoster('subject')).toBe(true);
    expect(canReadAttendance('subject')).toBe(false);
    expect(canReadWriteups('subject')).toBe(false);
    // The report card embeds both the attendance table and the adviser
    // comment, so it inherits the stricter of the two.
    expect(canReadReportCard('subject')).toBe(false);
  });

  it('adviser capability grants everything', () => {
    expect(canReadRoster('adviser')).toBe(true);
    expect(canReadAttendance('adviser')).toBe(true);
    expect(canReadWriteups('adviser')).toBe(true);
    expect(canReadReportCard('adviser')).toBe(true);
  });

  it('oversight capability grants everything', () => {
    expect(canReadRoster('oversight')).toBe(true);
    expect(canReadAttendance('oversight')).toBe(true);
    expect(canReadWriteups('oversight')).toBe(true);
    expect(canReadReportCard('oversight')).toBe(true);
  });

  it('no capability grants nothing', () => {
    expect(canReadRoster(null)).toBe(false);
    expect(canReadAttendance(null)).toBe(false);
    expect(canReadWriteups(null)).toBe(false);
    expect(canReadReportCard(null)).toBe(false);
  });

  // Belt-and-braces: if a future capability is added, it must be
  // consciously granted attendance rather than inheriting it.
  it('only adviser and oversight can read attendance', () => {
    const all: Array<ClassroomCapability | null> = [
      'adviser',
      'subject',
      'oversight',
      null,
    ];
    expect(all.filter(canReadAttendance)).toEqual(['adviser', 'oversight']);
  });

  it('only adviser and oversight can read a report card', () => {
    const all: Array<ClassroomCapability | null> = [
      'adviser',
      'subject',
      'oversight',
      null,
    ];
    expect(all.filter(canReadReportCard)).toEqual(['adviser', 'oversight']);
  });

  // FILING a disciplinary record is open to any staff member — Chandana,
  // 2026-08-14: incident reports are filed by "the person in charge who is
  // present at the venue of incident", which is a circumstance, not a role.
  // EDITING one you did not file is leadership only (Mr Ace, 2026-08-17), and
  // this predicate is only that second half; the route ORs it with
  // `record.filedBy === user.id`.
  it('only oversight can edit a discipline record they did not file', () => {
    const all: Array<ClassroomCapability | null> = [
      'adviser',
      'subject',
      'oversight',
      null,
    ];
    expect(all.filter(canManageAnyDisciplineRecord)).toEqual(['oversight']);
  });

  // A form adviser is NOT leadership here. They run the class, but correcting
  // another staff member's account of an incident is a different authority —
  // and the school routes a case to the FCA, the Discipline Committee or
  // Student Support Services by severity, none of which the system models yet.
  it('does not let a form adviser edit another person’s filing', () => {
    expect(canManageAnyDisciplineRecord('adviser')).toBe(false);
  });
});

// ── The active-role lens (role-switcher Phase 3a) ─────────────────────────
//
// Six live `school_admin` accounts also teach, four as the form adviser of
// record. `resolveClassroomScope` is what makes the two views differ: a page
// hands it `activeRole`, an API route hands it the real `role`, and the SAME
// account and the SAME assignment rows must produce two different answers.
//
// These cases are written as the pair, not as two separate assertions, because
// the property that matters is the RELATIONSHIP between them — the teacher
// view must be a strict narrowing of the admin view, never a widening.
describe('resolveClassroomScope — the active-role lens', () => {
  const teachingAdminRows = [
    adviserRow(SECTION_A),
    subjectRow(SECTION_B, 's1'),
  ];

  it('a school_admin who advises a class: oversight in the Admin view', () => {
    const scope = resolveClassroomScope('school_admin', teachingAdminRows);
    expect(scope.isOversight).toBe(true);
    expect(scope.sectionIds).toBeNull();
    // Every class in the year, including ones she has no assignment for.
    expect(capabilityForSection(scope, 'sec-she-never-heard-of')).toBe(
      'oversight'
    );
  });

  it('the same account, same rows: adviser for that one class in the Teacher view', () => {
    const scope = resolveClassroomScope('teacher', teachingAdminRows);
    expect(scope.isOversight).toBe(false);
    expect(capabilityForSection(scope, SECTION_A)).toBe('adviser');
    expect(capabilityForSection(scope, SECTION_B)).toBe('subject');
    // The narrowing is the point: a class she holds no row for is now closed
    // to her, where the Admin view above opened every one.
    expect(capabilityForSection(scope, 'sec-she-never-heard-of')).toBeNull();
  });

  it('the Teacher view is a strict subset of the Admin view, never a widening', () => {
    const adminView = resolveClassroomScope('school_admin', teachingAdminRows);
    const teacherView = resolveClassroomScope('teacher', teachingAdminRows);
    // Oversight reaches everything, so "subset" is only meaningful as: the
    // teacher view names a finite list, and the admin view answers for all of
    // it. Both halves are asserted so a future change to either side shows up.
    expect(adminView.sectionIds).toBeNull();
    expect(teacherView.sectionIds).toEqual([SECTION_A, SECTION_B]);
    for (const id of teacherView.sectionIds ?? []) {
      expect(capabilityForSection(adminView, id)).toBe('oversight');
    }
  });

  it('a plain teacher is unaffected — the lens can only ever say "teacher" for them', () => {
    // `getEntitledRoles` returns exactly `['teacher']` for a teacher, so
    // `activeRole` is always `'teacher'` and that is the only call that can
    // happen for them. Pinned because "nothing about a teacher's behaviour can
    // change" is the claim the whole phase rests on.
    //
    // Stated as the WHOLE expected scope rather than by comparing the call
    // with itself: an earlier version of this test asserted
    // `resolveClassroomScope('teacher', rows)` equals
    // `resolveClassroomScope('teacher', rows)`, which is a determinism check
    // wearing a lens test's name — it would have passed just as happily if
    // every value in it were wrong.
    expect(resolveClassroomScope('teacher', teachingAdminRows)).toEqual({
      sectionIds: [SECTION_A, SECTION_B],
      capabilityBySection: {
        [SECTION_A]: 'adviser',
        [SECTION_B]: 'subject',
      },
      substantiveCapabilityBySection: {
        [SECTION_A]: 'adviser',
        [SECTION_B]: 'subject',
      },
      isOversight: false,
    });
  });

  it('an oversight role with no assignments is unaffected in either view', () => {
    // An admin who does not teach is never offered the teacher lens at all
    // (`getEntitledRoles` adds it only on assignment rows), so her only
    // reachable answer is the oversight one — and it must not have moved.
    const adminView = resolveClassroomScope('academic_coordinator', []);
    expect(adminView.isOversight).toBe(true);
    expect(adminView.sectionIds).toBeNull();
    // And if a hand-edited cookie somehow reached here, the answer is "no
    // classes", not "every class": the fallback is closed, not open.
    const forcedTeacherView = resolveClassroomScope('teacher', []);
    expect(forcedTeacherView.isOversight).toBe(false);
    expect(forcedTeacherView.sectionIds).toEqual([]);
  });

  it('relief cover carries through the lens on both maps', () => {
    // A teaching admin covering a colleague's class gets the working
    // capability and NOT the adviser-of-record one, exactly as a teacher does.
    const covering = {
      ...adviserRow(SECTION_A),
      via: 'relief' as const,
    };
    const scope = resolveClassroomScope('teacher', [covering]);
    expect(scope.capabilityBySection[SECTION_A]).toBe('adviser');
    expect(scope.substantiveCapabilityBySection[SECTION_A]).toBeUndefined();
  });
});

describe('every role resolves without throwing', () => {
  it.each(ROLES.map((r) => [r] as const))('%s', (role: Role) => {
    expect(() =>
      resolveClassroomScope(role, [
        adviserRow(SECTION_A),
        subjectRow(SECTION_B, 'subj-1'),
      ])
    ).not.toThrow();
  });
});
