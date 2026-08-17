'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

import { useRefreshTransition } from '@/lib/hooks/use-refresh-transition';
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
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

type Action = 'approve' | 'reject';

export type ControlledOpenRequest = {
  action: Action;
  nonce: string;
};

export function ChangeRequestDecisionButtons({
  requestId,
  controlledOpen,
  onControlledOpenConsumed,
}: {
  requestId: string;
  controlledOpen?: ControlledOpenRequest | null;
  onControlledOpenConsumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>('approve');
  const [note, setNote] = useState('');
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastNonceRef = useRef<string | null>(null);

  const openDialog = useCallback((next: Action) => {
    setAction(next);
    setNote('');
    setOpen(true);
  }, []);

  // Controlled-open: when the parent sets controlledOpen with a fresh
  // nonce, open the dialog and auto-focus per action. Reject focuses the
  // textarea because rejectNeedsNote disables the Confirm button until a
  // note is typed; auto-focusing Confirm would land on a disabled button.
  useEffect(() => {
    if (!controlledOpen) return;
    if (lastNonceRef.current === controlledOpen.nonce) return;
    lastNonceRef.current = controlledOpen.nonce;
    openDialog(controlledOpen.action);
    onControlledOpenConsumed?.();
  }, [controlledOpen, onControlledOpenConsumed, openDialog]);

  // After the dialog opens, focus the appropriate control on the next
  // tick (DialogContent mounts asynchronously inside a portal).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (action === 'reject') {
        noteRef.current?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, action]);

  const rejectNeedsNote = action === 'reject' && note.trim().length === 0;

  const decisionMutation = useMutation({
    mutationFn: (vars: { action: Action; note?: string }) =>
      apiFetch(
        `/api/change-requests/${requestId}`,
        jsonInit('PATCH', {
          action: vars.action,
          decision_note: vars.note ? vars.note : undefined,
        })
      ),
  });

  const run = useWriteAction();
  // The 409 below is the one branch that needs a refresh on a FAILED write —
  // `useWriteAction` only refreshes on success, correctly, because a failed
  // write changed nothing. Here the write failed precisely BECAUSE somebody
  // else changed the row, so the stale list is exactly what has to be re-read.
  const awaitRefresh = useRefreshTransition();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = note.trim();
    setBusy(true);
    await run(
      () =>
        decisionMutation.mutateAsync({
          action,
          note: trimmed ? trimmed : undefined,
        }),
      {
        pending: action === 'approve' ? 'Approving…' : 'Declining…',
        success: action === 'approve' ? 'Request approved' : 'Request declined',
        error: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            // Concurrent-decision race: another administrator approved or
            // declined this request before us. Read body.error directly so the
            // fallback matches the original (statusText is not an acceptable
            // description).
            const body = (e.body ?? {}) as { error?: string };
            toast.error('Already handled', {
              description:
                body.error ??
                'Another administrator already actioned this request. Refresh to see the latest status.',
            });
            setOpen(false);
            void awaitRefresh();
            return null;
          }
          return e instanceof Error ? e.message : 'Failed to submit decision';
        },
        onResolved: () => setOpen(false),
      }
    );
    setBusy(false);
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => openDialog('reject')}
        >
          <X className="size-3" />
          Decline
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => openDialog('approve')}
        >
          <Check className="size-3" />
          Approve
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {action === 'approve'
                ? 'Approve this request?'
                : 'Decline this request?'}
            </DialogTitle>
            <DialogDescription>
              {action === 'approve'
                ? 'The registrar will be notified and can apply the change on the locked sheet. The teacher is also notified.'
                : 'The teacher will be notified by email. If you change your mind, you have a 2-hour window to undo the decline from the request queue.'}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="decision-note">
              Decision note{' '}
              <span className="text-muted-foreground">
                ({action === 'reject' ? 'required' : 'optional'})
              </span>
            </FieldLabel>
            <Textarea
              id="decision-note"
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                action === 'reject'
                  ? 'Explain why this request is being declined.'
                  : 'Optional note to the teacher and registrar.'
              }
              rows={4}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              onClick={() => void submit()}
              loading={busy}
              loadingText={action === 'approve' ? 'Approving…' : 'Declining…'}
              disabled={rejectNeedsNote}
              className={
                action === 'reject'
                  ? 'bg-destructive text-white hover:bg-destructive/90'
                  : ''
              }
            >
              {action === 'approve' ? 'Approve' : 'Decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
