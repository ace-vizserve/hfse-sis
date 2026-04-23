'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle2, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { EvaluationRosterStudent } from '@/lib/evaluation/queries';

type RowStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type RowState = {
  student_id: string;
  section_student_id: string;
  index_number: number;
  student_number: string;
  student_name: string;
  writeup: string;
  submitted: boolean;
  submittedAt: string | null;
  status: RowStatus;
  errorMessage: string | null;
  // Monotonic ticks for debounced-save + race-skip bookkeeping.
  dirtyTick: number;
  lastSavedTick: number;
};

const AUTOSAVE_DELAY_MS = 800;

// Adviser write-up roster. One <textarea> per student. Debounced autosave
// per student on change (800ms); explicit Submit button stamps `submitted`.
//
// Read-only mode (`canEdit=false`) is for teachers when the virtue theme
// hasn't been set — they see the same roster but can't type.
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
      section_student_id: r.section_student_id,
      index_number: r.index_number,
      student_number: r.student_number,
      student_name: r.student_name,
      writeup: r.writeup ?? '',
      submitted: r.submitted,
      submittedAt: r.submitted_at,
      status: 'idle',
      errorMessage: null,
      dirtyTick: 0,
      lastSavedTick: 0,
    })),
  );

  // Timer + in-flight tick maps keyed by student_id. Refs (not state) —
  // they track concurrency, not UI.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inFlight = useRef<Map<string, number>>(new Map());

  // Clear timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const saveRow = useCallback(
    async (studentId: string, text: string, submit = false) => {
      setRows((prev) =>
        prev.map((r) => (r.student_id === studentId ? { ...r, status: 'saving' } : r)),
      );
      const tick = Date.now();
      inFlight.current.set(studentId, tick);
      try {
        const res = await fetch('/api/evaluation/writeups', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            termId,
            sectionId,
            studentId,
            writeup: text,
            ...(submit ? { submit: true } : {}),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'save failed');

        // If a newer save has started for this row, don't trample it.
        if (inFlight.current.get(studentId) !== tick) return;

        setRows((prev) =>
          prev.map((r) =>
            r.student_id === studentId
              ? {
                  ...r,
                  status: 'saved',
                  errorMessage: null,
                  submitted: body?.submitted ?? r.submitted,
                  submittedAt: body?.submitted_at ?? r.submittedAt,
                  lastSavedTick: r.dirtyTick,
                }
              : r,
          ),
        );

        // Decay the "saved" badge back to idle after a moment.
        setTimeout(() => {
          setRows((prev) =>
            prev.map((r) =>
              r.student_id === studentId && r.status === 'saved' && r.dirtyTick === r.lastSavedTick
                ? { ...r, status: 'idle' }
                : r,
            ),
          );
        }, 1500);

        if (submit) {
          toast.success('Submitted');
          // Trigger a refresh so the "X of Y submitted" count at the top updates
          // without a full reload.
          router.refresh();
        }
      } catch (e) {
        if (inFlight.current.get(studentId) !== tick) return;
        setRows((prev) =>
          prev.map((r) =>
            r.student_id === studentId
              ? {
                  ...r,
                  status: 'error',
                  errorMessage: e instanceof Error ? e.message : 'save failed',
                }
              : r,
          ),
        );
        toast.error(e instanceof Error ? e.message : 'save failed');
      } finally {
        if (inFlight.current.get(studentId) === tick) {
          inFlight.current.delete(studentId);
        }
      }
    },
    [termId, sectionId, router],
  );

  function handleChange(studentId: string, next: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.student_id === studentId
          ? {
              ...r,
              writeup: next,
              status: 'dirty',
              errorMessage: null,
              dirtyTick: r.dirtyTick + 1,
            }
          : r,
      ),
    );
    // Debounce per-row.
    const existing = timers.current.get(studentId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      timers.current.delete(studentId);
      saveRow(studentId, next);
    }, AUTOSAVE_DELAY_MS);
    timers.current.set(studentId, t);
  }

  function handleSubmit(studentId: string) {
    // Flush any pending autosave first by cancelling the timer; the save
    // will run as part of this submit.
    const existing = timers.current.get(studentId);
    if (existing) clearTimeout(existing);
    timers.current.delete(studentId);
    const row = rows.find((r) => r.student_id === studentId);
    if (!row) return;
    saveRow(studentId, row.writeup, true);
  }

  const rowCount = rows.length;

  const countSummary = useMemo(() => {
    const submitted = rows.filter((r) => r.submitted).length;
    const drafted = rows.filter((r) => !r.submitted && r.writeup.trim().length > 0).length;
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
      {/* Roster summary */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[11px]">
        <StatusChip label="Submitted" value={countSummary.submitted} tone="success" />
        <StatusChip label="Drafted" value={countSummary.drafted} tone="info" />
        <StatusChip label="Empty" value={countSummary.empty} tone="muted" />
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {rows.map((r) => (
          <li key={r.student_id} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[260px_1fr_120px]">
            {/* Student identity column */}
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] font-semibold tabular-nums text-muted-foreground">
                  #{r.index_number}
                </span>
                <span className="font-serif text-[15px] font-semibold leading-snug tracking-tight text-foreground">
                  {r.student_name}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {r.student_number}
              </div>
              {r.submitted && r.submittedAt && (
                <div className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
                  <CheckCircle2 className="size-3 text-primary" />
                  Submitted {formatSubmittedAt(r.submittedAt)}
                </div>
              )}
            </div>

            {/* Textarea */}
            <div className="min-w-0">
              <textarea
                value={r.writeup}
                onChange={(e) => handleChange(r.student_id, e.target.value)}
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
                <StatusText status={r.status} error={r.errorMessage} />
              </div>
            </div>

            {/* Submit column */}
            <div className="flex items-start justify-end">
              <Button
                type="button"
                size="sm"
                variant={r.submitted ? 'outline' : 'default'}
                disabled={!canEdit || r.status === 'saving' || r.writeup.trim().length === 0}
                onClick={() => handleSubmit(r.student_id)}
                className="gap-1.5"
              >
                {r.status === 'saving' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : r.submitted ? (
                  <Check className="size-3.5" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {r.submitted ? 'Resubmit' : 'Submit'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
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
      ? 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200'
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

function StatusText({ status, error }: { status: RowStatus; error: string | null }) {
  if (status === 'saving') return <span className="text-muted-foreground">Saving…</span>;
  if (status === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-primary">
        <Check className="size-3" />
        Saved
      </span>
    );
  if (status === 'dirty') return <span className="text-muted-foreground">Unsaved</span>;
  if (status === 'error')
    return <span className="text-destructive">Error: {error ?? 'save failed'}</span>;
  return <Badge variant="outline" className="h-4 px-1.5 font-mono text-[9px]">Idle</Badge>;
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
