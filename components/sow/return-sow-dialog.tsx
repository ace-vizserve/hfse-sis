'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRefreshTransition } from '@/lib/hooks/use-refresh-transition';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { isEmptyRichText } from '@/lib/rich-text';
import { APPROVAL_NOTE_MAX } from '@/lib/schemas/approval-flows';

// Return a scheme of work to its teacher (board 5's return box). A dialog, not
// a drawer: it is one required note and one optional week (09a, 1–4 fields).
//
// The note is the engine's decision note, so it goes to the shared decide
// route with `action: 'reject'`; the SOW handler pins it to the week. Measured
// the way that route measures it — `isEmptyRichText` for "empty", the editor's
// own counter (prose length) for the 300 limit.

const NO_WEEK = 'none';

export function ReturnSowDialog({
  open,
  onOpenChange,
  requestId,
  weeks,
  firstStepLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
  weeks: { weekNumber: number; label: string }[];
  /** The step a resend starts at, for the description. */
  firstStepLabel: string | null;
}) {
  const run = useWriteAction();
  const awaitRefresh = useRefreshTransition();
  const [note, setNote] = useState('');
  const [week, setWeek] = useState<string>(NO_WEEK);
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    if (!next) {
      setNote('');
      setWeek(NO_WEEK);
    }
    onOpenChange(next);
  }

  async function submit() {
    setBusy(true);
    await run(
      () =>
        apiFetch<{ message?: string }>(
          `/api/approvals/${requestId}/decide`,
          jsonInit('POST', {
            action: 'reject',
            note: note.trim(),
            ...(week !== NO_WEEK ? { weekNumber: Number(week) } : {}),
          })
        ),
      {
        pending: 'Returning…',
        success: (r) => r?.message ?? 'Returned to the teacher.',
        error: (e) => {
          // Somebody else on the step decided it first. Their decision
          // stands; say so in the route's words and show the page as it is.
          if (e instanceof ApiError && e.status === 409) {
            const body = (e.body ?? {}) as { error?: string };
            toast.error('Already decided', {
              description:
                body.error ??
                'Someone on this step decided it a moment ago. The page now shows where it is.',
            });
            reset(false);
            void awaitRefresh();
            return null;
          }
          return e instanceof Error ? e.message : 'Could not return it.';
        },
        onResolved: () => reset(false),
      }
    );
    setBusy(false);
  }

  const start = firstStepLabel ? `the ${firstStepLabel}` : 'the first step';

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Return to teacher
          </DialogTitle>
          <DialogDescription>
            It goes back to the teacher with your note. When they send it again,
            it starts over from {start}.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="sow-return-note">
            Return to the teacher: what needs changing?
          </FieldLabel>
          <RichTextEditor
            id="sow-return-note"
            value={note}
            onChange={setNote}
            placeholder="e.g. Week 6 needs the Ch 4.3 practical under Activities."
            rows={4}
            maxLength={APPROVAL_NOTE_MAX}
          />
        </Field>
        {weeks.length > 0 && (
          <Field>
            <FieldLabel htmlFor="sow-return-week">
              Which week is it about?
            </FieldLabel>
            <Select value={week} onValueChange={setWeek}>
              <SelectTrigger id="sow-return-week" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_WEEK}>No particular week</SelectItem>
                {weeks.map((w) => (
                  <SelectItem key={w.weekNumber} value={String(w.weekNumber)}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              The teacher sees your note pinned to that week.
            </FieldDescription>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            loading={busy}
            loadingText="Returning…"
            disabled={isEmptyRichText(note)}
          >
            Return SOW
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
