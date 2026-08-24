'use client';

import { useMemo, useState } from 'react';

import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { numericToLetter } from '@/lib/compute/letter-grade';
import { GRADE_ALERT_THRESHOLD } from '@/lib/markbook/alert-threshold';
import { fmtGrade, signedGrade } from '@/lib/markbook/format-grade';
import { cn } from '@/lib/utils';

// One student, one subject, ONE MEASURE — headline, then the chart, then the
// marks. The pill strip picks which measure the whole panel is about.
//
// THE SAME PANEL ON BOTH SURFACES. A subject teacher opens it from their
// grading sheet and sees the subject they are marking; a form class adviser
// opens it from Classroom and picks a subject from tabs. Mr Ace, 2026-08-21:
// "use identical designs for grading sheet look up and classroom grades
// lookup its basically the same data bro why not just use same designs."
//
// WHY ONE AT A TIME. The panel used to draw a big chart, three 48px charts and
// a four-part table at once, and Mr Ace could not read it: "see that graphs? it
// must change depending on the selected tab." One measure gets the full width
// and a legible chart; the table drops from twelve rows to as many terms as are
// marked.
//
// THE PILLS ARE THE FLAG, and that is what makes hiding the rest honest. Koh
// Suat Hoon (55:10) asked the system to "flag out" students, and the ask was
// widened in the room to "not only for the quizzes, but also for exam, for
// overall… alongside with the term grades comparison". A control that shows one
// measure must therefore say where the problem is without being clicked — so
// every pill carries its own change, and a fall carries a dot. The case that
// proves it is real: a student whose term grade moved −3 while his exam fell
// 40.8, because written work rose and covered for it.

/** Marks scored out of marks available. Either half may be unknown. */
export type Marks = { scored: number | null; max: number | null };

export type TermFigures = {
  /** "Term 1 — AY2026", as the school stores it. */
  label: string;
  /** The weighted result. A band-representative integer when letter-graded. */
  quarterly: number | null;
  ww: number | null;
  pt: number | null;
  qa: number | null;
  /** What each component percentage is a percentage of. */
  marks?: Partial<Record<'ww' | 'pt' | 'qa', Marks>>;
};

export type SubjectTermPanelProps = {
  subject: string;
  /**
   * Letter-graded subjects store a band-representative integer in the term
   * grade (KD #104). The band is printed instead of the number, and a band
   * NEVER carries a points change — a five-point move there usually just means
   * the letter moved, which is not the same thing as a child slipping.
   */
  isExaminable: boolean;
  /** Ascending. The term being looked at is last. */
  terms: TermFigures[];
  /** Whole-number percents, printed on each component's pill. */
  weights?: { ww: number; pt: number; qa: number };
};

type MeasureKey = 'quarterly' | 'ww' | 'pt' | 'qa';

const COMPONENTS: { key: 'ww' | 'pt' | 'qa'; label: string }[] = [
  { key: 'ww', label: 'Written work' },
  { key: 'pt', label: 'Performance tasks' },
  { key: 'qa', label: 'Exam' },
];

/**
 * Every chart in this panel is pinned to it, and that is deliberate.
 *
 * Only one chart is on screen at a time now, so an axis fitted to the series
 * would be tempting — and wrong. Switching pills would silently change the
 * scale, and a term grade slipping three points would draw the same collapse as
 * an exam losing forty.
 */
const GRADE_SCALE: [number, number] = [0, 100];
const GRADE_TICKS = [0, 50, 100];

/**
 * "Term 1 — AY2026" → "Term 1".
 *
 * The label is stored with the year (`'Term ' || n || ' — ' || ay_code`,
 * migration 012 onward) and the panel only ever shows one academic year, so
 * repeating it on a chart axis and in a chip is noise. The table keeps the
 * stored label, where a reader may be copying a figure out.
 */
function shortTerm(label: string): string {
  return label.replace(/\s*—\s*AY\d{4}\s*$/, '');
}

/**
 * The change into each term from the term immediately before it.
 *
 * DELIBERATELY NOT "the most recent term that has a mark". A change printed
 * between two visible figures can be checked by eye; one that silently reaches
 * back across an empty term claims a comparison the reader cannot see.
 */
function deltas(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    if (i === 0 || v == null) return null;
    const before = values[i - 1];
    return before == null ? null : v - before;
  });
}

function toneFor(diff: number | null): string {
  if (diff == null || Math.abs(diff) < GRADE_ALERT_THRESHOLD) {
    return 'text-muted-foreground';
  }
  return diff > 0 ? 'text-brand-mint' : 'text-destructive';
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
      <span className="h-px flex-1 bg-border" aria-hidden />
    </p>
  );
}

type Measure = {
  key: MeasureKey;
  label: string;
  /** Printed beside the measure name over the figure, never on the tab. */
  sub: string;
  /** Percentages carry one; a weighted term grade does not. */
  unit: '' | '%';
  values: (number | null)[];
  deltas: (number | null)[];
  marks: (Marks | undefined)[] | null;
  /** Index of the last term carrying a value, or -1. */
  latest: number;
  /** The change into `latest`, or null when there is nothing before it. */
  change: number | null;
  fell: boolean;
};

export function SubjectTermPanel({
  subject,
  isExaminable,
  terms,
  weights,
}: SubjectTermPanelProps) {
  const measures = useMemo<Measure[]>(() => {
    const build = (
      key: MeasureKey,
      label: string,
      sub: string,
      unit: '' | '%',
      values: (number | null)[],
      marks: (Marks | undefined)[] | null
    ): Measure => {
      const d = deltas(values);
      let latest = -1;
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] != null) {
          latest = i;
          break;
        }
      }
      // A band is not a score, so it never carries a points change (KD #104).
      const change =
        latest >= 0 && (key !== 'quarterly' || isExaminable)
          ? (d[latest] ?? null)
          : null;
      return {
        key,
        label,
        sub,
        unit,
        values,
        deltas: d,
        marks,
        latest,
        change,
        fell: change != null && change <= -GRADE_ALERT_THRESHOLD,
      };
    };

    const out: Measure[] = [
      build(
        'quarterly',
        'Term grade',
        isExaminable ? '' : 'letter-graded',
        '',
        terms.map((t) => t.quarterly),
        null
      ),
    ];
    for (const c of COMPONENTS) {
      const values = terms.map((t) => t[c.key]);
      if (!values.some((v) => v != null)) continue;
      out.push(
        build(
          c.key,
          c.label,
          weights ? `${weights[c.key]}% of the term grade` : '',
          '%',
          values,
          terms.map((t) => t.marks?.[c.key])
        )
      );
    }
    return out;
  }, [terms, weights, isExaminable]);

  const [selected, setSelected] = useState<MeasureKey>('quarterly');
  const shown = measures.find((m) => m.key === selected) ?? measures[0];

  // Nothing at all: no term grade and no component carries a figure.
  if (!shown || measures.every((m) => m.latest < 0)) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No marks have been entered for {subject} yet.
      </p>
    );
  }

  const isGrade = shown.key === 'quarterly';
  const latestValue = shown.latest >= 0 ? shown.values[shown.latest] : null;
  const latestMarks = shown.marks?.[shown.latest];
  const priorLabel =
    shown.latest > 0 ? shortTerm(terms[shown.latest - 1]?.label ?? '') : null;

  // A single point is not a trend, and a letter band has no 0–100 position.
  const points = terms
    .map((t, i) => ({ x: shortTerm(t.label), y: shown.values[i] }))
    .filter((p): p is { x: string; y: number } => p.y != null);
  const showChart = points.length > 1 && (!isGrade || isExaminable);

  // A paper that changed size between terms. The percentage stays comparable;
  // the raw score does not, and reading down the Score column is exactly how
  // somebody concludes a child collapsed when the paper simply got longer.
  const totalChanged = (i: number): boolean => {
    const now = shown.marks?.[i]?.max ?? null;
    if (now == null) return false;
    for (let j = i - 1; j >= 0; j--) {
      const before = shown.marks?.[j]?.max ?? null;
      if (before != null) return before !== now;
    }
    return false;
  };
  const anyTotalChanged = terms.some((_, i) => totalChanged(i));

  const printValue = (v: number | null) => {
    if (v == null) return null;
    if (isGrade) return isExaminable ? fmtGrade(v) : numericToLetter(v);
    return `${fmtGrade(v)}%`;
  };

  return (
    <Tabs
      value={shown.key}
      onValueChange={(v) => setSelected(v as MeasureKey)}
      className="gap-5"
    >
      {/* The app's segmented switcher, not a hand-rolled one — its own comment
          calls it the variant for "level/view switchers", which is exactly this.
          Each tab carries its own change, and a fall carries a dot: a control
          that shows one measure has to say where the problem is without being
          clicked, or finding it means clicking all four. Same dot the Classroom
          subject tabs use, so it is one signal across the module. */}
      {/* Fitted, not stretched. Four tabs spread across 900px leaves each label
          marooned in the middle of its own cell. */}
      <TabsList variant="segmented" className="max-w-full flex-wrap">
        {measures.map((m) => (
          <TabsTrigger
            key={m.key}
            value={m.key}
            className="group/measure gap-1.5"
          >
            {m.fell && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-destructive group-data-[state=active]/measure:bg-white"
                aria-label="fell this term"
              />
            )}
            {m.label}
            <span
              className={cn(
                'font-mono text-[11px] font-semibold tabular-nums',
                m.fell
                  ? 'text-destructive group-data-[state=active]/measure:text-white'
                  : 'text-muted-foreground group-data-[state=active]/measure:text-white/75'
              )}
            >
              {m.change == null ? '—' : signedGrade(m.change)}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent
        value={shown.key}
        className="flex flex-col gap-5 data-[state=active]:outline-none"
      >
        {/* The chart is the main event now, so the figure column gives ground
            to it — at 28% the plot was squeezed into the right-hand third. */}
        {/* One line, then the chart at full width.
            The figure used to sit in a 22% column beside the chart, and at that
            width "PERFORMANCE TASKS · 40% of the term grade" wrapped onto three
            lines — the cramping Mr Ace kept seeing. The heading was also dead
            weight: the selected tab directly above already names the measure.
            So the name goes, the rest reads left to right, and the chart takes
            the whole dialog. */}
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p
            data-testid="measure-headline"
            className={cn(
              'font-serif text-[44px] font-semibold leading-none tabular-nums',
              shown.fell ? 'text-destructive' : 'text-foreground'
            )}
          >
            {printValue(latestValue) ?? '—'}
          </p>
          {latestMarks?.scored != null && latestMarks.max != null && (
            <p className="font-mono text-sm tabular-nums text-muted-foreground">
              {fmtGrade(latestMarks.scored)} / {fmtGrade(latestMarks.max)}
            </p>
          )}
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
              shown.change == null
                ? 'bg-muted text-muted-foreground'
                : shown.change <= -GRADE_ALERT_THRESHOLD
                  ? 'bg-destructive/10 text-destructive'
                  : shown.change >= GRADE_ALERT_THRESHOLD
                    ? 'bg-brand-mint/15 text-brand-mint'
                    : 'bg-muted text-muted-foreground'
            )}
          >
            {shown.change == null || !priorLabel
              ? 'No earlier term'
              : `${signedGrade(shown.change)} since ${priorLabel}`}
          </span>
          {shown.sub && (
            <span className="text-xs text-muted-foreground">{shown.sub}</span>
          )}
        </div>

        <div>
          <Eyebrow>Across the year</Eyebrow>
          {showChart ? (
            <div className="pt-2">
              <TrendChart
                label={shown.label}
                // Tall enough that the printed values, the plot and the term
                // labels each get their own band instead of stacking.
                height={196}
                domain={GRADE_SCALE}
                ticks={GRADE_TICKS}
                showValues
                yFormat={isGrade ? undefined : 'percent'}
                tone={shown.fell ? 'fall' : 'default'}
                current={points}
              />
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              {isGrade && !isExaminable
                ? 'This subject is letter-graded, so there is no figure to plot.'
                : 'One term is a point, not a trend — the figure carries it.'}
            </p>
          )}
        </div>

        {/* Open, not folded. One measure's marks is two to four rows — the fold
          was protecting the reader from a twelve-row table that no longer
          exists, and it cost a click on every student. */}
        <div>
          <Eyebrow>The marks behind it</Eyebrow>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left tabular-nums">
              <caption className="sr-only">
                {subject} — {shown.label}, by term
              </caption>
              {/* Score and Out of are removed for a term grade rather than filled
                with dashes, and the rest widen to take the space back. */}
              <colgroup>
                {(isGrade
                  ? ['50%', '25%', '25%']
                  : ['34%', '16%', '16%', '17%', '17%']
                ).map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <th scope="col" className="pb-2 text-left">
                    Term
                  </th>
                  {!isGrade && (
                    <>
                      <th scope="col" className="pb-2 text-right">
                        Score
                      </th>
                      <th scope="col" className="pb-2 text-right">
                        Out of
                      </th>
                    </>
                  )}
                  <th scope="col" className="pb-2 text-right">
                    Percentage
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t, i) => {
                  const v = shown.values[i];
                  const d = shown.deltas[i];
                  const m = shown.marks?.[i];
                  const changed = totalChanged(i);
                  return (
                    <tr key={t.label} className="border-t border-border">
                      <th
                        scope="row"
                        className="py-2 pr-2 text-left text-[13px] font-normal text-muted-foreground"
                      >
                        {t.label}
                      </th>
                      {!isGrade && (
                        <>
                          <td className="py-2 pl-2 text-right font-mono text-[12px] text-muted-foreground">
                            {m?.scored == null ? '—' : fmtGrade(m.scored)}
                          </td>
                          <td
                            className={cn(
                              'py-2 pl-2 text-right font-mono text-[12px]',
                              changed
                                ? 'font-semibold text-primary'
                                : 'text-muted-foreground'
                            )}
                          >
                            {m?.max == null ? '—' : fmtGrade(m.max)}
                            {changed && (
                              <span
                                className="ml-0.5 text-[9px]"
                                aria-label="total changed this term"
                              >
                                &#8593;
                              </span>
                            )}
                          </td>
                        </>
                      )}
                      <td
                        className={cn(
                          'py-2 pl-2 text-right font-serif text-[15px] font-semibold',
                          d != null && d <= -GRADE_ALERT_THRESHOLD
                            ? 'text-destructive'
                            : 'text-foreground'
                        )}
                      >
                        {printValue(v) ?? (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td
                        className={cn(
                          'py-2 pl-2 text-right font-mono text-[12px] font-semibold',
                          toneFor(isGrade && !isExaminable ? null : d)
                        )}
                      >
                        {(isGrade && !isExaminable) || d == null
                          ? '—'
                          : signedGrade(d)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <p className="flex gap-2 pt-3 text-xs text-muted-foreground">
              {anyTotalChanged && (
                <span
                  className="font-mono text-[10px] text-primary"
                  aria-hidden
                >
                  &#8593;
                </span>
              )}
              <span>
                {isGrade
                  ? 'A term grade is weighted out of 100, so it has no score and no total — those columns are not shown here rather than filled with dashes.'
                  : `${
                      anyTotalChanged
                        ? 'The paper changed size that term, so the score is not comparable with the one above it — the percentage is. '
                        : ''
                    }Marks are counted out of the assessments this student actually sat, so a missed assessment lowers both halves rather than scoring zero.`}
              </span>
            </p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
