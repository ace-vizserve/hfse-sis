'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Role, SidebarBadgeKey, SidebarBadges } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';
import { useChangeRequestCount } from '@/lib/sidebar/use-change-request-count';

// Generalized realtime sidebar badge hook. Subscribes to one supabase
// channel per badge key present in `initial`, returns merged live counts.
//
// Supersedes the older markbook-only `useRealtimeBadgeCount` hook. Only
// `changeRequests` has a wired channel today; new keys (attendance
// unmarked, p-files missing docs, admissions to review) plug in by
// adding a case to `subscribeChannel` and a matching SSR loader.
//
// Per-key subscription scoping mirrors the original markbook hook —
// only "count-up" events trigger a recount; "count-down" events are
// triggered by the local user's own action and are reflected
// synchronously in their initial count.

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
  initial: SidebarBadges
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

  const liveChangeRequestCount = useChangeRequestCount(
    role,
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
