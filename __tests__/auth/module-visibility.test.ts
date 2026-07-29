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
} from '@/lib/sidebar/module-visibility';
import type { AssignmentRow } from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';

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
