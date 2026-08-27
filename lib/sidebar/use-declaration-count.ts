'use client';

import { useEffect, useId, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/schemas/approval-flows';

// Live count of "approval steps waiting for THIS person to decide right now".
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
// small table is both correct and cheaper than a wrong filter.

export function useDeclarationCount(
  userId: string,
  initial: number | null
): number | null {
  const instanceId = useId();
  const [count, setCount] = useState<number | null>(initial);

  useEffect(() => {
    setCount(initial);
  }, [initial]);

  useEffect(() => {
    // `null` means the server did not render a count for this person — there
    // is nothing to keep up to date.
    if (initial == null || !userId) return;

    const supabase = createClient();

    const recount = async (): Promise<number | null> => {
      const { count: fresh, error } = await supabase
        .from('approval_request_stages')
        .select('id, approval_requests!inner(flow, status)', {
          count: 'exact',
          head: true,
        })
        .eq('status', 'pending')
        .eq('approval_requests.flow', DECLARATION_APPROVAL_FLOW)
        .eq('approval_requests.status', 'pending');

      if (error) {
        // Returning null freezes the badge at its last known value with no
        // signal at all — it stops tracking reality while still looking
        // authoritative. Logged so a stuck badge is findable.
        console.error(
          '[declarations] live recount failed; badge is now stale:',
          error.message
        );
        return null;
      }
      return fresh ?? null;
    };

    const channel = supabase
      .channel(`declaration-count-${instanceId}`)
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, instanceId]);

  return count;
}
