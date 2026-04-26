"use client";

import { useEffect, useState } from "react";

import type { Role, SidebarBadgeKey, SidebarBadges } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/client";

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
  userId: string,
): BadgeChannel[] {
  const channels: BadgeChannel[] = [];
  const supabase = createClient();

  if (initial.changeRequests != null) {
    let filter: string | null = null;
    if (role === "teacher") {
      filter = `requested_by=eq.${userId}`;
    } else if (role === "registrar") {
      filter = `status=eq.approved`;
    } else if (role === "admin" || role === "superadmin") {
      filter = `status=eq.pending`;
    }

    if (filter) {
      channels.push({
        key: "changeRequests",
        channelName: "sidebar-badge-change-requests",
        table: "grade_change_requests",
        filter,
        recount: async () => {
          let query = supabase
            .from("grade_change_requests")
            .select("id", { count: "exact", head: true });
          if (role === "teacher") {
            query = query.eq("requested_by", userId).eq("status", "pending");
          } else if (role === "registrar") {
            query = query.eq("status", "approved");
          } else if (role === "admin" || role === "superadmin") {
            query = query.eq("status", "pending");
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

export function useRealtimeBadges(
  role: Role | null,
  userId: string,
  initial: SidebarBadges,
): SidebarBadges {
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
          "postgres_changes",
          { event: "INSERT", schema: "public", table: c.table, filter: c.filter ?? undefined },
          async () => {
            const fresh = await c.recount();
            if (fresh != null) setBadges((prev) => ({ ...prev, [c.key]: fresh }));
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: c.table, filter: c.filter ?? undefined },
          async () => {
            const fresh = await c.recount();
            if (fresh != null) setBadges((prev) => ({ ...prev, [c.key]: fresh }));
          },
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

  return badges;
}
