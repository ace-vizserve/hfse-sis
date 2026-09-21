'use client';

import { useEffect, useState } from 'react';

import type { Role } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

// Live count of "change requests actionable by this user right now".
// Extracted out of use-realtime-badges.ts so both the sidebar's
// `changeRequests` nav badge AND the header notification bell can each
// subscribe independently without duplicating this per-role scope SQL in
// two places. Both hook instances join the SAME fixed Broadcast topic
// (`sis:grade-change-requests`, from migration 171) rather than each
// opening a uniquely-named channel — a Broadcast topic IS the channel
// name, so there is no per-instance name to mint the way there was under
// Postgres Changes (via useId). The topic only carries a ping; the actual
// count is re-fetched per-role via `recount` below.
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
  is: (column: string, value: null) => ChangeRequestScopeQuery;
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
    // ⚠ `approval_flow.is.null` in the broadcast arm — a request decided step
    // by step has both approver columns null by design, and is counted by the
    // staged-approval hook instead. See lib/change-requests/sidebar-counts.ts.
    return query
      .eq('status', 'pending')
      .or(
        `primary_approver_id.eq.${userId},secondary_approver_id.eq.${userId},and(primary_approver_id.is.null,secondary_approver_id.is.null,approval_flow.is.null)`
      );
  }
  if (role === 'superadmin') {
    // Legacy rows only, for the same reason — the ladder rows are the staged
    // count's, and counting them here too would double them on the badge.
    return query.eq('status', 'pending').is('approval_flow', null);
  }
  return null;
}

export function useChangeRequestCount(
  role: Role | null,
  userId: string,
  initial: number | null
): number | null {
  const [count, setCount] = useState<number | null>(initial);

  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    if (!role || initial == null) return;

    const supabase = createClient();

    // A role outside the change-request flow has no count to keep live.
    if (
      applyChangeRequestCountScope(
        supabase.from(
          'grade_change_requests'
        ) as unknown as ChangeRequestScopeQuery,
        role,
        userId
      ) === null
    ) {
      return;
    }

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

      const { count: fresh, error } =
        await (scoped as unknown as typeof baseQuery);
      if (error) {
        // Returning null here freezes the badge at its last known value with
        // no signal at all — the count silently stops tracking reality while
        // still looking authoritative. Logged so a stuck badge is findable.
        console.error(
          '[change-requests] live recount failed; badge is now stale:',
          error.message
        );
        return null;
      }
      return fresh ?? null;
    };

    // ⚠ `setAuth` IS NOT OPTIONAL AND ITS FAILURE IS SILENT. A private channel
    // is refused without it, and a refused join surfaces as a badge that simply
    // never moves — not as an error. It is async, hence the cancelled flag: the
    // effect can be torn down before the socket is authenticated, and
    // subscribing after that would leak a channel with no cleanup.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel('sis:grade-change-requests', { config: { private: true } })
        .on('broadcast', { event: 'badge' }, async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId]);

  return count;
}
