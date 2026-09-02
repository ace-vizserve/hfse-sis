/**
 * The active-role lens, stated as rules rather than as a rendered UI.
 *
 * Both functions under test are pure, which is the point of keeping them out of
 * lib/auth/view-context.ts: the entitlement rule is the security-relevant half
 * of this feature and it can be asserted here with no session, no cookie jar
 * and no database.
 *
 * The property that matters most is the last one — entitlement can only ever
 * NARROW. Nothing a client sends may add a role to the set.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_ROLE_COOKIE,
  getEntitledRoles,
  resolveActiveRole,
} from '@/lib/auth/active-role';
import { NAV_BY_MODULE, ROLES, type Role } from '@/lib/auth/roles';

describe('getEntitledRoles', () => {
  it('gives a plain teacher exactly one lens', () => {
    // And note the second argument is ignored: a teacher is already looking at
    // the teacher's view, so `view-context` never even runs the query.
    expect(getEntitledRoles('teacher', true)).toEqual(['teacher']);
    expect(getEntitledRoles('teacher', false)).toEqual(['teacher']);
  });

  it('gives a school_admin who teaches nothing only the admin lens', () => {
    expect(getEntitledRoles('school_admin', false)).toEqual(['school_admin']);
  });

  it('gives a school_admin who holds classes both lenses, admin first', () => {
    // Six live accounts at this school are in exactly this state.
    expect(getEntitledRoles('school_admin', true)).toEqual([
      'school_admin',
      'teacher',
    ]);
  });

  it('gives a parent nothing', () => {
    // Parents share this Supabase project, so `null` is a real value here.
    expect(getEntitledRoles(null, false)).toEqual([]);
    expect(getEntitledRoles(null, true)).toEqual([]);
  });

  it('puts the account role first for every role', () => {
    // `resolveActiveRole` falls back to `entitled[0]`, so this ordering is load
    // bearing: it is what makes "no preference" mean "the view you had before".
    for (const role of ROLES) {
      expect(getEntitledRoles(role, true)[0]).toBe(role);
      expect(getEntitledRoles(role, false)[0]).toBe(role);
    }
  });

  it('adds nothing but teacher, ever', () => {
    // The narrowing property. If this ever fails, a lens has become a way to
    // acquire a role rather than a way to look at one you already have.
    for (const role of ROLES) {
      const added = getEntitledRoles(role, true).filter((r) => r !== role);
      expect(added).toEqual(role === 'teacher' ? [] : ['teacher']);
    }
  });
});

describe('resolveActiveRole', () => {
  const both: Role[] = ['school_admin', 'teacher'];

  it('honours a cookie naming an entitled role', () => {
    expect(resolveActiveRole(both, 'teacher')).toBe('teacher');
  });

  it('falls back to the account role when the cookie names one they lack', () => {
    // The account had the teacher lens taken away — removing their last class
    // returns them to the admin view instead of stranding them in a dead one.
    expect(resolveActiveRole(['school_admin'], 'teacher')).toBe('school_admin');
  });

  it('ignores a cookie value that is not a role at all', () => {
    expect(resolveActiveRole(both, 'superadmin')).toBe('school_admin');
    expect(resolveActiveRole(both, 'nonsense')).toBe('school_admin');
    expect(resolveActiveRole(both, '')).toBe('school_admin');
  });

  it('falls back to the account role when there is no cookie', () => {
    expect(resolveActiveRole(both, null)).toBe('school_admin');
  });

  it('returns null for an account with no lens', () => {
    expect(resolveActiveRole([], 'teacher')).toBeNull();
    expect(resolveActiveRole([], null)).toBeNull();
  });
});

describe('the lens never names a role the Markbook sidebar cannot render', () => {
  // lib/auth/nav-visibility.ts:46-49 does `NAV_BY_MODULE.markbook[role] ?? []`
  // and FAILS CLOSED TO A BLANK SIDEBAR with no error for any role without a
  // tree. Only four roles have one. A lens value outside that set would empty
  // the Markbook sidebar silently, which is why this is asserted here and not
  // left to be noticed.
  const navRoles = Object.keys(NAV_BY_MODULE.markbook) as Role[];

  it('reads the four nav-tree roles out of the real table', () => {
    // Derived, not restated — a hand-written list here would just be the same
    // assumption twice.
    expect([...navRoles].sort()).toEqual([
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'teacher',
    ]);
  });

  it('every lens the switcher can ADD has a Markbook tree', () => {
    // The general form, and the one that survives someone adding a seventh
    // role: whatever entitlement grants beyond the account's own role must be
    // renderable in Markbook.
    for (const role of ROLES) {
      const added = getEntitledRoles(role, true).filter((r) => r !== role);
      for (const lens of added) expect(navRoles).toContain(lens);
    }
  });

  it('entitlement stays inside the nav-tree set for every role that can reach Markbook', () => {
    // p_file_officer and admissions are deliberately NOT in this loop: `/markbook`
    // admits exactly the four nav-tree roles (ROUTE_ACCESS), so those two never
    // reach `resolveSectionsForRole('markbook', …)` at all, and their own role
    // sitting in their entitled set costs nothing.
    for (const role of navRoles) {
      expect(
        getEntitledRoles(role, true).every((r) => navRoles.includes(r))
      ).toBe(true);
    }
  });
});

describe('the cookie name', () => {
  it('is namespaced to this app', () => {
    // Sits alongside `sidebar:groups` and Supabase's own `sb-*` cookies on the
    // same host; a bare name like `role` would be asking for a collision.
    expect(ACTIVE_ROLE_COOKIE).toBe('hfse_active_role');
  });
});
