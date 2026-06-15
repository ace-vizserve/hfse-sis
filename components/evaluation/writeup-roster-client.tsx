'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { EvaluationRosterStudent } from '@/lib/evaluation/queries';

type RowState = {
  student_id: string;
  index_number: number;
  student_number: string;
  student_name: string;
  /** Current textarea value. */
  writeup: string;
  /** Last value persisted to the server — drives the dirty/Saved indicator. */
  savedWriteup: string;
  submitted: boolean;
  submittedAt: string | null;
  saving: boolean;
  error: string | null;
};

// Adviser write-up roster. One <textarea> per student with explicit
// **Save as draft** and **Submit / Resubmit** buttons — no autosave. Nothing
// is persisted until a button is clicked (manual, predictable). Save as draft
// stores the text as a draft (and demotes a finalised write-up back to draft);
// Submit finalises it; once submitted, the primary button reads Resubmit.
//
// Read-only mode (`canEdit=false`) is for teachers before the virtue theme is
// set — they see the roster but can't type or save.
export function WriteupRosterClient({
  termId,
  sectionId,
  roster,
  canEdit,
}: {
  termId: string;
  sectionId: string;
  roster: EvaluationRosterStudent[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RowState[]>(() =>
    roster.map((r) => ({
      student_id: r.student_id,
      index_number: r.index_number,
      student_number: r.student_number,
      student_name: r.student_name,
      writeup: r.writeup ?? '',
      savedWriteup: r.writeup ?? '',
      submitted: r.submitted,
      submittedAt: r.submitted_at,
      saving: false,
      error: null,
    }))
  );

  type SaveVars = { studentId: string; text: string; submit: boolean };
  type SaveResult = { submitted?: boolean; submitted_at?: string | null };

  const saveMutation = useMutation({
    mutationFn: ({ studentId, text, submit }: SaveVars) =>
      apiFetch<SaveResult>(
        '/api/evaluation/writeups',
        jsonInit('PATCH', {
          termId,
          sectionId,
          studentId,
          writeup: text,
          submit,
        })
      ),
    onMutate: ({ studentId }) => {
      setRows((prev) =>
        prev.map((r) =>
          r.student_id === studentId ? { ...r, saving: true, error: null } : r
        )
      );
    },
    onSuccess: (body, { studentId, text, submit }) => {
      setRows((prev) =>
        prev.map((r) =>
          r.student_id === studentId
            ? {
                ...r,
                saving: false,
                error: null,
                savedWriteup: text,
                submitted: body?.submitted ?? r.submitted,
                submittedAt: body?.submitted_at ?? null,
              }
            : r
        )
      );
      toast.success(
        submit ? (body?.submitted ? 'Submitted' : 'Saved') : 'Saved as draft'
      );
      // Refresh so the section's "X of Y submitted" header count stays live.
      router.refresh();
    },
    onError: (e, { studentId }) => {
      // ApiError.message already equals the route's `error` body field, so the
      // route-specific message (not a generic one) is surfaced + stored on the row.
      const message = e instanceof Error ? e.message : 'save failed';
      setRows((prev) =>
        prev.map((r) =>
          r.student_id === studentId
            ? { ...r, saving: false, error: message }
            : r
        )
      );
      toast.error(message);
    },
  });

  const save = useCallback(
    (studentId: string, text: string, submit: boolean) => {
      saveMutation.mutate({ studentId, text, submit });
    },
    [saveMutation]
  );

  const rowCount = rows.length;

  // Summary reflects the *persisted* state (savedWriteup + submitted), not the
  // unsaved draft in the textarea.
  const countSummary = useMemo(() => {
    const submitted = rows.filter((r) => r.submitted).length;
    const drafted = rows.filter(
      (r) => !r.submitted && r.savedWriteup.trim().length > 0
    ).length;
    const empty = rowCount - submitted - drafted;
    return { submitted, drafted, empty };
  }, [rows, rowCount]);

  if (rowCount === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        No students on the roster.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Explainer + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          Comments save only when you click{' '}
          <span className="font-medium text-foreground">Save as draft</span> or{' '}
          <span className="font-medium text-foreground">Submit</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <StatusChip
            label="Submitted"
            value={countSummary.submitted}
            tone="success"
          />
          <StatusChip
            label="Drafted"
            value={countSummary.drafted}
            tone="info"
          />
          <StatusChip label="Empty" value={countSummary.empty} tone="muted" />
        </div>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((r) => {
          const dirty = r.writeup !== r.savedWriteup;
          const hasText = r.writeup.trim().length > 0;
          return (
            <li
              key={r.student_id}
              className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[240px_1fr_auto]"
            >
              {/* Student identity + workflow pill */}
              <div className="min-w-0 space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                    #{r.index_number}
                  </span>
                  <span className="font-serif text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                    {r.student_name}
                  </span>
                </div>
                <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {r.student_number}
                </div>
                <WorkflowPill
                  submitted={r.submitted}
                  submittedAt={r.submittedAt}
                  hasSavedText={r.savedWriteup.trim().length > 0}
                />
              </div>

              {/* Textarea + save state */}
              <div className="min-w-0">
                <textarea
                  value={r.writeup}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((row) =>
                        row.student_id === r.student_id
                          ? { ...row, writeup: e.target.value, error: null }
                          : row
                      )
                    )
                  }
                  disabled={!canEdit}
                  rows={4}
                  placeholder={
                    canEdit
                      ? 'One holistic paragraph through the lens of this term’s virtue theme…'
                      : 'Read-only — virtue theme not set.'
                  }
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                  <span>{r.writeup.length} chars</span>
                  <span className="text-border">·</span>
                  <SaveState
                    saving={r.saving}
                    error={r.error}
                    dirty={dirty}
                    hasSavedText={r.savedWriteup.trim().length > 0}
                  />
                </div>
              </div>

              {/* Manual actions */}
              <div className="flex flex-col items-stretch gap-2 md:w-[132px]">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canEdit || r.saving || !hasText}
                  onClick={() => save(r.student_id, r.writeup, true)}
                  className="gap-1.5"
                >
                  {r.saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  {r.submitted ? 'Resubmit' : 'Submit'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canEdit || r.saving || !dirty}
                  onClick={() => save(r.student_id, r.writeup, false)}
                  className="gap-1.5"
                >
                  <Save className="size-3.5" />
                  Save as draft
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WorkflowPill({
  submitted,
  submittedAt,
  hasSavedText,
}: {
  submitted: boolean;
  submittedAt: string | null;
  hasSavedText: boolean;
}) {
  if (submitted) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-mint">
        <CheckCircle2 className="size-3" />
        Submitted
        {submittedAt && (
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            · {formatSubmittedAt(submittedAt)}
          </span>
        )}
      </span>
    );
  }
  if (hasSavedText) {
    return (
      <Badge
        variant="outline"
        className="h-5 border-brand-indigo/30 bg-brand-indigo/5 px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep"
      >
        Draft
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-5 border-dashed border-border bg-muted px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
    >
      Empty
    </Badge>
  );
}

function StatusChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'info' | 'muted';
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-brand-mint/20 text-ink'
      : tone === 'info'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass}`}
    >
      <span className="tabular-nums">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}

// Honest, persistent save state — no fading "Idle". Shows what the textarea's
// relationship to the server is, right now.
function SaveState({
  saving,
  error,
  dirty,
  hasSavedText,
}: {
  saving: boolean;
  error: string | null;
  dirty: boolean;
  hasSavedText: boolean;
}) {
  if (saving) return <span className="text-muted-foreground">Saving…</span>;
  if (error)
    return (
      <span className="text-destructive">Error: {error ?? 'save failed'}</span>
    );
  if (dirty)
    return (
      <span className="font-semibold text-brand-amber">Unsaved changes</span>
    );
  if (hasSavedText) return <span className="text-muted-foreground">Saved</span>;
  return <span className="text-muted-foreground">No comment yet</span>;
}

function formatSubmittedAt(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('en-SG', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
