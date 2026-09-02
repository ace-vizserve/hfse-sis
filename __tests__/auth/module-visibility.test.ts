/**
 * The module switcher filters on ROUTE_ACCESS, which knows the ROLE but not the
 * teacher's assignments — so every teacher saw Attendance and Evaluation tiles,
 * including subject-teacher-only users who can never use either (attendance is
 * gated `is_adviser_for_section` at the DB; KD #114 removed subject teachers
 * from Evaluation entirely). These pin the narrowing.
 *
 * The failure that matters most is NOT "a dead tile is shown" — that's an
 * annoyance. It's "a form adviser loses Attendance", which would take away
 * their daily work surface. Several tests below exist only to guard that
 * direction.
 */

import { describe, it, expect } from 'vitest';
import {
  ADVISER_ONLY_MODULES,
  hiddenModulesForTeacher,
  hiddenModulesForView,
  isHiddenModuleHref,
  moduleAdmitsRole,
  teachingProfileFor,
} from '@/lib/sidebar/module-visibility';
import { MODULE_ORDER, SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';
import type { AssignmentRow } from '@/lib/auth/teacher-assignments';
import { isRouteAllowed, ROLES, type Role } from '@/lib/auth/roles';

function assignment(
  role: 'form_adviser' | 'subject_teacher',
  sectionId = 'sec-1'
): AssignmentRow {
  return {
    id: `ta-${role}-${sectionId}`,
    teacher_user_id: 'user-1',
    section_id: sectionId,
    subject_id: role === 'subject_teacher' ? 'sub-1' : null,
    role,
  };
}

describe('hiddenModulesForTeacher — narrowing subject-teacher-only users', () => {
  it('hides Attendance and Evaluation from a subject-teacher-only user', () => {
    const hidden = hiddenModulesForTeacher('teacher', [
      assignment('subject_teacher'),
    ]);
    expect(hidden).toEqual([...ADVISER_ONLY_MODULES]);
    expect(hidden).toContain('attendance');
    expect(hidden).toContain('evaluation');
  });

  it('never hides Markbook or Classroom from a subject teacher', () => {
    // Their grading sheet is real work and Classroom shows the classes they
    // teach — hiding either would remove access they actually have.
    const hidden = hiddenModulesForTeacher('teacher', [
      assignment('subject_teacher'),
    ]);
    expect(hidden).not.toContain('markbook');
    expect(hidden).not.toContain('classroom');
  });

  it('hides both for a teacher with no assignments at all', () => {
    expect(hiddenModulesForTeacher('teacher', [])).toEqual([
      ...ADVISER_ONLY_MODULES,
    ]);
  });
});

describe('hiddenModulesForTeacher — never narrows someone who needs it', () => {
  it('hides nothing from a form adviser', () => {
    expect(
      hiddenModulesForTeacher('teacher', [assignment('form_adviser')])
    ).toEqual([]);
  });

  it('hides nothing when advising one class and teaching subjects in others', () => {
    // The realistic case, and the one a naive "is every row a subject row?"
    // check would get wrong in the dangerous direction.
    const hidden = hiddenModulesForTeacher('teacher', [
      assignment('subject_teacher', 'sec-1'),
      assignment('subject_teacher', 'sec-2'),
      assignment('form_adviser', 'sec-3'),
      assignment('subject_teacher', 'sec-4'),
    ]);
    expect(hidden).toEqual([]);
  });

  it('is order-independent — adviser last still counts', () => {
    // DB row order is arbitrary; the same invariant scope.ts pins.
    const advisorFirst = hiddenModulesForTeacher('teacher', [
      assignment('form_adviser', 'sec-1'),
      assignment('subject_teacher', 'sec-2'),
    ]);
    const advisorLast = hiddenModulesForTeacher('teacher', [
      assignment('subject_teacher', 'sec-2'),
      assignment('form_adviser', 'sec-1'),
    ]);
    expect(advisorFirst).toEqual(advisorLast);
    expect(advisorLast).toEqual([]);
  });
});

describe('hiddenModulesForTeacher — only the teacher role is narrowed', () => {
  const nonTeachers: Array<Role | null> = [
    'academic_coordinator',
    'school_admin',
    'superadmin',
    'admissions',
    'p_file_officer',
    null,
  ];

  it.each(nonTeachers)('hides nothing from %s', (role) => {
    // Oversight roles hold no assignment rows at all, so an assignment-derived
    // rule applied to them would hide the modules from exactly the people who
    // work across every class.
    expect(hiddenModulesForTeacher(role, [])).toEqual([]);
  });
});

describe('isHiddenModuleHref — the five surfaces must agree', () => {
  const hidden = [...ADVISER_ONLY_MODULES];

  it('catches deep links, not just the module root', () => {
    // The home page offers "Mark attendance" -> /attendance/sections, not
    // /attendance. Matching only the root would leave that action on the page
    // while the switcher tile was hidden — the dead end still reachable, just
    // harder to explain.
    expect(isHiddenModuleHref('/attendance', hidden)).toBe(true);
    expect(isHiddenModuleHref('/attendance/sections', hidden)).toBe(true);
    expect(isHiddenModuleHref('/evaluation', hidden)).toBe(true);
    expect(isHiddenModuleHref('/evaluation/sections/abc', hidden)).toBe(true);
  });

  it('ignores query strings and fragments', () => {
    expect(isHiddenModuleHref('/attendance/x?date=2026-07-29', hidden)).toBe(
      true
    );
    expect(isHiddenModuleHref('/evaluation?term_id=t1#top', hidden)).toBe(true);
  });

  it('leaves other modules alone', () => {
    expect(isHiddenModuleHref('/markbook/grading', hidden)).toBe(false);
    expect(isHiddenModuleHref('/classroom/abc/grades', hidden)).toBe(false);
    expect(isHiddenModuleHref('/records/students', hidden)).toBe(false);
  });

  it('does not match a module whose path merely starts with the same text', () => {
    // Guards the classic prefix bug: '/attendance-report' is not '/attendance'.
    expect(isHiddenModuleHref('/attendance-report', hidden)).toBe(false);
    expect(isHiddenModuleHref('/evaluations', hidden)).toBe(false);
  });

  it('hides nothing when the hidden list is empty', () => {
    expect(isHiddenModuleHref('/attendance/sections', [])).toBe(false);
  });
});

// `hiddenModulesForTeacher` above answers a MODULE question ("is Attendance
// ever useful to you"). This answers the finer one: which of the two teaching
// jobs the person holds, which is what decides whether an ACTION is theirs.
describe('teachingProfileFor', () => {
  const adviser = (sectionId: string) => ({
    id: `a-${sectionId}`,
    teacher_user_id: 'u1',
    section_id: sectionId,
    subject_id: null,
    role: 'form_adviser' as const,
  });
  const subject = (sectionId: string, subjectId: string) => ({
    id: `s-${sectionId}-${subjectId}`,
    teacher_user_id: 'u1',
    section_id: sectionId,
    subject_id: subjectId,
    role: 'subject_teacher' as const,
  });

  it('reports adviser-only', () => {
    expect(teachingProfileFor('teacher', [adviser('sec-1')])).toEqual({
      advises: true,
      // A plain assignment row carries no `via`, so it is a class this teacher
      // actually holds — both axes true.
      advisesSubstantively: true,
      teachesSubject: false,
    });
  });

  it('reports subject-only', () => {
    expect(teachingProfileFor('teacher', [subject('sec-1', 'sub-1')])).toEqual({
      advises: false,
      advisesSubstantively: false,
      teachesSubject: true,
    });
  });

  it('reports both when the person does both jobs', () => {
    // The partial unique indexes on teacher_assignments permit this: the
    // adviser index keys on section_id alone, so one person can advise one
    // class and teach subjects in others.
    expect(
      teachingProfileFor('teacher', [
        adviser('sec-1'),
        subject('sec-2', 'sub-1'),
        subject('sec-3', 'sub-2'),
      ])
    ).toEqual({
      advises: true,
      advisesSubstantively: true,
      teachesSubject: true,
    });
  });

  it('is order-independent', () => {
    const rows = [subject('sec-2', 'sub-1'), adviser('sec-1')];
    expect(teachingProfileFor('teacher', rows)).toEqual(
      teachingProfileFor('teacher', [...rows].reverse())
    );
  });

  // Relief teachers (migrations 112/113). A substitute covering a form adviser
  // does the adviser's day-to-day work but is not the adviser of record — the
  // regular adviser still writes the write-ups while away. So the two axes
  // disagree, and everything keyed on the second must stay shut.
  it('a cover-only adviser advises, but not substantively', () => {
    const covering = { ...adviser('sec-1'), via: 'relief' as const };
    expect(teachingProfileFor('teacher', [covering])).toEqual({
      advises: true,
      advisesSubstantively: false,
      teachesSubject: false,
    });
  });

  it('holding one class and covering another still counts as substantive', () => {
    const covering = { ...adviser('sec-2'), via: 'relief' as const };
    expect(teachingProfileFor('teacher', [adviser('sec-1'), covering])).toEqual(
      {
        advises: true,
        advisesSubstantively: true,
        teachesSubject: false,
      }
    );
  });

  it('shows Attendance but hides Evaluation for a cover-only adviser', () => {
    const covering = { ...adviser('sec-1'), via: 'relief' as const };
    const hidden = hiddenModulesForTeacher('teacher', [covering]);
    expect(hidden).not.toContain('attendance');
    expect(hidden).toContain('evaluation');
  });

  it('reports neither for a teacher with no assignments', () => {
    expect(teachingProfileFor('teacher', [])).toEqual({
      advises: false,
      advisesSubstantively: false,
      teachesSubject: false,
    });
  });

  // Oversight roles hold no assignment rows at all, so deriving a job from them
  // would strip the people who most need the actions. Same invariant as
  // hiddenModulesForTeacher, which refuses to narrow them.
  it('reports neither for every non-teacher role, and for null', () => {
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'p_file_officer',
      'admissions',
      null,
    ] as const) {
      expect(teachingProfileFor(role, [adviser('sec-1')]), `${role}`).toEqual({
        advises: false,
        advisesSubstantively: false,
        teachesSubject: false,
      });
    }
  });
});

// ─── the route-shaped narrowing (role-switcher Phase 3b) ────────────────────
//
// ⚠ READ THIS BEFORE COMPARING IT WITH `hiddenModulesForTeacher` ABOVE. They
// look alike and answer different questions, which is why they are two
// functions and not one with a flag:
//
//   • that one is ASSIGNMENT-shaped. It reads the database, asks "is Attendance
//     ever USEFUL to someone who advises no class", and narrows the `teacher`
//     ROLE only — narrowing an admin is the one thing it must never do.
//   • this one is ROUTE-shaped. It is pure, asks "does `/sis` ADMIT a teacher at
//     all", and narrows a LENS rather than an account. It may take a tile from
//     an admin, because what it takes is a tile that view cannot fill.
//
// Getting them the wrong way round type-checks and runs, so both directions are
// asserted rather than one happy path.
describe('moduleAdmitsRole — the shared front-door question', () => {
  it('answers exactly what the module switcher asks', () => {
    // Not an independent reimplementation: the point is that the lens and the
    // switcher (components/module-sidebar/sidebar-header.tsx) ask ONE function,
    // so they cannot drift into hiding a tile whose sidebar still works, or
    // offering one whose sidebar is blank.
    for (const m of MODULE_ORDER) {
      expect(moduleAdmitsRole(m, 'superadmin'), m).toBe(
        isRouteAllowed(SIDEBAR_REGISTRY[m].primaryHref, 'superadmin')
      );
    }
  });

  it('refuses a teacher the four office modules', () => {
    for (const m of ['sis', 'records', 'p-files', 'admissions'] as const) {
      expect(moduleAdmitsRole(m, 'teacher'), m).toBe(false);
    }
  });

  it('and admits them the four teaching ones', () => {
    for (const m of [
      'classroom',
      'markbook',
      'attendance',
      'evaluation',
    ] as const) {
      expect(moduleAdmitsRole(m, 'teacher'), m).toBe(true);
    }
  });
});

describe('hiddenModulesForView — what the LENS takes away', () => {
  it('removes the four a teacher cannot open, in switcher order', () => {
    expect(hiddenModulesForView('school_admin', 'teacher')).toEqual([
      'admissions',
      'records',
      'p-files',
      'sis',
    ]);
  });

  it('⚠ and never the two the ASSIGNMENT rule owns', () => {
    // Attendance and Evaluation admit a teacher, so this rule has nothing to
    // say about them. Whether a particular teacher can use them is
    // `hiddenModulesForTeacher`'s question, and it is asked of the REAL role.
    const hidden = hiddenModulesForView('school_admin', 'teacher');
    expect(hidden).not.toContain('attendance');
    expect(hidden).not.toContain('evaluation');
    expect(hidden).not.toContain('markbook');
    expect(hidden).not.toContain('classroom');
  });

  it('takes nothing when the view is the account role', () => {
    for (const role of ROLES) {
      expect(hiddenModulesForView(role, role), `${role}`).toEqual([]);
      // The default argument is the same statement, made by omission — every
      // caller that has no lens to offer must get today's behaviour.
      expect(hiddenModulesForView(role), `${role} (implicit)`).toEqual([]);
    }
  });

  it('takes nothing from a plain teacher, who has only one view', () => {
    expect(hiddenModulesForView('teacher', 'teacher')).toEqual([]);
  });

  it('names only modules the ACCOUNT could otherwise have reached', () => {
    // Listing a module the real role cannot open either would be true and
    // useless — the switcher filters those on the real role before it consults
    // this list — and it would read as though the lens had taken something
    // away when it had not.
    const hidden = hiddenModulesForView('p_file_officer', 'teacher');
    expect(hidden).toContain('p-files');
    expect(hidden).not.toContain('records');
    expect(hidden).not.toContain('sis');
  });

  it('handles a null role without inventing a narrowing', () => {
    // A parent. `getEntitledRoles` gives them no lens at all, so this pair
    // cannot arise — but the type allows it and returning a list here would
    // mean hiding modules from someone who has none.
    expect(hiddenModulesForView(null, null)).toEqual([]);
    expect(hiddenModulesForView(null, 'teacher')).toEqual([]);
  });
});
