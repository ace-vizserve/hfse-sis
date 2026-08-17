'use client';

import {
  CalendarRange,
  CheckCircle2,
  Loader2,
  Lock,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useWriteAction } from '@/lib/hooks/use-write-action';

import { apiFetch, jsonInit, ApiError } from '@/lib/query/fetcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TermRow } from '@/lib/sis/ay-setup/queries';

type TermDraft = {
  id: string;
  term_number: number;
  label: string;
  start_date: string; // '' when null
  end_date: string;
  grading_lock_date: string; // '' when null — advisory cutoff chip on /markbook/grading
};

// "Term dates" dialog triggered from each AY row in /sis/ay-setup.
// Each term is its own card; a single "Save all" button flushes every
// dirty term in parallel via Promise.allSettled so partial failures don't
// block the rest.
export function TermDatesEditor({
  ayCode,
  ayLabel,
  terms,
  children,
}: {
  ayCode: string;
  ayLabel: string;
  terms: TermRow[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<TermDraft[]>(() => toDrafts(terms));
  const [justSavedIds, setJustSavedIds] = useState<Set<string>>(new Set());

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDrafts(toDrafts(terms));
      setJustSavedIds(new Set());
    }
  }

  function updateDraft(id: string, patch: Partial<TermDraft>) {
    setDrafts((current) =>
      current.map((d) => (d.id === id ? { ...d, ...patch } : d))
    );
    // Clear the "just saved" check on the term the user is editing so the
    // visual state doesn't lie.
    setJustSavedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function isDirty(draft: TermDraft): boolean {
    const original = terms.find((t) => t.id === draft.id);
    return (
      (draft.start_date || '') !== (original?.start_date ?? '') ||
      (draft.end_date || '') !== (original?.end_date ?? '') ||
      (draft.grading_lock_date || '') !== (original?.grading_lock_date ?? '')
    );
  }

  const saveAllMutation = useMutation({
    // Parallel PATCH per dirty term via Promise.allSettled so partial failures
    // don't block the rest. Aggregation preserved; toast/refresh in onSuccess.
    mutationFn: async (dirtyDrafts: TermDraft[]) => {
      const results = await Promise.allSettled(
        dirtyDrafts.map(async (d) => {
          await apiFetch(
            `/api/sis/ay-setup/terms/${d.id}`,
            jsonInit('PATCH', {
              startDate: d.start_date || null,
              endDate: d.end_date || null,
              gradingLockDate: d.grading_lock_date || null,
            })
          ).catch((err) => {
            // Mirror the original `body?.error ?? 'save failed'` per-term copy.
            const serverError =
              err instanceof ApiError &&
              err.body &&
              typeof err.body === 'object'
                ? (err.body as { error?: string }).error
                : undefined;
            throw new Error(serverError ?? 'save failed');
          });
          return d.id;
        })
      );

      const succeeded = new Set<string>();
      const failures: string[] = [];
      results.forEach((r, i) => {
        const d = dirtyDrafts[i];
        if (r.status === 'fulfilled') {
          succeeded.add(d.id);
        } else {
          failures.push(
            `${d.label}: ${r.reason instanceof Error ? r.reason.message : 'save failed'}`
          );
        }
      });
      return { succeeded, failures, total: dirtyDrafts.length };
    },
  });

  const run = useWriteAction();
  const [savingAll, setSavingAll] = useState(false);

  async function commitAll(dirtyDrafts: TermDraft[]) {
    setSavingAll(true);
    await run(() => saveAllMutation.mutateAsync(dirtyDrafts), {
      pending: `Saving ${dirtyDrafts.length} term${dirtyDrafts.length === 1 ? '' : 's'}…`,
      // A batch that partly failed is a failure to report, not a success —
      // the per-term reasons are the useful part.
      success: ({ failures, total }) => {
        if (failures.length > 0) {
          toast.error(failures.join(' · '));
          return null;
        }
        return `${total} term${total === 1 ? '' : 's'} updated.`;
      },
      onResolved: ({ succeeded, failures }) => {
        setJustSavedIds(succeeded);
        if (failures.length === 0) setTimeout(() => setOpen(false), 400);
      },
      // Partial success is still worth refreshing so the UI reflects what
      // landed; an all-failure batch changed nothing.
      refresh: ({ succeeded }) => succeeded.size > 0,
    });
    setSavingAll(false);
  }

  function saveAll() {
    // Pre-validate all dirty drafts — abort cleanly on any date-order issue
    // so we don't half-commit the batch.
    const dirtyDrafts = drafts.filter(isDirty);
    if (dirtyDrafts.length === 0) {
      setOpen(false);
      return;
    }
    for (const d of dirtyDrafts) {
      if (d.start_date && d.end_date && d.start_date > d.end_date) {
        toast.error(`${d.label}: end date must be on or after start date`);
        return;
      }
    }

    // Cross-term guard against the WOULD-BE state (all drafts, not just dirty):
    // in term-number order, each term must start strictly after the previous
    // term ends — no overlapping or shared-boundary windows. Validating the
    // full set catches the case where two terms are edited in the same save.
    const datedInOrder = drafts
      .filter((d) => d.start_date && d.end_date)
      .sort((a, b) => a.term_number - b.term_number);
    for (let i = 1; i < datedInOrder.length; i++) {
      const prev = datedInOrder[i - 1];
      const cur = datedInOrder[i];
      if (prev.end_date >= cur.start_date) {
        toast.error(
          `${cur.label} must start after ${prev.label} ends (${prev.label} ends ${prev.end_date}). Terms can't overlap.`
        );
        return;
      }
    }

    void commitAll(dirtyDrafts);
  }

  const sorted = drafts.slice().sort((a, b) => a.term_number - b.term_number);
  const dirtyCount = sorted.filter(isDirty).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="flex max-h-[min(800px,88vh)] flex-col gap-0 p-0 sm:max-w-3xl">
        <ScrollArea className="flex max-h-full flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-3 font-serif text-xl">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <CalendarRange className="size-4" />
              </div>
              Term dates — {ayCode}
            </DialogTitle>
            <DialogDescription>
              {ayLabel}. Dates unblock the Attendance calendar and report-card
              publish windows. Virtue themes are set in Evaluation &rarr; Virtue
              themes.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4">
            {sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No terms configured for this AY yet. Re-run the AY creation
                wizard.
              </div>
            ) : (
              <div className="space-y-3">
                {sorted.map((draft) => (
                  <TermCard
                    key={draft.id}
                    draft={draft}
                    dirty={isDirty(draft)}
                    justSaved={justSavedIds.has(draft.id)}
                    saving={savingAll && isDirty(draft)}
                    onChange={(patch) => updateDraft(draft.id, patch)}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:justify-between">
          <div className="flex items-center text-xs text-muted-foreground">
            {dirtyCount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full bg-brand-amber"
                  aria-hidden="true"
                />
                {dirtyCount} unsaved change{dirtyCount === 1 ? '' : 's'}
              </span>
            ) : (
              <span>All saved.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={savingAll}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={saveAll}
              disabled={savingAll || dirtyCount === 0}
            >
              {savingAll && <Loader2 className="animate-spin" />}
              {dirtyCount === 0
                ? 'Saved'
                : `Save ${dirtyCount} term${dirtyCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TermCard({
  draft,
  dirty,
  justSaved,
  saving,
  onChange,
}: {
  draft: TermDraft;
  dirty: boolean;
  justSaved: boolean;
  saving: boolean;
  onChange: (patch: Partial<TermDraft>) => void;
}) {
  return (
    <div
      className={
        'rounded-xl border bg-card p-4 transition-colors ' +
        (dirty
          ? 'border-brand-amber/40 bg-brand-amber-light/20'
          : 'border-border')
      }
    >
      {/* Header row: term label + dirty/saved indicator (Badge variants
          for the per-state pills — saving=muted, saved=success,
          dirty=warning, clean=secondary; matches §10 single-source-of-
          truth and the §9.3 trio voiced through Badge primitives). */}
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-base font-semibold tracking-tight text-foreground">
          {draft.label}
        </h3>
        {saving ? (
          <Badge variant="muted">
            <Loader2 className="size-3 animate-spin" />
            Saving
          </Badge>
        ) : justSaved ? (
          <Badge variant="success">
            <CheckCircle2 className="size-3" />
            Saved
          </Badge>
        ) : dirty ? (
          <Badge variant="warning">Unsaved</Badge>
        ) : (
          <Badge variant="secondary">Up to date</Badge>
        )}
      </div>

      {/* Dates row: Start + End side by side. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          htmlFor={`start-${draft.id}`}
          label="Start date"
          icon={CalendarRange}
        >
          <DatePicker
            id={`start-${draft.id}`}
            value={draft.start_date}
            onChange={(v) => onChange({ start_date: v })}
          />
        </Field>
        <Field
          htmlFor={`end-${draft.id}`}
          label="End date"
          icon={CalendarRange}
          warning={
            draft.start_date &&
            draft.end_date &&
            draft.start_date > draft.end_date
              ? 'Must be on or after start date'
              : null
          }
        >
          <DatePicker
            id={`end-${draft.id}`}
            value={draft.end_date}
            onChange={(v) => onChange({ end_date: v })}
          />
        </Field>
      </div>

      {/* Secondary row: Grading lock (virtue theme moved to Evaluation → Virtue themes). */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field htmlFor={`lock-${draft.id}`} label="Grading lock by" icon={Lock}>
          <DatePicker
            id={`lock-${draft.id}`}
            value={draft.grading_lock_date}
            onChange={(v) => onChange({ grading_lock_date: v })}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  icon: Icon,
  warning,
  children,
}: {
  htmlFor: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  warning?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
      >
        <Icon className="size-3" />
        {label}
      </label>
      {children}
      {warning && (
        <p className="flex items-center gap-1 font-mono text-[10px] text-destructive">
          <XCircle className="size-3" />
          {warning}
        </p>
      )}
    </div>
  );
}

function toDrafts(terms: TermRow[]): TermDraft[] {
  return terms.map((t) => ({
    id: t.id,
    term_number: t.term_number,
    label: t.label,
    start_date: t.start_date ?? '',
    end_date: t.end_date ?? '',
    grading_lock_date: t.grading_lock_date ?? '',
  }));
}
