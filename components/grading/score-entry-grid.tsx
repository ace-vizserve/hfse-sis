'use client';

import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Clock,
  Loader2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SlotMeta, SlotLabels } from '@/lib/schemas/grading-sheet';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DateAdministeredField } from './date-administered-field';
import {
  DEFAULT_GRID_FILTERS,
  GridFilterToolbar,
  type GridFilters,
} from './grid-filter-toolbar';
import {
  useChangeReference,
  type ChangeReferenceTarget,
} from './use-approval-reference';
import { GradeDiffDialog, type AlertComparison } from './grade-diff-dialog';
import {
  applyServerEntry,
  revertPatchedFields,
  type EntryPatchBody,
} from './score-revert';
import {
  resolveNonExaminableLetter,
  type NonExaminableLetter,
} from '@/lib/compute/letter-grade';
import {
  slotMetaSatisfied,
  slotRosterScored,
  type SlotKind,
} from '@/lib/grading/first-score-gate';
import { FirstScoreLabelDialog } from './first-score-label-dialog';

export type GradeRow = {
  entry_id: string;
  section_student_id: string;
  index_number: number;
  student_name: string;
  student_number: string;
  withdrawn: boolean;
  late_enrollee: boolean;
  is_na: boolean;
  ww_scores: (number | null)[];
  pt_scores: (number | null)[];
  qa_score: number | null;
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
  letter_grade: string | null;
};

type PriorTermGrade = {
  term_number: number;
  term_label: string;
  quarterly_grade: number | null;
};

type Props = {
  sheetId: string;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  rows: GradeRow[];
  readOnly?: boolean;
  requireApproval?: boolean;
  /** Teacher-authored activity metadata per column. */
  slotLabels?: SlotLabels;
  /** Subject weights as decimals (e.g. 0.40 for 40%). Used to compute WS columns. */
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
  /** When true, renders the Quarterly column as a derived letter (non-examinable subjects). */
  letterDisplay?: boolean;
  /** When true, the scoring guide rows become inline editors (description / page / date)
   *  that autosave on blur. Mirrors the old Activity Labels dialog's gate. */
  canEditLabels?: boolean;
  /** Prior-term grades keyed by section_student_id. Omit for T1 sheets. */
  priorGrades?: Record<string, PriorTermGrade[]>;
  currentTermNumber?: number;
  currentTermLabel?: string;
};

function parseCell(raw: string): number | null {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function displayCell(v: number | null): string {
  return v == null ? '' : String(v);
}

// Non-examinable per-term override (KD #104). The single dropdown maps to two
// columns: N/A → is_na, UG/E → letter_grade. '—' (NONE) clears both so the
// derived A/B/C/IP shows. is_na wins over letter_grade (see resolveNonExaminableLetter).
type OverrideChoice = 'NONE' | 'NA' | 'UG' | 'E';

const OVERRIDE_CHOICE_TO_COLUMNS: Record<
  OverrideChoice,
  { is_na: boolean; letter_grade: string | null }
> = {
  NONE: { is_na: false, letter_grade: null },
  NA: { is_na: true, letter_grade: null },
  UG: { is_na: false, letter_grade: 'UG' },
  E: { is_na: false, letter_grade: 'E' },
};

function rowToOverrideChoice(row: {
  is_na: boolean;
  letter_grade: string | null;
}): OverrideChoice {
  if (row.is_na) return 'NA';
  if (row.letter_grade === 'UG') return 'UG';
  if (row.letter_grade === 'E') return 'E';
  return 'NONE';
}

export function ScoreEntryGrid({
  sheetId,
  wwTotals,
  ptTotals,
  qaTotal,
  rows: initialRows,
  readOnly = false,
  requireApproval = false,
  slotLabels,
  wwWeight,
  ptWeight,
  qaWeight,
  letterDisplay = false,
  canEditLabels = false,
  priorGrades,
  currentTermNumber = 1,
  currentTermLabel = 'Term',
}: Props) {
  const [rows, setRows] = useState<GradeRow[]>(initialRows);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Last server-confirmed state per entry — the revert target when a commit
  // fails or the locked-sheet approval dialog is cancelled. Seeded from the
  // RSC rows; advanced ONLY on a successful PATCH reconcile. (The optimistic
  // update happens while TYPING via onLocalChange, so by commit time the rows
  // state no longer holds the pre-edit value — this snapshot does.)
  const savedRowsRef = useRef<Map<string, GradeRow>>(
    new Map(initialRows.map((r) => [r.entry_id, r]))
  );

  // Roster-wide "does this slot already hold a committed score?" — read from
  // savedRowsRef (server-confirmed truth), never from `rows` (which updates
  // optimistically on every keystroke via onLocalChange, so by commit time it
  // would already reflect the just-typed value and the gate would never
  // fire). Mirrors exactly what the entries PATCH route independently checks.
  const slotAlreadyScored = useCallback(
    (kind: SlotKind, index: number | null): boolean =>
      slotRosterScored(kind, index, Array.from(savedRowsRef.current.values())),
    []
  );

  // First-score label gate — set when a genuine first score for a slot needs
  // a label before it can save (see commitScore below). Rendering the dialog
  // conditionally on this being non-null (rather than an always-mounted
  // instance with `open` toggled) is deliberate: FirstScoreLabelDialog seeds
  // its internal label/date/page state from `seedMeta` only on mount, so a
  // persistent instance would leak a previously-labeled slot's state into a
  // newly-gated one.
  const [pendingFirstScore, setPendingFirstScore] = useState<{
    entryId: string;
    kind: SlotKind;
    slotIndex: number | null;
    target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>;
    body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score'>>;
    seedMeta: SlotMeta;
  } | null>(null);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<GridFilters>(DEFAULT_GRID_FILTERS);
  const { requireChangeReference, dialog: approvalDialog } =
    useChangeReference();
  const [alertDialogState, setAlertDialogState] = useState<{
    studentName: string;
    currentGrade: number;
    comparisons: AlertComparison[];
  } | null>(null);

  // Slot labels — managed locally, PATCHed on blur.
  const [labels, setLabels] = useState<Required<SlotLabels>>({
    ww: slotLabels?.ww ?? [],
    pt: slotLabels?.pt ?? [],
    qa: slotLabels?.qa ?? null,
  });

  useEffect(() => {
    setLabels({
      ww: slotLabels?.ww ?? [],
      pt: slotLabels?.pt ?? [],
      qa: slotLabels?.qa ?? null,
    });
  }, [slotLabels]);

  const [savingLabels, setSavingLabels] = useState(false);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  // Inline label edit — update local state immediately (optimistic); the
  // ScoringGuide commits on blur via saveLabels.
  const onSlotChange = useCallback(
    (kind: 'ww' | 'pt', index: number, patch: Partial<SlotMeta>) => {
      setLabels((prev) => {
        const arr = [...prev[kind]];
        const current = (arr[index] ?? {}) as SlotMeta;
        arr[index] = { ...current, ...patch };
        return { ...prev, [kind]: arr };
      });
    },
    []
  );

  const onQaChange = useCallback((value: string) => {
    setLabels((prev) => ({ ...prev, qa: value }));
  }, []);

  // Persist the FULL slot arrays (KD #105 — the labels route is a full-array
  // replace, not a per-slot merge). Normalize each array to its real slot
  // length so a single-row edit never drops other slots; trim text → null.
  const saveLabels = useCallback(async () => {
    const snapshot = labelsRef.current;
    const wwOut = Array.from({ length: wwTotals.length }, (_, i) => {
      const m = snapshot.ww[i];
      if (!m) return null;
      return {
        label: m.label?.trim() || null,
        page: m.page?.trim() || null,
        date: m.date || null,
      };
    });
    const ptOut = Array.from({ length: ptTotals.length }, (_, i) => {
      const m = snapshot.pt[i];
      if (!m) return null;
      return {
        label: m.label?.trim() || null,
        page: m.page?.trim() || null,
        date: m.date || null,
      };
    });
    const qaOut = (snapshot.qa ?? '').trim() || null;

    setSavingLabels(true);
    try {
      // Routed through apiFetch (Tier-3 label autosave) — a non-2xx throws
      // ApiError whose message already resolves to body.error, preserving the
      // existing toast; the local optimistic label state is untouched.
      await apiFetch(
        `/api/grading-sheets/${sheetId}/labels`,
        jsonInit('PATCH', { ww: wwOut, pt: ptOut, qa: qaOut })
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save activity labels.'
      );
    } finally {
      setSavingLabels(false);
    }
  }, [sheetId, wwTotals.length, ptTotals.length]);

  const locked = readOnly && !requireApproval;

  const wwLen = wwTotals.length;
  const ptLen = ptTotals.length;

  const visibleRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.hideWithdrawn && r.withdrawn) return false;
      if (q) {
        const hay = `${r.student_name} ${r.student_number}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.blanksOnly) {
        if (r.withdrawn || r.is_na) return false;
        const hasBlank =
          r.ww_scores.slice(0, wwLen).some((v) => v == null) ||
          r.pt_scores.slice(0, ptLen).some((v) => v == null) ||
          r.qa_score == null;
        if (!hasBlank) return false;
      }
      return true;
    });
  }, [rows, filters, wwLen, ptLen]);

  // Tier-3 autosave: the per-cell PATCH is routed through useMutation purely so
  // it gets retry:0 + the shared apiFetch error handling. The optimistic UX is
  // UNCHANGED — cells still update via local state (updateLocal) and reconcile
  // from data.entry on success; this mutation owns no cache and does not touch
  // the optimistic flow. The 422 error codes the autosave surfaces + the exact
  // per-cell revert/toast are preserved in patchEntry below.
  const entryMutation = useMutation({
    mutationFn: (vars: { entryId: string; payload: Record<string, unknown> }) =>
      apiFetch<{
        entry: {
          ww_scores: (number | null)[];
          pt_scores: (number | null)[];
          qa_score: number | null;
          ww_ps: number | null;
          pt_ps: number | null;
          qa_ps: number | null;
          initial_grade: number | null;
          quarterly_grade: number | null;
          letter_grade: string | null;
          is_na: boolean;
        };
      }>(
        `/api/grading-sheets/${sheetId}/entries/${vars.entryId}`,
        jsonInit('PATCH', vars.payload)
      ),
  });

  const patchEntry = useCallback(
    async (
      entryId: string,
      target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>,
      body: Partial<
        Pick<
          GradeRow,
          'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na'
        >
      >,
      slotLabel?: {
        kind: SlotKind;
        index: number | null;
        meta: SlotMeta | { label: string | null };
      }
    ) => {
      let extraPayload: Record<string, unknown> = {};
      let bodyOverride: Partial<
        Pick<
          GradeRow,
          'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na'
        >
      > | null = null;
      // Fold the touched fields back to the last server-confirmed values —
      // used when the commit fails or the approval dialog is cancelled, since
      // typing already updated the row optimistically (onLocalChange / the
      // N/A checkbox flip) and the cell would otherwise keep showing a value
      // that was never saved.
      const revertEntry = () => {
        const saved = savedRowsRef.current.get(entryId);
        if (!saved) return;
        setRows((current) =>
          current.map((r) =>
            r.entry_id === entryId
              ? revertPatchedFields(r, saved, body as EntryPatchBody)
              : r
          )
        );
      };

      if (requireApproval) {
        const ref = await requireChangeReference({
          sheetId,
          entryId,
          ...target,
        });
        if (!ref) {
          revertEntry();
          return;
        }
        if (ref.mode === 'request') {
          extraPayload = {
            change_request_id: ref.change_request_id,
            patch_target: target,
          };
          bodyOverride = approvedValueToPatchBody(
            target.field,
            target.slotIndex ?? null,
            ref.proposed_value,
            rowsRef.current.find((r) => r.entry_id === entryId) ?? null,
            wwTotals.length,
            ptTotals.length
          );
        } else {
          extraPayload = {
            correction_reason: ref.correction_reason,
            correction_justification: ref.correction_justification,
            patch_target: target,
          };
        }
      }

      setSavingId(entryId);
      try {
        const payload = {
          ...body,
          ...(bodyOverride ?? {}),
          ...extraPayload,
          ...(slotLabel ? { slot_label: slotLabel } : {}),
        };
        const data = await entryMutation.mutateAsync({ entryId, payload });
        setRows((current) =>
          current.map((r) =>
            r.entry_id === entryId ? applyServerEntry(r, data.entry) : r
          )
        );
        // Advance the last-saved snapshot to the server-confirmed state so a
        // later failed commit reverts to THIS save, not the page-load values.
        const savedPrev = savedRowsRef.current.get(entryId);
        if (savedPrev) {
          savedRowsRef.current.set(
            entryId,
            applyServerEntry(savedPrev, data.entry)
          );
        }
        if ('change_request_id' in extraPayload) {
          toast.success('Change request applied — teacher will be notified');
        } else if ('correction_reason' in extraPayload) {
          toast.success('Correction logged on activity history');
        }
      } catch (e) {
        // The commit did NOT persist — fold the optimistic cell (and its
        // derived Total) back to the last saved values so the grid never
        // keeps displaying a rejected score.
        revertEntry();
        // Preserve the exact per-cell error voices: a non-2xx (ApiError) keeps
        // the "Failed to save #N Name: {server error}" line with the same
        // 'save failed' fallback (reading body.error off ApiError.body); any
        // other failure (network) keeps the generic 'Failed to save entry'.
        if (e instanceof ApiError) {
          const row = rowsRef.current.find((r) => r.entry_id === entryId);
          const serverError =
            (e.body as { error?: string } | null)?.error ?? 'save failed';
          toast.error(
            `Failed to save ${row ? `#${row.index_number} ${row.student_name}` : 'entry'}: ${serverError}`
          );
        } else {
          toast.error(e instanceof Error ? e.message : 'Failed to save entry');
        }
      } finally {
        setSavingId(null);
      }
    },
    [
      sheetId,
      requireApproval,
      requireChangeReference,
      wwTotals.length,
      ptTotals.length,
      entryMutation,
    ]
  );

  // First-score label gate wrapper — intercepts a slot's genuine first score
  // (unlocked/direct-edit path only; requireApproval/locked edits go through
  // patchEntry's own change-request/correction flow untouched) and routes it
  // through FirstScoreLabelDialog before it ever reaches the server. Mirrors
  // the server's own check (lib/grading/first-score-gate.ts) so client and
  // server independently agree on when a label is required.
  const commitScore = useCallback(
    (
      entryId: string,
      kind: SlotKind,
      slotIndex: number | null,
      target: Omit<ChangeReferenceTarget, 'sheetId' | 'entryId'>,
      body: Partial<Pick<GradeRow, 'ww_scores' | 'pt_scores' | 'qa_score'>>,
      value: number | null
    ) => {
      const gated =
        !readOnly &&
        !requireApproval &&
        value != null &&
        !slotAlreadyScored(kind, slotIndex) &&
        !slotMetaSatisfied(
          kind,
          kind === 'qa'
            ? labelsRef.current.qa
            : labelsRef.current[kind][slotIndex!]
        );
      if (gated) {
        const seedMeta: SlotMeta =
          kind === 'qa'
            ? { label: labelsRef.current.qa ?? '', date: null, page: null }
            : ((labelsRef.current[kind][slotIndex!] as SlotMeta | null) ?? {
                label: '',
                date: '',
                page: '',
              });
        setPendingFirstScore({
          entryId,
          kind,
          slotIndex,
          target,
          body,
          seedMeta,
        });
        return;
      }
      patchEntry(entryId, target, body);
    },
    [readOnly, requireApproval, slotAlreadyScored, patchEntry]
  );

  // Dialog confirm — persist the label locally (optimistic, mirrors the
  // Activity Labels panel's own edit path) and fire ONE combined PATCH
  // carrying both the score and the slot_label (Task 2's server contract).
  const handleFirstScoreConfirm = useCallback(
    (meta: SlotMeta) => {
      if (!pendingFirstScore) return;
      const { entryId, kind, slotIndex, target, body } = pendingFirstScore;
      if (kind === 'qa') {
        onQaChange(meta.label ?? '');
      } else {
        onSlotChange(kind, slotIndex as number, meta);
      }
      patchEntry(entryId, target, body, {
        kind,
        index: slotIndex,
        meta: kind === 'qa' ? { label: meta.label ?? null } : meta,
      });
      setPendingFirstScore(null);
    },
    [pendingFirstScore, onQaChange, onSlotChange, patchEntry]
  );

  // Dialog cancel — nothing was ever sent to the server, so just fold the
  // optimistic cell back to the last saved value (mirrors patchEntry's own
  // revert-on-failure path).
  const handleFirstScoreCancel = useCallback(() => {
    if (!pendingFirstScore) return;
    const { entryId, body } = pendingFirstScore;
    const saved = savedRowsRef.current.get(entryId);
    if (saved) {
      setRows((current) =>
        current.map((r) =>
          r.entry_id === entryId
            ? revertPatchedFields(r, saved, body as EntryPatchBody)
            : r
        )
      );
    }
    setPendingFirstScore(null);
  }, [pendingFirstScore]);

  const updateLocal = useCallback(
    (entryId: string, patch: (row: GradeRow) => GradeRow) => {
      setRows((current) =>
        current.map((r) => (r.entry_id === entryId ? patch(r) : r))
      );
    },
    []
  );

  // # + Student | WW slots + (Total PS WS) | PT slots + (Total PS WS) | QA (Exam PS WS) | Initial | Quarterly | N/A | Alerts
  // The trailing Alerts column only exists in T2+ (no prior term to compare in T1).
  const totalCols =
    2 +
    (wwLen + 3) +
    (ptLen > 0 ? ptLen + 3 : 0) +
    3 +
    1 +
    1 +
    1 +
    (currentTermNumber > 1 ? 1 : 0);

  const wwPct = Math.round(wwWeight * 100);
  const ptPct = Math.round(ptWeight * 100);
  const qaPct = Math.round(qaWeight * 100);
  const wwMaxTotal = wwTotals.reduce((a, b) => a + b, 0);
  const ptMaxTotal = ptTotals.reduce((a, b) => a + b, 0);

  // Per-slot "has at least one score entered" — drives the soft "needs a label"
  // flag in the ScoringGuide (a slot with scores but no description).
  // "Has any score in this slot" is a property of the DATA, not the current
  // view — compute over the full roster (rows), not visibleRows, so the
  // unlabeled-slot flag doesn't flicker when the teacher filters/searches.
  const wwScored = useMemo(
    () =>
      Array.from({ length: wwLen }, (_, i) =>
        rows.some((r) => r.ww_scores[i] != null)
      ),
    [rows, wwLen]
  );
  const ptScored = useMemo(
    () =>
      Array.from({ length: ptLen }, (_, i) =>
        rows.some((r) => r.pt_scores[i] != null)
      ),
    [rows, ptLen]
  );

  return (
    <div className="space-y-3">
      <ScoringGuide
        wwTotals={wwTotals}
        ptTotals={ptTotals}
        qaTotal={qaTotal}
        labels={labels}
        wwPct={wwPct}
        ptPct={ptPct}
        qaPct={qaPct}
        wwScored={wwScored}
        ptScored={ptScored}
        canEditLabels={canEditLabels}
        saving={savingLabels}
        onSlotChange={onSlotChange}
        onQaChange={onQaChange}
        commit={saveLabels}
      />
      <div className="flex items-center justify-between gap-3">
        <GridFilterToolbar
          filters={filters}
          onChange={setFilters}
          total={rows.length}
          visible={visibleRows.length}
        />
        {savingId && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-indigo/20 bg-brand-indigo/8 px-2.5 py-1 font-mono text-[11px] font-semibold text-brand-indigo">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </span>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            {/* Row 1 — group headers */}
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead
                rowSpan={3}
                className="sticky left-0 z-10 bg-muted/60 w-8 align-bottom text-right font-mono text-[10px] text-muted-foreground/60"
              >
                #
              </TableHead>
              <TableHead
                rowSpan={3}
                className="sticky left-8 z-10 min-w-[160px] border-r-2 border-border/60 bg-muted/60 align-bottom text-xs text-muted-foreground"
              >
                Student
              </TableHead>
              {wwLen > 0 && (
                <TableHead
                  colSpan={wwLen + 3}
                  className="border-r-2 border-border/60 bg-brand-indigo text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
                >
                  Written Works ({wwPct}%)
                </TableHead>
              )}
              {ptLen > 0 && (
                <TableHead
                  colSpan={ptLen + 3}
                  className="border-r-2 border-border/60 bg-brand-indigo-deep text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
                >
                  Performance Tasks ({ptPct}%)
                </TableHead>
              )}
              <TableHead
                colSpan={3}
                className="border-r-2 border-border/60 bg-brand-amber text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white"
              >
                Quarterly Assessment ({qaPct}%)
              </TableHead>
              <TableHead
                rowSpan={3}
                className="border-l-2 border-border/40 align-bottom text-right text-[10px] text-muted-foreground/70"
              >
                Initial
                <br />
                Grade
              </TableHead>
              <TableHead
                rowSpan={3}
                className="align-bottom text-right text-xs text-muted-foreground"
              >
                Quarterly
                <br />
                Grade
              </TableHead>
              <TableHead
                rowSpan={3}
                className="align-bottom text-center text-xs text-muted-foreground"
              >
                {letterDisplay ? 'Override' : 'N/A'}
              </TableHead>
              {/* No prior term to compare against in T1 — drop the column. */}
              {currentTermNumber > 1 && (
                <TableHead
                  rowSpan={3}
                  className="align-bottom text-center text-xs text-muted-foreground"
                >
                  Alerts
                </TableHead>
              )}
            </TableRow>

            {/* Row 2 — column codes */}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {wwTotals.map((_, i) => (
                <TableHead
                  key={`ww-lbl-${i}`}
                  className="text-center font-mono text-xs font-semibold text-foreground"
                >
                  W{i + 1}
                </TableHead>
              ))}
              <TableHead className="text-center font-mono text-[10px] text-muted-foreground">
                Total
              </TableHead>
              <TableHead className="text-center font-mono text-[10px] text-muted-foreground">
                PS
              </TableHead>
              <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground">
                WS
              </TableHead>
              {ptLen > 0 && (
                <>
                  {ptTotals.map((_, i) => (
                    <TableHead
                      key={`pt-lbl-${i}`}
                      className="text-center font-mono text-xs font-semibold text-foreground"
                    >
                      PT{i + 1}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-mono text-[10px] text-muted-foreground">
                    Total
                  </TableHead>
                  <TableHead className="text-center font-mono text-[10px] text-muted-foreground">
                    PS
                  </TableHead>
                  <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground">
                    WS
                  </TableHead>
                </>
              )}
              <TableHead className="text-center font-mono text-xs font-semibold text-foreground">
                Exam
              </TableHead>
              <TableHead className="text-center font-mono text-[10px] text-muted-foreground">
                PS
              </TableHead>
              <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground">
                WS
              </TableHead>
            </TableRow>

            {/* Row 3 — max values reference row */}
            <TableRow className="bg-muted/20 hover:bg-muted/20">
              {wwTotals.map((max, i) => (
                <TableHead
                  key={`ww-max-${i}`}
                  className="text-center font-mono text-[10px] tabular-nums text-muted-foreground/50"
                >
                  {max}
                </TableHead>
              ))}
              <TableHead className="text-center font-mono text-[10px] tabular-nums text-muted-foreground/50">
                {wwMaxTotal}
              </TableHead>
              <TableHead className="text-center font-mono text-[10px] text-muted-foreground/50">
                100%
              </TableHead>
              <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground/50">
                {wwPct}%
              </TableHead>
              {ptLen > 0 && (
                <>
                  {ptTotals.map((max, i) => (
                    <TableHead
                      key={`pt-max-${i}`}
                      className="text-center font-mono text-[10px] tabular-nums text-muted-foreground/50"
                    >
                      {max}
                    </TableHead>
                  ))}
                  <TableHead className="text-center font-mono text-[10px] tabular-nums text-muted-foreground/50">
                    {ptMaxTotal}
                  </TableHead>
                  <TableHead className="text-center font-mono text-[10px] text-muted-foreground/50">
                    100%
                  </TableHead>
                  <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground/50">
                    {ptPct}%
                  </TableHead>
                </>
              )}
              <TableHead className="text-center font-mono text-[10px] tabular-nums text-muted-foreground/50">
                {qaTotal ?? '—'}
              </TableHead>
              <TableHead className="text-center font-mono text-[10px] text-muted-foreground/50">
                100%
              </TableHead>
              <TableHead className="border-r-2 border-border/60 text-center font-mono text-[10px] text-muted-foreground/50">
                {qaPct}%
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={totalCols}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No students match the current filters.
                </TableCell>
              </TableRow>
            )}
            {visibleRows.map((r) => {
              const inputsDisabled = r.withdrawn || r.is_na || readOnly;
              const rowClass = r.withdrawn
                ? 'opacity-50'
                : r.is_na
                  ? 'text-muted-foreground'
                  : '';

              const wwTotal = sumScores(r.ww_scores, wwLen);
              const ptTotal = sumScores(r.pt_scores, ptLen);
              const wwWs = r.ww_ps != null ? r.ww_ps * wwWeight : null;
              const ptWs = r.pt_ps != null ? r.pt_ps * ptWeight : null;
              const qaWs = r.qa_ps != null ? r.qa_ps * qaWeight : null;

              return (
                <TableRow
                  key={r.entry_id}
                  className={`transition-colors duration-75 hover:bg-accent/30 ${rowClass}`}
                >
                  {/* # */}
                  <TableCell className="sticky left-0 z-10 w-8 bg-card text-right font-mono tabular-nums text-[11px] text-muted-foreground/60">
                    {r.index_number}
                  </TableCell>

                  {/* Student */}
                  <TableCell className="sticky left-8 z-10 min-w-[160px] border-r-2 border-border/40 bg-card py-2">
                    <div
                      className={
                        r.withdrawn
                          ? 'whitespace-nowrap text-sm font-medium text-muted-foreground line-through'
                          : 'whitespace-nowrap text-sm font-medium text-foreground'
                      }
                    >
                      {r.student_name}
                    </div>
                    <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.student_number}
                    </div>
                    {r.late_enrollee && !r.withdrawn && (
                      <span
                        className="mt-0.5 inline-flex items-center rounded bg-brand-amber/10 px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wider text-brand-amber"
                        title="Earlier assessments stay blank and are excluded from the average — proration is automatic."
                      >
                        Late
                      </span>
                    )}
                  </TableCell>

                  {/* WW inputs */}
                  {wwTotals.map((max, i) => (
                    <TableCell key={`ww-${i}`} className="px-1 py-1">
                      <ScoreInput
                        value={r.ww_scores[i] ?? null}
                        max={max}
                        plaintext={locked}
                        disabled={inputsDisabled}
                        onLocalChange={(v) =>
                          updateLocal(r.entry_id, (row) => ({
                            ...row,
                            ww_scores: replaceAt(
                              row.ww_scores,
                              i,
                              v,
                              wwTotals.length
                            ),
                          }))
                        }
                        onCommit={(v) => {
                          const next = replaceAt(
                            r.ww_scores,
                            i,
                            v,
                            wwTotals.length
                          );
                          commitScore(
                            r.entry_id,
                            'ww',
                            i,
                            { field: 'ww_scores', slotIndex: i },
                            { ww_scores: next },
                            v
                          );
                        }}
                      />
                    </TableCell>
                  ))}
                  <ComputedCell value={wwTotal} dp={0} />
                  <ComputedCell value={r.ww_ps} />
                  <ComputedCell value={wwWs} groupEnd />

                  {/* PT inputs */}
                  {ptLen > 0 && (
                    <>
                      {ptTotals.map((max, i) => (
                        <TableCell key={`pt-${i}`} className="px-1 py-1">
                          <ScoreInput
                            value={r.pt_scores[i] ?? null}
                            max={max}
                            plaintext={locked}
                            disabled={inputsDisabled}
                            onLocalChange={(v) =>
                              updateLocal(r.entry_id, (row) => ({
                                ...row,
                                pt_scores: replaceAt(
                                  row.pt_scores,
                                  i,
                                  v,
                                  ptTotals.length
                                ),
                              }))
                            }
                            onCommit={(v) => {
                              const next = replaceAt(
                                r.pt_scores,
                                i,
                                v,
                                ptTotals.length
                              );
                              commitScore(
                                r.entry_id,
                                'pt',
                                i,
                                { field: 'pt_scores', slotIndex: i },
                                { pt_scores: next },
                                v
                              );
                            }}
                          />
                        </TableCell>
                      ))}
                      <ComputedCell value={ptTotal} dp={0} />
                      <ComputedCell value={r.pt_ps} />
                      <ComputedCell value={ptWs} groupEnd />
                    </>
                  )}

                  {/* QA input */}
                  <TableCell className="px-1 py-1">
                    <ScoreInput
                      value={r.qa_score}
                      max={qaTotal}
                      plaintext={locked}
                      disabled={inputsDisabled}
                      onLocalChange={(v) =>
                        updateLocal(r.entry_id, (row) => ({
                          ...row,
                          qa_score: v,
                        }))
                      }
                      onCommit={(v) =>
                        commitScore(
                          r.entry_id,
                          'qa',
                          null,
                          { field: 'qa_score', slotIndex: null },
                          { qa_score: v },
                          v
                        )
                      }
                    />
                  </TableCell>
                  <ComputedCell value={r.qa_ps} />
                  <ComputedCell value={qaWs} groupEnd />

                  {/* Initial grade — de-emphasised; the quarterly is the result the teacher cares about */}
                  <TableCell className="border-l-2 border-border/30 px-2 text-right font-mono tabular-nums text-[11px] text-muted-foreground/60">
                    {r.initial_grade != null ? r.initial_grade.toFixed(2) : '—'}
                  </TableCell>

                  {/* Quarterly grade — derived letter for non-examinable subjects (KD #104) */}
                  <TableCell className="text-right tabular-nums">
                    <QuarterlyPill
                      value={r.quarterly_grade}
                      muted={r.withdrawn || r.is_na || readOnly}
                      letter={
                        letterDisplay
                          ? resolveNonExaminableLetter({
                              isNa: r.is_na,
                              letterOverride: r.letter_grade,
                              quarterly: r.quarterly_grade,
                            })
                          : undefined
                      }
                    />
                  </TableCell>

                  {/* N/A (examinable) — or override code —/N/A/UG/E for
                      non-examinable subjects (KD #104). */}
                  <TableCell className="text-center">
                    {letterDisplay ? (
                      <Select
                        value={rowToOverrideChoice(r)}
                        disabled={r.withdrawn || readOnly}
                        onValueChange={(v) => {
                          const next =
                            OVERRIDE_CHOICE_TO_COLUMNS[v as OverrideChoice];
                          const isNaChanged = next.is_na !== r.is_na;
                          const letterChanged =
                            next.letter_grade !== (r.letter_grade ?? null);
                          if (!isNaChanged && !letterChanged) return;
                          // A locked-sheet change request carries a single
                          // field; the N/A↔UG/E jump touches both columns, so
                          // make the registrar clear to '—' first.
                          if (requireApproval && isNaChanged && letterChanged) {
                            toast.error(
                              'On a locked sheet, set this to “—” first, then choose UG or E.'
                            );
                            return;
                          }
                          patchEntry(
                            r.entry_id,
                            {
                              field: letterChanged ? 'letter_grade' : 'is_na',
                              slotIndex: null,
                            },
                            {
                              is_na: next.is_na,
                              letter_grade: next.letter_grade,
                            }
                          );
                        }}
                      >
                        <SelectTrigger
                          className="mx-auto h-7 w-[4.75rem] justify-center px-2 font-mono text-xs"
                          aria-label="Grade override"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">—</SelectItem>
                          <SelectItem value="NA">N/A</SelectItem>
                          <SelectItem value="UG">UG</SelectItem>
                          <SelectItem value="E">E</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Checkbox
                        checked={r.is_na}
                        disabled={r.withdrawn || readOnly}
                        aria-label="Mark late enrollee N/A"
                        onCheckedChange={(v) => {
                          const next = v === true;
                          updateLocal(r.entry_id, (row) => ({
                            ...row,
                            is_na: next,
                          }));
                          patchEntry(
                            r.entry_id,
                            { field: 'is_na', slotIndex: null },
                            { is_na: next }
                          );
                        }}
                      />
                    )}
                  </TableCell>

                  {/* Alerts — column hidden entirely in T1 (no prior term). */}
                  {currentTermNumber > 1 && (
                    <TableCell className="text-center">
                      <AlertCell
                        row={r}
                        priorTermGrades={
                          priorGrades?.[r.section_student_id] ?? []
                        }
                        currentTermNumber={currentTermNumber}
                        onOpen={(comparisons) =>
                          setAlertDialogState({
                            studentName: r.student_name,
                            currentGrade: r.quarterly_grade!,
                            comparisons,
                          })
                        }
                      />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {approvalDialog}

      {pendingFirstScore && (
        <FirstScoreLabelDialog
          open
          kind={pendingFirstScore.kind}
          slotCode={
            pendingFirstScore.kind === 'qa'
              ? 'QA'
              : pendingFirstScore.kind === 'ww'
                ? `W${(pendingFirstScore.slotIndex as number) + 1}`
                : `PT${(pendingFirstScore.slotIndex as number) + 1}`
          }
          seedMeta={pendingFirstScore.seedMeta}
          onConfirm={handleFirstScoreConfirm}
          onCancel={handleFirstScoreCancel}
        />
      )}

      {alertDialogState && (
        <GradeDiffDialog
          open
          onOpenChange={(open) => {
            if (!open) setAlertDialogState(null);
          }}
          studentName={alertDialogState.studentName}
          currentTermLabel={currentTermLabel}
          currentGrade={alertDialogState.currentGrade}
          comparisons={alertDialogState.comparisons}
        />
      )}
    </div>
  );
}

function computeComparisons(
  currentGrade: number,
  priorTermGrades: PriorTermGrade[]
): AlertComparison[] {
  return priorTermGrades
    .filter((p) => p.quarterly_grade !== null)
    .map((p) => {
      const diff = currentGrade - p.quarterly_grade!;
      return {
        term_label: p.term_label,
        term_number: p.term_number,
        prior_grade: p.quarterly_grade!,
        diff,
        flagged: Math.abs(diff) >= 5,
      };
    });
}

function AlertCell({
  row,
  priorTermGrades,
  currentTermNumber,
  onOpen,
}: {
  row: GradeRow;
  priorTermGrades: PriorTermGrade[];
  currentTermNumber: number;
  onOpen: (comparisons: AlertComparison[]) => void;
}) {
  if (
    currentTermNumber <= 1 ||
    row.is_na ||
    row.withdrawn ||
    row.quarterly_grade == null
  ) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground/40">—</span>
    );
  }

  const comparisons = computeComparisons(row.quarterly_grade, priorTermGrades);
  // No prior-term grades to compare against — nothing to show.
  if (comparisons.length === 0) {
    return (
      <span className="font-mono text-[11px] text-muted-foreground/40">—</span>
    );
  }

  const flaggedCount = comparisons.filter((c) => c.flagged).length;
  // Largest term-over-term swing (by magnitude) — surfaced on the chip so the
  // comparison stays glanceable even when nothing crosses the ±5 alert threshold.
  const biggest = comparisons.reduce((a, b) =>
    Math.abs(b.diff) > Math.abs(a.diff) ? b : a
  );
  const absBig = Math.abs(biggest.diff);
  const signedBig =
    biggest.diff > 0 ? `+${absBig}` : biggest.diff < 0 ? `−${absBig}` : '0';

  if (flaggedCount === 0) {
    // Comparison available but below the ±5 alert threshold — neutral chip
    // showing the biggest delta; click to view the full term-over-term breakdown.
    const neutralLabel = `Largest change ${signedBig} vs a prior term — click to compare`;
    return (
      <button
        type="button"
        onClick={() => onOpen(comparisons)}
        title={neutralLabel}
        aria-label={neutralLabel}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground transition hover:border-hairline-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/30"
      >
        {signedBig}
      </button>
    );
  }

  const label = `${flaggedCount} significant grade change${
    flaggedCount === 1 ? '' : 's'
  } (≥5 points) — click to view`;

  return (
    <button
      type="button"
      onClick={() => onOpen(comparisons)}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full border border-transparent bg-gradient-to-b from-brand-amber to-brand-amber/85 px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_1px_2px_rgba(15,23,42,0.08)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40"
    >
      <AlertTriangle className="h-3 w-3" />
      {flaggedCount}
    </button>
  );
}

function ScoringGuide({
  wwTotals,
  ptTotals,
  qaTotal,
  labels,
  wwPct,
  ptPct,
  qaPct,
  wwScored,
  ptScored,
  canEditLabels = false,
  saving = false,
  onSlotChange,
  onQaChange,
  commit,
}: {
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  labels: Required<SlotLabels>;
  wwPct: number;
  ptPct: number;
  qaPct: number;
  /** Per-slot "has at least one score" — flags scored-but-unlabeled slots. */
  wwScored: boolean[];
  ptScored: boolean[];
  /** When true, rows render inline editors and autosave on blur. */
  canEditLabels?: boolean;
  /** Saving indicator (true while a label PATCH is in flight). */
  saving?: boolean;
  onSlotChange?: (
    kind: 'ww' | 'pt',
    index: number,
    patch: Partial<SlotMeta>
  ) => void;
  onQaChange?: (value: string) => void;
  /** Persist all labels (called on blur of an editable field). */
  commit?: () => void;
}) {
  // When the guide is editable, default it open so editors land on the rows.
  const [expanded, setExpanded] = useState(canEditLabels);

  const effectiveWw = (i: number): SlotMeta | null => {
    return labels.ww[i] ?? null;
  };
  const effectivePt = (i: number): SlotMeta | null => {
    return labels.pt[i] ?? null;
  };

  // A slot "needs a label" when it has scores but no description set.
  const needsLabelWw = (i: number): boolean =>
    !!wwScored[i] && !effectiveWw(i)?.label;
  const needsLabelPt = (i: number): boolean =>
    !!ptScored[i] && !effectivePt(i)?.label;

  const flaggedCount =
    wwTotals.reduce((acc, _, i) => acc + (needsLabelWw(i) ? 1 : 0), 0) +
    ptTotals.reduce((acc, _, i) => acc + (needsLabelPt(i) ? 1 : 0), 0);

  const summaryParts = [
    wwTotals.length > 0
      ? `${wwTotals.length} Written Work${wwTotals.length !== 1 ? 's' : ''}`
      : null,
    ptTotals.length > 0
      ? `${ptTotals.length} Performance Task${ptTotals.length !== 1 ? 's' : ''}`
      : null,
    'QA',
  ].filter(Boolean);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-gradient-to-t from-primary/5 to-card">
      {/* Toggle row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        {canEditLabels && (
          <span className="shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">
            Activity labels
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {summaryParts.map((part, i) => (
            <span key={i}>
              {i > 0 && (
                <span className="mx-1.5 select-none opacity-40">·</span>
              )}
              {part}
            </span>
          ))}
          {flaggedCount > 0 && (
            <span className="inline-flex items-center font-semibold text-brand-amber">
              <span className="mx-1.5 select-none text-muted-foreground opacity-40">
                ·
              </span>
              <AlertTriangle className="mr-1 h-3 w-3" />
              {flaggedCount} need{flaggedCount === 1 ? 's' : ''} a label
            </span>
          )}
        </span>
        {saving && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-mono text-[10px] font-semibold text-brand-indigo">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </span>
        )}
      </button>

      {/* Expanded grouped list */}
      {expanded && (
        <div className="divide-y divide-border/40 border-t border-border/40">
          {wwTotals.length > 0 && (
            <div className="px-3 py-3">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Written Works ({wwPct}%)
              </p>
              <div className="space-y-1.5">
                {wwTotals.map((max, i) => (
                  <ActivityRow
                    key={i}
                    code={`W${i + 1}`}
                    max={max}
                    meta={effectiveWw(i)}
                    needsLabel={needsLabelWw(i)}
                    editable={canEditLabels}
                    placeholder="e.g. Worksheet 2: Multiplication Tables"
                    onMetaChange={(patch) => onSlotChange?.('ww', i, patch)}
                    onCommit={commit}
                  />
                ))}
              </div>
            </div>
          )}
          {ptTotals.length > 0 && (
            <div className="px-3 py-3">
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Performance Tasks ({ptPct}%)
              </p>
              <div className="space-y-1.5">
                {ptTotals.map((max, i) => (
                  <ActivityRow
                    key={i}
                    code={`PT${i + 1}`}
                    max={max}
                    meta={effectivePt(i)}
                    needsLabel={needsLabelPt(i)}
                    editable={canEditLabels}
                    placeholder="e.g. Quiz 1"
                    onMetaChange={(patch) => onSlotChange?.('pt', i, patch)}
                    onCommit={commit}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="px-3 py-3">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Quarterly Assessment ({qaPct}%)
            </p>
            <ActivityRow
              code="QA"
              max={qaTotal}
              fixedLabel="Exam"
              editable={canEditLabels}
              qaMode
              qaValue={labels.qa ?? ''}
              placeholder="e.g. Quarterly Exam"
              onQaChange={onQaChange}
              onCommit={commit}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function formatChipDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

function ActivityRow({
  code,
  max,
  meta,
  fixedLabel,
  needsLabel = false,
  editable = false,
  qaMode = false,
  qaValue = '',
  placeholder,
  onMetaChange,
  onQaChange,
  onCommit,
}: {
  code: string;
  max?: number | null;
  meta?: SlotMeta | null;
  fixedLabel?: string;
  /** Scored but no description set — soft amber flag (non-blocking). */
  needsLabel?: boolean;
  /** Inline edit mode — description / page / date inputs that autosave on blur. */
  editable?: boolean;
  /** QA row — single description input, no page/date (mirrors the old dialog). */
  qaMode?: boolean;
  qaValue?: string;
  placeholder?: string;
  onMetaChange?: (patch: Partial<SlotMeta>) => void;
  onQaChange?: (value: string) => void;
  /** Persist all labels (blur autosave). */
  onCommit?: () => void;
}) {
  const codeChip = (
    <span className="inline-flex h-6 min-w-[3.5rem] shrink-0 items-center justify-center gap-0.5 rounded-md border border-border bg-muted/60 px-1.5 font-mono text-[11px] font-semibold tabular-nums text-foreground">
      {code}
      {max != null && (
        <span className="text-[9px] font-normal text-muted-foreground/60">
          /{max}
        </span>
      )}
    </span>
  );

  // ── Editable mode ──────────────────────────────────────────────────────
  // Autosave fires on blur of the wrapping field group (a focus move out of
  // the row's inputs); typing never saves. The DatePicker commits via its own
  // onChange (a discrete pick), so a value change there also persists.
  if (editable) {
    if (qaMode) {
      return (
        <div className="group -mx-1 flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
          {codeChip}
          <Input
            value={qaValue}
            onChange={(e) => onQaChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            placeholder={placeholder}
            className="h-8 flex-1 text-sm"
            maxLength={120}
            aria-label="Quarterly assessment description"
          />
        </div>
      );
    }
    return (
      <div className="group -mx-1 flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
        {codeChip}
        <Input
          value={meta?.label ?? ''}
          onChange={(e) => onMetaChange?.({ label: e.target.value })}
          onBlur={() => onCommit?.()}
          placeholder={placeholder}
          className="h-8 flex-1 text-sm"
          maxLength={120}
          aria-label={`${code} description`}
        />
        <Input
          value={meta?.page ?? ''}
          onChange={(e) => onMetaChange?.({ page: e.target.value })}
          onBlur={() => onCommit?.()}
          placeholder="p.#"
          className="h-8 w-16 shrink-0 text-sm"
          maxLength={40}
          aria-label={`${code} page number`}
        />
        <DateAdministeredField
          value={meta?.date ?? ''}
          onChange={(date) => {
            onMetaChange?.({ date });
            // A date pick / Ongoing toggle / clear is a discrete commit — persist
            // here (NOT via a wrapping onBlur: the popover returns focus inside
            // the row, so a blur would either miss the pick or double-fire).
            onCommit?.();
          }}
        />
      </div>
    );
  }

  // ── Read-only mode (unchanged design) ──────────────────────────────────
  const label = fixedLabel ?? meta?.label;
  const isOngoing = meta?.date === 'Ongoing';
  const hasDate = !!meta?.date;
  const hasPage = !!meta?.page;

  return (
    <div className="group -mx-1 flex items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
      {/* Code chip — neutral; the list is already grouped by activity type.
          Mono code (the data voice) with the max demoted to micro-copy. */}
      <span className="inline-flex h-6 min-w-[3.5rem] shrink-0 items-center justify-center gap-0.5 rounded-md border border-border bg-muted/60 px-1.5 font-mono text-[11px] font-semibold tabular-nums text-foreground">
        {code}
        {max != null && (
          <span className="text-[9px] font-normal text-muted-foreground/60">
            /{max}
          </span>
        )}
      </span>

      {/* Label (body voice) — three states: set / scored-but-missing (amber
          soft flag) / unset. Warning carries icon + text, never colour alone. */}
      {label ? (
        <span className="flex-1 truncate text-sm text-foreground">{label}</span>
      ) : needsLabel ? (
        <span className="flex flex-1 items-center gap-1 text-sm font-medium text-brand-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Needs a label
        </span>
      ) : (
        <span className="flex-1 truncate text-sm italic text-muted-foreground/50">
          No label set
        </span>
      )}

      {/* Right metadata (mono micro-copy). "Ongoing" is a state → accent pill;
          a real date gets a calendar glyph; page number trails, muted. */}
      {(hasDate || hasPage) && (
        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {isOngoing ? (
            <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-brand-indigo-deep">
              <Clock className="h-3 w-3" aria-hidden />
              Ongoing
            </span>
          ) : hasDate ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays
                className="h-3 w-3 text-muted-foreground/70"
                aria-hidden
              />
              {formatChipDate(meta!.date!)}
            </span>
          ) : null}
          {hasPage && (
            <span className="text-muted-foreground/60">· p.{meta!.page}</span>
          )}
        </span>
      )}
    </div>
  );
}

function QuarterlyPill({
  value,
  muted,
  letter,
}: {
  value: number | null;
  muted: boolean;
  /** When provided (non-examinable subjects, KD #104), renders the derived
   *  letter instead of the numeric quarterly. `null` = no grade yet. */
  letter?: NonExaminableLetter | null;
}) {
  // Non-examinable subjects show A/B/C/IP (derived) or NA/UG/E (override).
  if (letter !== undefined) {
    if (letter == null) {
      return (
        <span className="font-mono text-base font-semibold text-muted-foreground/50">
          —
        </span>
      );
    }
    // NA / UG / E and muted rows (withdrawn, locked) read as neutral.
    const letterTone =
      muted || letter === 'NA' || letter === 'UG' || letter === 'E'
        ? 'border-hairline bg-muted text-muted-foreground'
        : letter === 'A' || letter === 'B'
          ? 'border-brand-mint/60 bg-brand-mint/20 text-ink'
          : letter === 'C'
            ? 'border-hairline bg-muted text-ink'
            : 'border-brand-amber/50 bg-brand-amber/20 text-ink'; // IP — in progress
    return (
      <Badge
        variant="outline"
        className={`h-7 min-w-9 justify-center px-2 font-mono text-sm font-semibold ${letterTone}`}
      >
        {letter}
      </Badge>
    );
  }
  if (value == null) {
    return (
      <span className="font-mono text-base font-semibold text-muted-foreground/50">
        —
      </span>
    );
  }
  if (muted) {
    return (
      <span className="font-mono text-base font-semibold tabular-nums text-muted-foreground/60">
        {value}
      </span>
    );
  }
  const tone =
    value < 75
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : value < 85
        ? 'border-hairline bg-muted text-ink'
        : 'border-brand-mint/60 bg-brand-mint/20 text-ink';
  return (
    <Badge
      variant="outline"
      className={`h-7 justify-end px-2 font-mono text-sm font-semibold tabular-nums ${tone}`}
    >
      {value}
    </Badge>
  );
}

function sumScores(scores: (number | null)[], len: number): number | null {
  const slice = scores.slice(0, len);
  if (slice.every((v) => v === null)) return null;
  return slice.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function ComputedCell({
  value,
  dp = 2,
  groupEnd,
}: {
  value: number | null;
  dp?: number;
  groupEnd?: boolean;
}) {
  return (
    <TableCell
      className={`px-2 text-right font-mono tabular-nums text-xs text-muted-foreground${groupEnd ? ' border-r-2 border-border/60' : ''}`}
    >
      {value != null ? value.toFixed(dp) : '—'}
    </TableCell>
  );
}

function replaceAt(
  arr: (number | null)[],
  i: number,
  v: number | null,
  length: number
): (number | null)[] {
  const out = new Array<number | null>(length).fill(null);
  for (let k = 0; k < length; k++) out[k] = arr[k] ?? null;
  out[i] = v;
  return out;
}

function approvedValueToPatchBody(
  field: 'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na',
  slotIndex: number | null,
  proposed: string,
  row: GradeRow | null,
  wwLength: number,
  ptLength: number
): Partial<
  Pick<
    GradeRow,
    'ww_scores' | 'pt_scores' | 'qa_score' | 'letter_grade' | 'is_na'
  >
> | null {
  switch (field) {
    case 'ww_scores': {
      if (slotIndex == null || row == null) return null;
      return {
        ww_scores: replaceAt(
          row.ww_scores,
          slotIndex,
          parseCell(proposed),
          wwLength
        ),
      };
    }
    case 'pt_scores': {
      if (slotIndex == null || row == null) return null;
      return {
        pt_scores: replaceAt(
          row.pt_scores,
          slotIndex,
          parseCell(proposed),
          ptLength
        ),
      };
    }
    case 'qa_score':
      return { qa_score: parseCell(proposed) };
    case 'letter_grade': {
      const v = proposed.trim();
      return { letter_grade: v === '' ? null : v };
    }
    case 'is_na':
      return { is_na: proposed.trim().toLowerCase() === 'true' };
    default:
      return null;
  }
}

function ScoreInput({
  value,
  max,
  disabled,
  plaintext,
  onLocalChange,
  onCommit,
}: {
  value: number | null;
  max?: number | null;
  disabled?: boolean;
  plaintext?: boolean;
  onLocalChange: (v: number | null) => void;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState<string>(displayCell(value));

  // Re-sync the draft text when the row value changes UNDERNEATH the input —
  // i.e. a failed/cancelled commit reverted the optimistic row state. While
  // the user is typing, onLocalChange keeps `value` === parseCell(text), so
  // this bails out (returns the same string → React skips the re-render) and
  // never touches an in-progress draft. Same when a successful save echoes
  // the typed value back.
  useEffect(() => {
    setText((prev) => (parseCell(prev) === value ? prev : displayCell(value)));
  }, [value]);

  if (plaintext) {
    return (
      <span className="inline-block h-8 w-14 px-1.5 py-1 text-right font-mono text-sm tabular-nums text-ink">
        {displayCell(value) || '—'}
      </span>
    );
  }

  const parsed = parseCell(text);
  const isExceeded = parsed != null && max != null && parsed > max;

  return (
    <input
      type="number"
      inputMode="decimal"
      disabled={disabled}
      aria-invalid={isExceeded || undefined}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onLocalChange(parseCell(e.target.value));
      }}
      onBlur={() => {
        onCommit(parseCell(text));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-8 w-14 rounded-md border border-input bg-background px-1.5 text-right font-mono text-sm tabular-nums ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-destructive/5 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/20"
    />
  );
}
