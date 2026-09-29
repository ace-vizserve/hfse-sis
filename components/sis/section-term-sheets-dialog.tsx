'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, Lock, LockOpen } from 'lucide-react';
import Link from 'next/link';

import {
  COMPONENT_PAINT,
  GRADE_COMPONENTS,
  type ComponentWeights,
} from '@/components/grading/component-weight-chips';
import { LockToggle } from '@/components/grading/lock-toggle';
import { TotalsEditorForm } from '@/components/grading/totals-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { ApiError, apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// One class's four terms for one subject, side by side, each editable in place.
//
// A drawer, not a dialog, and the editor opens INSIDE it: a term's row expands
// into `TotalsEditorForm` (layout="inline") rather than raising
// `TotalsEditor`'s own side sheet on top — Mr Ace: never nest dialogs.
//
// ⚠ STILL NO SECOND EDITOR. The form is the same component
// /markbook/grading/[id] uses — slots with each one's max, the exam max, the
// component chips that take the exam off a term (migration 159 / KD #218), and
// the post-lock correction (Hard Rule #5). Building a second one is how the two
// drift apart, and it is what the first attempt at this did.
//
// The table exists because terms genuinely differ. Measured 2026-09-23: 123 of
// 125 AY2026 class+subject pairs carry all four terms, and a sampled class is
// marked out of 20 in T1/T2 and out of 10 in T3/T4 — which one row per term,
// with a highlight wherever a term changed from the one before, shows at once.

type TermRow = {
  termId: string;
  termNumber: number;
  label: string;
  sheetId: string | null;
  isLocked: boolean;
  wwTotals: number[];
  ptTotals: number[];
  qaTotal: number | null;
  weights: ComponentWeights;
  weightsOverridden: boolean;
};

type Payload = {
  section: { id: string; name: string };
  subject: { code: string; name: string };
  limits: { wwMaxSlots: number; ptMaxSlots: number };
  subjectWeights: ComponentWeights;
  terms: TermRow[];
};

const COLUMN_COUNT = 7;

export function SectionTermSheetsDialog({
  sheetId,
  sectionName,
  open,
  onOpenChange,
}: {
  /** Any one of the class's sheets for this subject — the route finds the rest. */
  sheetId: string;
  sectionName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['section-term-sheets', sheetId];
  // Owned by the drawer, not the form: a save collapses the row, which
  // unmounts the form while the write is still reporting itself.
  const run = useWriteAction();
  const [editingTermId, setEditingTermId] = useState<string | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery<Payload>({
    queryKey,
    queryFn: () =>
      apiFetch<Payload>(`/api/grading-sheets/${sheetId}/section-terms`),
    enabled: open,
  });

  const terms = Array.isArray(data?.terms) ? data.terms : null;
  // TanStack Query, so the `router.refresh()` every write already does cannot
  // reach this list — each write here re-reads it explicitly.
  const reload = () => void queryClient.invalidateQueries({ queryKey });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {data ? data.subject.name : 'Grading sheets'}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {sectionName}
          </SheetTitle>
          <SheetDescription>
            Each term&rsquo;s slots, max scores and weights side by side. Open a
            term to change it.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {isPending ? (
            <TermsSkeleton />
          ) : isError || !terms ? (
            <LoadFailed error={error} onRetry={() => void refetch()} />
          ) : terms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
              <p className="font-serif text-base font-semibold text-foreground">
                No terms yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This academic year has no terms set up. Add them in AY Setup,
                then come back to set each term&rsquo;s slots.
              </p>
            </div>
          ) : (
            <TermsTable
              terms={terms}
              payload={data}
              editingTermId={editingTermId}
              onToggleEdit={(termId) =>
                setEditingTermId((cur) => (cur === termId ? null : termId))
              }
              renderEditor={(term) => (
                <TermEditor
                  term={term}
                  payload={data}
                  run={run}
                  onClose={() => setEditingTermId(null)}
                  onSaved={() => {
                    setEditingTermId(null);
                    reload();
                  }}
                  onLockChanged={reload}
                />
              )}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── The comparison table ──────────────────────────────────────────────────

function TermsTable({
  terms,
  payload,
  editingTermId,
  onToggleEdit,
  renderEditor,
}: {
  terms: TermRow[];
  payload: Payload;
  editingTermId: string | null;
  onToggleEdit: (termId: string) => void;
  renderEditor: (term: TermRow) => React.ReactNode;
}) {
  // What each term changed from the last term that HAS a sheet — the
  // comparison a registrar is making when T3 suddenly reads "out of 10".
  const changes = new Map<string, { ww: boolean; pt: boolean; qa: boolean }>();
  let prev: TermRow | null = null;
  for (const term of terms) {
    if (term.sheetId == null) continue;
    changes.set(term.termId, {
      ww: prev != null && slotsKey(prev.wwTotals) !== slotsKey(term.wwTotals),
      pt: prev != null && slotsKey(prev.ptTotals) !== slotsKey(term.ptTotals),
      qa: prev != null && examKey(prev) !== examKey(term),
    });
    prev = term;
  }
  const anyChange = [...changes.values()].some((c) => c.ww || c.pt || c.qa);
  const anyOwnSplit = terms.some(
    (t) => t.sheetId != null && !sameWeights(t.weights, payload.subjectWeights)
  );

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <Table className="min-w-[640px]">
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[84px]">Term</TableHead>
              <ComponentHead component="ww">Written work</ComponentHead>
              <ComponentHead component="pt">Performance</ComponentHead>
              <ComponentHead component="qa">Exam</ComponentHead>
              <TableHead className="w-[120px]">Weights</TableHead>
              <TableHead className="w-[92px]">Status</TableHead>
              <TableHead className="w-[84px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {terms.map((term) => {
              const editing = editingTermId === term.termId;
              const changed = changes.get(term.termId);
              return (
                <TermRows
                  key={term.termId}
                  term={term}
                  subjectWeights={payload.subjectWeights}
                  changed={changed}
                  editing={editing}
                  onToggleEdit={() => onToggleEdit(term.termId)}
                  editor={editing ? renderEditor(term) : null}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      {(anyChange || anyOwnSplit) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
          {anyChange && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm bg-accent ring-1 ring-inset ring-brand-indigo-soft"
              />
              Changed from the term before
            </span>
          )}
          {anyOwnSplit && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-brand-indigo-deep"
              />
              Not the subject&rsquo;s split (
              {formatWeights(payload.subjectWeights)})
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ComponentHead({
  component,
  children,
}: {
  component: keyof typeof COMPONENT_PAINT;
  children: React.ReactNode;
}) {
  return (
    <TableHead>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn('size-2 rounded-sm', COMPONENT_PAINT[component].swatch)}
        />
        {children}
      </span>
    </TableHead>
  );
}

function TermRows({
  term,
  subjectWeights,
  changed,
  editing,
  onToggleEdit,
  editor,
}: {
  term: TermRow;
  subjectWeights: ComponentWeights;
  changed: { ww: boolean; pt: boolean; qa: boolean } | undefined;
  editing: boolean;
  onToggleEdit: () => void;
  editor: React.ReactNode;
}) {
  const label = (
    <TableCell className="align-top">
      <span className="text-[13px] font-medium text-foreground">
        Term {term.termNumber}
      </span>
    </TableCell>
  );

  if (term.sheetId == null) {
    return (
      <TableRow className="hover:bg-transparent">
        {label}
        <TableCell
          colSpan={COLUMN_COUNT - 1}
          className="text-[13px] text-muted-foreground"
        >
          No grading sheet for this term.
        </TableCell>
      </TableRow>
    );
  }

  const ownSplit = !sameWeights(term.weights, subjectWeights);

  return (
    <>
      <TableRow
        className={cn(editing && 'border-b-0 bg-muted/30 hover:bg-muted/30')}
      >
        {label}
        <TableCell className="align-top">
          <SlotsSummary
            values={term.wwTotals}
            counted={term.weights.ww > 0}
            changed={changed?.ww ?? false}
          />
        </TableCell>
        <TableCell className="align-top">
          <SlotsSummary
            values={term.ptTotals}
            counted={term.weights.pt > 0}
            changed={changed?.pt ?? false}
          />
        </TableCell>
        <TableCell className="align-top">
          <ExamSummary term={term} changed={changed?.qa ?? false} />
        </TableCell>
        <TableCell className="align-top">
          <WeightsSummary weights={term.weights} ownSplit={ownSplit} />
        </TableCell>
        <TableCell className="align-top">
          {term.isLocked ? (
            <Badge
              variant="outline"
              className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
            >
              <Lock className="h-3 w-3" />
              Locked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
            >
              <LockOpen className="h-3 w-3" />
              Open
            </Badge>
          )}
        </TableCell>
        <TableCell className="align-top text-right">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editing}
            aria-label={`${editing ? 'Close' : 'Edit'} Term ${term.termNumber}`}
            onClick={onToggleEdit}
          >
            {editing ? 'Close' : 'Edit'}
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform motion-reduce:transition-none',
                editing && 'rotate-180'
              )}
            />
          </Button>
        </TableCell>
      </TableRow>

      {editing && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={COLUMN_COUNT} className="px-4 pb-5 pt-0">
            {editor}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function SlotsSummary({
  values,
  counted,
  changed,
}: {
  values: number[];
  counted: boolean;
  changed: boolean;
}) {
  if (values.length === 0) {
    return (
      <Figure changed={changed}>
        <span className="text-[13px] text-muted-foreground">None</span>
      </Figure>
    );
  }
  const total = values.reduce((sum, v) => sum + v, 0);
  const allSame = values.every((v) => v === values[0]);
  const slots = values.length === 1 ? '1 slot' : `${values.length} slots`;

  return (
    <Figure changed={changed}>
      <span className="font-mono text-[13px] tabular-nums text-foreground">
        {allSame && values.length > 1
          ? `${values.length} × ${values[0]}`
          : values.join(', ')}
      </span>
      <span className="block text-[11px] text-muted-foreground">
        {allSame && values.length > 1
          ? `out of ${total}`
          : `${slots}, out of ${total}`}
        {!counted && ', not counted'}
      </span>
    </Figure>
  );
}

function ExamSummary({ term, changed }: { term: TermRow; changed: boolean }) {
  if (term.weights.qa === 0) {
    return (
      <Figure changed={changed}>
        <span className="text-[13px] text-muted-foreground">No exam</span>
      </Figure>
    );
  }
  return (
    <Figure changed={changed}>
      {term.qaTotal == null ? (
        <span className="text-[13px] text-muted-foreground">Max not set</span>
      ) : (
        <>
          <span className="font-mono text-[13px] tabular-nums text-foreground">
            {term.qaTotal}
          </span>
          <span className="block text-[11px] text-muted-foreground">marks</span>
        </>
      )}
    </Figure>
  );
}

/** A figure, washed in the accent tint when it changed from the term before. */
function Figure({
  changed,
  children,
}: {
  changed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        '-mx-1.5 -my-0.5 inline-block rounded-md px-1.5 py-0.5',
        changed && 'bg-accent ring-1 ring-inset ring-brand-indigo-soft'
      )}
    >
      {children}
      {changed && (
        <span className="sr-only"> (changed from the term before)</span>
      )}
    </div>
  );
}

/** The split as a bar in the component colours, with the numbers under it. */
function WeightsSummary({
  weights,
  ownSplit,
}: {
  weights: ComponentWeights;
  ownSplit: boolean;
}) {
  return (
    <div className="w-[96px] space-y-1.5">
      <div
        aria-hidden
        className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
      >
        {GRADE_COMPONENTS.filter((c) => weights[c] > 0).map((c) => (
          <span
            key={c}
            className={COMPONENT_PAINT[c].swatch}
            style={{ width: `${weights[c]}%` }}
          />
        ))}
      </div>
      <span
        className={cn(
          'flex items-center gap-1.5 font-mono text-[12px] tabular-nums',
          ownSplit ? 'font-semibold text-brand-indigo-deep' : 'text-ink-3'
        )}
      >
        {formatWeights(weights)}
        {ownSplit && (
          <>
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-brand-indigo-deep"
            />
            <span className="sr-only">(not the subject&rsquo;s split)</span>
          </>
        )}
      </span>
    </div>
  );
}

// ─── The inline editor ─────────────────────────────────────────────────────

function TermEditor({
  term,
  payload,
  run,
  onClose,
  onSaved,
  onLockChanged,
}: {
  term: TermRow;
  payload: Payload;
  run: ReturnType<typeof useWriteAction>;
  onClose: () => void;
  onSaved: () => void;
  onLockChanged: () => void;
}) {
  // Only rendered for a term that has a sheet.
  const sheetId = term.sheetId!;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-0.5">
          <p className="font-serif text-lg font-semibold tracking-tight text-foreground">
            Term {term.termNumber} setup
          </p>
          <p className="text-[13px] text-muted-foreground">
            Saving recomputes every student&rsquo;s grade for this term.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Straight to the sheet in Markbook, to see the marks themselves.
              Ghost: it leaves the page and changes nothing. */}
          <Button asChild variant="ghost" size="sm">
            <Link href={`/markbook/grading/${sheetId}`}>
              <ArrowUpRight className="size-3.5" />
              View sheet
            </Link>
          </Button>
          {/* Unlock goes outline here: Save totals below is this view's one
              primary button. */}
          <LockToggle
            sheetId={sheetId}
            isLocked={term.isLocked}
            unlockVariant="outline"
            onDone={onLockChanged}
          />
        </div>
      </div>

      <TotalsEditorForm
        key={sheetId}
        layout="inline"
        sheetId={sheetId}
        wwTotals={term.wwTotals}
        ptTotals={term.ptTotals}
        qaTotal={term.qaTotal}
        wwMaxSlots={payload.limits.wwMaxSlots}
        ptMaxSlots={payload.limits.ptMaxSlots}
        isLocked={term.isLocked}
        weights={term.weights}
        subjectWeights={payload.subjectWeights}
        weightsOverridden={term.weightsOverridden}
        scopeLabel={`Term ${term.termNumber}`}
        run={run}
        onSaved={onSaved}
        onCancel={onClose}
      />
    </div>
  );
}

// ─── States ────────────────────────────────────────────────────────────────

function TermsSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="h-11 border-b border-border bg-muted/40" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border px-4 py-3.5 last:border-b-0"
        >
          <Skeleton className="h-4 w-12" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-4 w-10" />
          <div className="w-[96px] space-y-1.5">
            <Skeleton className="h-1.5 w-full rounded-full" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function LoadFailed({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const reason =
    error instanceof ApiError
      ? error.status === 401
        ? 'Your session has expired — sign in again.'
        : error.status === 403
          ? 'Your account can’t change grading sheets.'
          : error.message
      : error instanceof Error
        ? error.message
        : null;

  return (
    <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="space-y-1">
        <p className="font-serif text-base font-semibold text-foreground">
          Couldn&rsquo;t load this class&rsquo;s terms
        </p>
        {reason && <p className="text-sm text-muted-foreground">{reason}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function slotsKey(values: number[]): string {
  return values.join(',');
}

function examKey(term: TermRow): string {
  return term.weights.qa === 0 ? 'none' : String(term.qaTotal);
}

function sameWeights(a: ComponentWeights, b: ComponentWeights): boolean {
  return a.ww === b.ww && a.pt === b.pt && a.qa === b.qa;
}

/** "30 / 50 / 20", with a component that is off shown as a dash. */
function formatWeights(w: ComponentWeights): string {
  return GRADE_COMPONENTS.map((c) => (w[c] > 0 ? String(w[c]) : '—')).join(
    ' / '
  );
}
