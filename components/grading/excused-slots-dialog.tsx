'use client';

import { useEffect, useState } from 'react';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { proseLength } from '@/lib/rich-text';
import {
  CORRECTION_REASONS,
  CORRECTION_REASON_LABELS,
  type CorrectionReason,
} from '@/lib/schemas/change-request';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Which assessments count for one student (proration, migration 179).
//
// Every slot starts ticked. Unticking one takes it out of that student's score
// AND total — a late enrollee's assessments from before they joined, the way
// the registrar prorates them by hand in the workbooks. A slot that already
// holds a score cannot be unticked; the score has to be cleared first.

export type ExcusedSaved = {
  id: string;
  ww_excused: number[];
  pt_excused: number[];
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string;
  sheetLocked: boolean;
  student: {
    section_student_id: string;
    student_name: string;
    ww_scores: (number | null)[];
    pt_scores: (number | null)[];
    ww_excused: number[];
    pt_excused: number[];
  };
  wwTotals: number[];
  ptTotals: number[];
  wwLabels: (string | null | undefined)[];
  ptLabels: (string | null | undefined)[];
  onSaved: (saved: ExcusedSaved) => void;
};

export function ExcusedSlotsDialog({
  open,
  onOpenChange,
  sheetId,
  sheetLocked,
  student,
  wwTotals,
  ptTotals,
  wwLabels,
  ptLabels,
  onSaved,
}: Props) {
  const [ww, setWw] = useState<number[]>(student.ww_excused);
  const [pt, setPt] = useState<number[]>(student.pt_excused);
  const [reason, setReason] = useState<CorrectionReason>('other');
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useWriteAction();

  useEffect(() => {
    if (!open) return;
    setWw(student.ww_excused);
    setPt(student.pt_excused);
    setReason('other');
    setJustification('');
  }, [open, student.ww_excused, student.pt_excused]);

  const same = (a: number[], b: number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const dirty =
    !same(
      [...ww].sort((a, b) => a - b),
      student.ww_excused
    ) ||
    !same(
      [...pt].sort((a, b) => a - b),
      student.pt_excused
    );
  const justificationOk = !sheetLocked || proseLength(justification) >= 20;

  async function save() {
    setSaving(true);
    try {
      await run(
        () =>
          apiFetch<{ entry: ExcusedSaved }>(
            `/api/grading-sheets/${sheetId}/excused`,
            jsonInit('PATCH', {
              section_student_id: student.section_student_id,
              ww_excused: ww,
              pt_excused: pt,
              ...(sheetLocked
                ? {
                    correction_reason: reason,
                    correction_justification: justification.trim(),
                  }
                : {}),
            })
          ),
        {
          pending: 'Saving counted assessments…',
          success: 'Counted assessments saved',
          // The grid applies the recomputed grade itself.
          refresh: false,
          onResolved: (res) => {
            onSaved(res.entry);
            onOpenChange(false);
          },
        }
      );
    } finally {
      setSaving(false);
    }
  }

  const group = (
    title: string,
    prefix: string,
    totals: number[],
    labels: (string | null | undefined)[],
    scores: (number | null)[],
    excused: number[],
    setExcused: (next: number[]) => void
  ) =>
    totals.length > 0 && (
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium text-foreground">
          {title}
        </legend>
        {totals.map((max, i) => {
          const slot = i + 1;
          const counted = !excused.includes(slot);
          const hasScore = scores[i] != null;
          const id = `excuse-${prefix}-${slot}`;
          return (
            <label
              key={id}
              htmlFor={id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm has-[:disabled]:opacity-70"
            >
              <Checkbox
                id={id}
                checked={counted}
                disabled={hasScore || saving}
                onCheckedChange={(v) =>
                  setExcused(
                    v === true
                      ? excused.filter((s) => s !== slot)
                      : [...excused, slot]
                  )
                }
              />
              <span className="font-medium tabular-nums">
                {prefix}
                {slot}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {labels[i] || ''}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {hasScore ? `scored ${scores[i]}/${max}` : `out of ${max}`}
              </span>
            </label>
          );
        })}
      </fieldset>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Counted assessments</DialogTitle>
          <DialogDescription>
            {student.student_name}. Untick an assessment this student could not
            take. It leaves both their score and their total.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {group(
            'Written work',
            'W',
            wwTotals,
            wwLabels,
            student.ww_scores,
            ww,
            setWw
          )}
          {group(
            'Performance tasks',
            'PT',
            ptTotals,
            ptLabels,
            student.pt_scores,
            pt,
            setPt
          )}
          <p className="text-xs text-muted-foreground">
            An assessment that already has a score can’t be unticked. Clear the
            score first.
          </p>
        </div>

        {sheetLocked && (
          <div className="space-y-3 border-t border-border pt-3">
            <Field>
              <FieldLabel htmlFor="excuse-reason">Correction type</FieldLabel>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as CorrectionReason)}
              >
                <SelectTrigger id="excuse-reason" className="h-9">
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
              <FieldLabel htmlFor="excuse-justification">
                Justification
              </FieldLabel>
              <RichTextEditor
                id="excuse-justification"
                value={justification}
                onChange={setJustification}
                placeholder="This sheet is locked. Say why these assessments don't count, e.g. enrolled after they were given (min 20 characters)"
                rows={3}
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!dirty || !justificationOk || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
