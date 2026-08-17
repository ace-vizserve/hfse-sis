'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, ApiError, jsonInit } from '@/lib/query/fetcher';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type Props = {
  requestId: string;
};

// Undo a rejection within the 2-hour window. The PATCH endpoint enforces:
//   - only the rejecting approver can undo
//   - row must still be in 'rejected' status
//   - within 2 hours of primary_reviewed_at
// Server-side errors come back as plain-English text (no field names);
// the client surfaces them verbatim via toast.error.
export function UndoRejectionButton({ requestId }: Props) {
  const [open, setOpen] = React.useState(false);

  const undoMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/change-requests/${encodeURIComponent(requestId)}`,
        jsonInit('PATCH', { action: 'undo_rejection' })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = React.useState(false);

  async function handleUndo() {
    setBusy(true);
    await run(() => undoMutation.mutateAsync(), {
      pending: 'Undoing the decline…',
      success: 'Decline undone — the request is back to Awaiting Review.',
      // The expected validation failures (400 wrong-status, 403
      // not-the-rejecting-approver, 409 outside-the-2h-window) are definitive
      // answers, so the route's plain-English `error` is shown alone; anything
      // else keeps the "try again or contact an administrator" description.
      // That second line needs toast options a plain message can't carry, so
      // it is raised here and `null` returned.
      error: (e) => {
        if (e instanceof ApiError) {
          const expected =
            e.status === 400 || e.status === 403 || e.status === 409;
          const body = (e.body ?? {}) as { error?: string };
          toast.error(body.error ?? 'Could not undo the decline.', {
            description: expected
              ? undefined
              : 'Please try again or contact a system administrator.',
          });
          return null;
        }
        return e instanceof Error ? e.message : 'Could not undo the decline.';
      },
      onResolved: () => setOpen(false),
    });
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo decline
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Undo this decline?</DialogTitle>
          <DialogDescription>
            The request will go back to Awaiting Review. The teacher will see
            the change. You have a 2-hour window from when you declined.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void handleUndo()}
            disabled={busy}
          >
            {busy ? 'Undoing…' : 'Undo decline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
