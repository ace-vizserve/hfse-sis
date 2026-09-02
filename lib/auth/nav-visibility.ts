import { can, type Capability } from '@/lib/auth/capabilities';
import {
  isRouteAllowed,
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
 *
 * `viewRole` is the active-role lens (lib/auth/active-role.ts) and defaults to
 * `role`, so a caller that has no lens to offer gets exactly today's behaviour.
 * It is used ONLY to pick Markbook's per-role tree — see below. Every other
 * module filters per item on `requiresRoles`, which is left on the real role
 * deliberately: those lists mirror ROUTE_ACCESS, and Phase 3a's remit is the
 * Markbook nav, not a sweep of all eight sidebars.
 */
export function resolveSectionsForRole(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined,
  viewRole: Role | null = role
): NavSection[] {
  // Markbook is keyed per role rather than filtered per item — four hand-written
  // variants, no `requiresRoles` anywhere in them. No item there is capability
  // gated today; if one ever is, it goes through the same filter below.
  //
  // ⚠ THE TREE IS PICKED BY THE LENS AND THEN INTERSECTED WITH THE REAL ROLE.
  // Picking by `viewRole` is the whole point — it is how a `school_admin` who
  // also teaches gets the teacher's "My Sheets / My Requests" sidebar instead
  // of the coordinator's twenty-row one. But the tree the lens names is a set
  // of LINKS, and a link the proxy will bounce is the dead end KD #173 exists
  // to prevent, so every href is re-checked against the role that actually
  // authorises before it renders.
  //
  // Not reachable today: all six teaching accounts are `school_admin`, whom
  // `/markbook` admits, so the filter is a no-op for them. It bites the moment
  // Phase 4 lets anyone be assigned a class — a `p_file_officer` or
  // `admissions` account holding assignment rows may take the Teacher lens
  // (`getEntitledRoles` grants it on assignment rows alone), and `/markbook`'s
  // ROUTE_ACCESS row refuses both. Rendering the teacher tree for them would
  // advertise four Markbook links that all bounce.
  //
  // Filtering runs unconditionally rather than only when the lens differs from
  // the role, because it is a no-op in the ordinary case BY CONSTRUCTION:
  // `__tests__/auth/nav-route-consistency-all-modules.test.ts` already asserts
  // every markbook href is route-allowed for the role whose tree holds it. One
  // path, no special case to drift.
  //
  // ⚠ CHILDREN GO THROUGH THE SAME FILTER, INDEPENDENTLY. No Markbook tree has
  // children today, so this is latent — but `flattenNavItems` below carries a
  // whole docstring about children being the level people forget, and it earned
  // it: a capability-gated CHILD advertising work its page refuses is KD #173
  // one level down. Made recursive rather than commented, because "the day
  // someone adds a child to the coordinator's Grading group" is exactly when
  // nobody re-reads this function. A parent whose children all fail keeps its
  // own row and loses the `children` key, matching `withVisibleChildren`.
  if (module === 'markbook') {
    const view = viewRole ?? role;
    if (!view) return [];
    return (NAV_BY_MODULE.markbook[view] ?? [])
      .map((section) => ({
        ...section,
        items: section.items
          .filter((item) => isRouteAllowed(item.href, role))
          .map((item) => withRouteAllowedChildren(item, role)),
      }))
      .filter((section) => section.items.length > 0);
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

/**
 * The Markbook intersection's child half — `withVisibleChildren`'s sibling for
 * the one module that is keyed per role instead of filtered per item.
 *
 * Separate from `withVisibleChildren` rather than parameterised over it,
 * because the two ask genuinely different questions: that one runs a
 * `requiresRoles`/`requiresCapability` filter the item declares about itself,
 * this one asks ROUTE_ACCESS whether the viewer's REAL role could open the
 * href at all. Folding them together would hide which of the two a future
 * change is touching.
 */
function withRouteAllowedChildren(item: NavItem, role: Role | null): NavItem {
  if (!item.children?.length) return item;
  const children = item.children.filter((child) =>
    isRouteAllowed(child.href, role)
  );
  if (children.length === 0) {
    const { children: _dropped, ...rest } = item;
    return rest;
  }
  return { ...item, children };
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
