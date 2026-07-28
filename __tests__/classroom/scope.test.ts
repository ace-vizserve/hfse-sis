import { describe, expect, it } from 'vitest';

import {
  canReadAttendance,
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
  });

  it('adviser capability grants everything', () => {
    expect(canReadRoster('adviser')).toBe(true);
    expect(canReadAttendance('adviser')).toBe(true);
    expect(canReadWriteups('adviser')).toBe(true);
  });

  it('oversight capability grants everything', () => {
    expect(canReadRoster('oversight')).toBe(true);
    expect(canReadAttendance('oversight')).toBe(true);
    expect(canReadWriteups('oversight')).toBe(true);
  });

  it('no capability grants nothing', () => {
    expect(canReadRoster(null)).toBe(false);
    expect(canReadAttendance(null)).toBe(false);
    expect(canReadWriteups(null)).toBe(false);
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
