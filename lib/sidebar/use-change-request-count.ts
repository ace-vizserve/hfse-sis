'use client';

import { useEffect, useId, useState } from 'react';

import type { Role } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

// Live count of "change requests actionable by this user right now".
// Extracted out of use-realtime-badges.ts so both the sidebar's
// `changeRequests` nav badge AND the header notification bell can each
// subscribe independently without duplicating this per-role scope SQL in
// two places. Each hook instance opens its own realtime channel (a unique
// name per mounted instance, via useId) — two lightweight subscriptions
// instead of a shared client-state provider; simpler than threading one
// value through two components that aren't parent/child.
//
// Scope MUST mirror
// lib/change-requests/sidebar-counts.ts::getSidebarChangeRequestCount —
// see that function's doc comment for the per-role rules. `initial` is the
// SSR-computed starting value; passing `null` (or a falsy `role`) means
// "there is nothing to subscribe to" and this hook no-ops.
export function useChangeRequestCount(
  role: Role | null,
  userId: string,
  initial: number | null
): number | null {
  const instanceId = useId();
  const [count, setCount] = useState<number | null>(initial);

  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    if (!role || initial == null) return;

    let filter: string | null = null;
    if (role === 'teacher') {
      filter = `requested_by=eq.${userId}`;
    } else if (role === 'academic_coordinator') {
      filter = `status=eq.approved`;
    } else if (role === 'school_admin' || role === 'superadmin') {
      filter = `status=eq.pending`;
    }
    if (!filter) return;

    const supabase = createClient();

    const recount = async (): Promise<number | null> => {
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
        query = query
          .eq('status', 'pending')
          .or(
            `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
          );
      } else if (role === 'superadmin') {
        query = query.eq('status', 'pending');
      } else {
        return null;
      }
      const { count: fresh } = await query;
      return fresh ?? null;
    };

    const channelName = `change-request-count-${instanceId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'grade_change_requests',
          filter,
        },
        async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'grade_change_requests',
          filter,
        },
        async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, instanceId]);

  return count;
}
