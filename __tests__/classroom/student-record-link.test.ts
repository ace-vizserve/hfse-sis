/**
 * The classroom links student names to /records/students/[studentNumber] —
 * but that page is registrar-and-above in ROUTE_ACCESS. Before this was
 * gated, every classroom surface rendered the link for everyone, so a form
 * adviser clicking a student on their OWN roster was bounced to `/`.
 *
 * Same cross-file invariant as adviser-fix-link.test.ts and the same two
 * failure directions, neither of them loud:
 *   - link shown to a role ROUTE_ACCESS blocks -> the dead link this fixed
 *   - link withheld from a role that could open it -> a silent regression
 *
 * `canOpenStudentRecord` returns true for exactly 'oversight', which is only
 * defensible while OVERSIGHT_ROLES and the /records rule name the same three
 * roles. That equality is the thing under test — not the ternary at the call
 * sites.
 */

import { describe, it, expect } from 'vitest';
import {
  canOpenStudentRecord,
  capabilityForSection,
  resolveClassroomScope,
} from '@/lib/classroom/scope';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

const STUDENT_RECORD_ROUTE = '/records/students/S12345';

// Every role in the system, so a newly-added one can't slip past this file.
const ALL_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
];

/** Mirrors the call sites: capability for this section decides the link. */
function showsRecordLink(role: Role): boolean {
  const scope = resolveClassroomScope(role, []);
  return canOpenStudentRecord(capabilityForSection(scope, 'sec-1'));
}

describe('student-record link — capability must match ROUTE_ACCESS', () => {
  it.each(ALL_ROLES)('never offers %s a link it cannot open', (role) => {
    if (showsRecordLink(role)) {
      expect(isRouteAllowed(STUDENT_RECORD_ROUTE, role)).toBe(true);
    }
  });

  it.each(ALL_ROLES)(
    'never withholds the link from %s when the record is reachable',
    (role) => {
      // The inverse direction. A role that CAN open /records/students should
      // be offered the link — otherwise a future widening of ROUTE_ACCESS
      // silently leaves the classroom rendering plain text for someone who
      // could act. Roles with no classroom capability at all (admissions,
      // p_file_officer) are exempt: they never reach a classroom surface.
      const hasAnyClassroomCapability =
        capabilityForSection(resolveClassroomScope(role, []), 'sec-1') != null;
      if (
        isRouteAllowed(STUDENT_RECORD_ROUTE, role) &&
        hasAnyClassroomCapability
      ) {
        expect(showsRecordLink(role)).toBe(true);
      }
    }
  );

  it('offers the link to every oversight role', () => {
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as Role[]) {
      expect(showsRecordLink(role)).toBe(true);
      expect(isRouteAllowed(STUDENT_RECORD_ROUTE, role)).toBe(true);
    }
  });

  it('withholds the link from teachers, who are bounced from /records', () => {
    expect(showsRecordLink('teacher')).toBe(false);
    expect(isRouteAllowed(STUDENT_RECORD_ROUTE, 'teacher')).toBe(false);
  });

  it('a teacher WITH a form_adviser row still gets no link', () => {
    // This is the case that produced the bug. Advising a class grants the
    // 'adviser' capability, which reads the roster, the register and the
    // write-ups — but not the permanent record. Being the form adviser must
    // not become a route into /records.
    const scope = resolveClassroomScope('teacher', [
      {
        id: 'ta-1',
        teacher_user_id: 'user-1',
        section_id: 'sec-1',
        role: 'form_adviser',
        subject_id: null,
      },
    ]);
    const capability = capabilityForSection(scope, 'sec-1');
    expect(capability).toBe('adviser');
    expect(canOpenStudentRecord(capability)).toBe(false);
    expect(isRouteAllowed(STUDENT_RECORD_ROUTE, 'teacher')).toBe(false);
  });

  it('a subject teacher gets no link either', () => {
    const scope = resolveClassroomScope('teacher', [
      {
        id: 'ta-2',
        teacher_user_id: 'user-2',
        section_id: 'sec-1',
        role: 'subject_teacher',
        subject_id: 'subj-1',
      },
    ]);
    expect(canOpenStudentRecord(capabilityForSection(scope, 'sec-1'))).toBe(
      false
    );
  });

  it('no capability at all means no link', () => {
    expect(canOpenStudentRecord(null)).toBe(false);
  });
});
