'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Minus, Pencil, Plus, Save } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setWw(initialWw);
    setPt(initialPt);
    setQa(initialQa);
    setError(null);
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

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const shrinking = ww.length < initialWw.length || pt.length < initialPt.length;
    if (shrinking) {
      const ok = confirm(
        'Removing slots will delete any scores entered in those slots for every student. Continue?',
      );
      if (!ok) return;
    }

    let approval_reference: string | undefined;
    if (isLocked) {
      const entered = window.prompt(
        'This sheet is locked. Enter the approval reference for the totals change:',
        '',
      );
      if (!entered || !entered.trim()) {
        setError('approval reference required');
        return;
      }
      approval_reference = entered.trim();
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/grading-sheets/${sheetId}/totals`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ww_totals: ww,
          pt_totals: pt,
          qa_total: qa,
          ...(approval_reference ? { approval_reference } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'save failed');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
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
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
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

        <form onSubmit={save} className="flex flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-6">
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

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
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
      </SheetContent>
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
