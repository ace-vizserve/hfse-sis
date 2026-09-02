/**
 * The Markbook sidebar under the active-role lens.
 *
 * `NAV_BY_MODULE.markbook` is four hand-written trees keyed by role, and it is
 * the only module nav that works that way. Phase 3a made
 * `resolveSectionsForRole` index it with the VIEW role, so a `school_admin`
 * who also teaches gets the teacher's short "My Sheets / My Requests" sidebar
 * while she is in the Teacher view.
 *
 * ⚠ THE HALF THAT NEEDS THE TEST IS THE INTERSECTION, NOT THE SWAP. The tree
 * the lens names is a list of LINKS, and `getEntitledRoles` hands out the
 * teacher lens on assignment rows alone — so a `p_file_officer` or `admissions`
 * account that is ever assigned a class could take it, and `/markbook`'s
 * ROUTE_ACCESS row refuses both. Rendering the teacher tree for them would be
 * four links the proxy bounces: the dead end KD #173 exists to prevent.
 * Not reachable today (all six teaching accounts are `school_admin`); Phase 4
 * makes it reachable.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveSectionsForRole,
  flattenNavItems,
} from '@/lib/auth/nav-visibility';
import {
  isRouteAllowed,
  NAV_BY_MODULE,
  ROLES,
  type Role,
} from '@/lib/auth/roles';

const MARKBOOK_ROLES = [
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const;

function hrefs(role: Role | null, viewRole?: Role | null): string[] {
  return flattenNavItems(
    resolveSectionsForRole('markbook', role, undefined, viewRole)
  ).map((i) => i.href);
}

describe('nothing changes when there is no lens to look through', () => {
  it.each(MARKBOOK_ROLES)(
    '%s with no viewRole renders exactly its own tree',
    (role) => {
      // The default (`viewRole = role`) plus the intersection has to be a
      // no-op, or every single-role account in the school sees a different
      // sidebar than it did yesterday. This is the regression guard for the
      // 99% case.
      expect(resolveSectionsForRole('markbook', role, undefined)).toEqual(
        NAV_BY_MODULE.markbook[role]
      );
    }
  );

  it.each(MARKBOOK_ROLES)(
    '%s passing its own role as the view is identical too',
    (role) => {
      expect(hrefs(role, role)).toEqual(hrefs(role));
    }
  );

  it('a role with no markbook tree still gets nothing, not a crash', () => {
    // nav-visibility fails closed to a blank sidebar here, deliberately and
    // silently — pinned so a later change has to decide about it on purpose.
    expect(
      resolveSectionsForRole('markbook', 'p_file_officer', undefined)
    ).toEqual([]);
    expect(resolveSectionsForRole('markbook', null, undefined)).toEqual([]);
  });
});

describe('a teaching admin sees the teacher tree in the Teacher view', () => {
  it('renders the teacher sidebar, not the school_admin one', () => {
    const teacherView = hrefs('school_admin', 'teacher');
    expect(teacherView).toEqual(hrefs('teacher', 'teacher'));
    // The concrete difference the six live accounts will notice: "My Sheets"
    // instead of twenty rows of oversight.
    expect(teacherView).toContain('/markbook/grading');
    expect(teacherView).not.toContain('/markbook/awards');
    expect(teacherView).not.toContain('/markbook/audit-log');
  });

  it('and the admin sidebar again as soon as she switches back', () => {
    expect(hrefs('school_admin', 'school_admin')).toEqual(
      hrefs('school_admin')
    );
    expect(hrefs('school_admin', 'school_admin')).toContain('/markbook/awards');
  });

  it('the same holds for a coordinator or superadmin who teaches', () => {
    for (const role of ['academic_coordinator', 'superadmin'] as const) {
      expect(hrefs(role, 'teacher')).toEqual(hrefs('teacher'));
    }
  });
});

describe('the lens can never advertise a link the proxy would bounce', () => {
  it.each(ROLES)(
    '%s in any view only ever sees markbook links its REAL role may open',
    (role: Role) => {
      for (const viewRole of ROLES) {
        for (const href of hrefs(role, viewRole)) {
          expect(
            isRouteAllowed(href, role),
            `${role} in the ${viewRole} view was offered ${href}, which ROUTE_ACCESS refuses`
          ).toBe(true);
        }
      }
    }
  );

  it('a p_file_officer holding assignment rows gets no markbook links at all', () => {
    // The Phase 4 case, stated concretely. `/markbook` admits four roles and
    // this is not one of them, so every href in the teacher tree is filtered
    // and the sidebar is empty — which is correct: the module is closed to
    // them, so there is nothing honest to put in it.
    expect(hrefs('p_file_officer', 'teacher')).toEqual([]);
    expect(hrefs('admissions', 'teacher')).toEqual([]);
  });

  it('the filter is not silently swallowing the whole teacher tree', () => {
    // Guards the assertion above from passing for the wrong reason. If
    // `isRouteAllowed` ever started refusing everything, the p_file_officer
    // case would still be green while every real teacher lost their sidebar.
    expect(hrefs('teacher', 'teacher').length).toBeGreaterThanOrEqual(3);
  });
});

describe('Markbook is no longer the only module keyed on the lens', () => {
  // ⚠ THIS BLOCK ASSERTED THE OPPOSITE UNTIL 2026-09-02. Phase 3a's remit was
  // the Markbook nav alone, and the asymmetry was pinned here so it stayed
  // visible. Mr Ace's call in Phase 3b was that it read as half-finished — a
  // teaching admin saw a teacher's Markbook menu beside an admin's Attendance
  // and SIS menus — so the lens now reaches every sidebar. Kept as a test
  // rather than deleted, in the direction that is now true, so the reversal is
  // recorded where the old claim was.
  //
  // The whole-sidebar behaviour, including the blank-sidebar guard, lives in
  // __tests__/sidebar/nav-lens-all-modules.test.ts. This is the seam.
  it('a module the view CAN open now follows it', () => {
    // Not named `module` — `@next/next/no-assign-module-variable` forbids it
    // even in a test.
    for (const sidebarModule of ['attendance', 'evaluation'] as const) {
      const teacherView = resolveSectionsForRole(
        sidebarModule,
        'school_admin',
        undefined,
        'teacher'
      );
      expect(teacherView).toEqual(
        resolveSectionsForRole(sidebarModule, 'teacher', undefined)
      );
      expect(teacherView).not.toEqual(
        resolveSectionsForRole(sidebarModule, 'school_admin', undefined)
      );
    }
  });

  it('a module the view CANNOT open keeps the account role’s tree', () => {
    // `/sis` and `/records` refuse a teacher, so there is no teacher tree to
    // render — filtering would empty every group. The tile is hidden instead
    // (lib/sidebar/module-visibility.ts), and anyone who arrives by a bookmark
    // gets the nav their account has always had rather than a blank rail.
    for (const sidebarModule of ['sis', 'records', 'p-files'] as const) {
      expect(
        resolveSectionsForRole(
          sidebarModule,
          'school_admin',
          undefined,
          'teacher'
        )
      ).toEqual(
        resolveSectionsForRole(sidebarModule, 'school_admin', undefined)
      );
    }
  });
});
