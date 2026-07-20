'use client';

import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { MAX_ACTIVE_PER_SECTION } from '@/lib/sis/class-assignment';
import { Badge } from '@/components/ui/badge';
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

export type SiblingSection = {
  id: string;
  name: string;
  activeCount: number;
  isAtCapacity: boolean;
};

export type SectionTransferDialogProps = {
  enroleeNumber: string;
  studentName: string;
  fromSectionName: string;
  ayCode: string;
  siblings: SiblingSection[];
  trigger?: React.ReactNode;
};

export function SectionTransferDialog({
  enroleeNumber,
  studentName,
  fromSectionName,
  ayCode,
  siblings,
  trigger,
}: SectionTransferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  const transferMutation = useMutation({
    mutationFn: (targetSectionId: string) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/transfer-section?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('POST', { targetSectionId })
      ),
    onSuccess: (_data, targetSectionId) => {
      const target = siblings.find((s) => s.id === targetSectionId);
      toast.success(
        `Moved ${studentName} from ${fromSectionName} to ${target?.name ?? 'target'}.`
      );
      setOpen(false);
      router.refresh();
    },
    onError: (err) => {
      // Preserve the two-tier error copy: prefer the server's `error`, else a
      // status-coded fallback; network errors → generic 'Transfer failed'.
      if (err instanceof ApiError) {
        const serverError =
          err.body && typeof err.body === 'object'
            ? (err.body as { error?: string }).error
            : undefined;
        toast.error(serverError ?? `Transfer failed (${err.status})`);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Transfer failed');
    },
  });
  const submitting = transferMutation.isPending;

  function submit() {
    if (!selectedId) return;
    transferMutation.mutate(selectedId);
  }

  // Sort siblings by capacity (most-available first), then alphabetically.
  const sorted = React.useMemo(
    () =>
      [...siblings].sort(
        (a, b) =>
          Number(a.isAtCapacity) - Number(b.isAtCapacity) ||
          a.activeCount - b.activeCount ||
          a.name.localeCompare(b.name)
      ),
    [siblings]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <ArrowRightLeft className="size-4 text-brand-indigo" />
            Move {studentName}
          </DialogTitle>
          <DialogDescription>
            Currently in <strong>{fromSectionName}</strong>. Pick a target
            section at the same level. The transfer is atomic — the old
            enrolment is marked withdrawn and a new active row is created in one
            step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {sorted.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No other sections at this level for {ayCode}.
            </p>
          ) : (
            sorted.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.isAtCapacity || submitting}
                onClick={() => setSelectedId(s.id)}
                aria-pressed={selectedId === s.id}
                className={
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ' +
                  (selectedId === s.id
                    ? 'border-brand-indigo bg-accent'
                    : s.isAtCapacity
                      ? 'cursor-not-allowed border-border/60 bg-muted/30 opacity-60'
                      : 'border-border hover:border-brand-indigo-soft hover:bg-accent/40')
                }
              >
                <span className="font-medium text-foreground">{s.name}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {s.activeCount}/{MAX_ACTIVE_PER_SECTION}
                  </span>
                  {s.isAtCapacity && (
                    <Badge
                      variant="outline"
                      className="border-destructive/40 bg-destructive/10 px-1.5 font-mono text-[9px] uppercase tracking-wider text-destructive"
                    >
                      Full
                    </Badge>
                  )}
                </span>
              </button>
            ))
          )}
        </div>

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
            onClick={submit}
            disabled={!selectedId || submitting}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Move student
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
