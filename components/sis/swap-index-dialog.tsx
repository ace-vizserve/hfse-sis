'use client';

// Swap two students' class numbers.
//
// The counterpart to "Generate index", which is a derivation, not an edit: it
// recomputes the whole roster from names, start dates and the numbers kept
// aside for students who left, and it is deterministic — so when its answer is
// wrong, running it again returns the same wrong answer. This is the other
// lever: fix two students and leave everyone else alone.
//
// A swap is a trade, never a free-typed number, and that is the whole safety
// argument: the set of numbers the class holds is identical before and after,
// so it can leave no gap, make no duplicate, and bring no retired number back.
// Withdrawn students are therefore absent from the picker — their number is
// kept aside permanently (migration 147, KD #85/#136).
//
// Deliberately NOT carrying the mid-year warning that "Generate index" shows.
// That one renumbers the whole class and cannot be undone from the screen; this
// one moves two numbers the user has just read on screen, and swapping the same
// pair again puts them back. A warning here would be noise.

import * as React from 'react';
import { ArrowDownUp, Check } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export type SwapCandidateRow = {
  enrolmentId: string;
  indexNumber: number;
  studentName: string;
};

export type SwapIndexDialogProps = {
  sectionId: string;
  /** The student the swap was opened from. */
  subject: SwapCandidateRow;
  /** Everyone else on the roster who can trade — numbered and not withdrawn. */
  candidates: SwapCandidateRow[];
  trigger: React.ReactNode;
};

/** One side of the trade: who, the number they hold, the number they get. */
function ExchangeLine({
  name,
  from,
  to,
}: {
  name: string;
  from: number;
  to: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {name}
      </span>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          #{from}
        </span>
        <span className="text-xs text-hairline-strong">→</span>
        <span className="font-serif text-lg font-semibold leading-none tabular-nums text-foreground">
          #{to}
        </span>
      </span>
    </div>
  );
}

export function SwapIndexDialog({
  sectionId,
  subject,
  candidates,
  trigger,
}: SwapIndexDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [partnerId, setPartnerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) setPartnerId(null);
  }, [open]);

  // Ordered by the number itself, not by name: the admin is looking for "who
  // currently holds 4", because the number is what they are correcting.
  const sorted = React.useMemo(
    () => [...candidates].sort((a, b) => a.indexNumber - b.indexNumber),
    [candidates]
  );
  const partner = sorted.find((c) => c.enrolmentId === partnerId) ?? null;

  const swapMutation = useMutation({
    mutationFn: (otherId: string) =>
      apiFetch(
        `/api/sections/${sectionId}/swap-index`,
        jsonInit('POST', {
          enrolment_a: subject.enrolmentId,
          enrolment_b: otherId,
        })
      ),
  });

  const run = useWriteAction();
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    if (!partner) return;
    setSubmitting(true);
    await run(() => swapMutation.mutateAsync(partner.enrolmentId), {
      pending: 'Swapping numbers…',
      success: `${subject.studentName} is now #${partner.indexNumber}, ${partner.studentName} is now #${subject.indexNumber}.`,
      error: (err) => {
        if (err instanceof ApiError) {
          const serverError =
            err.body && typeof err.body === 'object'
              ? (err.body as { error?: string }).error
              : undefined;
          return serverError ?? `Could not swap the numbers (${err.status})`;
        }
        return err instanceof Error
          ? err.message
          : 'Could not swap the numbers';
      },
      onResolved: () => setOpen(false),
    });
    setSubmitting(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <ArrowDownUp className="size-4 text-brand-indigo" />
            Swap {subject.studentName}&rsquo;s number
          </DialogTitle>
          <DialogDescription>
            Currently{' '}
            <strong className="font-mono tabular-nums">
              #{subject.indexNumber}
            </strong>
            . Pick who to trade with — only these two numbers change. Everyone
            else keeps theirs, and both students keep all their marks and
            attendance.
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            There is no one else on this class list to trade numbers with.
          </p>
        ) : (
          <Command className="rounded-lg border border-border">
            <CommandInput placeholder="Search by name or number…" />
            <CommandList className="max-h-56">
              <CommandEmpty>No student matches.</CommandEmpty>
              {sorted.map((c) => (
                <CommandItem
                  key={c.enrolmentId}
                  // cmdk filters on this string, so the number has to be in it
                  // — searching "12" is the fastest way to find who holds 12.
                  value={`${c.indexNumber} ${c.studentName}`}
                  onSelect={() => setPartnerId(c.enrolmentId)}
                  // The chosen row is marked with a tick, not a background.
                  // cmdk paints its own keyboard/hover highlight with bg-accent,
                  // so a chosen-state built from the same wash would be
                  // indistinguishable from the row the cursor happens to be on.
                  className={
                    partnerId === c.enrolmentId
                      ? 'border border-brand-indigo'
                      : 'border border-transparent'
                  }
                >
                  <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    #{c.indexNumber}
                  </span>
                  <span className="truncate text-foreground">
                    {c.studentName}
                  </span>
                  {partnerId === c.enrolmentId && (
                    <Check className="ml-auto size-3.5 shrink-0 text-brand-indigo" />
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        )}

        {partner && (
          <div className="space-y-2 rounded-lg border border-brand-indigo-soft bg-accent p-4">
            <ExchangeLine
              name={subject.studentName}
              from={subject.indexNumber}
              to={partner.indexNumber}
            />
            <ExchangeLine
              name={partner.studentName}
              from={partner.indexNumber}
              to={subject.indexNumber}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            loading={submitting}
            loadingText="Swapping…"
            disabled={!partner}
          >
            Swap numbers
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
