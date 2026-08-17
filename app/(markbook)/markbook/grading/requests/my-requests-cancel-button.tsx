'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function MyRequestsCancelButton({ requestId }: { requestId: string }) {
  // ApiError.message already resolves to the body's `error` field, so the
  // original `body.error ?? 'failed to cancel'` copy is preserved via
  // e.message; the generic fallback covers non-ApiError failures.
  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${requestId}`,
        jsonInit('PATCH', { action: 'cancel' })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    await run(() => cancelMutation.mutateAsync(), {
      pending: 'Cancelling request…',
      success: 'Request cancelled',
      error: (e) => (e instanceof Error ? e.message : 'Failed to cancel'),
    });
    setBusy(false);
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
        >
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
          <AlertDialogDescription>
            This will withdraw the request from your school admin&apos;s review
            queue. You can file a new one if you change your mind.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep request</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void cancel()}
            disabled={busy}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {busy ? 'Cancelling…' : 'Cancel request'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
