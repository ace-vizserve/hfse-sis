'use client';

import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { BulkActionDialog } from '@/components/ui/bulk-action-dialog';

// The class picker for a bulk assign or move: choose ONE section once, and it
// applies to every ticked student. Same list and wording as the per-student
// AssignSectionDialog / SectionTransferDialog, minus the per-student extras.

export type BulkSectionOption = {
  id: string;
  name: string;
  /** Small text on the right, e.g. "12 in class". */
  note?: string;
  isAtCapacity: boolean;
};

export function BulkSectionPicker({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  options,
  emptyText,
  blocked,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  options: BulkSectionOption[];
  emptyText: string;
  /** When set, the ticked students cannot share one class, so nothing is
   *  offered and this says why. */
  blocked?: string | null;
  onConfirm: (sectionId: string) => void | Promise<void>;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  const sorted = React.useMemo(
    () =>
      [...options].sort(
        (a, b) =>
          Number(a.isAtCapacity) - Number(b.isAtCapacity) ||
          a.name.localeCompare(b.name)
      ),
    [options]
  );

  return (
    <BulkActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={!selectedId || Boolean(blocked)}
      onConfirm={() => (selectedId ? onConfirm(selectedId) : undefined)}
    >
      <div className="max-h-64 space-y-2 overflow-y-auto py-1">
        {blocked ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {blocked}
          </p>
        ) : sorted.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          sorted.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.isAtCapacity}
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
              <span className="flex shrink-0 items-center gap-2">
                {s.note && (
                  <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {s.note}
                  </span>
                )}
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
    </BulkActionDialog>
  );
}
