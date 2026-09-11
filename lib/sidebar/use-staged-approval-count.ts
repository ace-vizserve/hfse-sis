'use client';

import { useEffect, useId, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

// Live count of "approval steps waiting for THIS person to decide right now",
// across whichever ordered-approval flows (KD #196) the caller names.
//
// Deliberately shaped like `use-change-request-count.ts`: the same
// SSR-value-then-subscribe pattern, the same per-instance channel via `useId`
// so the sidebar badge and the header bell can each subscribe without a shared
// provider, and the same "log it and freeze" on a failed recount.
//
// ⚠ ONE REAL DIFFERENCE: THERE IS NO PER-ROLE SCOPE SQL HERE, AND THERE MUST
// NOT BE. The change-request hook re-implements its scope predicate in the
// browser — which is why that predicate now exists in six places, three of
// which disagree about what a superadmin sees. This one asks for every pending
// step and lets the DATABASE decide which rows the caller may see: migration
// 129's policy admits a row only when the reader is named in its pool or
// advises its class, which is precisely "can act on it". The scope lives in
// one place, in SQL, and cannot drift from the queue it is counting.
//
// ⚠ THE SUBSCRIPTION CARRIES NO FILTER, also on purpose. `postgres_changes`
// filters are single-column comparisons, and the predicate that matters here
// is "am I in this row's pool" — an array membership test it cannot express.
// RLS already restricts what is delivered, so an unfiltered subscription on a
// small table is both correct and cheaper than a wrong filter. It also means
// the channel does not care WHICH flows are counted: every flow's steps live
// in the same table, and the flow scope is applied by the recount.
//
// The one filtered listener is on `approval_request_stage_decisions` (migration
// 145), where "mine" IS a single column: `user_id`.

export function useStagedApprovalCount(
  userId: string,
  flows: readonly string[],
  initial: number | null
): number | null {
  const instanceId = useId();
  const [count, setCount] = useState<number | null>(initial);

  // A caller passing an inline array literal hands this a new reference every
  // render. Keying the subscription on the CONTENT keeps that from tearing the
  // channel down and rebuilding it on every render.
  const flowsKey = [...flows].sort().join('|');

  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    // `null` means the server did not render a count for this person — there
    // is nothing to keep up to date.
    if (initial == null || !userId) return;

    const flowList = flowsKey.length > 0 ? flowsKey.split('|') : [];
    // No flows means nothing to count, and `in.()` is not valid PostgREST.
    if (flowList.length === 0) return;

    const supabase = createClient();

    const recount = async (): Promise<number | null> => {
      const [pending, decided] = await Promise.all([
        countPendingSteps(),
        countStepsIAlreadyDecided(),
      ]);
      if (pending == null || decided == null) return null;
      // Both reads see exactly the steps RLS lets this person see, with the
      // same filters, so the difference cannot count a step the first did not.
      return Math.max(0, pending - decided);
    };

    const countPendingSteps = async (): Promise<number | null> => {
      const { count: fresh, error } = await supabase
        .from('approval_request_stages')
        .select('id, approval_requests!inner(flow, status)', {
          count: 'exact',
          head: true,
        })
        .eq('status', 'pending')
        .in('approval_requests.flow', flowList)
        .eq('approval_requests.status', 'pending')
        // ⚠ NOT THE READER'S OWN FILINGS. RLS admits a step whose class the
        // reader advises, and a teacher filing a grade change for their own
        // advisory class is on exactly that step — but nobody approves their
        // own request, and the server count (`listInboxStagesAcrossFlows`)
        // does not count it. The `is.null` arm is load-bearing: `neq` alone is
        // never true of a null filer, and would silently drop those rows.
        .or(`filed_by.is.null,filed_by.neq.${userId}`, {
          referencedTable: 'approval_requests',
        });

      if (error) {
        // Returning null freezes the badge at its last known value with no
        // signal at all — it stops tracking reality while still looking
        // authoritative. Logged so a stuck badge is findable.
        console.error(
          '[approvals] live recount failed; badge is now stale:',
          flowList.join(', '),
          error.message
        );
        return null;
      }
      return fresh ?? null;
    };

    // ⚠ A STEP I HAVE ALREADY DECIDED IS NOT WAITING FOR ME (migration 145).
    // On a step that needs everyone it stays pending after my yes, and RLS
    // still admits it — I am in its pool — so the count above includes it.
    // Migration 145's policy lets me read my own decision rows and nobody
    // else's; the embed narrows them to the same pending steps, on the same
    // flows, of the same open requests.
    const countStepsIAlreadyDecided = async (): Promise<number | null> => {
      const { count: fresh, error } = await supabase
        .from('approval_request_stage_decisions')
        .select(
          'id, approval_request_stages!inner(status, approval_requests!inner(flow, status))',
          { count: 'exact', head: true }
        )
        .eq('user_id', userId)
        .eq('approval_request_stages.status', 'pending')
        .in('approval_request_stages.approval_requests.flow', flowList)
        .eq('approval_request_stages.approval_requests.status', 'pending');

      if (error) {
        console.error(
          '[approvals] live recount of decided steps failed; badge is now stale:',
          flowList.join(', '),
          error.message
        );
        return null;
      }
      return fresh ?? 0;
    };

    const channel = supabase
      .channel(`staged-approval-count-${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'approval_request_stages',
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
          table: 'approval_request_stages',
        },
        async () => {
          const fresh = await recount();
          if (fresh != null) setCount(fresh);
        }
      )
      // A yes on a step that needs everyone changes no step row, so the two
      // listeners above hear nothing. My own decision rows do change.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'approval_request_stage_decisions',
          filter: `user_id=eq.${userId}`,
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
  }, [userId, instanceId, flowsKey]);

  return count;
}
