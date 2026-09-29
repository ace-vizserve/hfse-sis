'use client';

import { useId, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, Minus, Pencil, Plus, Save, Trash2 } from 'lucide-react';

import { toast } from 'sonner';

import { useWriteAction, type WriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import {
  ComponentWeightChips,
  redistributePercents,
  type ComponentWeights,
  type GradeComponent,
} from '@/components/grading/component-weight-chips';

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
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { proseLength } from '@/lib/rich-text';
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

// One editor for a grading sheet's slots, max scores and weights, in two
// shells:
//
//  - `TotalsEditor` — the button + side sheet on /markbook/grading/[id].
//  - `TotalsEditorForm layout="inline"` — the same form, rendered in place
//    inside a surface that is ALREADY a drawer (subject setup's per-class term
//    drawer, `components/sis/section-term-sheets-dialog.tsx`). Opening the
//    side sheet from there would stack a drawer on a drawer (Mr Ace: never
//    nest dialogs), so the inline layout also asks its two follow-up
//    questions — "remove slots?" and the locked-sheet correction — in the
//    form itself instead of in a dialog.
//
// Both shells share every rule below: the slot caps, redistribution from the
// subject's weights, the shrink warning, and the post-lock correction the
// totals route requires (Hard Rule #5). Do not fork it.

const JUSTIFICATION_MIN = 20;

type Props = {
  sheetId: string;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  wwMaxSlots: number;
  ptMaxSlots: number;
  isLocked: boolean;
  /**
   * The weights IN FORCE for this sheet, as integer percentages — its own if it
   * has them, its subject config's otherwise (migration 159).
   */
  weights: ComponentWeights;
  /** The subject's own weights, to go back to when the override is dropped. */
  subjectWeights: ComponentWeights;
  /** Does this sheet already differ from its subject? */
  weightsOverridden: boolean;
};

export function TotalsEditor(props: Props) {
  const [open, setOpen] = useState(false);
  // Owned HERE, not by the form: the form unmounts the moment the sheet
  // closes on success, and a write action that unmounts mid-flight drops its
  // pending toast and stops waiting for the refresh.
  const run = useWriteAction();

  // The form lives inside `SheetContent`, which unmounts on close — so every
  // open starts again from the sheet as it is now, with nothing left over
  // from an abandoned edit.
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
          Edit totals & slots
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="shrink-0 space-y-3 border-b border-border p-6">
          <SheetTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Edit totals & slots
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {props.isLocked
              ? 'Sheet is locked — you will be prompted for an approval reference on save.'
              : 'All student grades will be recomputed against the new denominators.'}
          </SheetDescription>
        </SheetHeader>

        <TotalsEditorForm
          {...props}
          layout="sheet"
          run={run}
          onSaved={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

export function TotalsEditorForm({
  sheetId,
  wwTotals: initialWw,
  ptTotals: initialPt,
  qaTotal: initialQa,
  wwMaxSlots,
  ptMaxSlots,
  isLocked,
  weights: initialWeights,
  subjectWeights,
  weightsOverridden,
  layout,
  scopeLabel = 'this class',
  onSaved,
  onCancel,
  run: hostRun,
}: Props & {
  /**
   * The write action of a component that OUTLIVES this form. Pass it whenever
   * `onSaved` unmounts the form (closing a sheet, collapsing a row) — see
   * `TotalsEditor`.
   */
  run?: WriteAction;
  /**
   * `sheet` — rendered inside `TotalsEditor`'s own `SheetContent`: footer
   * pinned with `SheetClose`, follow-up questions as dialogs.
   * `inline` — rendered inside someone else's drawer: no dialogs at all.
   */
  layout: 'sheet' | 'inline';
  /** Named in the weight chips' accessible labels, e.g. "Term 3". */
  scopeLabel?: string;
  /** After a save lands — before the page refresh is awaited. */
  onSaved?: () => void;
  /** The inline layout's Cancel. The sheet layout closes its sheet instead. */
  onCancel?: () => void;
}) {
  const inline = layout === 'inline';
  const idBase = useId();
  const qaId = `${idBase}-qa`;
  const reasonId = `${idBase}-correction-reason`;
  const justificationId = `${idBase}-correction-justification`;

  const [ww, setWw] = useState<number[]>(initialWw);
  const [pt, setPt] = useState<number[]>(initialPt);
  const [qa, setQa] = useState<number | null>(initialQa);
  const [weights, setWeights] = useState<ComponentWeights>(initialWeights);
  const [followsSubject, setFollowsSubject] = useState(!weightsOverridden);
  const [shrinkConfirmOpen, setShrinkConfirmOpen] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] =
    useState<CorrectionReason>('formula_fix');
  const [correctionJustification, setCorrectionJustification] = useState('');
  // The 20-character floor counts what was written, not the markup — an empty
  // rich-text box already carries seven characters of `<p></p>`.
  const justificationLength = proseLength(correctionJustification);
  const pendingCorrection = useRef<
    | ((v: { reason: CorrectionReason; justification: string } | null) => void)
    | null
  >(null);

  async function requireCorrection(): Promise<{
    reason: CorrectionReason;
    justification: string;
  } | null> {
    // Inline: the reason and justification are already on the form, and Save
    // stays disabled until the justification is long enough.
    if (inline) {
      return {
        reason: correctionReason,
        justification: correctionJustification.trim(),
      };
    }
    setCorrectionReason('formula_fix');
    setCorrectionJustification('');
    setCorrectionOpen(true);
    return new Promise((resolve) => {
      pendingCorrection.current = resolve;
    });
  }
  function resolveCorrection(
    value: { reason: CorrectionReason; justification: string } | null
  ) {
    const fn = pendingCorrection.current;
    pendingCorrection.current = null;
    fn?.(value);
  }

  /**
   * Tick or untick a component for THIS class. The remaining ones take the
   * share, so the grade stays out of 100 — the arithmetic Miss Joann described
   * as "the PT score effectively is the exam".
   *
   * Redistribution always starts from the SUBJECT's weights, never from what is
   * currently on screen. Starting from the current values compounds: untick the
   * exam (30/50/20 → 37/63), tick it back, and you would land on 30/50/20's
   * neighbour rather than back where you started.
   */
  function toggleComponent(component: GradeComponent) {
    const inUse: Record<GradeComponent, boolean> = {
      ww: weights.ww > 0,
      pt: weights.pt > 0,
      qa: weights.qa > 0,
    };
    inUse[component] = !inUse[component];

    if (!inUse.ww && !inUse.pt && !inUse.qa) {
      toast.error('A class has to be graded on at least one component.');
      return;
    }

    setWeights(redistributePercents(subjectWeights, inUse));
    setFollowsSubject(false);
  }

  function followSubjectAgain() {
    setWeights(subjectWeights);
    setFollowsSubject(true);
  }

  function updateAt(
    arr: number[],
    setArr: (v: number[]) => void,
    i: number,
    v: number
  ) {
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

  const shrinking =
    ww.length < initialWw.length || pt.length < initialPt.length;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (shrinking) {
      setShrinkConfirmOpen(true);
      return;
    }
    void doSave();
  }

  // Tier-2 mutation (Model A). The bespoke error message (422 body.error from
  // the slot-shrink / validation path) is preserved — ApiError.message already
  // resolves to body.error, so `e.message` carries the route's specific copy.
  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch(
        `/api/grading-sheets/${sheetId}/totals`,
        jsonInit('PATCH', payload)
      ),
  });

  // Saving recomputes every student's grade on the server, so the sheet behind
  // this one is meaningfully different afterwards. The toast holds until that
  // re-render lands rather than claiming "recomputed" over the old numbers.
  const ownRun = useWriteAction();
  const run = hostRun ?? ownRun;
  const [saving, setSaving] = useState(false);

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

    setSaving(true);
    await run(
      () =>
        saveMutation.mutateAsync({
          ww_totals: ww,
          pt_totals: pt,
          qa_total: qa,
          // All three or all null — migration 159's CHECK, and the route's own
          // contract. Null means this class goes back to following the subject.
          ...(followsSubject
            ? { ww_weight: null, pt_weight: null, qa_weight: null }
            : {
                ww_weight: weights.ww,
                pt_weight: weights.pt,
                qa_weight: weights.qa,
              }),
          ...lockExtras,
        }),
      {
        pending: 'Saving totals…',
        success: 'Totals saved — grades recomputed',
        error: (e) =>
          e instanceof Error ? e.message : 'Failed to save totals',
        onResolved: () => onSaved?.(),
      }
    );
    setSaving(false);
  }

  const correctionMissing =
    inline && isLocked && justificationLength < JUSTIFICATION_MIN;

  const correctionFields = (
    <>
      <Field>
        <FieldLabel htmlFor={reasonId}>Correction type</FieldLabel>
        <Select
          value={correctionReason}
          onValueChange={(v) => setCorrectionReason(v as CorrectionReason)}
        >
          <SelectTrigger id={reasonId} className="h-9">
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
        <FieldLabel htmlFor={justificationId}>Justification</FieldLabel>
        <RichTextEditor
          id={justificationId}
          value={correctionJustification}
          onChange={setCorrectionJustification}
          placeholder="Explain what was wrong and why the totals are being changed (min 20 characters)"
          rows={4}
        />
        <p className="text-[11px] text-muted-foreground">
          {justificationLength}/{JUSTIFICATION_MIN} characters minimum
        </p>
      </Field>
    </>
  );

  const saveButton = (
    <Button
      type="submit"
      size="sm"
      loading={saving}
      loadingText="Saving…"
      disabled={correctionMissing || (inline && shrinkConfirmOpen)}
    >
      {!saving && <Save className="h-4 w-4" />}
      Save totals
    </Button>
  );

  return (
    <>
      <form
        onSubmit={onSubmit}
        className={inline ? 'flex flex-col' : 'flex min-h-0 flex-1 flex-col'}
      >
        <div
          className={
            inline ? 'space-y-5' : 'min-h-0 flex-1 overflow-y-auto p-6'
          }
        >
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
              <FieldLabel htmlFor={qaId}>Quarterly assessment · max</FieldLabel>
              <Input
                id={qaId}
                type="number"
                min={1}
                value={qa ?? ''}
                onChange={(e) =>
                  setQa(e.target.value === '' ? null : Number(e.target.value))
                }
                className="h-9 w-28 text-right tabular-nums"
              />
              <FieldDescription>
                Single quarterly assessment denominator.
              </FieldDescription>
            </Field>

            {/* Which components this ONE class is graded on. Subject setup
                  sets it for every class in a term; this is the exception for
                  a class that differs. Same chips and same colours as that
                  screen — see components/grading/component-weight-chips.tsx. */}
            <Field>
              <FieldLabel>Counts towards the grade</FieldLabel>
              <ComponentWeightChips
                values={weights}
                onToggle={toggleComponent}
                disabled={saving}
                scopeLabel={scopeLabel}
              />
              <FieldDescription>
                {followsSubject ? (
                  <>
                    Following the subject&rsquo;s split for this term. Untick
                    anything this class doesn&rsquo;t sit and its share moves to
                    the rest.
                  </>
                ) : (
                  <>
                    This class is graded differently from the rest of the
                    subject.{' '}
                    <button
                      type="button"
                      onClick={followSubjectAgain}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Follow the subject again
                    </button>
                    .
                  </>
                )}
              </FieldDescription>
            </Field>
          </FieldGroup>

          {/* Inline: a locked sheet's correction is part of the form, not a
              dialog raised on Save (Hard Rule #5 — the route 400s without it). */}
          {inline && isLocked && (
            <div className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground shadow-brand-tile">
                  <Lock className="size-3.5" />
                </div>
                <div className="space-y-1">
                  <p className="font-serif text-[15px] font-semibold text-foreground">
                    This term is locked
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Changing its totals is logged as a correction on the
                    sheet&rsquo;s history. Say what was wrong before saving.
                  </p>
                </div>
              </div>
              {correctionFields}
            </div>
          )}

          {/* Inline: removing slots is confirmed in place, never in a dialog. */}
          {inline && shrinkConfirmOpen && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive text-destructive-foreground shadow-brand-tile">
                <Trash2 className="size-3.5" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <p className="font-serif text-[15px] font-semibold text-foreground">
                    Remove slots?
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    Removing slots will delete any scores entered in those slots
                    for every student. This cannot be undone.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={correctionMissing}
                    loading={saving}
                    loadingText="Saving…"
                    onClick={async () => {
                      await doSave();
                      setShrinkConfirmOpen(false);
                    }}
                  >
                    Remove slots & save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => setShrinkConfirmOpen(false)}
                  >
                    Keep them
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {inline ? (
          <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
            {saveButton}
          </div>
        ) : (
          <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border bg-background p-6 sm:justify-end">
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm">
                Cancel
              </Button>
            </SheetClose>
            {saveButton}
          </SheetFooter>
        )}
      </form>

      {!inline && (
        <AlertDialog
          open={shrinkConfirmOpen}
          onOpenChange={setShrinkConfirmOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove slots?</AlertDialogTitle>
              <AlertDialogDescription>
                Removing slots will delete any scores entered in those slots for
                every student. This cannot be undone.
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
      )}

      {!inline && (
        <Dialog
          open={correctionOpen}
          onOpenChange={(next) => {
            setCorrectionOpen(next);
            if (!next) resolveCorrection(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Log a data entry correction</DialogTitle>
              <DialogDescription>
                This sheet is locked. Totals changes are treated as
                registrar-only corrections and are flagged on the activity
                history.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-1">{correctionFields}</div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCorrectionOpen(false);
                  resolveCorrection(null);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={justificationLength < JUSTIFICATION_MIN}
                onClick={() => {
                  setCorrectionOpen(false);
                  resolveCorrection({
                    reason: correctionReason,
                    justification: correctionJustification.trim(),
                  });
                }}
              >
                Log correction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
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
