'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Role, SidebarBadgeKey, SidebarBadges } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

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

type BadgeChannel = {
  key: SidebarBadgeKey;
  channelName: string;
  table: string;
  filter: string | null;
  recount: () => Promise<number | null>;
};

function subscribeChannels(
  initial: SidebarBadges,
  role: Role,
  userId: string
): BadgeChannel[] {
  const channels: BadgeChannel[] = [];
  const supabase = createClient();

  if (initial.changeRequests != null) {
    let filter: string | null = null;
    if (role === 'teacher') {
      filter = `requested_by=eq.${userId}`;
    } else if (role === 'academic_coordinator') {
      filter = `status=eq.approved`;
    } else if (role === 'school_admin' || role === 'superadmin') {
      filter = `status=eq.pending`;
    }

    if (filter) {
      channels.push({
        key: 'changeRequests',
        channelName: 'sidebar-badge-change-requests',
        table: 'grade_change_requests',
        filter,
        recount: async () => {
          // Scope MUST mirror getSidebarChangeRequestCount (SSR sibling)
          // and the /markbook/change-requests page query — see KD #41.
          // Two axes: approver scope (school_admin/superadmin see only
          // their designated CRs or legacy null-approver rows) AND AY
          // scope (page filters via grading_sheet.section.academic_year_id;
          // without it, pending CRs from prior/test AYs inflate the badge).
          const { data: ayData } = await supabase
            .from('academic_years')
            .select('id')
            .eq('is_current', true)
            .maybeSingle();
          const currentAyId = (ayData as { id: string } | null)?.id ?? null;
          if (!currentAyId) return 0;

          let query = supabase
            .from('grade_change_requests')
            .select(
              'id, grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))',
              { count: 'exact', head: true }
            )
            .eq('grading_sheet.section.academic_year_id', currentAyId);
          if (role === 'teacher') {
            query = query.eq('requested_by', userId).eq('status', 'pending');
          } else if (role === 'academic_coordinator') {
            query = query.eq('status', 'approved');
          } else if (role === 'school_admin') {
            // Designated approver scope (KD #41): only requests this admin is
            // primary/secondary on, plus legacy null-approver rows.
            query = query
              .eq('status', 'pending')
              .or(
                `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
              );
          } else if (role === 'superadmin') {
            // Oversight scope: full visibility, matches the page filter.
            query = query.eq('status', 'pending');
          } else {
            return null;
          }
          const { count } = await query;
          return count ?? null;
        },
      });
    }
  }

  return channels;
}

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

  useEffect(() => {
    if (!role) return;

    const supabase = createClient();
    const channels = subscribeChannels(initial, role, userId);
    if (channels.length === 0) return;

    const subscriptions = channels.map((c) => {
      const channel = supabase
        .channel(c.channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: c.table,
            filter: c.filter ?? undefined,
          },
          async () => {
            const fresh = await c.recount();
            if (fresh != null)
              setBadges((prev) => ({ ...prev, [c.key]: fresh }));
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: c.table,
            filter: c.filter ?? undefined,
          },
          async () => {
            const fresh = await c.recount();
            if (fresh != null)
              setBadges((prev) => ({ ...prev, [c.key]: fresh }));
          }
        )
        .subscribe();
      return channel;
    });

    return () => {
      for (const channel of subscriptions) {
        supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId]);

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
