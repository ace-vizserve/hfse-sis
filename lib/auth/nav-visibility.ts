import { can, type Capability } from '@/lib/auth/capabilities';
import {
  NAV_BY_MODULE,
  type NavItem,
  type NavSection,
  type Role,
} from '@/lib/auth/roles';
import type { SidebarModule } from '@/lib/sidebar/registry';

// Which sidebar rows a viewer actually sees.
//
// WHY THIS IS ITS OWN MODULE. This is authorization logic, not rendering, and
// it used to live inside components/module-sidebar.tsx — a `'use client'` file
// that pulls in JSX, next/navigation, lucide and cmdk. The regression test in
// __tests__/auth/link-capability-consistency.test.ts has to enumerate what each
// role can see, and it should not have to mount a React tree to do it.
//
// WHY IT TAKES CAPABILITIES. A nav item's `requiresRoles` answers "will the
// proxy let you through" (it mirrors ROUTE_ACCESS). It cannot answer "will the
// page keep you once you arrive", because several pages now guard on a
// CAPABILITY instead of a role name. Those two questions had no shared
// vocabulary, which is how the academic coordinator came to be shown
// "Document validation" — a page that redirects her on
// `documents_pre_enrolment.read`, which migration 106 deliberately took off
// her. Five surfaces advertised it; the page bounced her from all five.
// See KD #173.

/**
 * The sidebar sections a viewer sees, after both gates.
 *
 * FAILS CLOSED. Omitting `capabilities` hides every capability-gated item
 * rather than revealing it — `can()` returns false for `undefined`. That is the
 * right direction: a missing row is visible and gets reported, while a row that
 * shouldn't be there is exactly the bug this function exists to prevent. The
 * cost is that a caller who forgets the argument silently loses rows, so
 * `link-capability-consistency.test.ts` asserts every layout passes it.
 */
export function resolveSectionsForRole(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined
): NavSection[] {
  // Markbook is keyed per role rather than filtered per item — four hand-written
  // variants, no `requiresRoles` anywhere in them. No item there is capability
  // gated today; if one ever is, it goes through the same filter below.
  if (module === 'markbook') {
    if (!role) return [];
    return NAV_BY_MODULE.markbook[role] ?? [];
  }

  const sections = NAV_BY_MODULE[module] ?? [];
  if (!role) return sections;

  // Filter per item, then drop empty groups so no orphan labels render.
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => isVisible(item, role, capabilities))
        .map((item) => withVisibleChildren(item, role, capabilities)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Every row a viewer can see, parents and children alike, as one flat list.
 *
 * Use this anywhere the question is "what links does this role have" —
 * active-state matching, and the KD #173 guards that check no visible link
 * points at a page which will bounce the viewer. Iterating `section.items`
 * alone skips children, which would let a capability-gated child advertise work
 * its page then refuses: the exact defect KD #173 exists to prevent, one level
 * further down.
 */
export function flattenNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) =>
    section.items.flatMap((item) => [item, ...(item.children ?? [])])
  );
}

function isVisible(
  item: NavItem,
  role: Role,
  capabilities: readonly Capability[] | undefined
): boolean {
  return (
    (!item.requiresRoles || item.requiresRoles.includes(role)) &&
    (!item.requiresCapability || can(capabilities, item.requiresCapability))
  );
}

/**
 * Children run through the same two gates as their parent, independently.
 *
 * A parent whose children all fail keeps its own row and loses the `children`
 * key entirely, so it renders as a plain link rather than an expander that
 * opens onto nothing. That is the Staff case: everyone who can open Staff sees
 * it, but only a holder of `staff.view_accounts` sees the Accounts child.
 */
function withVisibleChildren(
  item: NavItem,
  role: Role,
  capabilities: readonly Capability[] | undefined
): NavItem {
  if (!item.children?.length) return item;
  const children = item.children.filter((child) =>
    isVisible(child, role, capabilities)
  );
  if (children.length === 0) {
    const { children: _dropped, ...rest } = item;
    return rest;
  }
  return { ...item, children };
}
