'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateAdministeredField } from './date-administered-field';
import {
  slotMetaSatisfied,
  type SlotKind,
} from '@/lib/grading/first-score-gate';
import type { SlotMeta } from '@/lib/schemas/grading-sheet';

// Intercepts a slot's very first score (roster-wide) — reuses the exact same
// input shapes as the "Activity labels" panel's editable ActivityRow
// (score-entry-grid.tsx), just surfaced as a focused dialog instead of an
// inline row. Save is disabled until the same slotMetaSatisfied rule the
// server independently enforces is met, so client and server validation are
// provably the same predicate.
export function FirstScoreLabelDialog({
  open,
  kind,
  slotCode,
  seedMeta,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  kind: SlotKind;
  slotCode: string;
  seedMeta: SlotMeta;
  onConfirm: (meta: SlotMeta) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(seedMeta.label ?? '');
  const [date, setDate] = useState(seedMeta.date ?? '');
  const [page, setPage] = useState(seedMeta.page ?? '');

  const meta: SlotMeta = { label, date, page };
  const canSave = slotMetaSatisfied(kind, meta);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">
            Label {slotCode} before its first score
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div>
            <Label
              htmlFor="first-score-label-desc"
              className="mb-1.5 block text-xs font-semibold"
            >
              Description
            </Label>
            <Input
              id="first-score-label-desc"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                kind === 'qa'
                  ? 'e.g. Quarterly Exam'
                  : 'e.g. Worksheet 2: Multiplication Tables'
              }
              maxLength={120}
              autoFocus
            />
          </div>
          {kind !== 'qa' && (
            <>
              <div>
                <Label
                  htmlFor="first-score-label-page"
                  className="mb-1.5 block text-xs font-semibold"
                >
                  Page #{' '}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="first-score-label-page"
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  placeholder="p.#"
                  maxLength={40}
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">
                  Date administered
                </Label>
                <DateAdministeredField value={date} onChange={setDate} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => onConfirm(meta)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
