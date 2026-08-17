'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MidTermPayload } from '@/lib/sis/placement-completion';

// "This student is joining after the year started — which term?"
//
// Renders as the CONTENTS of an already-open dialog, not its own dialog: both
// hosts swap their body to this rather than stacking a second modal, which the
// design system forbids.
//
// It lives here because placement can now happen in two places. HFSE assigns
// classes as step 11 of admission, separately from enrolment at step 10, so
// the prompt fires either from the stage dialog (when a coordinator does both
// at once) or from the assign-section dialog (the normal path).

export function LateEnrolleePrompt({
  payload,
  onDone,
}: {
  payload: MidTermPayload;
  /**
   * Called once the user has chosen or dismissed, so the host can close.
   *
   * The host used to refresh here too. It no longer should: the write happens
   * in this component, so the wait belongs in this component, and both hosts
   * refreshing as well would run the server render twice for one save.
   */
  onDone: () => void;
}) {
  // Default to the joining term the server resolved; mid-term that's the
  // current one, in a break it's the only option there is.
  const [chosenTerm, setChosenTerm] = useState<number | null>(
    payload.termNumber
  );

  const lateMutation = useMutation({
    mutationFn: (vars: { term: number }) =>
      apiFetch(
        `/api/sections/${payload.sectionId}/students/${payload.sectionStudentId}`,
        jsonInit('PATCH', {
          enrollment_status: 'late_enrollee',
          late_enrollee_term_number: vars.term,
        })
      ),
  });

  const run = useWriteAction();
  const [applyingLate, setApplyingLate] = useState(false);

  async function confirm(term: number) {
    setApplyingLate(true);
    const result = await run(() => lateMutation.mutateAsync({ term }), {
      pending: 'Marking as late enrollee…',
      success: `Marked as late enrollee · T${term}`,
      error: () => 'Failed to mark as late enrollee',
      // Closes immediately on success while the toast keeps holding for the
      // refresh. `useRefreshTransition` flushes its waiters on unmount, so
      // closing here cannot strand the toast.
      onResolved: onDone,
    });
    setApplyingLate(false);
    // The old `onSettled: onDone` closed on failure too — the host offers no
    // retry, so leaving it open would strand the user.
    if (result === undefined) onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-serif text-lg font-semibold">
          Joining after the year started
        </DialogTitle>
        <DialogDescription>
          {payload.activeTermNumber !== null
            ? `T${payload.activeTermNumber} is already under way, so this is a late enrollee. Choose which term they join — this skips assessments from before they arrived.`
            : `The school year has already started, so this is a late enrollee. They'll join the next term, ${payload.termLabel}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setChosenTerm(payload.termNumber)}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
            chosenTerm === payload.termNumber
              ? 'border-primary bg-accent text-foreground'
              : 'border-hairline text-foreground hover:bg-muted/50'
          }`}
        >
          {payload.activeTermNumber !== null
            ? `Join ${payload.termLabel} now`
            : `Join ${payload.termLabel}`}
          {payload.daysLeftInActiveTerm !== null &&
            payload.daysLeftInActiveTerm < 14 && (
              <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-brand-amber">
                ends in {payload.daysLeftInActiveTerm}d
              </span>
            )}
        </button>
        {payload.canDeferToNext && payload.nextTermNumber !== null && (
          <button
            type="button"
            onClick={() => setChosenTerm(payload.nextTermNumber!)}
            className={`flex w-full items-center rounded-lg border px-3 py-2 text-left text-sm ${
              chosenTerm === payload.nextTermNumber
                ? 'border-primary bg-accent text-foreground'
                : 'border-hairline text-foreground hover:bg-muted/50'
            }`}
          >
            Start in T{payload.nextTermNumber} instead
          </button>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={applyingLate}
          onClick={onDone}
        >
          Not a late enrollee
        </Button>
        <Button
          type="button"
          size="sm"
          loading={applyingLate}
          loadingText="Saving…"
          disabled={chosenTerm === null}
          onClick={() => {
            if (chosenTerm === null) return;
            void confirm(chosenTerm);
          }}
        >
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}
