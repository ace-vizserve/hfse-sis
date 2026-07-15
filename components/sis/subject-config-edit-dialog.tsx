'use client';

import { AlertCircle, CheckCircle2, Loader2, Save, Scale } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { GradingSheetPreview } from '@/components/sis/grading-sheet-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SubjectConfigCreateSchema,
  SubjectConfigUpdateSchema,
} from '@/lib/schemas/subject-config';
import { cn } from '@/lib/utils';

type SubjectOption = { id: string; code: string; name: string };

// A `subject_configs` row is now subject-scoped only (migration 080 — no
// level dimension; the same weights apply everywhere the subject is
// attached). `reportSubjectId` is resolved by the caller (self-map when
// unmapped) so the dialog never has to reach for `subject_report_map`
// itself.
export type SubjectConfigDraft = {
  configId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  ayCode: string;
  ww_weight: number; // integer percentage
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number; // max possible QA score (default 30 per Hard Rule #1)
  reportSubjectId: string;
};

export function SubjectConfigEditDialog({
  draft,
  open,
  onOpenChange,
  subjects,
}: {
  draft: SubjectConfigDraft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  // No auto-fill (KD-#155-candidate design decision — see the Subject
  // Weights collapse design doc): fields start empty until the `draft`
  // effect below re-seeds them from the actual saved row. The dialog only
  // ever edits existing cells, so `draft` is non-null by the time inputs
  // render in practice — these are just the pre-load placeholders.
  const [ww, setWw] = useState('');
  const [pt, setPt] = useState('');
  const [qa, setQa] = useState('');
  const [wwSlots, setWwSlots] = useState('');
  const [ptSlots, setPtSlots] = useState('');
  const [qaMax, setQaMax] = useState('');
  const [reportSubjectId, setReportSubjectId] = useState('');

  // Re-seed on draft change (i.e., user opened the dialog for a different row).
  useEffect(() => {
    if (!draft) return;
    setWw(String(draft.ww_weight));
    setPt(String(draft.pt_weight));
    setQa(String(draft.qa_weight));
    setWwSlots(String(draft.ww_max_slots));
    setPtSlots(String(draft.pt_max_slots));
    setQaMax(String(draft.qa_max));
    setReportSubjectId(draft.reportSubjectId);
  }, [draft]);

  const wwN = Number(ww) || 0;
  const ptN = Number(pt) || 0;
  const qaN = Number(qa) || 0;
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;

  const parsed = SubjectConfigUpdateSchema.safeParse({
    ww_weight: wwN,
    pt_weight: ptN,
    qa_weight: qaN,
    ww_max_slots: Number(wwSlots) || 0,
    pt_max_slots: Number(ptSlots) || 0,
    qa_max: Number(qaMax) || 0,
  });

  const saveMutation = useMutation({
    mutationFn: (vars: {
      configId: string;
      payload: Record<string, unknown>;
    }) =>
      apiFetch(
        `/api/sis/admin/subjects/${vars.configId}`,
        jsonInit('PATCH', vars.payload)
      ),
    onSuccess: () => {
      // draft is guaranteed non-null at mutate-time (guarded in save()).
      toast.success(
        `${draft!.subjectName}: ${wwN}·${ptN}·${qaN} · QA/${Number(qaMax)}`
      );
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });
  const saving = saveMutation.isPending;

  function save() {
    if (!draft) return;
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid values');
      return;
    }
    saveMutation.mutate({ configId: draft.configId, payload: parsed.data });
  }

  // Reports-to — independent auto-save mutation, own toast. Rare edit, so
  // it doesn't share a Save button with the weights form; changing the
  // Select fires immediately.
  const reportMapMutation = useMutation({
    mutationFn: (vars: { subjectId: string; reportSubjectId: string }) =>
      apiFetch(
        `/api/sis/admin/subjects/${vars.subjectId}/report-map`,
        jsonInit('PUT', { report_subject_id: vars.reportSubjectId })
      ),
    onSuccess: (_data, vars) => {
      const target = subjects.find((s) => s.id === vars.reportSubjectId);
      toast.success(
        vars.reportSubjectId === vars.subjectId
          ? `${draft?.subjectCode} now reports as itself`
          : `${draft?.subjectCode} now reports as ${target?.code ?? 'another subject'}`
      );
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not update mapping');
      // Revert the Select on failure.
      if (draft) setReportSubjectId(draft.reportSubjectId);
    },
  });

  function onReportSubjectChange(next: string) {
    setReportSubjectId(next);
    if (!draft) return;
    reportMapMutation.mutate({
      subjectId: draft.subjectId,
      reportSubjectId: next,
    });
  }

  const previewValid =
    Number(wwSlots) > 0 && Number(ptSlots) > 0 && Number(qaMax) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {/* §7.4 gradient icon tile — anchors the dialog's purpose visually. */}
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {draft ? draft.ayCode : 'Subject weights'}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {draft ? draft.subjectName : 'Subject weights'}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                {draft
                  ? 'Changes apply to every grading sheet for this subject in every level it teaches. Locked sheets are not changed.'
                  : 'Pick a subject to edit.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {draft && (
          <div className="space-y-5">
            {/* Live ratio bar — stacked horizontal segments showing the WW / PT /
                QA proportions so the user can see their choice before saving.
                Clamped to sum; if total ≠ 100 the bar shows partial fill. */}
            <RatioBar ww={wwN} pt={ptN} qa={qaN} sumOk={sumOk} sum={sum} />

            {/* Weights row — three inputs with short, aligned labels. */}
            <FieldRow
              eyebrow="Weights"
              helper="Must sum to 100%. Canonical HFSE: Primary 40·40·20, Secondary 30·50·20."
            >
              <div className="grid grid-cols-3 gap-3">
                <PercentField
                  label="WW"
                  sublabel="Written Works"
                  value={ww}
                  setValue={setWw}
                />
                <PercentField
                  label="PT"
                  sublabel="Perf. Tasks"
                  value={pt}
                  setValue={setPt}
                />
                <PercentField
                  label="QA"
                  sublabel="Quarterly"
                  value={qa}
                  setValue={setQa}
                />
              </div>
            </FieldRow>

            {/* Max slots row. */}
            <FieldRow
              eyebrow="Max slots"
              helper="Hard cap 5 per KD #5. Lowering won't delete existing entries."
            >
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="WW slots"
                  value={wwSlots}
                  setValue={setWwSlots}
                  maxDigits={1}
                />
                <NumberField
                  label="PT slots"
                  value={ptSlots}
                  setValue={setPtSlots}
                  maxDigits={1}
                />
              </div>
            </FieldRow>

            {/* Slot-reduction warning — fires when the user lowers WW or PT count
                below the current saved value. Grading sheets will be trimmed and
                any Scheme of Work labels beyond the new limit stop appearing. */}
            {(Number(wwSlots) < draft.ww_max_slots ||
              Number(ptSlots) < draft.pt_max_slots) && (
              <div className="flex items-start gap-2 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-3 text-[12px] text-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-brand-amber" />
                <span>
                  Lowering slot count will trim existing unlocked grading sheets
                  — scores in removed slots will be lost. If a Scheme of Work
                  has been published for this subject, activity labels beyond
                  the new limit won't appear on future grading sheets.
                </span>
              </div>
            )}

            {/* QA max row — single input, label-left input-right. */}
            <FieldRow
              eyebrow="QA max score"
              helper="Denominator of the QA percentage. Canonical 30 per Hard Rule #1; vary per subject (e.g. 50 Math, 20 Art)."
            >
              <div className="max-w-[160px]">
                <NumberField
                  label="Max score"
                  value={qaMax}
                  setValue={setQaMax}
                  maxDigits={3}
                />
              </div>
            </FieldRow>

            {/* Live grading-sheet preview — the actual columns a teacher would
                see, reflecting the slot counts above as they're edited. */}
            {previewValid && (
              <FieldRow eyebrow="Grading sheet preview">
                <div className="w-fit rounded-md border border-border bg-muted/20 px-2 py-1">
                  <GradingSheetPreview
                    config={{
                      ww_max_slots: Number(wwSlots),
                      pt_max_slots: Number(ptSlots),
                      qa_max: Number(qaMax),
                    }}
                  />
                </div>
              </FieldRow>
            )}

            {/* Reports-to — which report-card column this subject's grades roll
                up into. Global + independent of weights (subject_report_map has
                no AY/level column) so it auto-saves on change with its own
                toast rather than sharing the weights Save button. */}
            <FieldRow
              eyebrow="Reports to"
              helper="Which report-card column this subject's grades show under. Most subjects report as themselves."
            >
              <Select
                value={reportSubjectId}
                onValueChange={onReportSubjectChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-mono text-xs">{s.code}</span>
                        <span className="ml-2 text-muted-foreground">
                          {s.name}
                          {s.id === draft.subjectId ? ' (itself)' : ''}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FieldRow>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!draft || saving || !parsed.success}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {saving ? 'Saving…' : 'Save weights'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Create-weights dialog — opens from a subject chip attached to a level
// with no `subject_configs` row yet for this AY. Mirrors
// TemplateSubjectConfigCreateDialog's blank-start behavior (no
// level-profile auto-fill — weight is a property of the subject, not any
// one level, so there's no single level context to derive a default from
// even when the chip that opened it happens to live under one level).
// =====================================================================

export function SubjectConfigCreateDialog({
  subject,
  ayId,
  ayCode,
  open,
  onOpenChange,
}: {
  subject: SubjectOption | null;
  ayId: string;
  ayCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const [ww, setWw] = useState('');
  const [pt, setPt] = useState('');
  const [qa, setQa] = useState('');
  const [wwSlots, setWwSlots] = useState('5');
  const [ptSlots, setPtSlots] = useState('5');
  const [qaMax, setQaMax] = useState('30');

  useEffect(() => {
    if (open) {
      setWw('');
      setPt('');
      setQa('');
      setWwSlots('5');
      setPtSlots('5');
      setQaMax('30');
    }
  }, [open, subject?.id]);

  const wwN = Number(ww) || 0;
  const ptN = Number(pt) || 0;
  const qaN = Number(qa) || 0;
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;

  const parsed = subject
    ? SubjectConfigCreateSchema.safeParse({
        academic_year_id: ayId,
        subject_id: subject.id,
        ww_weight: wwN,
        pt_weight: ptN,
        qa_weight: qaN,
        ww_max_slots: Number(wwSlots) || 0,
        pt_max_slots: Number(ptSlots) || 0,
        qa_max: Number(qaMax) || 0,
      })
    : null;

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch('/api/sis/admin/subjects', jsonInit('POST', payload)),
    onSuccess: () => {
      toast.success(`Set weights for ${subject?.code}`);
      onOpenChange(false);
      router.refresh();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'save failed');
    },
  });
  const saving = createMutation.isPending;

  function save() {
    if (!subject || !parsed || !parsed.success) {
      toast.error(
        (!parsed?.success && parsed?.error.issues[0]?.message) ||
          'Invalid values'
      );
      return;
    }
    createMutation.mutate(parsed.data);
  }

  const previewValid =
    Number(wwSlots) > 0 && Number(ptSlots) > 0 && Number(qaMax) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl!">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber">
              <Scale className="size-4" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {ayCode}
              </p>
              <DialogTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                {subject ? `Set weights for ${subject.name}` : 'Set weights'}
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
                Applies to every level this subject is attached to in {ayCode}.
                Used the moment a grading sheet is generated.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {subject && (
          <div className="space-y-5">
            <RatioBar ww={wwN} pt={ptN} qa={qaN} sumOk={sumOk} sum={sum} />

            <FieldRow
              eyebrow="Weights"
              helper="Must sum to 100%. Canonical HFSE: Primary 40·40·20, Secondary 30·50·20."
            >
              <div className="grid grid-cols-3 gap-3">
                <PercentField
                  label="WW"
                  sublabel="Written Works"
                  value={ww}
                  setValue={setWw}
                />
                <PercentField
                  label="PT"
                  sublabel="Perf. Tasks"
                  value={pt}
                  setValue={setPt}
                />
                <PercentField
                  label="QA"
                  sublabel="Quarterly"
                  value={qa}
                  setValue={setQa}
                />
              </div>
            </FieldRow>

            <FieldRow eyebrow="Max slots" helper="Hard cap 5 per KD #5.">
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="WW slots"
                  value={wwSlots}
                  setValue={setWwSlots}
                  maxDigits={1}
                />
                <NumberField
                  label="PT slots"
                  value={ptSlots}
                  setValue={setPtSlots}
                  maxDigits={1}
                />
              </div>
            </FieldRow>

            <FieldRow
              eyebrow="QA max score"
              helper="Denominator of the QA percentage. Canonical 30 per Hard Rule #1."
            >
              <div className="max-w-[160px]">
                <NumberField
                  label="Max score"
                  value={qaMax}
                  setValue={setQaMax}
                  maxDigits={3}
                />
              </div>
            </FieldRow>

            {previewValid && (
              <FieldRow eyebrow="Grading sheet preview">
                <div className="w-fit rounded-md border border-border bg-muted/20 px-2 py-1">
                  <GradingSheetPreview
                    config={{
                      ww_max_slots: Number(wwSlots),
                      pt_max_slots: Number(ptSlots),
                      qa_max: Number(qaMax),
                    }}
                  />
                </div>
              </FieldRow>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!subject || saving || !parsed?.success}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {saving ? 'Saving…' : 'Set weights'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Thin 3-segment progress bar showing the WW/PT/QA split at a glance.
// Color-coded segments only — no inline labels, no gradients, no inset
// chrome. The compact header row carries the segment legend + live sum
// validation.
function RatioBar({
  ww,
  pt,
  qa,
  sumOk,
  sum,
}: {
  ww: number;
  pt: number;
  qa: number;
  sumOk: boolean;
  sum: number;
}) {
  // Clamp so the bar never overflows when sum > 100; gap on the right when sum < 100.
  const total = Math.max(sum, 100);
  const pctOf = (n: number) => (n / total) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <div className="flex items-center gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-chart-3" /> WW {ww}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-brand-indigo" /> PT {pt}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-brand-amber" /> QA {qa}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 font-semibold',
            sumOk ? 'text-ink' : 'text-destructive'
          )}
        >
          {sumOk ? (
            <CheckCircle2 className="size-3" />
          ) : (
            <AlertCircle className="size-3" />
          )}
          <span className="tabular-nums">{sum}%</span>
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {ww > 0 && (
          <div
            className="bg-chart-3 transition-[flex-basis] duration-200"
            style={{ flexBasis: `${pctOf(ww)}%` }}
          />
        )}
        {pt > 0 && (
          <div
            className="bg-brand-indigo transition-[flex-basis] duration-200"
            style={{ flexBasis: `${pctOf(pt)}%` }}
          />
        )}
        {qa > 0 && (
          <div
            className="bg-brand-amber transition-[flex-basis] duration-200"
            style={{ flexBasis: `${pctOf(qa)}%` }}
          />
        )}
      </div>
    </div>
  );
}

// Labeled form row — eyebrow + children + helper caption. Flat hierarchy
// (no nested card) so the dialog breathes.
function FieldRow({
  eyebrow,
  helper,
  children,
}: {
  eyebrow: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-hairline pt-4 first:border-t-0 first:pt-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      {children}
      {helper && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {helper}
        </p>
      )}
    </div>
  );
}

function PercentField({
  label,
  sublabel,
  value,
  setValue,
}: {
  label: string;
  sublabel: string;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="flex items-baseline gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-muted-foreground">· {sublabel}</span>
      </Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) =>
            setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))
          }
          className="h-10 pr-7 text-right font-mono text-[15px] font-semibold tabular-nums"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  setValue,
  maxDigits,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  maxDigits: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) =>
          setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, maxDigits))
        }
        className="h-10 text-right font-mono text-[15px] font-semibold tabular-nums"
      />
    </div>
  );
}
