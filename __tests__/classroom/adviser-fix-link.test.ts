/**
 * The Classroom Overview's "No form adviser assigned" health row links to
 * /sis/sections/[id]?tab=teachers — but only for viewers whose classroom
 * capability is 'oversight'. That gate is a CROSS-FILE invariant: the link is
 * decided in app/(classroom)/classroom/[sectionId]/page.tsx from
 * lib/classroom/scope.ts, while whether it opens is decided by ROUTE_ACCESS in
 * lib/auth/roles.ts. Nothing forces those two to agree.
 *
 * Both failure directions are real and neither is loud:
 *   - link shown to a role ROUTE_ACCESS blocks -> a dead end offered as the fix
 *   - link withheld from a role that could act  -> the bug this change fixed
 *
 * These tests pin the agreement rather than the ternary.
 */

import { describe, it, expect } from 'vitest';
import { resolveClassroomScope } from '@/lib/classroom/scope';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

const ADVISER_FIX_ROUTE = '/sis/sections';

// Every role in the system, so a newly-added one can't slip past this file.
const ALL_ROLES: Role[] = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
];

/** Mirrors the page: the row links only when capability === 'oversight'. */
function showsAdviserFixLink(role: Role): boolean {
  // Assignments are irrelevant to oversight — an oversight role resolves to
  // 'oversight' regardless — so an empty list is the honest input here.
  return resolveClassroomScope(role, []).isOversight;
}

describe('adviser "fix it" link — capability must match ROUTE_ACCESS', () => {
  it.each(ALL_ROLES)('never offers %s a link it cannot open', (role) => {
    if (showsAdviserFixLink(role)) {
      expect(isRouteAllowed(ADVISER_FIX_ROUTE, role)).toBe(true);
    }
  });

  it('offers the link to every oversight role', () => {
    // Named explicitly: this is the set the fix exists for. If a role is added
    // to the oversight set, it must appear here deliberately.
    for (const role of [
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as Role[]) {
      expect(showsAdviserFixLink(role)).toBe(true);
      expect(isRouteAllowed(ADVISER_FIX_ROUTE, role)).toBe(true);
    }
  });

  it('withholds the link from teachers, who are bounced from section setup', () => {
    // A teacher is 'adviser' or 'subject', never 'oversight' — so they keep the
    // informational copy ("ask the academic coordinator") instead of a link
    // that would redirect them away.
    expect(showsAdviserFixLink('teacher')).toBe(false);
    expect(isRouteAllowed(ADVISER_FIX_ROUTE, 'teacher')).toBe(false);
  });

  it('a teacher WITH adviser assignments still gets no link', () => {
    // Guards the subtle case: being a form adviser for the section makes the
    // capability 'adviser', which is not 'oversight'. Assigning yourself as
    // adviser must not become a route to section setup.
    const scope = resolveClassroomScope('teacher', [
      {
        id: 'ta-1',
        teacher_user_id: 'user-1',
        section_id: 'sec-1',
        role: 'form_adviser',
        subject_id: null,
      },
    ]);
    expect(scope.isOversight).toBe(false);
    expect(scope.capabilityBySection['sec-1']).toBe('adviser');
  });
});
