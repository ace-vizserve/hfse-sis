'use client';

import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { GradingSheetPreview } from '@/components/sis/grading-sheet-preview';
import { Button } from '@/components/ui/button';
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
  GRADING_METHOD_LABELS,
  GRADING_METHOD_VALUES,
  type GradingMethod,
} from '@/lib/schemas/subject';
import {
  SubjectConfigCreateSchema,
  SubjectConfigUpdateSchema,
} from '@/lib/schemas/subject-config';
import { defaultWeightPercentsForSubjectCode } from '@/lib/sis/subjects/weight-defaults';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────
// SubjectConfigForm — Task 2 of the "Unified Subject Setup page" plan.
// Field state + mutations extracted out of the (formerly duplicated)
// SubjectConfigEditDialog / SubjectConfigCreateDialog bodies, so the SAME
// logic now renders in FOUR chrome contexts: those two existing modal
// dialogs (Advanced tab), Step ①'s in-row Collapsible "needs attention"
// quick-fix, and Step ①'s per-row full-Edit Sheet drawer. This component
// is deliberately presentational-plus-logic ONLY — it renders no Dialog/
// Sheet/Collapsible chrome of its own and never opens a further dialog
// (Hard Rule of the plan's interaction model: leaf UI, no nested dialogs).
// Callers own the chrome; this just needs a place to render its fields.
//
// New in this task vs. the pre-existing dialogs: grade type
// (`is_examinable`) and grading method fields, auto-saving via
// PATCH /api/sis/admin/subjects/catalog/[id] — the one gap the existing
// subject_configs routes can't reach (those two fields live on `subjects`,
// which has no AY dimension, so an edit here is GLOBAL to the subject, not
// scoped to the AY on screen; the helper copy below says so explicitly).
// ─────────────────────────────────────────────────────────────────────────

export type SubjectOption = { id: string; code: string; name: string };

// The subject-identity slice every mode needs regardless of whether a
// subject_configs row exists yet.
export type SubjectConfigFormSubject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  grading_method: GradingMethod;
  // What prints on the report card for this subject, independent of
  // `name`. Null = falls back to `name` (see lib/report-card/build-report-card.ts).
  report_label: string | null;
};

// A `subject_configs` row is subject-scoped only (migration 080 — no level
// dimension; the same weights apply everywhere the subject is attached).
export type SubjectConfigFormDraft = SubjectConfigFormSubject & {
  configId: string;
  ayCode: string;
  ww_weight: number; // integer percentage
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number; // max possible QA score (default 30 per Hard Rule #1)
  reportSubjectId: string;
};

type SubjectConfigFormProps = {
  /** What a save would actually change, from `lib/sis/subjects/sheet-impact.ts`
   * — UNLOCKED sheets only, since locked ones are immune (Hard Rule #5). The
   * catalog table quotes the wider "who uses this at all" figure from the same
   * source; the two differing is the point, not a bug. Optional: when absent
   * the scope alert still renders without numbers, because a missing count
   * must never block Subject Setup. */
  sheetImpact?: { unlockedSheets: number; unlockedSections: number };
  /** Full catalog subject list — feeds the "Reports to" select (edit mode
   * only; see the field's own comment for why create mode omits it). */
  subjects: SubjectOption[];
  /** Fired ONLY after the explicit "Save weights" click succeeds —
   * callers use this to close their chrome (inline expansion / drawer /
   * dialog). Deliberately NOT fired by the three auto-save fields (grade
   * type, grading method, reports-to) — those save silently in the
   * background on every change (matching the pre-extraction dialog's own
   * "Reports to" behavior, which never closed the dialog), so a caller's
   * chrome stays open while the admin is still tuning other fields. */
  onSaved?: () => void;
  /** Renders a Cancel button beside "Save weights" when provided — the
   * pre-extraction dialogs both had an explicit Cancel in their
   * DialogFooter; this keeps that affordance available (now owned by the
   * form itself, since callers no longer wrap it in their own footer) in
   * every chrome context. Omit only when there is genuinely nothing to
   * cancel back to (there isn't one such caller today — all four chrome
   * contexts pass this). */
  onCancel?: () => void;
} & (
  | { mode: 'edit'; draft: SubjectConfigFormDraft }
  | {
      mode: 'create';
      subject: SubjectConfigFormSubject;
      ayId: string;
      ayCode: string;
    }
);

export function SubjectConfigForm(props: SubjectConfigFormProps) {
  const { subjects, onSaved, onCancel, mode } = props;
  const router = useRouter();

  const subjectId = mode === 'edit' ? props.draft.id : props.subject.id;
  const subjectCode = mode === 'edit' ? props.draft.code : props.subject.code;
  const subjectName = mode === 'edit' ? props.draft.name : props.subject.name;
  const ayCode = mode === 'edit' ? props.draft.ayCode : props.ayCode;
  const initialIsExaminable =
    mode === 'edit' ? props.draft.is_examinable : props.subject.is_examinable;
  const initialGradingMethod =
    mode === 'edit' ? props.draft.grading_method : props.subject.grading_method;
  const initialReportLabel =
    mode === 'edit' ? props.draft.report_label : props.subject.report_label;

  // ── Weights + slots + QA max ─────────────────────────────────────────
  // Edit mode re-seeds from the actual saved row — an already-configured
  // subject's real data is always the source of truth, never overwritten
  // by a suggestion. Create mode pre-fills the three weight fields with
  // the DepEd default inferred from the subject's CODE
  // (defaultWeightPercentsForSubjectCode) — a real, valid, fully editable
  // starting point (Save is enabled immediately since the default already
  // sums to 100). Slots still default to 5/5, QA max to 30.
  const createDefaults = defaultWeightPercentsForSubjectCode(subjectCode);
  const [ww, setWw] = useState(
    mode === 'edit' ? String(props.draft.ww_weight) : String(createDefaults.ww)
  );
  const [pt, setPt] = useState(
    mode === 'edit' ? String(props.draft.pt_weight) : String(createDefaults.pt)
  );
  const [qa, setQa] = useState(
    mode === 'edit' ? String(props.draft.qa_weight) : String(createDefaults.qa)
  );
  const [wwSlots, setWwSlots] = useState(
    mode === 'edit' ? String(props.draft.ww_max_slots) : '5'
  );
  const [ptSlots, setPtSlots] = useState(
    mode === 'edit' ? String(props.draft.pt_max_slots) : '5'
  );
  const [qaMax, setQaMax] = useState(
    mode === 'edit' ? String(props.draft.qa_max) : '30'
  );
  const [reportSubjectId, setReportSubjectId] = useState(
    mode === 'edit' ? props.draft.reportSubjectId : subjectId
  );
  const [isExaminable, setIsExaminable] = useState(initialIsExaminable);
  const [gradingMethod, setGradingMethod] = useState(initialGradingMethod);
  // Report label — a free-text field, so it can't auto-save on every
  // keystroke like the Selects above; saves on blur instead, only when the
  // value actually changed since the last successful save (tracked via a
  // ref rather than re-comparing against `initialReportLabel`, since that
  // stays stale for the rest of this mount once the first save succeeds —
  // props don't re-fetch until the drawer closes and reopens).
  const [reportLabel, setReportLabel] = useState(initialReportLabel ?? '');
  const lastSavedReportLabelRef = useRef(initialReportLabel ?? '');

  // Re-seed on identity change (edit: a different draft loaded; create: a
  // different subject picked) — mirrors the pre-extraction dialogs' own
  // re-seed effects.
  useEffect(() => {
    if (mode === 'edit') {
      setWw(String(props.draft.ww_weight));
      setPt(String(props.draft.pt_weight));
      setQa(String(props.draft.qa_weight));
      setWwSlots(String(props.draft.ww_max_slots));
      setPtSlots(String(props.draft.pt_max_slots));
      setQaMax(String(props.draft.qa_max));
      setReportSubjectId(props.draft.reportSubjectId);
      setIsExaminable(props.draft.is_examinable);
      setGradingMethod(props.draft.grading_method);
      setReportLabel(props.draft.report_label ?? '');
      lastSavedReportLabelRef.current = props.draft.report_label ?? '';
    } else {
      const d = defaultWeightPercentsForSubjectCode(props.subject.code);
      setWw(String(d.ww));
      setPt(String(d.pt));
      setQa(String(d.qa));
      setWwSlots('5');
      setPtSlots('5');
      setQaMax('30');
      setIsExaminable(props.subject.is_examinable);
      setGradingMethod(props.subject.grading_method);
      setReportLabel(props.subject.report_label ?? '');
      lastSavedReportLabelRef.current = props.subject.report_label ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, mode === 'edit' ? props.draft.configId : null]);

  const wwN = Number(ww) || 0;
  const ptN = Number(pt) || 0;
  const qaN = Number(qa) || 0;
  const sum = wwN + ptN + qaN;
  const sumOk = sum === 100;

  const weightsPayload = {
    ww_weight: wwN,
    pt_weight: ptN,
    qa_weight: qaN,
    ww_max_slots: Number(wwSlots) || 0,
    pt_max_slots: Number(ptSlots) || 0,
    qa_max: Number(qaMax) || 0,
  };
  const parsed =
    mode === 'edit'
      ? SubjectConfigUpdateSchema.safeParse(weightsPayload)
      : SubjectConfigCreateSchema.safeParse({
          academic_year_id: props.ayId,
          subject_id: subjectId,
          ...weightsPayload,
        });

  const saveWeightsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      mode === 'edit'
        ? apiFetch(
            `/api/sis/admin/subjects/${props.draft.configId}`,
            jsonInit('PATCH', payload)
          )
        : apiFetch('/api/sis/admin/subjects', jsonInit('POST', payload)),
    onSuccess: () => {
      toast.success(
        mode === 'edit'
          ? `${subjectName}: ${wwN}·${ptN}·${qaN} · QA/${Number(qaMax)}`
          : `Set weights for ${subjectCode}`
      );
      router.refresh();
      onSaved?.();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    },
  });
  const savingWeights = saveWeightsMutation.isPending;

  function saveWeights() {
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid values');
      return;
    }
    saveWeightsMutation.mutate(parsed.data);
  }

  // ── Reports-to — edit mode only ──────────────────────────────────────
  // A brand-new (create-mode) config has no subject_report_map row to
  // edit yet and, per migration 080, is implicitly self-mapped until one
  // is set — matching the pre-extraction CreateDialog's own behavior
  // (which never showed this field). Independent auto-save mutation, own
  // toast — rare edit, doesn't share the weights Save button.
  const reportMapMutation = useMutation({
    mutationFn: (nextReportSubjectId: string) =>
      apiFetch(
        `/api/sis/admin/subjects/${subjectId}/report-map`,
        jsonInit('PUT', { report_subject_id: nextReportSubjectId })
      ),
    onSuccess: (_data, nextReportSubjectId) => {
      const target = subjects.find((s) => s.id === nextReportSubjectId);
      toast.success(
        nextReportSubjectId === subjectId
          ? `${subjectCode} now reports as itself`
          : `${subjectCode} now reports as ${target?.code ?? 'another subject'}`
      );
      router.refresh();
      // Deliberately does NOT call onSaved() — this auto-saves silently in
      // the background (matching the pre-extraction dialog's own
      // behavior: changing "Reports to" never closed the dialog). onSaved
      // is reserved for the one explicit, terminal action in this form
      // (the weights Save button) — calling it here would close the
      // caller's chrome (inline expansion / drawer) after a single field
      // tweak, before the admin is necessarily done.
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not update mapping');
      if (mode === 'edit') setReportSubjectId(props.draft.reportSubjectId);
    },
  });

  function onReportSubjectChange(next: string) {
    setReportSubjectId(next);
    reportMapMutation.mutate(next);
  }

  // ── Grade type + grading method + report label — new in Task 2 (+
  // report label, this session), both modes ───────────────────────────
  // Auto-save on change, mirroring reports-to's pattern. These fields
  // live on `subjects` (no AY dimension) — PATCH /catalog/[id] is the one
  // route that reaches them; the subject_configs routes above can't.
  const catalogMutation = useMutation({
    mutationFn: (patch: {
      is_examinable?: boolean;
      grading_method?: GradingMethod;
      report_label?: string;
    }) =>
      apiFetch(
        `/api/sis/admin/subjects/catalog/${subjectId}`,
        jsonInit('PATCH', patch)
      ),
    onSuccess: (_data, patch) => {
      const what =
        'is_examinable' in patch
          ? 'grade type'
          : 'grading_method' in patch
            ? 'grading method'
            : 'report label';
      toast.success(`${subjectCode} ${what} updated`);
      if ('report_label' in patch)
        lastSavedReportLabelRef.current = patch.report_label ?? '';
      router.refresh();
      // No onSaved() here either — same reasoning as reportMapMutation
      // above; these auto-save independently and shouldn't close the
      // caller's chrome on their own.
    },
    onError: (e, patch) => {
      toast.error(e instanceof Error ? e.message : 'Could not update');
      if ('is_examinable' in patch) setIsExaminable(initialIsExaminable);
      if ('grading_method' in patch) setGradingMethod(initialGradingMethod);
      if ('report_label' in patch)
        setReportLabel(lastSavedReportLabelRef.current);
    },
  });

  function onGradeTypeChange(next: 'numeric' | 'letter') {
    const nextExaminable = next === 'numeric';
    setIsExaminable(nextExaminable);
    catalogMutation.mutate({ is_examinable: nextExaminable });
  }

  function onGradingMethodChange(next: GradingMethod) {
    setGradingMethod(next);
    catalogMutation.mutate({ grading_method: next });
  }

  function onReportLabelBlur() {
    if (reportLabel === lastSavedReportLabelRef.current) return;
    catalogMutation.mutate({ report_label: reportLabel });
  }

  const previewValid =
    Number(wwSlots) > 0 && Number(ptSlots) > 0 && Number(qaMax) > 0;

  return (
    <div className="space-y-5">
      {/* Grade type + grading method — global to this subject, not scoped
          to the AY on screen (subjects has no AY dimension). */}
      <FieldRow
        eyebrow="Subject identity"
        helper="Applies to this subject in every academic year, not just the one shown here."
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Grade type
            </Label>
            <Select
              value={isExaminable ? 'numeric' : 'letter'}
              onValueChange={(v) =>
                onGradeTypeChange(v as 'numeric' | 'letter')
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="numeric">Numeric</SelectItem>
                <SelectItem value="letter">Letter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Grading method
            </Label>
            <Select
              value={gradingMethod}
              onValueChange={(v) => onGradingMethodChange(v as GradingMethod)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADING_METHOD_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {GRADING_METHOD_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Report label
          </Label>
          <Input
            type="text"
            placeholder={subjectName}
            value={reportLabel}
            onChange={(e) => setReportLabel(e.target.value)}
            onBlur={onReportLabelBlur}
            maxLength={128}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            What prints on the report card for this subject, if different from
            &ldquo;{subjectName}&rdquo;. Leave blank to use the subject name
            as-is.
          </p>
        </div>
      </FieldRow>

      {gradingMethod === 'no_sheet' ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3 text-[12px] text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            &ldquo;No sheet&rdquo; subjects are recorded some other way — no
            grading grid is generated, so weights below aren&apos;t used.
          </span>
        </div>
      ) : (
        <>
          {/* Live ratio bar — stacked horizontal segments showing the
              WW / PT / QA proportions so the user can see their choice
              before saving. Clamped to sum; if total ≠ 100 the bar shows
              partial fill. */}
          <RatioBar ww={wwN} pt={ptN} qa={qaN} sumOk={sumOk} sum={sum} />

          {/* Weights row — three inputs with short, aligned labels. */}
          <FieldRow
            eyebrow="Weights"
            helper={
              mode === 'create'
                ? 'Must sum to 100%. Pre-filled with the DepEd standard split for this kind of subject — adjust if this subject differs.'
                : 'Must sum to 100%.'
            }
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

          {/* Scope + reduction notice — edit mode only (a new subject has no
              sheets yet, and nothing to reduce FROM).

              One `subject_configs` row covers the whole subject for the year
              (migration 080 dropped the level dimension), so a save reaches
              every unlocked sheet across every section and level — up to ~21
              sections for English or Maths. That breadth is deliberate: it is
              how the Scheme of Work lands each year (KD #176). The form just
              never said so, and an admin cannot judge a change they cannot
              see the size of.

              The reduction sentence used to read "scores in removed slots
              will be lost." That stopped being true in KD #176 — the save is
              now REFUSED when a slot being removed holds a mark. Leaving it
              would have warned about an impossible outcome while implying a
              safe reduction was dangerous. */}
          {mode === 'edit' && (
            <div className="flex items-start gap-2 rounded-md border border-brand-amber/40 bg-brand-amber/5 p-3 text-[12px] text-foreground">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-brand-amber" />
              <span>
                <span className="font-medium">
                  Saving applies to every class taking this subject.
                </span>{' '}
                {props.sheetImpact && props.sheetImpact.unlockedSheets > 0
                  ? `${props.sheetImpact.unlockedSheets} grading ${props.sheetImpact.unlockedSheets === 1 ? 'sheet' : 'sheets'} across ${props.sheetImpact.unlockedSections} ${props.sheetImpact.unlockedSections === 1 ? 'class' : 'classes'} will be updated. `
                  : 'No open grading sheets are affected right now. '}
                Locked sheets are not changed.
                {(Number(wwSlots) < props.draft.ww_max_slots ||
                  Number(ptSlots) < props.draft.pt_max_slots) && (
                  <>
                    {' '}
                    Slots you remove are cleared from those sheets. If a student
                    already has a mark in a slot you&apos;re removing, the save
                    is refused and nothing changes.
                  </>
                )}
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

          {/* Live grading-sheet preview — the actual columns a teacher
              would see, reflecting the slot counts above as they're
              edited. */}
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
        </>
      )}

      {/* Reports-to — edit mode only (see field comment above). Global +
          independent of weights, so it auto-saves on change with its own
          toast rather than sharing the weights Save button. */}
      {mode === 'edit' && (
        <FieldRow
          eyebrow="Reports to"
          helper="Which report-card column this subject's grades show under. Most subjects report as themselves."
        >
          <Select value={reportSubjectId} onValueChange={onReportSubjectChange}>
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
                      {s.id === subjectId ? ' (itself)' : ''}
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FieldRow>
      )}

      {ayCode && gradingMethod !== 'no_sheet' && (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Weights above apply to {ayCode} only.
        </p>
      )}

      {/* Cancel + Save footer — always rendered (even for a "No sheet"
          subject, which has nothing to save but still needs a way to back
          out) so every chrome context gets a way to close without saving.
          Save only appears when there are weights to save. */}
      {(onCancel || gradingMethod !== 'no_sheet') && (
        <FieldRow>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={savingWeights}
              >
                Cancel
              </Button>
            )}
            {gradingMethod !== 'no_sheet' && (
              <Button
                type="button"
                onClick={saveWeights}
                disabled={savingWeights || !parsed.success}
                className="gap-1.5"
              >
                {savingWeights ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {mode === 'edit' ? 'Save weights' : 'Set weights'}
              </Button>
            )}
          </div>
        </FieldRow>
      )}
    </div>
  );
}

// Labeled form row — eyebrow + children + helper caption. Flat hierarchy
// (no nested card) so the form breathes in every chrome context (dialog,
// inline expansion, or drawer).
function FieldRow({
  eyebrow,
  helper,
  children,
}: {
  eyebrow?: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-hairline pt-4 first:border-t-0 first:pt-0">
      {eyebrow && (
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
      )}
      {children}
      {helper && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {helper}
        </p>
      )}
    </div>
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
