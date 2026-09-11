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
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { isEmptyRichText } from '@/lib/rich-text';
import { APPROVAL_NOTE_MAX } from '@/lib/schemas/approval-flows';

type Action = 'approve' | 'reject';

export type ControlledOpenRequest = {
  action: Action;
  nonce: string;
};

export function ChangeRequestDecisionButtons({
  requestId,
  approvalRequestId = null,
  everyoneTally = null,
  controlledOpen,
  onControlledOpenConsumed,
}: {
  requestId: string;
  /**
   * Set for a request decided step by step (migration 144): the decision then
   * goes to the approval engine for this one step, not to the two-approver
   * route. The same dialog either way — what changes is where it posts, what
   * it promises, and how long the note may be.
   */
  approvalRequestId?: string | null;
  /**
   * Set when the step being decided needs everyone on it to approve (migration
   * 145): how many have so far. Unless this person is the last one still to
   * approve, their approval is recorded and the step waits for the rest — so
   * the dialog must not promise that it moves on.
   */
  everyoneTally?: { approved: number; total: number } | null;
  controlledOpen?: ControlledOpenRequest | null;
  onControlledOpenConsumed?: () => void;
}) {
  const staged = approvalRequestId != null;
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>('approve');
  const [note, setNote] = useState('');
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastNonceRef = useRef<string | null>(null);

  const openDialog = useCallback((next: Action) => {
    setAction(next);
    setNote('');
    setOpen(true);
  }, []);

  // Controlled-open: when the parent sets controlledOpen with a fresh
  // nonce, open the dialog and auto-focus per action. Reject focuses the
  // note box because rejectNeedsNote disables the Confirm button until a
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
        // The rich-text box has no focusable element of its own — the
        // editable surface lives inside the wrapper carrying the id.
        document
          .getElementById('decision-note')
          ?.querySelector<HTMLElement>('[contenteditable="true"]')
          ?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, action]);

  // ⚠ On a step-by-step request "empty" is measured the way the engine's schema
  // measures it (`DecideApprovalSchema`): a note box clicked into and left
  // alone stores `<p></p>`, which `.trim()` would call a reason.
  const rejectNeedsNote =
    action === 'reject' &&
    (staged ? isEmptyRichText(note) : note.trim().length === 0);

  const decisionMutation = useMutation({
    mutationFn: (vars: { action: Action; note?: string }) =>
      staged
        ? apiFetch<{ message?: string; outcome?: string }>(
            `/api/approvals/${approvalRequestId}/decide`,
            jsonInit('POST', {
              action: vars.action,
              note: vars.note ? vars.note : undefined,
            })
          )
        : apiFetch<{ message?: string }>(
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
        // The engine says what the decision did — "moved on to the next step"
        // is not the same news as "approved", and `recorded` ("still waiting on
        // the others") is different news again — so its sentence wins when
        // there is one. `recorded` is a success: the approval is saved, and the
        // refresh swaps these buttons for "You approved — waiting on the others".
        success: (data) =>
          (staged ? data?.message : undefined) ??
          (action === 'approve' ? 'Request approved' : 'Request declined'),
        error: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            // Concurrent-decision race: another administrator approved or
            // declined this request before us. Read body.error directly so the
            // fallback matches the original (statusText is not an acceptable
            // description).
            const body = (e.body ?? {}) as { error?: string; outcome?: string };
            // This person approved it already, on a step that needs everyone
            // (a second tab, or a stale screen). Nothing went wrong.
            toast.error(
              body.outcome === 'already_approved'
                ? 'Already approved'
                : 'Already handled',
              {
                description:
                  body.error ??
                  'Another administrator already actioned this request. Refresh to see the latest status.',
              }
            );
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
              {staged
                ? action === 'approve'
                  ? everyoneTally &&
                    everyoneTally.approved < everyoneTally.total - 1
                    ? `Everyone on this step must approve, and ${everyoneTally.approved} of ${everyoneTally.total} have so far. Yours is recorded now, and the request moves on once the others have approved too.`
                    : 'This approves your step. If it is the last step, the registrar can then apply the change on the locked sheet. If not, it moves on to the next person.'
                  : 'The request stops here and the grade stays as it is. The teacher is told, with your note as the reason. This cannot be undone.'
                : action === 'approve'
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
            <RichTextEditor
              id="decision-note"
              value={note}
              onChange={setNote}
              placeholder={
                action === 'reject'
                  ? 'Explain why this request is being declined.'
                  : staged
                    ? 'Optional note for the next person and the registrar.'
                    : 'Optional note to the teacher and registrar.'
              }
              rows={4}
              maxLength={staged ? APPROVAL_NOTE_MAX : 1000}
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
