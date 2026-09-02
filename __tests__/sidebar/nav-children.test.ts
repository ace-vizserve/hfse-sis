import { describe, expect, it, vi } from 'vitest';

import {
  flattenNavItems,
  resolveSectionsForRole,
} from '@/lib/auth/nav-visibility';

// Child nav rows are gated INDEPENDENTLY of their parent. Staff is the case
// that motivated it: everyone who can open Staff sees it, but only a holder of
// `staff.view_accounts` sees the Accounts child.
//
// The fixture lives inside the factory because `vi.mock` is hoisted above every
// top-level binding in this file.
vi.mock('@/lib/auth/roles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/roles')>();
  return {
    ...actual,
    NAV_BY_MODULE: {
      ...actual.NAV_BY_MODULE,
      sis: [
        {
          label: 'Organisation',
          items: [
            {
              href: '/sis/admin/staff',
              label: 'Staff',
              children: [
                { href: '/sis/admin/staff', label: 'Teacher assignments' },
                {
                  href: '/sis/admin/staff/accounts',
                  label: 'Accounts',
                  requiresCapability: 'staff.view_accounts',
                },
              ],
            },
            {
              // ⚠ `/sis/admin/school-config`, NOT `/sis/admin/roles` — and the
              // change is worth recording. This fixture used to point the
              // parent at `/sis/admin/roles`, which ROUTE_ACCESS gives to
              // `superadmin` ALONE, while every test below exercised it as
              // `school_admin`. It passed because `resolveSectionsForRole` used
              // to filter non-Markbook rows on `requiresRoles` only; the
              // role-switcher Phase 3b intersection with `isRouteAllowed` broke
              // it, correctly — the fixture was modelling a nav row that offers
              // a school_admin a page the proxy would bounce her from, which is
              // the KD #173 dead end. School config admits her, so the
              // parent-and-children shape these tests are actually about
              // survives, and the dead-link case is asserted deliberately at
              // the bottom of this file instead of by accident here.
              href: '/sis/admin/school-config',
              label: 'School config',
              children: [
                {
                  href: '/sis/admin/roles/matrix',
                  label: 'Matrix',
                  requiresRoles: ['superadmin'],
                },
              ],
            },
            {
              // Superadmin-only, kept so the intersection has something real to
              // remove. See the last test in this file.
              href: '/sis/admin/roles',
              label: 'Role permissions',
            },
          ],
        },
      ] satisfies import('@/lib/auth/roles').NavSection[],
    },
  };
});

function staffChildren(
  role: Parameters<typeof resolveSectionsForRole>[1],
  caps: Parameters<typeof resolveSectionsForRole>[2]
) {
  const sections = resolveSectionsForRole('sis', role, caps);
  const staff = sections[0].items.find((i) => i.label === 'Staff');
  return staff?.children?.map((c) => c.label);
}

describe('child visibility', () => {
  it('shows a capability-gated child to a holder', () => {
    expect(staffChildren('school_admin', ['staff.view_accounts'])).toEqual([
      'Teacher assignments',
      'Accounts',
    ]);
  });

  it('hides it from a viewer who lacks the capability, keeping the parent', () => {
    const sections = resolveSectionsForRole('sis', 'school_admin', []);
    const staff = sections[0].items.find((i) => i.label === 'Staff');
    expect(staff).toBeTruthy();
    expect(staffChildren('school_admin', [])).toEqual(['Teacher assignments']);
  });

  it('fails closed when capabilities are omitted entirely', () => {
    expect(staffChildren('school_admin', undefined)).toEqual([
      'Teacher assignments',
    ]);
  });

  it('drops `children` entirely when every child is filtered out, so the parent renders as a plain link', () => {
    const sections = resolveSectionsForRole('sis', 'school_admin', []);
    const config = sections[0].items.find((i) => i.label === 'School config');
    expect(config).toBeTruthy();
    // Not an empty array — absent. An expander that opens onto nothing is worse
    // than no expander.
    expect(config?.children).toBeUndefined();
  });

  it('keeps a role-gated child for the role that holds it', () => {
    const sections = resolveSectionsForRole('sis', 'superadmin', []);
    const config = sections[0].items.find((i) => i.label === 'School config');
    expect(config?.children?.map((c) => c.label)).toEqual(['Matrix']);
  });

  it('drops a parent whose href the viewer’s role cannot open at all', () => {
    // The half `requiresRoles` cannot express. "Role permissions" declares no
    // roles, so the item-level filter admits everybody — and ROUTE_ACCESS gives
    // `/sis/admin/roles` to superadmin alone, deliberately (a capability
    // controlling the capability editor could be revoked and lock its holder
    // out). Before role-switcher Phase 3b this row rendered for a school_admin
    // and the proxy bounced her off it.
    const labels = (role: 'school_admin' | 'superadmin') =>
      resolveSectionsForRole('sis', role, [])[0].items.map((i) => i.label);
    expect(labels('school_admin')).not.toContain('Role permissions');
    expect(labels('superadmin')).toContain('Role permissions');
  });
});

describe('flattenNavItems', () => {
  it('returns parents and children as one list', () => {
    const flat = flattenNavItems(
      resolveSectionsForRole('sis', 'superadmin', ['staff.view_accounts'])
    );
    expect(flat.map((i) => i.href)).toContain('/sis/admin/staff/accounts');
    expect(flat.map((i) => i.href)).toContain('/sis/admin/roles/matrix');
    // Parents are still present.
    expect(flat.map((i) => i.href)).toContain('/sis/admin/school-config');
  });

  it('omits a child the viewer cannot see, so the KD #173 guards never check a link that is not rendered', () => {
    const flat = flattenNavItems(
      resolveSectionsForRole('sis', 'admissions', [])
    );
    expect(flat.map((i) => i.href)).not.toContain('/sis/admin/roles/matrix');
  });
});
