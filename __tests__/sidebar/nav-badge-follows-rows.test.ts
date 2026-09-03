/**
 * A sidebar's CTA and its badge belong to the rows they sit with.
 *
 * 🔴 THE DEFECT THIS EXISTS FOR (role-switcher Phase 3b review, 2026-09-02).
 * Phase 3b lensed the nav ROWS but left two neighbours on the account role, so
 * a teaching admin in the Teacher view got a rail that argued with itself:
 *
 *   • `config.quickActionByRole[role]` rendered the approver's full-width
 *     "Review change requests" button above a teacher's two-row Markbook menu;
 *   • `useRealtimeBadges(role, …)` scoped the `changeRequests` count to her
 *     APPROVAL QUEUE, and that number was drawn beside the teacher tree's "My
 *     Requests" row — a page listing the requests SHE filed. The badge counted
 *     one thing and linked to another.
 *
 * The second is the "3 documents" defect class the session log already treats
 * as serious: a count that disagrees with the surface it labels. Neither the
 * Phase 3a grep (role literals in pages and layouts) nor Phase 3b's
 * `requiresRoles` sweep could see it, because it lived in a role-indexed lookup
 * table and a hook argument.
 *
 * The fix is structural rather than a third place to remember: `resolveNavView`
 * returns `rowsRole` WITH the sections, and all three consumers read it.
 */
import { describe, expect, it } from 'vitest';

import {
  resolveNavView,
  resolveSectionsForRole,
} from '@/lib/auth/nav-visibility';
import { NAV_BY_MODULE, ROLES, type NavSection } from '@/lib/auth/roles';
import { applyChangeRequestCountScope } from '@/lib/sidebar/use-change-request-count';
import { MODULE_ORDER, SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';

describe('rowsRole always names the tree that was actually returned', () => {
  it('holds for every module × role', () => {
    // The invariant the whole fix rests on. If `rowsRole` and `sections` could
    // ever disagree, the CTA and the badge would be keyed on a menu that is not
    // on screen — which is the original defect, moved rather than fixed.
    const mismatches: string[] = [];
    for (const sidebarModule of MODULE_ORDER) {
      for (const role of ROLES) {
        const { rowsRole, sections } = resolveNavView(
          sidebarModule,
          role,
          undefined
        );
        const expected = resolveSectionsForRole(sidebarModule, role, undefined);
        if (rowsRole !== role) {
          mismatches.push(`${sidebarModule}: ${role} got rowsRole ${rowsRole}`);
        }
        if (JSON.stringify(sections) !== JSON.stringify(expected)) {
          mismatches.push(
            `${sidebarModule}: ${role} rendered rows that are not ${rowsRole}'s`
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('the quick-action CTA follows the rows', () => {
  it('a teacher is offered no Markbook CTA', () => {
    const { rowsRole } = resolveNavView('markbook', 'teacher', undefined);
    expect(rowsRole).toBe('teacher');
    // Markbook defines no `teacher` quick action on purpose — its target ("My
    // Sheets") is already the second nav row, so a CTA would duplicate it. That
    // absence is what keeps the approver's button off a teacher's rail, and it
    // is what a teaching admin loses the moment she switches to Teacher.
    expect(SIDEBAR_REGISTRY.markbook.quickActionByRole.teacher).toBeUndefined();
  });

  it('and an approver gets the approver CTA', () => {
    const { rowsRole } = resolveNavView('markbook', 'school_admin', undefined);
    expect(rowsRole).toBe('school_admin');
    expect(
      SIDEBAR_REGISTRY.markbook.quickActionByRole.school_admin?.label
    ).toBe('Review change requests');
  });
});

describe('the changeRequests badge and the row it sits on describe one page', () => {
  /** The href the `changeRequests` badge hangs off in a given role's tree. */
  function badgedHref(role: 'teacher' | 'school_admin'): string | undefined {
    const tree = (NAV_BY_MODULE.markbook[role] ?? []) as NavSection[];
    return tree
      .flatMap((s) => s.items)
      .find((i) => i.badgeKey === 'changeRequests')?.href;
  }

  it('the two trees badge two DIFFERENT destinations', () => {
    // This is the whole reason the count cannot be keyed on the account role.
    expect(badgedHref('teacher')).toBe('/markbook/grading/requests');
    expect(badgedHref('school_admin')).toBe('/markbook/change-requests');
  });

  it('the teacher scope counts the requests SHE filed, which is what My Requests lists', () => {
    // `/markbook/grading/requests` filters `requested_by = userId` for EVERY
    // role — it is not role-branched at all, and its own comment says so
    // ("anyone else can still view this page as a history of their own-filed
    // requests"). So the teacher scope is the right one for that row whoever
    // is looking, which is exactly why no Markbook page needed changing.
    const calls: string[] = [];
    const query = {
      eq: (column: string) => {
        calls.push(`eq:${column}`);
        return query;
      },
      or: () => {
        calls.push('or');
        return query;
      },
    };
    applyChangeRequestCountScope(query, 'teacher', 'user-1');
    expect(calls).toEqual(['eq:requested_by', 'eq:status']);
  });

  it('while the oversight scope counts requests waiting on the APPROVER', () => {
    // Non-vacuity: the two scopes really are different, so keying the badge on
    // the wrong one really does change the number.
    const calls: string[] = [];
    const query = {
      eq: (column: string) => {
        calls.push(`eq:${column}`);
        return query;
      },
      or: () => {
        calls.push('or');
        return query;
      },
    };
    applyChangeRequestCountScope(query, 'school_admin', 'user-1');
    expect(calls).toEqual(['eq:status', 'or']);
    expect(calls).not.toContain('eq:requested_by');
  });
});
