'use client';

import { ArrowLeft, Search, TriangleAlert, UserSearch } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  SubjectTermPanel,
  type Marks,
  type TermFigures,
} from '@/components/shared/subject-term-panel';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GRADE_ALERT_THRESHOLD,
  type AlertMetric,
} from '@/lib/markbook/alert-threshold';
// One copy of how a grade figure is written down — see the file header there.
import {
  fmtGrade as fmt,
  signedGrade as signed,
} from '@/lib/markbook/format-grade';

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
  /** That term's marks: what was scored, out of what was available. */
  prior_scored?: number | null;
  prior_max?: number | null;
};

/** Marks out of marks, or null when either half is missing. */
function marks(
  scored: number | null | undefined,
  max: number | null | undefined
): string | null {
  if (scored == null || max == null) return null;
  return `${fmt(scored)} / ${fmt(max)}`;
}

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
  /** This term's marks per component, straight off the sheet being marked. */
  currentMarks?: Partial<Record<AlertMetric, Marks>>;
};

// Formula order, which is also sheet order. Never alphabetical.
const COMPONENT_ORDER: AlertMetric[] = ['ww', 'pt', 'qa'];

/** The most recent earlier term, which is what the list summary reports on. */
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
  subjectName = 'This subject',
  isExaminable = true,
  currentTermLabel,
  weights,
}: {
  rows: StudentAlertRow[];
  /** The sheet's subject — the panel shows one subject at a time. */
  subjectName?: string;
  isExaminable?: boolean;
  currentTermLabel: string;
  weights?: { ww: number; pt: number; qa: number };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const withCounts = useMemo(
    () => rows.map((r) => ({ row: r, count: flaggedCount(r) })),
    [rows]
  );
  const totalFlagged = withCounts.filter((r) => r.count > 0).length;

  // ONE LIST, INDEX ORDER, AND A FILTER — not two headed groups.
  //
  // The groups ("Needs a look" / "Everyone else") sorted the class for the
  // reader, which is the right default only if triage is the only question.
  // Mr Ace, 2026-08-21: "list all students sorted by index numbers and a filter
  // dropdown to show only flagged students or all." Index order is how a
  // teacher already holds the class in their head — they call students by
  // number — so a specific student is always where they expect, and the
  // dropdown answers the triage question on demand instead of by default.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withCounts
      .filter((r) => (onlyFlagged ? r.count > 0 : true))
      .filter((r) => (q ? r.row.studentName.toLowerCase().includes(q) : true))
      .sort((a, b) => a.row.indexNumber - b.row.indexNumber);
  }, [withCounts, query, onlyFlagged]);

  const selected = rows.find((r) => r.entryId === selectedId) ?? null;

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setOnlyFlagged(false);
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

      <DialogContent className="flex h-[calc(100vh-4rem)] max-h-[860px] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold tracking-tight">
            {/* Mirrors attendance's "Attendance lookup" / "Attendance
                record" pair, so the two modules read the same way. */}
            {selected ? 'Grade record' : 'Grade lookup'}
          </DialogTitle>
        </DialogHeader>

        {!selected && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Type a student name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              {/* The term is named in the option itself. Without it, a narrowed
                  list reading "nobody" invites "this class has no problems",
                  when what it means is "nobody in THIS term". */}
              <Select
                value={onlyFlagged ? 'flagged' : 'all'}
                onValueChange={(v) => setOnlyFlagged(v === 'flagged')}
              >
                <SelectTrigger className="w-auto shrink-0 gap-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">All students</SelectItem>
                  <SelectItem value="flagged">
                    Only flagged · {currentTermLabel}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? `No students match “${query}”`
                    : `Nobody needs a look in ${currentTermLabel}.`}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map(({ row, count }) => (
                    <StudentRow
                      key={row.entryId}
                      row={row}
                      count={count}
                      onOpen={() => setSelectedId(row.entryId)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {selected && (
          <StudentDetail
            row={selected}
            subjectName={subjectName}
            isExaminable={isExaminable}
            currentTermLabel={currentTermLabel}
            weights={weights}
            onBack={() => setSelectedId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
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
  subjectName,
  isExaminable,
  currentTermLabel,
  weights,
  onBack,
}: {
  row: StudentAlertRow;
  subjectName: string;
  isExaminable: boolean;
  currentTermLabel: string;
  weights?: { ww: number; pt: number; qa: number };
  onBack: () => void;
}) {
  // Fold the flat comparison list back into one row per term. Every prior term
  // is already in `row.comparisons` — the old term picker was hiding data the
  // component had all along.
  const terms = useMemo<TermFigures[]>(() => {
    const byTerm = new Map<number, Map<AlertMetric, AlertComparison>>();
    const labels = new Map<number, string>();
    for (const c of row.comparisons) {
      labels.set(c.term_number, c.term_label);
      let inner = byTerm.get(c.term_number);
      if (!inner) {
        inner = new Map();
        byTerm.set(c.term_number, inner);
      }
      inner.set(c.metric, c);
    }
    const nums = [...byTerm.keys()].sort((a, b) => a - b);

    const prior: TermFigures[] = nums.map((n) => {
      const at = byTerm.get(n);
      const marksFor = (k: 'ww' | 'pt' | 'qa') => ({
        scored: at?.get(k)?.prior_scored ?? null,
        max: at?.get(k)?.prior_max ?? null,
      });
      return {
        label: labels.get(n) ?? `Term ${n}`,
        quarterly: at?.get('quarterly')?.prior_grade ?? null,
        ww: at?.get('ww')?.prior_grade ?? null,
        pt: at?.get('pt')?.prior_grade ?? null,
        qa: at?.get('qa')?.prior_grade ?? null,
        marks: { ww: marksFor('ww'), pt: marksFor('pt'), qa: marksFor('qa') },
      };
    });

    // A component's CURRENT value is `prior_grade + diff` on any one of its
    // comparisons: every prior term was diffed against the same current
    // figure, so they all agree.
    const currentOf = (k: AlertMetric): number | null => {
      const c = row.comparisons.find((x) => x.metric === k);
      return c ? c.prior_grade + c.diff : null;
    };

    return [
      ...prior,
      {
        label: currentTermLabel,
        quarterly: row.currentGrade,
        ww: currentOf('ww'),
        pt: currentOf('pt'),
        qa: currentOf('qa'),
        marks: {
          ww: row.currentMarks?.ww ?? { scored: null, max: null },
          pt: row.currentMarks?.pt ?? { scored: null, max: null },
          qa: row.currentMarks?.qa ?? { scored: null, max: null },
        },
      },
    ];
  }, [row, currentTermLabel]);

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-5 p-6">
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
            {subjectName} &middot; {currentTermLabel}
          </p>
        </div>

        <SubjectTermPanel
          subject={subjectName}
          isExaminable={isExaminable}
          terms={terms}
          weights={weights}
        />

        {/* A single assessment, raw, compared only against this student's own
            other work on this sheet — the one place a slot appears, and the
            only signal that exists in Term 1. Nothing in Classroom can show
            this, because it needs the sheet being marked. */}
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
