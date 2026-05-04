'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Minus, Pencil, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';

type Props = {
  sheetId: string;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  wwMaxSlots: number;
  ptMaxSlots: number;
  isLocked: boolean;
};

export function TotalsEditor({
  sheetId,
  wwTotals: initialWw,
  ptTotals: initialPt,
  qaTotal: initialQa,
  wwMaxSlots,
  ptMaxSlots,
  isLocked,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ww, setWw] = useState<number[]>(initialWw);
  const [pt, setPt] = useState<number[]>(initialPt);
  const [qa, setQa] = useState<number | null>(initialQa);
  const [busy, setBusy] = useState(false);
  const [shrinkConfirmOpen, setShrinkConfirmOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason>('formula_fix');
  const [correctionJustification, setCorrectionJustification] = useState('');
  const pendingCorrection = useRef<((v: { reason: CorrectionReason; justification: string } | null) => void) | null>(null);

  async function requireCorrection(): Promise<{ reason: CorrectionReason; justification: string } | null> {
    setCorrectionReason('formula_fix');
    setCorrectionJustification('');
    setCorrectionOpen(true);
    return new Promise((resolve) => {
      pendingCorrection.current = resolve;
    });
  }
  function resolveCorrection(value: { reason: CorrectionReason; justification: string } | null) {
    const fn = pendingCorrection.current;
    pendingCorrection.current = null;
    fn?.(value);
  }

  function reset() {
    setWw(initialWw);
    setPt(initialPt);
    setQa(initialQa);
  }

  function updateAt(arr: number[], setArr: (v: number[]) => void, i: number, v: number) {
    const next = arr.slice();
    next[i] = v;
    setArr(next);
  }

  function addSlot(arr: number[], setArr: (v: number[]) => void, cap: number) {
    if (arr.length >= cap) return;
    const def = arr.length > 0 ? arr[arr.length - 1] : 10;
    setArr([...arr, def]);
  }

  function removeSlot(arr: number[], setArr: (v: number[]) => void) {
    if (arr.length === 0) return;
    setArr(arr.slice(0, -1));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const shrinking = ww.length < initialWw.length || pt.length < initialPt.length;
    if (shrinking) {
      setShrinkConfirmOpen(true);
      return;
    }
    void doSave();
  }

  async function doSave() {
    let lockExtras: Record<string, unknown> = {};
    if (isLocked) {
      const correction = await requireCorrection();
      if (!correction) return;
      lockExtras = {
        correction_reason: correction.reason,
        correction_justification: correction.justification,
      };
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/grading-sheets/${sheetId}/totals`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ww_totals: ww,
          pt_totals: pt,
          qa_total: qa,
          ...lockExtras,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      setOpen(false);
      toast.success('Totals saved — grades recomputed');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save totals');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
          Edit totals & slots
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
        <ScrollArea className="h-full">
          <SheetHeader className="space-y-3 border-b border-border p-6">
            <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Edit totals & slots
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {isLocked
                ? 'Sheet is locked — you will be prompted for an approval reference on save.'
                : 'All student grades will be recomputed against the new denominators.'}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={onSubmit}>
          <div className="p-6">
            <FieldGroup>
              <SlotSection
                label="Written Works"
                prefix="W"
                values={ww}
                onChangeAt={(i, v) => updateAt(ww, setWw, i, v)}
                onAdd={() => addSlot(ww, setWw, wwMaxSlots)}
                onRemove={() => removeSlot(ww, setWw)}
                cap={wwMaxSlots}
              />

              <SlotSection
                label="Performance Tasks"
                prefix="PT"
                values={pt}
                onChangeAt={(i, v) => updateAt(pt, setPt, i, v)}
                onAdd={() => addSlot(pt, setPt, ptMaxSlots)}
                onRemove={() => removeSlot(pt, setPt)}
                cap={ptMaxSlots}
              />

              <Field>
                <FieldLabel htmlFor="te-qa">Quarterly assessment · max</FieldLabel>
                <Input
                  id="te-qa"
                  type="number"
                  min={1}
                  value={qa ?? ''}
                  onChange={(e) =>
                    setQa(e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="h-9 w-28 text-right tabular-nums"
                />
                <FieldDescription>Single quarterly assessment denominator.</FieldDescription>
              </Field>

            </FieldGroup>
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-border p-6 sm:justify-end">
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {busy ? 'Saving…' : 'Save totals'}
            </Button>
          </SheetFooter>
        </form>
        </ScrollArea>
      </SheetContent>

      <AlertDialog open={shrinkConfirmOpen} onOpenChange={setShrinkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove slots?</AlertDialogTitle>
            <AlertDialogDescription>
              Removing slots will delete any scores entered in those slots for every student.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                setShrinkConfirmOpen(false);
                await doSave();
              }}
            >
              Remove slots & save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={correctionOpen}
        onOpenChange={(next) => {
          setCorrectionOpen(next);
          if (!next) resolveCorrection(null);
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log a data entry correction</DialogTitle>
            <DialogDescription>
              This sheet is locked. Totals changes are treated as registrar-only
              corrections and are flagged on the activity history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Field>
              <FieldLabel htmlFor="te-correction-reason">Correction type</FieldLabel>
              <Select
                value={correctionReason}
                onValueChange={(v) => setCorrectionReason(v as CorrectionReason)}>
                <SelectTrigger id="te-correction-reason" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CORRECTION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {CORRECTION_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="te-correction-justification">Justification</FieldLabel>
              <Textarea
                id="te-correction-justification"
                value={correctionJustification}
                onChange={(e) => setCorrectionJustification(e.target.value)}
                placeholder="Explain what was wrong and why the totals are being changed (min 20 characters)"
                rows={4}
              />
              <p className="text-[11px] text-muted-foreground">
                {correctionJustification.trim().length}/20 characters minimum
              </p>
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCorrectionOpen(false);
                resolveCorrection(null);
              }}>
              Cancel
            </Button>
            <Button
              disabled={correctionJustification.trim().length < 20}
              onClick={() => {
                setCorrectionOpen(false);
                resolveCorrection({
                  reason: correctionReason,
                  justification: correctionJustification.trim(),
                });
              }}>
              Log correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function SlotSection({
  label,
  prefix,
  values,
  onChangeAt,
  onAdd,
  onRemove,
  cap,
}: {
  label: string;
  prefix: string;
  values: number[];
  onChangeAt: (i: number, v: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  cap: number;
}) {
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel className="m-0">
          {label}
          <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground">
            {values.length} / {cap}
          </span>
        </FieldLabel>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRemove}
            disabled={values.length === 0}
          >
            <Minus className="h-3.5 w-3.5" />
            Remove
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            disabled={values.length >= cap}
          >
            <Plus className="h-3.5 w-3.5" />
            Add slot
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 pt-1">
        {values.length === 0 && (
          <div className="text-xs text-muted-foreground">no slots</div>
        )}
        {values.map((v, i) => (
          <label key={i} className="flex items-center gap-1.5 text-sm">
            <span className="font-mono text-[11px] text-muted-foreground">
              {prefix}
              {i + 1}
            </span>
            <Input
              type="number"
              min={1}
              value={v}
              onChange={(e) => onChangeAt(i, Number(e.target.value))}
              className="h-9 w-20 text-right tabular-nums"
            />
          </label>
        ))}
      </div>
    </Field>
  );
}
