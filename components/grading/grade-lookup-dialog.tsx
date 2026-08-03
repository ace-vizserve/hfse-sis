'use client';

import { ArrowLeft, Search, TriangleAlert, UserSearch } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  GRADE_ALERT_THRESHOLD,
  type AlertMetric,
} from '@/lib/markbook/alert-threshold';
import { cn } from '@/lib/utils';

// The grading sheet's at-risk surface.
//
// Koh, at the 2026-07-31 training: "Can this system actually help to FLAG OUT
// STUDENTS who are scoring at risk... then the subject teacher or the FCA got
// to contact the parents." She asked for a list and an action. What existed
// was an Alerts column at the far right of a wide grid — a twenty-pixel chip
// per row, telling you about one student at a time and only if you scrolled
// far enough to see it. That column is gone.
//
// This is the attendance sheet's "Look up student" pattern, deliberately: same
// words, same two-view shape, same back link. Two modules, one habit. One
// difference — attendance fetches a summary per student, and this needs no
// fetch at all, because every number is already in the grid.
//
// Still unanswered: the FCA half. A form class adviser has no grading sheet,
// so nothing here reaches them.

export type AlertComparison = {
  term_label: string;
  term_number: number;
  prior_grade: number;
  /** currentGrade - prior_grade */
  diff: number;
  flagged: boolean;
  /**
   * Which component moved. 'quarterly' is the term grade — the only thing this
   * compared before the training, where Koh and Hermilita asked for the
   * quizzes and the exam too. A term grade can hold still while written work
   * falls and the exam rises to cover it, which is the case that slipped
   * through.
   */
  metric: AlertMetric;
  metric_label: string;
};

/**
 * One assessment on the CURRENT sheet sitting well below this student's own
 * average across the sheet's other assessments.
 *
 * Kept apart from `AlertComparison` because it answers a different question in
 * a different unit. A comparison is a COMPONENT PERCENTAGE — all of written
 * work against all of written work — and cannot be asked until a term grade
 * exists. This is a single slot, raw, and never crosses a term boundary, which
 * is what makes it sound: `ww_scores[0]` in two different terms are unrelated
 * assessments (KD #179).
 */
export type SheetOutlier = {
  /** "Written work 2", "Performance task 3" — what the teacher calls it. */
  label: string;
  score: number;
  max: number;
  pct: number;
  othersMeanPct: number;
};

export type StudentAlertRow = {
  entryId: string;
  indexNumber: number;
  studentName: string;
  withdrawn: boolean;
  currentGrade: number | null;
  comparisons: AlertComparison[];
  outliers: SheetOutlier[];
};

// Formula order, which is also sheet order. Never alphabetical.
const COMPONENT_ORDER: AlertMetric[] = ['ww', 'pt', 'qa'];

/**
 * One decimal, and no trailing `.0`.
 *
 * Component percentages are genuine fractions — 110 out of 120 is 91.666… —
 * and this printed the float raw, which is how `−6.666699999999999` ended up
 * on screen beside a student's name.
 */
function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function signed(n: number): string {
  const v = fmt(Math.abs(n));
  return n > 0 ? `+${v}` : n < 0 ? `−${v}` : '0';
}

/**
 * Colour by direction, and only once the movement is worth reporting.
 *
 * This used to be an orange "SIGNIFICANT" badge on every row that crossed the
 * threshold, including the ones that went UP — a 58-point rise in written work
 * was dressed as a problem. Direction belongs in the colour of the number.
 */
function deltaClass(diff: number, flagged: boolean): string {
  if (!flagged) return 'text-muted-foreground';
  return diff > 0 ? 'text-brand-mint' : 'text-destructive';
}

/** The most recent earlier term — the one the detail view opens on. */
function latestTermNumber(comparisons: AlertComparison[]): number | null {
  let max: number | null = null;
  for (const c of comparisons) {
    if (max == null || c.term_number > max) max = c.term_number;
  }
  return max;
}

function flaggedCount(row: StudentAlertRow): number {
  if (row.withdrawn) return 0;
  const latest = latestTermNumber(row.comparisons);
  const changes = row.comparisons.filter(
    (c) => c.term_number === latest && c.flagged
  ).length;
  return changes + row.outliers.length;
}

/**
 * The one line under a name in the list. Enough to triage without opening
 * anything — the old chip carried a bare count and nothing else.
 */
function summarise(row: StudentAlertRow): string {
  if (row.comparisons.length === 0 && row.outliers.length === 0) {
    return row.currentGrade == null
      ? 'No grades yet'
      : 'No earlier term to compare';
  }

  const latest = latestTermNumber(row.comparisons);
  const changes = row.comparisons.filter((c) => c.term_number === latest);
  const parts = changes
    .filter((c) => c.flagged)
    .map((c) => `${c.metric_label} ${signed(c.diff)}`);

  if (row.outliers.length > 0) {
    parts.push(
      `${row.outliers.length} assessment${row.outliers.length === 1 ? '' : 's'}`
    );
  }

  if (parts.length > 0) return parts.join(' · ');

  // Nothing crossed the line. Name the largest movement anyway, so a teacher
  // can see the check actually ran rather than assuming it found nothing.
  const biggest = changes.reduce<AlertComparison | null>(
    (a, b) => (a == null || Math.abs(b.diff) > Math.abs(a.diff) ? b : a),
    null
  );
  return biggest ? `Largest change ${signed(biggest.diff)}` : 'No change';
}

export function GradeLookupDialog({
  rows,
  currentTermLabel,
  weights,
}: {
  rows: StudentAlertRow[];
  currentTermLabel: string;
  weights?: { ww: number; pt: number; qa: number };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const withCounts = useMemo(
    () => rows.map((r) => ({ row: r, count: flaggedCount(r) })),
    [rows]
  );
  const totalFlagged = withCounts.filter((r) => r.count > 0).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return withCounts;
    return withCounts.filter((r) =>
      r.row.studentName.toLowerCase().includes(q)
    );
  }, [withCounts, query]);

  // Order encodes the finding: who needs attention first, roster order inside
  // each group so a specific student is still where you expect them.
  const flagged = filtered
    .filter((r) => r.count > 0)
    .sort((a, b) => a.row.indexNumber - b.row.indexNumber);
  const rest = filtered
    .filter((r) => r.count === 0)
    .sort((a, b) => a.row.indexNumber - b.row.indexNumber);

  const selected = rows.find((r) => r.entryId === selectedId) ?? null;

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setSelectedId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <UserSearch className="size-3.5" />
          Look up student
          {/* The finding, visible without opening anything. Absent when there
              is nothing to report, so a clean sheet looks clean rather than
              looking unchecked. */}
          {totalFlagged > 0 && (
            <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-brand-amber px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-white">
              <TriangleAlert className="size-2.5" aria-hidden />
              {totalFlagged}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold tracking-tight">
            {/* Mirrors attendance's "Attendance lookup" / "Attendance
                record" pair, so the two modules read the same way. */}
            {selected ? 'Grade record' : 'Grade lookup'}
          </DialogTitle>
        </DialogHeader>

        {!selected && (
          <>
            <div className="shrink-0 border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Type a student name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {flagged.length === 0 && rest.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No students match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <>
                  {flagged.length > 0 && (
                    <>
                      <GroupHead tone="flagged">
                        Needs a look · {flagged.length}
                      </GroupHead>
                      <ul className="divide-y divide-border">
                        {flagged.map(({ row, count }) => (
                          <StudentRow
                            key={row.entryId}
                            row={row}
                            count={count}
                            onOpen={() => setSelectedId(row.entryId)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {rest.length > 0 && (
                    <>
                      <GroupHead tone="rest">Everyone else</GroupHead>
                      <ul className="divide-y divide-border">
                        {rest.map(({ row, count }) => (
                          <StudentRow
                            key={row.entryId}
                            row={row}
                            count={count}
                            onOpen={() => setSelectedId(row.entryId)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {selected && (
          <StudentDetail
            row={selected}
            currentTermLabel={currentTermLabel}
            weights={weights}
            onBack={() => setSelectedId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupHead({
  tone,
  children,
}: {
  tone: 'flagged' | 'rest';
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        'border-b border-border bg-muted px-6 pb-1.5 pt-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
        tone === 'flagged' ? 'text-brand-amber' : 'text-muted-foreground'
      )}
    >
      {children}
    </p>
  );
}

function StudentRow({
  row,
  count,
  onOpen,
}: {
  row: StudentAlertRow;
  count: number;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {row.indexNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {row.studentName}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {summarise(row)}
          </span>
        </span>
        {row.withdrawn ? (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Withdrawn
          </Badge>
        ) : count > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-amber px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-white">
            <TriangleAlert className="size-2.5" aria-hidden />
            {count}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/50">
            —
          </span>
        )}
      </button>
    </li>
  );
}

function StudentDetail({
  row,
  currentTermLabel,
  weights,
  onBack,
}: {
  row: StudentAlertRow;
  currentTermLabel: string;
  weights?: { ww: number; pt: number; qa: number };
  onBack: () => void;
}) {
  const byTerm = useMemo(() => {
    const map = new Map<number, Map<AlertMetric, AlertComparison>>();
    for (const c of row.comparisons) {
      let inner = map.get(c.term_number);
      if (!inner) {
        inner = new Map();
        map.set(c.term_number, inner);
      }
      inner.set(c.metric, c);
    }
    return map;
  }, [row.comparisons]);

  const termNumbers = useMemo(
    () => [...byTerm.keys()].sort((a, b) => a - b),
    [byTerm]
  );

  // Opens on the most recent earlier term: "what changed since last term" is
  // the usual question, and the rest are one click away.
  const [selected, setSelected] = useState<number | null>(
    termNumbers.length > 0 ? termNumbers[termNumbers.length - 1] : null
  );
  const shownTerm =
    selected != null && termNumbers.includes(selected)
      ? selected
      : (termNumbers[termNumbers.length - 1] ?? null);
  const comparison = shownTerm != null ? byTerm.get(shownTerm) : undefined;
  const termGrade = comparison?.get('quarterly');

  const weightFor = (metric: AlertMetric): number | undefined =>
    weights
      ? metric === 'ww'
        ? weights.ww
        : metric === 'pt'
          ? weights.pt
          : metric === 'qa'
            ? weights.qa
            : undefined
      : undefined;

  const nothingFlagged = flaggedCount(row) === 0 && row.comparisons.length > 0;

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          All students
        </button>

        <div>
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {row.studentName}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {currentTermLabel}
          </p>
        </div>

        {/* One tab per earlier term. Rendered only when there is a choice to
            make: a single prior term needs no control, and Term 1 has none at
            all. This also replaces a shape that produced one card per prior
            term PER COMPONENT — sixteen cards by Term 4. */}
        {termNumbers.length > 1 && (
          <div
            role="tablist"
            aria-label="Compare against"
            className="flex gap-1 rounded-lg border border-border bg-muted p-0.5"
          >
            {termNumbers.map((n) => {
              const on = n === shownTerm;
              return (
                <button
                  key={n}
                  role="tab"
                  type="button"
                  aria-selected={on}
                  onClick={() => setSelected(n)}
                  className={cn(
                    'flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    on
                      ? 'bg-card font-semibold text-foreground shadow-sm'
                      : 'font-medium text-muted-foreground hover:text-foreground'
                  )}
                >
                  vs Term {n}
                </button>
              );
            })}
          </div>
        )}

        {/* The term grade is the result, so it sits above the parts that
            produce it. It used to be one row in a flat list alongside its own
            components. */}
        {termGrade && row.currentGrade != null && (
          <div className="space-y-1.5">
            <SectionHead>Term grade</SectionHead>
            <div className="flex items-end justify-between gap-4 rounded-xl border border-border bg-muted/50 px-4 py-3.5">
              <p className="flex items-baseline gap-2 font-serif leading-none tabular-nums">
                <span className="text-[22px] font-semibold text-muted-foreground">
                  {fmt(termGrade.prior_grade)}
                </span>
                <span className="text-sm text-muted-foreground">&rarr;</span>
                <span className="text-4xl font-semibold text-foreground">
                  {fmt(row.currentGrade)}
                </span>
              </p>
              <span
                className={cn(
                  'font-mono text-xs font-semibold tabular-nums',
                  deltaClass(termGrade.diff, termGrade.flagged)
                )}
              >
                {signed(termGrade.diff)} points
              </span>
            </div>
          </div>
        )}

        {/* Written work, tasks and exam are the three parts of one formula, so
            they stay together and in formula order. Their weights are printed
            because the weights are the reason a fall in two parts can still
            produce a rise overall. */}
        {comparison && (
          <div className="space-y-1.5">
            <SectionHead hint="weighted into the grade above">
              What it is made of
            </SectionHead>
            <div>
              {COMPONENT_ORDER.map((metric) => {
                const c = comparison.get(metric);
                if (!c) return null;
                const w = weightFor(metric);
                return (
                  <div
                    key={metric}
                    className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-lg px-2.5 py-2 [&+&]:border-t [&+&]:border-border"
                  >
                    <span className="text-[13px] font-medium text-foreground">
                      {c.metric_label}
                      {w != null && (
                        <span className="ml-1.5 font-mono text-[10px] font-semibold text-muted-foreground">
                          {w}%
                        </span>
                      )}
                    </span>
                    <span className="flex items-baseline gap-1.5 font-serif leading-none tabular-nums">
                      <span className="text-[15px] font-semibold text-muted-foreground">
                        {fmt(c.prior_grade)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        &rarr;
                      </span>
                      <span className="text-[19px] font-semibold text-foreground">
                        {fmt(c.prior_grade + c.diff)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'min-w-[3.75rem] text-right font-mono text-[11px] font-semibold tabular-nums',
                        deltaClass(c.diff, c.flagged)
                      )}
                    >
                      {signed(c.diff)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* A single assessment, raw, compared only against this student's own
            other work on this sheet — the one place a slot appears, and the
            only signal that exists in Term 1. */}
        {row.outliers.length > 0 && (
          <div className="space-y-1.5">
            <SectionHead>On this sheet</SectionHead>
            <div className="space-y-2">
              {row.outliers.map((o) => (
                <div
                  key={o.label}
                  className="flex gap-2.5 rounded-lg border-l-[3px] border-brand-amber bg-brand-amber/5 px-3 py-2.5"
                >
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0 text-brand-amber"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">
                      {o.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      Scored{' '}
                      <span className="font-serif text-sm font-semibold text-foreground">
                        {o.score} out of {o.max}
                      </span>{' '}
                      &mdash; {Math.round(o.pct)}%, against an average of{' '}
                      {Math.round(o.othersMeanPct)}% across the rest of this
                      sheet.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nothingFlagged && (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
            <p className="font-serif text-[15px] font-semibold text-foreground">
              Steady
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing moved by {GRADE_ALERT_THRESHOLD} points or more.
            </p>
          </div>
        )}

        {/* Explains an absence rather than counting a presence. The old
            "4 significant changes detected (threshold ±5)" did neither
            plainly, and three of those words were ours, not a teacher's. */}
        <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
          {shownTerm != null
            ? `Compared with Term ${shownTerm}. Only changes of ${GRADE_ALERT_THRESHOLD} points or more are highlighted.`
            : row.currentGrade == null
              ? 'No grades have been entered for this student yet.'
              : 'There is no earlier term to compare against yet.'}
        </p>
      </div>
    </ScrollArea>
  );
}

function SectionHead({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
      {hint && (
        <span className="font-sans text-[11px] font-normal normal-case tracking-normal">
          &middot; {hint}
        </span>
      )}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </p>
  );
}
