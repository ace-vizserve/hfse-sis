'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Role, SidebarBadgeKey, SidebarBadges } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';
import { useDeclarationCount } from '@/lib/sidebar/use-declaration-count';

// Generalized realtime sidebar badge hook, returning merged live counts for
// the badges present in `initial`.
//
// Supersedes the older markbook-only `useRealtimeBadgeCount` hook. Three
// badges are wired today, following two patterns:
//
//   - `declarations` delegates to `useDeclarationCount`, the same shape as
//     `changeRequests` below but with NO per-role scope SQL of its own: RLS
//     (migration 129) admits only the steps the reader can act on, so the
//     scope lives in one place instead of being restated in the browser.
//
//   - `changeRequests` delegates entirely to the extracted
//     `useChangeRequestCount` hook (lib/sidebar/use-change-request-count.ts)
//     — pulled out of this file so both this sidebar badge AND the header
//     notification bell (components/notifications/notification-bell.tsx)
//     can each subscribe independently without duplicating the per-role
//     scope SQL in two places.
//   - `pfileAwaitingVerification` stays inline below as its own effect
//     (SSR-rendered count + a realtime channel that triggers
//     `router.refresh()` rather than recomputing client-side) — untouched
//     by the changeRequests extraction.
// A future badge key would follow whichever of these two shapes fits.

// Audit-log actions that indicate P-Files awaiting-verification count may
// have changed. INSERT on audit_log with one of these actions triggers a
// router.refresh() so the SSR-rendered badge re-fetches from the server.
const PFILE_VERIFICATION_ACTIONS = [
  'pfile.upload',
  'pfile.reminder.sent',
  'sis.document.approve',
  'sis.document.reject',
  'sis.documents.auto-expire',
  'sis.documents.auto-revive',
] as const;

// Roles that see the pfileAwaitingVerification badge. Mirrors the p-files
// layout gate (p-file, school_admin, superadmin per KD #31 + KD #74).
const PFILE_BADGE_ROLES: Role[] = [
  'p_file_officer',
  'school_admin',
  'superadmin',
];

export function useRealtimeBadges(
  role: Role | null,
  userId: string,
  initial: SidebarBadges,
  // The role whose ROWS the sidebar is rendering — `resolveNavView`'s
  // `rowsRole`. Defaults to `role`, so every account with a single view behaves
  // exactly as before.
  //
  // ⚠ ONLY `changeRequests` TAKES IT, AND THAT IS THE WHOLE POINT OF PASSING IT
  // SEPARATELY RATHER THAN SHADOWING `role`. That badge hangs off a row the LENS
  // chose — "My Requests" in the teacher tree, "Change Requests" in the
  // oversight one — and those two rows point at different pages with different
  // scopes, so a count keyed on the account role describes the wrong page. The
  // other two badges are account-level: `pfileAwaitingVerification` gates on
  // which roles see the P-Files sidebar at all, and `declarations` has no role
  // branch anywhere (RLS decides it). Shadowing `role` would have quietly moved
  // all three. (role-switcher Phase 3b, 2026-09-02.)
  rowsRole: Role | null = role
): SidebarBadges {
  const router = useRouter();
  const [badges, setBadges] = useState<SidebarBadges>(initial);

  // Sync with the SSR-provided baseline when its CONTENT changes — not
  // its reference. A caller that passes `badges ?? {}` would otherwise
  // create a fresh object every render and trigger an infinite loop.
  useEffect(() => {
    setBadges((prev) => {
      const keys = new Set<SidebarBadgeKey>([
        ...(Object.keys(prev) as SidebarBadgeKey[]),
        ...(Object.keys(initial) as SidebarBadgeKey[]),
      ]);
      for (const k of keys) {
        if (prev[k] !== initial[k]) return { ...initial };
      }
      return prev;
    });
  }, [initial]);

  // ⚠ The live recount MUST use the same scope as the SSR count that seeded it
  // (`getSidebarChangeRequestCount` in the module layout, which is passed the
  // same `rowsRole`), or the badge is correct on first paint and wrong the
  // moment any change request is inserted or updated.
  const liveChangeRequestCount = useChangeRequestCount(
    rowsRole,
    userId,
    initial.changeRequests ?? null
  );

  useEffect(() => {
    if (liveChangeRequestCount == null) return;
    setBadges((prev) =>
      prev.changeRequests === liveChangeRequestCount
        ? prev
        : { ...prev, changeRequests: liveChangeRequestCount }
    );
  }, [liveChangeRequestCount]);

  const liveDeclarationCount = useDeclarationCount(
    userId,
    initial.declarations ?? null
  );

  useEffect(() => {
    if (liveDeclarationCount == null) return;
    setBadges((prev) =>
      prev.declarations === liveDeclarationCount
        ? prev
        : { ...prev, declarations: liveDeclarationCount }
    );
  }, [liveDeclarationCount]);

  // pfileAwaitingVerification — SSR-rendered badge; realtime channel fires
  // router.refresh() on document-related audit_log INSERTs so the layout
  // RSC re-fetches countAwaitingVerification from the server.
  // Gated on roles that see the P-Files sidebar (p-file, school_admin, superadmin).
  useEffect(() => {
    if (!role || !PFILE_BADGE_ROLES.includes(role)) return;
    if (initial.pfileAwaitingVerification == null) return;

    const supabase = createClient();
    const filter = `action=in.(${PFILE_VERIFICATION_ACTIONS.join(',')})`;
    const channel = supabase
      .channel('sidebar-badge-pfile-awaiting-verification')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log', filter },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return badges;
}
