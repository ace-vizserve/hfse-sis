'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';

export function TodoCrActions({ requestId }: { requestId: string }) {
  // Approve fires immediately, no dialog — decide.ts's approve path needs
  // no note (KD #123's email one-click Approve behaves the same way).
  // Reject stays a Link, not a mutation — rejecting requires a reason
  // (KD #88), which doesn't fit a one-line to-do row.
  const approveMutation = useMutation({
    mutationFn: () =>
      apiFetch(
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
      success: 'Change request approved',
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
