/**
 * The whole sidebar under the active-role lens — all eight modules, not just
 * Markbook (role-switcher Phase 3b, Mr Ace's call 2026-09-02).
 *
 * 🔴 THE FAILURE THIS FILE EXISTS FOR IS A BLANK SIDEBAR FOR A REAL USER, and
 * it is worth stating plainly because it is SILENT. Every module but Markbook
 * is one flat `NavSection[]` filtered per item on `requiresRoles`, and
 * `resolveSectionsForRole` drops a group once its items are all filtered out.
 * Look at `/sis` through a teacher lens and every row goes, every group goes,
 * and the function returns `[]` — a legal value that renders as a header over
 * nothing, throws nothing and logs nothing. So the guard below is EXHAUSTIVE
 * over module × real role × view rather than a few hand-picked pairs: the
 * combination that breaks is exactly the one nobody thought to write down.
 *
 * The design that makes it unreachable is in two halves, and both are asserted
 * here:
 *
 *   • a module the VIEW cannot open loses its TILE
 *     (`hiddenModulesForView`), so nobody clicks their way into one;
 *   • and if someone arrives anyway — a bookmark, a typed URL, a link in an
 *     old email — the sidebar falls back to the account role's own tree
 *     (`lensForModule`), which is what they saw before this feature existed.
 *
 * Sibling files: `__tests__/auth/markbook-nav-lens.test.ts` (the per-role tree
 * swap, the one module keyed differently) and
 * `__tests__/sidebar/teacher-nav-scope-lens.test.ts` (the resolver that unions
 * the two hidden-module rules).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  flattenNavItems,
  resolveSectionsForRole,
} from '@/lib/auth/nav-visibility';
import { getEntitledRoles } from '@/lib/auth/active-role';
import {
  hrefPathname,
  isRouteAllowed,
  ROLES,
  type Role,
} from '@/lib/auth/roles';
import {
  hiddenModulesForView,
  moduleAdmitsRole,
} from '@/lib/sidebar/module-visibility';
import { MODULE_ORDER, type SidebarModule } from '@/lib/sidebar/registry';

/** Every module the sidebar can render, in switcher order. */
const MODULES: readonly SidebarModule[] = MODULE_ORDER;

function hrefs(
  sidebarModule: SidebarModule,
  role: Role | null,
  viewRole?: Role | null
): string[] {
  return flattenNavItems(
    resolveSectionsForRole(sidebarModule, role, undefined, viewRole)
  ).map((i) => i.href);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('🔴 no lens, on any module, may empty a sidebar', () => {
  it('every module × role × view keeps at least the rows the account role had', () => {
    const blank: string[] = [];
    for (const sidebarModule of MODULES) {
      for (const role of ROLES) {
        const own = resolveSectionsForRole(sidebarModule, role, undefined);
        if (own.length === 0) continue; // nothing to lose
        for (const viewRole of ROLES) {
          const lensed = resolveSectionsForRole(
            sidebarModule,
            role,
            undefined,
            viewRole
          );
          if (lensed.length === 0) {
            blank.push(`${sidebarModule}: ${role} viewing as ${viewRole}`);
          }
        }
      }
    }
    expect(
      blank,
      'these viewers would be shown a sidebar with no rows in it — a header ' +
        'over nothing, with no way out of the page but the browser back button'
    ).toEqual([]);
  });

  it('and the runtime net under that is never actually needed today', () => {
    // `resolveSectionsForRole` warns and falls back to the account role's nav
    // if a lens ever does empty a sidebar. That net is deliberate — the thing
    // that would newly cause it is a data edit (a `requiresRoles` list, a
    // ROUTE_ACCESS row), not a change to that file — but it must be DEAD code
    // as shipped. If it fires, some combination is being RESCUED rather than
    // being correct, and the assertion above cannot tell the two apart.
    //
    // ⚠ SCOPED TO THE VIEWS THAT CAN ACTUALLY EXIST, and derived from
    // `getEntitledRoles` rather than listed here, so it cannot drift from the
    // rule that hands out lenses. The set can only ever be the account role,
    // plus `teacher` when the account holds assignment rows — "a school_admin
    // viewing as p_file_officer" is not a state the app can reach, and holding
    // the net to it would be holding it to a case it exists to survive.
    // `hasAssignments: true` is the widest reachable set, i.e. Phase 4's world
    // where anyone may be assigned a class, not just today's six school_admins.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const sidebarModule of MODULES) {
      for (const role of ROLES) {
        for (const viewRole of getEntitledRoles(role, true)) {
          resolveSectionsForRole(sidebarModule, role, undefined, viewRole);
        }
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('but the net does catch a sidebar a lens would otherwise empty', () => {
    // Non-vacuity for the net itself, using a pair the app cannot reach: a
    // school_admin looking through a `p_file_officer` lens has no Markbook tree
    // at all (`NAV_BY_MODULE.markbook` has four keys and that is not one), so
    // the raw answer is `[]`. Without the net that is a blank Markbook rail.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rescued = resolveSectionsForRole(
      'markbook',
      'school_admin',
      undefined,
      'p_file_officer'
    );
    expect(rescued).toEqual(
      resolveSectionsForRole('markbook', 'school_admin', undefined)
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('emptied the markbook sidebar');
  });

  it('the sweep above is not vacuous — most of those sidebars have rows', () => {
    // Guards the two assertions above from passing because everything came
    // back empty. 8 modules × 6 roles = 48 pairs; the ones with no rows are the
    // roles a module refuses, which is most of the grid's edges.
    const withRows = MODULES.flatMap((m) =>
      ROLES.filter((r) => resolveSectionsForRole(m, r, undefined).length > 0)
    );
    expect(withRows.length).toBeGreaterThanOrEqual(20);
  });
});

describe('a teaching admin gets a teacher’s sidebar where a teacher can go', () => {
  const TEACHER_MODULES: SidebarModule[] = [
    'classroom',
    'markbook',
    'attendance',
    'evaluation',
  ];

  it.each(TEACHER_MODULES)('%s renders the teacher’s rows', (sidebarModule) => {
    expect(hrefs(sidebarModule, 'school_admin', 'teacher')).toEqual(
      hrefs(sidebarModule, 'teacher')
    );
  });

  it('which is a real difference, not an accidental match', () => {
    // Attendance is the clearest: a teacher marks and files, an oversight role
    // also imports, reads Insights and opens the audit log.
    const asTeacher = hrefs('attendance', 'school_admin', 'teacher');
    const asAdmin = hrefs('attendance', 'school_admin');
    expect(asTeacher).not.toEqual(asAdmin);
    expect(asAdmin).toContain('/attendance/audit-log');
    expect(asTeacher).not.toContain('/attendance/audit-log');
    expect(asTeacher).toContain('/attendance/sections');
  });

  it('and she gets her own rows back the moment she switches home', () => {
    for (const sidebarModule of MODULES) {
      expect(
        hrefs(sidebarModule, 'school_admin', 'school_admin'),
        `${sidebarModule} did not return to normal in the Admin view`
      ).toEqual(hrefs(sidebarModule, 'school_admin'));
    }
  });

  it('the same holds for a coordinator or superadmin who teaches', () => {
    for (const role of ['academic_coordinator', 'superadmin'] as const) {
      for (const sidebarModule of TEACHER_MODULES) {
        expect(hrefs(sidebarModule, role, 'teacher')).toEqual(
          hrefs(sidebarModule, 'teacher')
        );
      }
    }
  });
});

describe('a module the view cannot enter is hidden, not emptied', () => {
  const CLOSED_TO_TEACHERS: SidebarModule[] = [
    'admissions',
    'records',
    'p-files',
    'sis',
  ];

  it('those four are exactly what the Teacher view removes from the switcher', () => {
    expect(hiddenModulesForView('school_admin', 'teacher')).toEqual(
      CLOSED_TO_TEACHERS
    );
  });

  it('and the two rules agree on which modules those are', () => {
    // The tile-hiding rule and the sidebar-lensing rule must not disagree, or
    // a module is either hidden while its teacher nav works, or offered while
    // its teacher nav is blank. Both ask `moduleAdmitsRole`; this asserts they
    // reach the same answer rather than trusting that they share a function.
    const hidden = hiddenModulesForView('school_admin', 'teacher');
    for (const sidebarModule of MODULES) {
      const admits = moduleAdmitsRole(sidebarModule, 'teacher');
      expect(
        hidden.includes(sidebarModule),
        `${sidebarModule}: the tile and the nav disagree about whether a ` +
          'teacher can go there'
      ).toBe(!admits);
      expect(
        hrefs(sidebarModule, 'school_admin', 'teacher'),
        `${sidebarModule}: the nav did not follow the rule its tile follows`
      ).toEqual(
        admits
          ? hrefs(sidebarModule, 'teacher')
          : hrefs(sidebarModule, 'school_admin')
      );
    }
  });

  it.each(CLOSED_TO_TEACHERS)(
    '%s still renders her own nav if she arrives by a bookmark',
    (sidebarModule) => {
      const lensed = hrefs(sidebarModule, 'school_admin', 'teacher');
      expect(lensed).toEqual(hrefs(sidebarModule, 'school_admin'));
      expect(lensed.length).toBeGreaterThan(0);
    }
  );

  it('nothing is hidden when the view IS the account role', () => {
    for (const role of ROLES) {
      expect(hiddenModulesForView(role, role)).toEqual([]);
    }
  });

  it('and nothing a plain teacher could reach is taken from a teacher', () => {
    // A plain teacher's entitled set is exactly ['teacher'], so the view and
    // the role are always the same value and this rule can never fire for them.
    expect(hiddenModulesForView('teacher', 'teacher')).toEqual([]);
  });

  it('a module the ACCOUNT cannot open is not named either', () => {
    // Truthful but meaningless: the switcher already filters those on the real
    // role, and listing them would read as though the lens had taken something
    // away when it had not. A p_file_officer cannot open Records in any view.
    expect(hiddenModulesForView('p_file_officer', 'teacher')).not.toContain(
      'records'
    );
  });
});

describe('the lens never advertises a link the proxy would bounce', () => {
  it.each(ROLES)(
    '%s in any view only sees hrefs its REAL role may open',
    (role: Role) => {
      for (const viewRole of ROLES) {
        for (const sidebarModule of MODULES) {
          for (const href of hrefs(sidebarModule, role, viewRole)) {
            expect(
              isRouteAllowed(hrefPathname(href), role),
              `${role} in the ${viewRole} view was offered ${href} in ` +
                `${sidebarModule}, which ROUTE_ACCESS refuses`
            ).toBe(true);
          }
        }
      }
    }
  );
});

describe('nothing changes for anyone with a single view', () => {
  it.each(ROLES)('%s renders identically with and without the lens', (role) => {
    // The 99% case, and the one that would be noticed within minutes: every
    // account in the school but the six that also teach passes its own role as
    // the view, and must see byte-identical nav.
    for (const sidebarModule of MODULES) {
      expect(
        resolveSectionsForRole(sidebarModule, role, undefined, role)
      ).toEqual(resolveSectionsForRole(sidebarModule, role, undefined));
    }
  });

  it('an admin who does not teach never reaches the lens at all', () => {
    // Belt and braces on the line above: her entitled set is `['school_admin']`
    // (getEntitledRoles ignores assignments she does not have), so `activeRole`
    // is her account role on every request and this is the identity case.
    for (const sidebarModule of MODULES) {
      expect(hrefs(sidebarModule, 'school_admin', 'school_admin')).toEqual(
        hrefs(sidebarModule, 'school_admin')
      );
    }
  });
});
