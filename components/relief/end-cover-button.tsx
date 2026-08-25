'use client';

import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
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
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// End a whole absence at once — every class that teacher holds goes back to
// them, today, whatever the end date said.
//
// ⚠ IT DOES NOT BACKDATE AN END DATE, it clears the cover outright. "She is
// back early" means the substitute should lose access now, not on the day the
// booking happened to name.
//
// Confirmed rather than one-click, because it can affect several classes at
// once and there is no undo beyond re-booking it.

export function EndCoverButton({
  coveredTeacherId,
  coveredTeacherName,
  reliefTeacherName,
  classCount,
  scheduled,
}: {
  coveredTeacherId: string;
  coveredTeacherName: string;
  reliefTeacherName: string;
  classCount: number;
  /** Not started yet — so this cancels a booking rather than ending cover. */
  scheduled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(
        '/api/relief/book',
        jsonInit('POST', {
          covered_teacher_user_id: coveredTeacherId,
          // null ends it — the same meaning `null` carries on the per-class
          // PATCH.
          relief_teacher_user_id: null,
        })
      ),
  });

  const classes = `${classCount} ${classCount === 1 ? 'class' : 'classes'}`;

  async function end() {
    setBusy(true);
    await run(() => mutation.mutateAsync(), {
      pending: scheduled ? 'Cancelling…' : 'Ending cover…',
      success: scheduled
        ? `That booking is cancelled. ${reliefTeacherName} will not be covering.`
        : `${coveredTeacherName} has their ${classes} back.`,
      error: (e) =>
        e instanceof Error ? e.message : 'That change could not be saved.',
      onResolved: () => setOpen(false),
    });
    setBusy(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            scheduled
              ? `Cancel the cover booked for ${coveredTeacherName}`
              : `End ${reliefTeacherName} covering for ${coveredTeacherName}`
          }
          title={scheduled ? 'Cancel this booking' : 'End this cover'}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif">
            {scheduled
              ? `Cancel this booking?`
              : `${coveredTeacherName} is back?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {scheduled
              ? `${reliefTeacherName} will not cover ${coveredTeacherName}'s ${classes}. Nothing changes for anyone today — the cover had not started.`
              : `${reliefTeacherName} loses access to all ${classes} straight away, and ${coveredTeacherName} has them back. Anything already marked stays as it is.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog up while the write runs, so a slow save cannot
              // look like nothing happened.
              e.preventDefault();
              void end();
            }}
            disabled={busy}
          >
            {busy
              ? 'Saving…'
              : scheduled
                ? 'Cancel the booking'
                : 'End the cover'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
