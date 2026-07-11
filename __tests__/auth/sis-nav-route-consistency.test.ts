import { describe, it, expect } from 'vitest';

import {
  NAV_BY_MODULE,
  ROLES,
  isRouteAllowed,
  type NavItem,
  type NavSection,
} from '@/lib/auth/roles';

// No-dead-ends regression guard (SIS Admin IA redesign, Phase 1).
//
// A sidebar link that a role can SEE but that the proxy then bounces the
// role off of is a dead end. This walks every item in the SIS module's nav
// tree and asserts that every role listed in that item's `requiresRoles`
// actually passes `isRouteAllowed(item.href, role)` per ROUTE_ACCESS. An
// item with no `requiresRoles` is checked against every role that isn't
// explicitly excluded by another SIS nav item — in practice every SIS nav
// item declares `requiresRoles`, so this degrades to "every declared role
// must be route-allowed."
//
// This test failed before the Phase 1 gate fixes on two counts:
//   1. The "Admin Hub" (/sis) item listed `registrar` in requiresRoles, but
//      ROUTE_ACCESS's broad `/sis` catch-all is school_admin/superadmin only.
//   2. `/sis/admin/staff` had NO ROUTE_ACCESS row at all, so it fell through
//      to the same catch-all — excluding the `registrar` role its own
//      requiresRoles declared.

function flattenItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

describe('SIS_NAV <-> ROUTE_ACCESS consistency', () => {
  const items = flattenItems(NAV_BY_MODULE.sis);

  it('has at least one nav item to check (sanity)', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it.each(items.map((item) => [item.href, item.label, item] as const))(
    'every requiresRoles entry for %s (%s) passes isRouteAllowed',
    (href, _label, item) => {
      const rolesToCheck = item.requiresRoles ?? ROLES;
      for (const role of rolesToCheck) {
        expect(
          isRouteAllowed(href, role),
          `expected role "${role}" to be allowed on "${href}" (declared in SIS_NAV requiresRoles) but ROUTE_ACCESS rejects it`
        ).toBe(true);
      }
    }
  );
});
