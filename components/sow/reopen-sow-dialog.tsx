'use client';

import { useState } from 'react';

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
import { Input } from '@/components/ui/input';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// Reopen an approved scheme of work (the office only). One short reason, so a
// dialog; a plain input because the reason is stored and shown as plain text
// (`ReopenSowSchema`, and the "Reopened by …" line on the draft).

const MAX = 300;

export function ReopenSowDialog({
  open,
  onOpenChange,
  sowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sowId: string;
}) {
  const run = useWriteAction();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    if (!next) setNote('');
    onOpenChange(next);
  }

  async function submit() {
    setBusy(true);
    await run(
      () =>
        apiFetch(
          `/api/sow/${sowId}/reopen`,
          jsonInit('POST', { note: note.trim() })
        ),
      {
        pending: 'Reopening…',
        success: 'Reopened. Its teachers can change it now.',
        onResolved: () => reset(false),
      }
    );
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">
            Reopen this scheme of work?
          </DialogTitle>
          <DialogDescription>
            It goes back to a draft so its teachers can change it, then they
            send it for review again. The approved version stays in use until
            the new one is approved.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="sow-reopen-note">Why is it reopened?</FieldLabel>
          <Input
            id="sow-reopen-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX}
            placeholder="e.g. The term exam moved to Week 9."
            aria-describedby="sow-reopen-note-count"
          />
          {/* The same counter the Return dialog's editor shows. */}
          <p
            id="sow-reopen-note-count"
            className="mt-1 text-right font-mono text-[10px] tracking-wider tabular-nums text-muted-foreground"
          >
            {note.length} / {MAX}
          </p>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            loadingText="Reopening…"
            disabled={note.trim().length === 0}
          >
            Reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
