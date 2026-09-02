/**
 * THE FIFTH SURFACE.
 *
 * `isHiddenModuleHref`'s docstring names five places a module is offered — the
 * sidebar switcher, the topbar switcher, the home quick actions, the account
 * shortcuts and the Cmd+K palette — and says that hiding a tile in one while
 * another still offers the page is worse than not hiding it at all: the dead
 * end is still reachable, just harder to explain.
 *
 * Phase 3b lensed four of the five. The palette was the one left over: it
 * resolved its module list with no view and passed the ACCOUNT role to
 * `visibleNavEntries`, so a teaching admin in the Teacher view kept a SIS Admin
 * hub entry, six Records pages and the whole Admissions group in a switcher
 * that had just stopped showing their tiles.
 *
 * These tests are about that agreement, in both directions:
 *
 *   • nothing the palette offers may live in a module the current view hides;
 *   • nothing INSIDE a still-visible module may be offered when the view's own
 *     sidebar has dropped it — which is the half the module filter alone cannot
 *     see, and where `/markbook/audit-log` lives;
 *   • the REAL role never stops mattering, because it is what the proxy will
 *     apply when the link is clicked.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/auth/capabilities';
import { getEntitledRoles } from '@/lib/auth/active-role';
import {
  hrefPathname,
  isRouteAllowed,
  ROLES,
  type Role,
} from '@/lib/auth/roles';
import {
  hiddenModulesForView,
  isHiddenModuleHref,
} from '@/lib/sidebar/module-visibility';
import { NAV_ENTRIES, visibleNavEntries } from '@/lib/sis/command-palette-nav';

/**
 * The one pairing the whole feature exists for: an account that administers the
 * school AND teaches, looking at the app as a teacher.
 *
 * Derived from `getEntitledRoles` rather than written out, so if the rule that
 * hands out lenses ever changes, this fixture changes with it instead of
 * quietly describing a state the app can no longer produce.
 */
const TEACHING_ADMIN: Role = 'school_admin';
const TEACHING_ADMIN_LENSES = getEntitledRoles(TEACHING_ADMIN, true);

function paletteFor(role: Role, viewRole: Role) {
  return visibleNavEntries(
    role,
    DEFAULT_ROLE_CAPABILITIES[role],
    hiddenModulesForView(role, viewRole),
    viewRole
  );
}

describe('the fixture is the state the app can actually produce', () => {
  it('a school_admin who teaches really is offered the teacher lens', () => {
    expect(TEACHING_ADMIN_LENSES).toEqual([TEACHING_ADMIN, 'teacher']);
  });

  it('a plain teacher has no second lens, so nothing here can change for one', () => {
    expect(getEntitledRoles('teacher', true)).toEqual(['teacher']);
  });
});

describe('the palette agrees with the module switcher', () => {
  it('offers no page in a module the current view has hidden', () => {
    for (const role of ROLES) {
      for (const viewRole of getEntitledRoles(role, true)) {
        const hidden = hiddenModulesForView(role, viewRole);
        const offered = paletteFor(role, viewRole);
        const offences = offered
          .filter((e) => isHiddenModuleHref(e.href, hidden))
          .map((e) => `${role} as ${viewRole}: ${e.href}`);
        expect(offences).toEqual([]);
      }
    }
  });

  it('drops SIS, Records, P-Files and Admissions for a teaching admin in the Teacher view', () => {
    // The concrete, checkable consequence — asserted as a set difference rather
    // than a count, so a new NAV_ENTRY in one of those modules is covered
    // automatically.
    const admin = paletteFor(TEACHING_ADMIN, TEACHING_ADMIN);
    const teacher = paletteFor(TEACHING_ADMIN, 'teacher');

    const lost = admin
      .filter((a) => !teacher.some((t) => t.href === a.href))
      .map((e) => e.href);

    for (const href of ['/sis', '/records', '/p-files', '/admissions']) {
      expect(lost).toContain(href);
    }
    // And nothing is GAINED. A lens may only narrow.
    expect(
      teacher.filter((t) => !admin.some((a) => a.href === t.href))
    ).toEqual([]);
  });

  it('keeps Attendance, Evaluation, Markbook and Home — a teacher can open all four', () => {
    const hrefs = paletteFor(TEACHING_ADMIN, 'teacher').map((e) => e.href);
    expect(hrefs).toContain('/');
    expect(hrefs).toContain('/attendance');
    expect(hrefs).toContain('/attendance/sections');
    expect(hrefs).toContain('/evaluation');
    expect(hrefs).toContain('/markbook');
    expect(hrefs).toContain('/markbook/grading');
  });
});

describe('the half the module filter cannot see', () => {
  // These three live INSIDE modules a teacher view can still open, so
  // `isHiddenModuleHref` says nothing about them. Only the per-entry role gate
  // — now intersected with the view — takes them away, and each one is a page
  // whose sidebar row the Teacher view has already dropped.
  it.each([
    ['/markbook/audit-log', 'guarded by requiresRoles, coordinator and above'],
    ['/markbook/report-cards', 'coordinator and above at ROUTE_ACCESS'],
    ['/markbook/change-requests', 'the approver inbox, not a teacher surface'],
    ['/sis/admin/staff/accounts', 'an explicit requiresRoles entry'],
  ])('%s is gone in the Teacher view (%s)', (href) => {
    const admin = paletteFor(TEACHING_ADMIN, TEACHING_ADMIN).map((e) => e.href);
    const teacher = paletteFor(TEACHING_ADMIN, 'teacher').map((e) => e.href);
    // Non-vacuous: it has to be there in the Admin view for its absence in the
    // Teacher view to mean anything.
    expect(admin).toContain(href);
    expect(teacher).not.toContain(href);
  });
});

describe('the real role never stops mattering', () => {
  it('every offered entry is route-allowed for the ACCOUNT role, in every view', () => {
    // The lens narrows; it must never ADVERTISE. A link the proxy would bounce
    // is KD #173's dead end, and it is what an implementation that swapped
    // `role` for `viewRole` — rather than intersecting them — would produce.
    for (const role of ROLES) {
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const entry of paletteFor(role, viewRole)) {
          const allowed = entry.requiresRoles
            ? entry.requiresRoles.includes(role)
            : isRouteAllowed(hrefPathname(entry.href), role);
          expect(
            allowed,
            `${role} as ${viewRole} was offered ${entry.href}, which the proxy would refuse`
          ).toBe(true);
        }
      }
    }
  });

  it('a lens can only ever remove entries, never add one', () => {
    for (const role of ROLES) {
      const own = paletteFor(role, role).map((e) => e.href);
      for (const viewRole of getEntitledRoles(role, true)) {
        for (const href of paletteFor(role, viewRole).map((e) => e.href)) {
          expect(own, `${role} as ${viewRole} gained ${href}`).toContain(href);
        }
      }
    }
  });
});

describe('nothing changes for an account without a second lens', () => {
  it('every role gets exactly its old list when the view is the account role', () => {
    for (const role of ROLES) {
      const caps = DEFAULT_ROLE_CAPABILITIES[role];
      // The three-argument call is the pre-Phase-3c signature. Passing the view
      // explicitly must not change the answer for anybody.
      expect(paletteFor(role, role).map((e) => e.href)).toEqual(
        visibleNavEntries(role, caps, hiddenModulesForView(role, role)).map(
          (e) => e.href
        )
      );
    }
  });

  it('a plain teacher is byte-for-byte unaffected', () => {
    const before = visibleNavEntries(
      'teacher',
      DEFAULT_ROLE_CAPABILITIES.teacher,
      []
    );
    const after = visibleNavEntries(
      'teacher',
      DEFAULT_ROLE_CAPABILITIES.teacher,
      [],
      'teacher'
    );
    expect(after).toEqual(before);
  });
});

describe('🔴 the two dead ends the Phase 3c sweep found', () => {
  // Both were live for every REAL teacher, not only for a lensed one, and the
  // palette was the only surface carrying them — the Markbook teacher nav tree
  // holds neither row. ROUTE_ACCESS admits teachers on the broad `/markbook`
  // prefix and each page's own guard then turns them away, which is KD #173.
  //
  // `link-capability-consistency.test.ts` cannot see either: one guards with
  // `ALLOWED_ROLES.has(role)` and the other with an `||`, and its role-guard
  // reader models only `if (role !== 'a' && role !== 'b') bounce`. Asserted
  // here, against the ROLE, so the fix cannot be undone by deleting the lens.
  it.each(['/markbook/report-cards', '/markbook/change-requests'])(
    'a plain teacher is never offered %s',
    (href) => {
      const hrefs = visibleNavEntries(
        'teacher',
        DEFAULT_ROLE_CAPABILITIES.teacher,
        []
      ).map((e) => e.href);
      expect(hrefs).not.toContain(href);
      // Non-vacuous: the entry still exists and is still offered to the roles
      // that can use it.
      expect(NAV_ENTRIES.some((e) => e.href === href)).toBe(true);
      expect(
        visibleNavEntries(
          'academic_coordinator',
          DEFAULT_ROLE_CAPABILITIES.academic_coordinator,
          []
        ).map((e) => e.href)
      ).toContain(href);
    }
  );
});

describe('the guard is not vacuous', () => {
  it('the palette really does hold entries in the modules a teacher loses', () => {
    // If NAV_ENTRIES ever stopped listing any SIS/Records/P-Files/Admissions
    // page, every assertion above would pass while testing nothing.
    for (const prefix of ['/sis', '/records', '/p-files', '/admissions']) {
      expect(
        NAV_ENTRIES.filter((e) => e.href.startsWith(prefix)).length
      ).toBeGreaterThan(0);
    }
  });

  it('the Teacher view really does remove something', () => {
    expect(paletteFor(TEACHING_ADMIN, 'teacher').length).toBeLessThan(
      paletteFor(TEACHING_ADMIN, TEACHING_ADMIN).length
    );
  });
});
