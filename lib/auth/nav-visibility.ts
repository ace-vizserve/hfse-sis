import { can, type Capability } from '@/lib/auth/capabilities';
import {
  hrefPathname,
  isRouteAllowed,
  NAV_BY_MODULE,
  type NavItem,
  type NavSection,
  type Role,
} from '@/lib/auth/roles';
import { moduleAdmitsRole } from '@/lib/sidebar/module-visibility';
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
 *
 * ⚠ THE LENS NOW REACHES ALL EIGHT SIDEBARS, NOT ONLY MARKBOOK (Mr Ace's call,
 * 2026-09-02, role-switcher Phase 3b). Markbook is keyed per role, so there the
 * lens picks the TREE; every other module is one flat list filtered per item on
 * `requiresRoles`, so there the lens picks the ROWS. Phase 3a did only the
 * first, which left a teaching admin looking at a teacher's Markbook menu
 * beside an admin's Attendance and SIS menus — half a view.
 *
 * In both shapes the result is intersected with `isRouteAllowed(href, REAL
 * role)`: what the lens names is a set of LINKS, and a link the proxy bounces
 * is the dead end KD #173 exists to prevent.
 *
 * `capabilities` is NOT lensed, and that is the invariant, not an omission —
 * it is the REAL role's grant set (`getCapabilitiesForRole(role)`), it answers
 * "will the page keep you once you arrive", and the answer to that cannot
 * change because someone chose a different view. `role` authorises;
 * `viewRole` renders.
 */
export function resolveSectionsForRole(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined,
  viewRole: Role | null = role
): NavSection[] {
  return resolveNavView(module, role, capabilities, viewRole).sections;
}

/**
 * The sidebar's rows AND the role they belong to, from one computation.
 *
 * 🔴 WHY BOTH ANSWERS COME OUT OF ONE FUNCTION. A sidebar is not only its nav
 * rows: it also carries a full-width quick-action CTA
 * (`quickActionByRole[…]`) and live badge counts, and every one of those three
 * has to be keyed on the SAME role or the rail contradicts itself. It did.
 * Until 2026-09-02 `components/module-sidebar.tsx` resolved the rows through
 * the lens while reading the CTA and the badge scope off the ACCOUNT role, so a
 * teaching admin in the Teacher view got:
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
 * one answer and every consumer reads it, INCLUDING in the fallback case below,
 * where the rows come from the account role and `rowsRole` says so.
 *
 * `rowsRole` is `null` only when `role` is — a parent, who never reaches a
 * module sidebar.
 */
export function resolveNavView(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined,
  viewRole: Role | null = role
): { rowsRole: Role | null; sections: NavSection[] } {
  const view = viewRole ?? role;
  const lensed = sectionsThroughView(module, role, capabilities, view);
  if (lensed.length > 0 || view === role || role == null) {
    return {
      rowsRole: role == null ? null : lensForModule(module, role, view ?? role),
      sections: lensed,
    };
  }

  // ⚠ THE NET UNDER THE HIGHEST-RISK OUTCOME: A BLANK SIDEBAR FOR A REAL USER.
  //
  // `lensForModule` below is meant to make this unreachable, and
  // `__tests__/sidebar/nav-lens-all-modules.test.ts` asserts it is, across
  // every module × real role × view — including the pairs `getEntitledRoles`
  // can never actually produce. This is here anyway because the failure mode is
  // SILENT: an empty `NavSection[]` renders as a header over nothing, throws
  // nothing and logs nothing, and the thing that would newly cause it is a DATA
  // edit (a `requiresRoles` list, a ROUTE_ACCESS row) rather than a change to
  // this file. Falling back to the account's own nav is the same direction
  // everything else in nav fails: a row too many is an annoyance, no rows at
  // all takes away the only way out of the page.
  //
  // ⚠ ONLY WHEN THERE IS SOMETHING TO FALL BACK TO. A role whose own nav for
  // this module is also empty has lost nothing to the lens — that is
  // `p_file_officer` on `/classroom`, which admits neither the account nor the
  // view — and warning there would print noise on a page nobody can reach and
  // train the reader to ignore the message that matters.
  const own = sectionsThroughView(module, role, capabilities, role);
  if (own.length === 0) {
    return {
      rowsRole: lensForModule(module, role, view ?? role),
      sections: lensed,
    };
  }
  console.warn(
    `[sidebar] the ${view} view emptied the ${module} sidebar for a ${role}; ` +
      'falling back to their own nav. See nav-lens-all-modules.test.ts.'
  );
  // ⚠ `rowsRole: role`, matching the rows we are actually returning. If the net
  // ever does fire, the CTA and the badge must fall back WITH the tree — a
  // teacher-scoped badge over an admin's rows is the same lie in the other
  // direction, and it is the one this net would otherwise create.
  return { rowsRole: role, sections: own };
}

function sectionsThroughView(
  module: SidebarModule,
  role: Role | null,
  capabilities: readonly Capability[] | undefined,
  viewRole: Role | null
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
    if (!viewRole) return [];
    return (NAV_BY_MODULE.markbook[viewRole] ?? [])
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

  const view = lensForModule(module, role, viewRole ?? role);

  // Filter per item, then drop empty groups so no orphan labels render.
  //
  // TWO ROLES, TWO QUESTIONS. `view` answers "is this row part of the job I am
  // looking at" (`requiresRoles`); `role` answers "may I open it at all"
  // (ROUTE_ACCESS). The second runs unconditionally rather than only when the
  // two differ, and is a no-op in the ordinary case BY CONSTRUCTION: direction
  // A of `__tests__/auth/nav-route-consistency-all-modules.test.ts` already
  // asserts every visible item is route-allowed for its own role. One path, no
  // special case to drift.
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter(
          (item) =>
            isVisible(item, view, capabilities) &&
            isRouteAllowed(hrefPathname(item.href), role)
        )
        .map((item) => withVisibleChildren(item, view, capabilities, role)),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Which role's ROWS to render for this module.
 *
 * ⚠ A VIEW THAT CANNOT OPEN THE MODULE HAS NOTHING TO SAY ABOUT ITS ROWS.
 * `/sis`, `/records`, `/p-files` and `/admissions` do not admit `teacher`, so
 * filtering their items through a teacher lens empties every group and leaves
 * the blank sidebar this file fails closed to. The ruling (2026-09-02) is that
 * such a module is HIDDEN from the switcher instead — see
 * `hiddenModulesForView` in lib/sidebar/module-visibility.ts, which asks this
 * same `moduleAdmitsRole` question so the two cannot disagree.
 *
 * This is the other half of that ruling: hiding the tile stops anyone CLICKING
 * their way in, and this stops the one who arrives anyway — a bookmark, a typed
 * URL, a stale link in an email — from getting the empty tree. She sees her own
 * account's nav, which is exactly what she saw before this feature existed.
 */
function lensForModule(
  module: SidebarModule,
  role: Role,
  viewRole: Role
): Role {
  if (viewRole === role) return role;
  return moduleAdmitsRole(module, viewRole) ? viewRole : role;
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
 * `viewRole` decides whether the child belongs to the job on screen and
 * `realRole` whether the proxy would let the viewer open it — the same two
 * questions the parent row is asked, in the same order. They are the same role
 * for every account but the six that also teach.
 */
function withVisibleChildren(
  item: NavItem,
  viewRole: Role,
  capabilities: readonly Capability[] | undefined,
  realRole: Role
): NavItem {
  if (!item.children?.length) return item;
  const children = item.children.filter(
    (child) =>
      isVisible(child, viewRole, capabilities) &&
      isRouteAllowed(hrefPathname(child.href), realRole)
  );
  if (children.length === 0) {
    const { children: _dropped, ...rest } = item;
    return rest;
  }
  return { ...item, children };
}
