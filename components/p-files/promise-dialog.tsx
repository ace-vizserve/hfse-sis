'use client';

import { useMutation } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const DEFAULT_HORIZON_DAYS = 14;
const MAX_HORIZON_DAYS = 90;

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type PromiseDialogProps = {
  enroleeNumber: string;
  slotKey: string;
  label: string;
  trigger?: React.ReactNode;
  /**
   * Discriminator forwarded to the API so the route picks the right
   * audit action + scope gate. Defaults to 'p-files' for back-compat
   * with existing renewal-lifecycle callers.
   */
  module?: 'p-files' | 'admissions';
};

export function PromiseDialog({
  enroleeNumber,
  slotKey,
  label,
  trigger,
  module = 'p-files',
}: PromiseDialogProps) {
  const [open, setOpen] = useState(false);
  const [promisedUntil, setPromisedUntil] = useState<string>(
    isoDateOffset(DEFAULT_HORIZON_DAYS)
  );
  const [note, setNote] = useState('');

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPromisedUntil(isoDateOffset(DEFAULT_HORIZON_DAYS));
      setNote('');
    }
  }

  // The route's bespoke `body.error` surfaces via ApiError.message, preserving
  // the 'Failed to record promise' fallback.
  const promiseMutation = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/p-files/${encodeURIComponent(enroleeNumber)}/promise`,
        jsonInit('PATCH', {
          slotKey,
          promisedUntil,
          note: note.trim() || undefined,
          module,
        })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!promisedUntil) {
      toast.error('Pick a promise date');
      return;
    }
    setBusy(true);
    await run(() => promiseMutation.mutateAsync(), {
      pending: 'Recording promise…',
      success: `Promise recorded — slot marked as 'To follow' through ${promisedUntil}`,
      error: (e) =>
        e instanceof Error ? e.message : 'Failed to record promise',
      onResolved: () => setOpen(false),
    });
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <CalendarClock className="size-3" />
            Mark as promised
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">
            Mark as promised
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            Record that the parent has committed to re-uploading{' '}
            <strong>{label}</strong>. The slot will be marked as{' '}
            <strong>To follow</strong> until the promised date — it surfaces in
            the dashboard&apos;s &quot;promised&quot; bucket so you can re-check
            on the day.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label
              htmlFor="promisedUntil"
              className="mb-1.5 block text-xs font-semibold"
            >
              Promised by
            </Label>
            <DatePicker
              id="promisedUntil"
              value={promisedUntil}
              onChange={setPromisedUntil}
              placeholder="Pick a date"
              allowClear={false}
            />
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Default: {DEFAULT_HORIZON_DAYS} days from today · Max horizon{' '}
              {MAX_HORIZON_DAYS} days
            </p>
          </div>
          <div>
            <Label
              htmlFor="promiseNote"
              className="mb-1.5 block text-xs font-semibold"
            >
              Note (optional)
            </Label>
            <Textarea
              id="promiseNote"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Mother confirmed via WhatsApp she's renewing the passport this week"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            loading={busy}
            loadingText="Recording…"
            disabled={!promisedUntil}
          >
            {!busy && <CalendarClock className="size-4" />}
            Record promise
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
