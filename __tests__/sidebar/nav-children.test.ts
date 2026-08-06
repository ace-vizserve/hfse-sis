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
              href: '/sis/admin/roles',
              label: 'Role permissions',
              children: [
                {
                  href: '/sis/admin/roles/matrix',
                  label: 'Matrix',
                  requiresRoles: ['superadmin'],
                },
              ],
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
    const roles = sections[0].items.find((i) => i.label === 'Role permissions');
    expect(roles).toBeTruthy();
    // Not an empty array — absent. An expander that opens onto nothing is worse
    // than no expander.
    expect(roles?.children).toBeUndefined();
  });

  it('keeps a role-gated child for the role that holds it', () => {
    const sections = resolveSectionsForRole('sis', 'superadmin', []);
    const roles = sections[0].items.find((i) => i.label === 'Role permissions');
    expect(roles?.children?.map((c) => c.label)).toEqual(['Matrix']);
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
    expect(flat.map((i) => i.href)).toContain('/sis/admin/roles');
  });

  it('omits a child the viewer cannot see, so the KD #173 guards never check a link that is not rendered', () => {
    const flat = flattenNavItems(
      resolveSectionsForRole('sis', 'admissions', [])
    );
    expect(flat.map((i) => i.href)).not.toContain('/sis/admin/roles/matrix');
  });
});
