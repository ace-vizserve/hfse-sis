import { describe, it, expect } from 'vitest';

import {
  NAV_BY_MODULE,
  ROLES,
  ROUTE_ACCESS,
  isRouteAllowed,
  type NavItem,
  type NavSection,
  type Role,
} from '@/lib/auth/roles';
import { SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';

// Whole-app nav <-> ROUTE_ACCESS consistency, both directions.
//
// The pre-existing `sis-nav-route-consistency.test.ts` guards direction (A)
// for the SIS module only. This widens the guard to EVERY module and adds
// direction (B), which nothing covered — and which is where two real bugs
// were found (2026-07-28):
//
//   1. `school_admin` had no Grading group in its Markbook nav at all, even
//      though ROUTE_ACCESS, the RLS `is_registrar_or_above()` gate, and the
//      grading page's own role check all allow it (and it is the grade-change
//      approver pool, KD #41). Reachable only by typing the URL.
//   2. `academic_coordinator` could reach `/sis/admin/staff` (KD #154 added a
//      ROUTE_ACCESS row specifically for her) but never sees the SIS sidebar,
//      and no Records cross-link existed — despite a SIS_NAV comment claiming
//      one did.
//
// Direction A — a link a role can SEE must not be proxy-blocked (dead end).
// Direction B — a route a role is ALLOWED to open should have some nav path
//   to it, unless it is a deliberate redirect stub kept alive for old
//   bookmarks (allowlisted below).
//
// KNOWN LIMITATION (deliberate): direction B checks ROUTE_ACCESS *prefixes*,
// not individual pages. A page sitting under a broad prefix the role already
// links elsewhere (e.g. `/markbook/grading` under the broad `/markbook` rule)
// is therefore NOT covered — this test would not have caught bug 1 above on
// its own. Page-level coverage was evaluated and rejected: it requires
// walking `app/**/page.tsx` plus a large per-role allowlist for pages that
// are intentionally unlinked (teacher-scoped views, registrar-only surfaces
// under a shared prefix, detail pages reached by clicking a row), which is
// more maintenance surface than signal. That sweep was instead run once, by
// hand, on 2026-07-28; see the audit notes in the commit for its findings.

// Module root -> the prefix that gates whether the role sees that sidebar at
// all. A role that can't open the root never sees any of that module's items.
//
// Derived from SIDEBAR_REGISTRY rather than hand-maintained, because this is
// EXACTLY what the real module switcher does
// (components/module-sidebar/sidebar-header.tsx):
//     MODULE_ORDER.filter((m) => isRouteAllowed(SIDEBAR_REGISTRY[m].primaryHref, role))
// A hardcoded copy of this map drifts the moment a module is added — when
// Classroom landed, its missing entry disabled the module-root gate for the
// new module and the test only caught it as a spurious dead link. Deriving
// removes that failure mode entirely.
function moduleRoot(moduleName: string): string | undefined {
  return SIDEBAR_REGISTRY[moduleName as keyof typeof SIDEBAR_REGISTRY]
    ?.primaryHref;
}

// Routes that intentionally have no nav entry: each is a redirect stub whose
// ROUTE_ACCESS row exists only so the role gate fires BEFORE the redirect.
// Verified against the page source — every one is a `redirect(...)` one-liner.
const REDIRECT_STUBS = new Set([
  '/markbook/masterfile', // -> /records/academic-summary (KD #127)
  '/attendance/calendar', // -> /sis/calendar
  '/sis/admin/users', // -> /sis/admin/staff?view=accounts (KD #154)
  '/admin/admissions', // -> /records (KD #17)
]);

function itemsForRole(role: Role): Array<{ module: string; item: NavItem }> {
  const out: Array<{ module: string; item: NavItem }> = [];
  for (const [moduleName, nav] of Object.entries(NAV_BY_MODULE)) {
    const root = moduleRoot(moduleName);
    if (root && !isRouteAllowed(root, role)) continue;

    const sections: NavSection[] | undefined =
      moduleName === 'markbook'
        ? (nav as Partial<Record<Role, NavSection[]>>)[role]
        : (nav as NavSection[]);
    if (!sections) continue;

    for (const section of sections) {
      for (const item of section.items) {
        if (item.requiresRoles && !item.requiresRoles.includes(role)) continue;
        out.push({ module: moduleName, item });
      }
    }
  }
  return out;
}

const pathOf = (href: string) => href.split('?')[0];

describe('nav <-> ROUTE_ACCESS consistency (all modules)', () => {
  describe('A. no dead links — every visible item is route-allowed', () => {
    it.each(ROLES.map((r) => [r] as const))('%s', (role) => {
      const dead = itemsForRole(role)
        .filter(({ item }) => !isRouteAllowed(pathOf(item.href), role))
        .map(({ module, item }) => `${module}: ${item.label} -> ${item.href}`);

      expect(
        dead,
        `role "${role}" can see nav items pointing at routes the proxy blocks`
      ).toEqual([]);
    });
  });

  // Directions A and B are both satisfied VACUOUSLY by a module with no
  // ROUTE_ACCESS rule at all: `isRouteAllowed` returns true for any unmatched
  // prefix, so nothing looks like a dead link and there is no prefix to
  // demand a nav entry for. Verified by experiment — deleting Classroom's
  // ROUTE_ACCESS row left A and B green while every role, including
  // admissions and p_file_officer, could open /classroom.
  //
  // So the highest-risk mistake when adding a module — forgetting the rule —
  // needs its own assertion. No module may rely on default-allow.
  describe('C. every module root has an explicit ROUTE_ACCESS rule', () => {
    it.each(
      (
        Object.keys(SIDEBAR_REGISTRY) as Array<keyof typeof SIDEBAR_REGISTRY>
      ).map((m) => [m, SIDEBAR_REGISTRY[m].primaryHref] as const)
    )('%s (%s)', (_module, primaryHref) => {
      const rule = ROUTE_ACCESS.find(
        (r) =>
          primaryHref === r.prefix || primaryHref.startsWith(r.prefix + '/')
      );
      expect(
        rule,
        `module root "${primaryHref}" has no ROUTE_ACCESS rule, so isRouteAllowed ` +
          `defaults to ALLOW and every authenticated role can open it — including ` +
          `roles with no business there. Add an explicit rule.`
      ).toBeDefined();
      expect(
        rule!.allowed.length,
        `ROUTE_ACCESS rule for "${primaryHref}" allows no roles`
      ).toBeGreaterThan(0);
    });
  });

  describe('B. no invisible pages — every allowed route has a nav path', () => {
    it.each(ROLES.map((r) => [r] as const))('%s', (role) => {
      const linked = new Set(
        itemsForRole(role).map(({ item }) => pathOf(item.href))
      );

      const unreachable = ROUTE_ACCESS.filter((rule) =>
        rule.allowed.includes(role)
      )
        .map((rule) => rule.prefix)
        .filter((prefix) => !REDIRECT_STUBS.has(prefix))
        .filter(
          (prefix) =>
            ![...linked].some((p) => p === prefix || p.startsWith(prefix + '/'))
        );

      expect(
        unreachable,
        `role "${role}" is allowed to open these routes but has no nav link to them ` +
          `(add a nav item / cross-link, or add the route to REDIRECT_STUBS if it is a redirect)`
      ).toEqual([]);
    });
  });
});
