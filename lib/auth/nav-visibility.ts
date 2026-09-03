import { can, type Capability } from '@/lib/auth/capabilities';
import {
  hrefPathname,
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
 * ⚠ ONE ROLE, ONE ANSWER. An earlier design threaded a second `viewRole`
 * through here so that a teaching admin could be shown a teacher's rows while
 * her account stayed an admin's. An account now holds a LIST of roles with one
 * in force (`app_metadata.active_role`), so switching changes `role` itself and
 * there is nothing left to hold apart. `capabilities` is the same role's grant
 * set (`getCapabilitiesForRole(role)`), which is why the two gates below can
 * never disagree about who is looking.
 */
export function resolveSectionsForRole(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined
): NavSection[] {
  return resolveNavView(module, role, capabilities).sections;
}

/**
 * The sidebar's rows AND the role they belong to, from one computation.
 *
 * 🔴 WHY BOTH ANSWERS COME OUT OF ONE FUNCTION. A sidebar is not only its nav
 * rows: it also carries a full-width quick-action CTA
 * (`quickActionByRole[…]`) and live badge counts, and every one of those three
 * has to be keyed on the SAME role or the rail contradicts itself. It did:
 * until 2026-09-02 `components/module-sidebar.tsx` resolved the rows one way
 * and read the CTA and the badge scope another, so a teaching admin working as
 * a teacher got:
 *
 *   • the admin's "Review change requests" CTA sitting above a teacher's
 *     two-row Markbook menu, and
 *   • the number beside the teacher tree's own "My Requests" row showing her
 *     APPROVAL QUEUE — pending requests awaiting her decision — rather than the
 *     requests she has filed, which is what that row links to.
 *
 * A badge that disagrees with the row it sits on is the "3 documents" defect
 * class this codebase already treats as serious. Returning `rowsRole` alongside
 * `sections` is what makes the three impossible to key differently: there is
 * one answer and every consumer reads it rather than re-deriving it.
 *
 * `rowsRole` is `null` only when `role` is — a parent, who never reaches a
 * module sidebar.
 */
export function resolveNavView(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined
): { rowsRole: Role | null; sections: NavSection[] } {
  return {
    rowsRole: role,
    sections: sectionsForRole(module, role, capabilities),
  };
}

function sectionsForRole(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined
): NavSection[] {
  // Markbook is keyed per role rather than filtered per item — four hand-written
  // variants, no `requiresRoles` anywhere in them. No item there is capability
  // gated today; if one ever is, it goes through the same filter below.
  //
  // ⚠ THE TREE IS INTERSECTED WITH ROUTE_ACCESS BEFORE IT RENDERS. What a tree
  // names is a set of LINKS, and a link the proxy will bounce is the dead end
  // KD #173 exists to prevent, so every href is re-checked. It is a no-op in
  // the ordinary case BY CONSTRUCTION —
  // `__tests__/auth/nav-route-consistency-all-modules.test.ts` already asserts
  // every markbook href is route-allowed for the role whose tree holds it — and
  // it runs unconditionally so there is one path and no special case to drift.
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
    if (!role) return [];
    return (NAV_BY_MODULE.markbook[role] ?? [])
      .map((section) => ({
        ...section,
        items: section.items
          .filter((item) => isRouteAllowed(hrefPathname(item.href), role))
          .map((item) => withRouteAllowedChildren(item, role)),
      }))
      .filter((section) => section.items.length > 0);
  }

  const sections = NAV_BY_MODULE[module] ?? [];
  if (!role) return sections;

  // Filter per item, then drop empty groups so no orphan labels render.
  //
  // TWO GATES, ONE ROLE. `requiresRoles`/`requiresCapability` answer "is this
  // row part of your job"; ROUTE_ACCESS answers "may you open it at all". The
  // second runs unconditionally and is a no-op in the ordinary case BY
  // CONSTRUCTION: direction A of
  // `__tests__/auth/nav-route-consistency-all-modules.test.ts` already asserts
  // every visible item is route-allowed for its own role. One path, no special
  // case to drift.
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter(
          (item) =>
            isVisible(item, role, capabilities) &&
            isRouteAllowed(hrefPathname(item.href), role)
        )
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
 * ⚠ AMENDED BY PHASE 3b, AND IT IS NOW THE NARROWER OF THE TWO. Phase 3a kept
 * this separate because `withVisibleChildren` asked only the item's own
 * `requiresRoles`/`requiresCapability` question while this one asked
 * ROUTE_ACCESS. `withVisibleChildren` now asks BOTH, so this is a strict
 * special case of it — safe only because no Markbook tree declares either
 * field, which is what makes its `isVisible` half vacuous.
 *
 * Kept rather than folded in, deliberately: Markbook is the module keyed per
 * ROLE rather than filtered per item, and the day someone gives a Markbook row
 * a `requiresCapability` is the day that difference matters. Merging now would
 * silently decide that question in advance. If both branches ever converge on
 * one filter, delete this and say why in the same commit.
 */
function withRouteAllowedChildren(item: NavItem, role: Role | null): NavItem {
  if (!item.children?.length) return item;
  const children = item.children.filter((child) =>
    isRouteAllowed(hrefPathname(child.href), role)
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
 *
 * Does the child belong to this job (`requiresRoles`/`requiresCapability`), and
 * would the proxy let the viewer open it (ROUTE_ACCESS) — the same two
 * questions the parent row is asked, in the same order.
 */
function withVisibleChildren(
  item: NavItem,
  role: Role,
  capabilities: readonly Capability[] | undefined
): NavItem {
  if (!item.children?.length) return item;
  const children = item.children.filter(
    (child) =>
      isVisible(child, role, capabilities) &&
      isRouteAllowed(hrefPathname(child.href), role)
  );
  if (children.length === 0) {
    const { children: _dropped, ...rest } = item;
    return rest;
  }
  return { ...item, children };
}
