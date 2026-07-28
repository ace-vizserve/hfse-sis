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

// Query-builder shape common to a Supabase PostgrestFilterBuilder's
// filter methods, loose enough to accept the real client without fighting
// its generic/overloaded `.eq()`/`.or()` signatures at the call site below
// (which casts through `unknown`, the established pattern for this kind of
// mismatch elsewhere in the codebase — see e.g.
// lib/change-requests/sidebar-counts.ts's own `as unknown as` usage).
type ChangeRequestScopeQuery = {
  eq: (column: string, value: unknown) => ChangeRequestScopeQuery;
  or: (filters: string) => ChangeRequestScopeQuery;
};

// The pure per-role branch of the live-recount query — pulled out of the
// `recount` closure inside the effect below so it can be unit-tested in
// isolation (it was previously only reachable by mounting the hook inside
// React). MUST mirror lib/change-requests/sidebar-counts.ts's two
// functions' identical branches; __tests__/change-requests/scope-parity.
// test.ts asserts all three agree on which roles apply `.or()`. Returns
// `null` for a role outside the change-request flow (mirrors the other two
// implementations' `return 0` / `return []` "not in scope" case).
export function applyChangeRequestCountScope(
  query: ChangeRequestScopeQuery,
  role: Role,
  userId: string
): ChangeRequestScopeQuery | null {
  if (role === 'teacher') {
    return query.eq('requested_by', userId).eq('status', 'pending');
  }
  if (role === 'academic_coordinator') {
    return query.eq('status', 'approved');
  }
  if (role === 'school_admin') {
    return query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null)`
      );
  }
  if (role === 'superadmin') {
    return query.eq('status', 'pending');
  }
  return null;
}

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

      const baseQuery = supabase
        .from('grade_change_requests')
        .select(
          'id, grading_sheet:grading_sheets!inner(section:sections!inner(academic_year_id))',
          { count: 'exact', head: true }
        )
        .eq('grading_sheet.section.academic_year_id', currentAyId);

      const scoped = applyChangeRequestCountScope(
        baseQuery as unknown as ChangeRequestScopeQuery,
        role,
        userId
      );
      if (!scoped) return null;

      const { count: fresh } = await (scoped as unknown as typeof baseQuery);
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
