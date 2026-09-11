'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';

import { APPROVAL_OUTCOME_MESSAGES } from '@/lib/approvals/state-machine';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';

export function TodoCrActions({
  requestId,
  approvalRequestId = null,
}: {
  /** The grade change request — what the reject link deep-links to. */
  requestId: string;
  /**
   * Set when the request is decided step by step (migration 144). Approve then
   * decides THIS person's step on the approval engine rather than going
   * through the two-approver route, which refuses such a request.
   */
  approvalRequestId?: string | null;
}) {
  // Approve fires immediately, no dialog — neither path needs a note to
  // approve (KD #123's email one-click Approve behaves the same way).
  // Reject stays a Link, not a mutation — rejecting requires a reason
  // (KD #88), which doesn't fit a one-line to-do row.
  const approveMutation = useMutation({
    mutationFn: () =>
      approvalRequestId
        ? apiFetch<{ message?: string; outcome?: string }>(
            `/api/approvals/${approvalRequestId}/decide`,
            jsonInit('POST', { action: 'approve' })
          )
        : apiFetch<{ message?: string; outcome?: string }>(
            `/api/change-requests/${requestId}`,
            jsonInit('PATCH', { action: 'approve' })
          ),
    retry: 0,
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  // The row this button sits in disappears once the to-do list re-renders, so
  // holding the toast until then is what stops it reappearing under a
  // "approved" message.
  async function approve() {
    setBusy(true);
    await run(() => approveMutation.mutateAsync(), {
      pending: 'Approving change request…',
      // On a step-by-step request the engine says what the approval did —
      // "sent on to the next step" is different news from "approved".
      //
      // ⚠ `recorded` IS A SUCCESS, NOT A HALF-FAILURE. On a step that needs
      // everyone, this approval is saved and the step waits for the others.
      // The engine's own sentence says exactly that; "Change request approved"
      // would claim a decision that has not been made yet.
      success: (data) =>
        (approvalRequestId
          ? (data?.message ??
            (data?.outcome === 'recorded'
              ? APPROVAL_OUTCOME_MESSAGES.recorded
              : undefined))
          : undefined) ?? 'Change request approved',
      error: (e) => (e instanceof ApiError ? e.message : 'Failed to approve'),
    });
    setBusy(false);
  }

  return (
    <div className="flex shrink-0 gap-1.5">
      <Button
        variant="success"
        size="sm"
        onClick={() => void approve()}
        loading={busy}
        loadingText="Approving…"
      >
        <Check /> Approve
      </Button>
      <Button variant="destructive" size="sm" asChild>
        <Link href={`/markbook/change-requests?req=${requestId}&action=reject`}>
          <X /> Reject
        </Link>
      </Button>
    </div>
  );
}
