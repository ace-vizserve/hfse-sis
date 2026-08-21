'use client';

import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { numericToLetter } from '@/lib/compute/letter-grade';
import { GRADE_ALERT_THRESHOLD } from '@/lib/markbook/alert-threshold';
import { fmtGrade, signedGrade } from '@/lib/markbook/format-grade';
import { cn } from '@/lib/utils';

// One student, one subject, the whole year — headline, then what moved, then
// the marks.
//
// THE SAME PANEL ON BOTH SURFACES. A subject teacher opens it from their
// grading sheet and sees the subject they are marking; a form class adviser
// opens it from Classroom and picks a subject from tabs. Mr Ace, 2026-08-21:
// "use identical designs for grading sheet look up and classroom grades
// lookup its basically the same data bro why not just use same designs."
// Two components drew this before and had already drifted apart.
//
// The order is attendance's order, deliberately: a figure you can read at a
// glance, a chart, and only then a table. Three surfaces, one habit.

/** Marks scored out of marks available. Either half may be unknown. */
export type Marks = { scored: number | null; max: number | null };

export type TermFigures = {
  /** "Term 1" — as the school names it, never "T1". */
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
  /** Whole-number percents, printed beside each component label. */
  weights?: { ww: number; pt: number; qa: number };
};

const COMPONENTS: { key: 'ww' | 'pt' | 'qa'; label: string }[] = [
  { key: 'ww', label: 'Written work' },
  { key: 'pt', label: 'Performance tasks' },
  { key: 'qa', label: 'Exam' },
];

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

function Eyebrow({
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

export function SubjectTermPanel({
  subject,
  isExaminable,
  terms,
  weights,
}: SubjectTermPanelProps) {
  const quarterly = terms.map((t) => t.quarterly);
  const quarterlyDeltas = deltas(quarterly);

  // The last term that actually carries a result — not simply the last column,
  // which is empty for most of a school year.
  let latest = -1;
  for (let i = quarterly.length - 1; i >= 0; i--) {
    if (quarterly[i] != null) {
      latest = i;
      break;
    }
  }

  const headline = latest >= 0 ? quarterly[latest] : null;
  const headlineDelta = latest >= 0 ? quarterlyDeltas[latest] : null;
  const priorLabel = latest > 0 ? terms[latest - 1]?.label : null;

  // A single point is not a trend. Drawing a chart through one mark invents a
  // line the data cannot support, so the figure carries it alone.
  const plottable = terms.filter((t) => t.quarterly != null);
  const showTrend = plottable.length > 1 && isExaminable;

  const componentRows = COMPONENTS.map((c) => {
    const values = terms.map((t) => t[c.key]);
    return {
      ...c,
      values,
      deltas: deltas(values),
      any: values.some((v) => v != null),
    };
  }).filter((r) => r.any);

  const weightFor = (key: 'ww' | 'pt' | 'qa'): string | null =>
    weights ? `${weights[key]}%` : null;

  // A paper that changed size between terms. The percentage stays comparable;
  // the raw score does not, and reading down the Score column is exactly how
  // somebody concludes a child collapsed when the paper simply got longer.
  const totalChanged = (key: 'ww' | 'pt' | 'qa', i: number): boolean => {
    const now = terms[i]?.marks?.[key]?.max ?? null;
    if (now == null) return false;
    for (let j = i - 1; j >= 0; j--) {
      const before = terms[j]?.marks?.[key]?.max ?? null;
      if (before != null) return before !== now;
    }
    return false;
  };

  const anyTotalChanged = componentRows.some((r) =>
    terms.some((_, i) => totalChanged(r.key, i))
  );

  if (headline == null && componentRows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No marks have been entered for {subject} yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Two columns at dialog width: the result, and what produced it. One
          chart stretched the full width is a thin ribbon that says nothing. */}
      <div className="grid gap-7 md:grid-cols-[minmax(200px,32%)_1fr]">
        <div>
          <Eyebrow>Term grade</Eyebrow>
          <div className="pt-3">
            <p
              className={cn(
                'font-serif text-[44px] font-semibold leading-none tabular-nums',
                headlineDelta != null && headlineDelta <= -GRADE_ALERT_THRESHOLD
                  ? 'text-destructive'
                  : 'text-foreground'
              )}
            >
              {headline == null
                ? '—'
                : isExaminable
                  ? fmtGrade(headline)
                  : numericToLetter(headline)}
            </p>
            <p className="pt-2">
              {/* A band never carries a points change. */}
              {isExaminable && headlineDelta != null && priorLabel ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums',
                    headlineDelta < 0
                      ? 'bg-destructive/10 text-destructive'
                      : headlineDelta > 0
                        ? 'bg-brand-mint/15 text-brand-mint'
                        : 'bg-muted text-muted-foreground'
                  )}
                >
                  {signedGrade(headlineDelta)} since {priorLabel}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                  No earlier term
                </span>
              )}
            </p>
          </div>

          {showTrend && (
            <div className="pt-3">
              <TrendChart
                label="Term grade"
                variant="compact"
                height={72}
                current={plottable.map((t) => ({
                  x: t.label,
                  y: t.quarterly as number,
                }))}
              />
            </div>
          )}
        </div>

        {componentRows.length > 0 && (
          <div>
            <Eyebrow hint="all on one 0–100 scale">What moved</Eyebrow>
            {/* ONE SCALE ACROSS ALL THREE, which is the whole point: a term
                grade can sit still while written work collapses and the exam
                covers for it. That is invisible in a single line and obvious
                in three side by side. */}
            <div className="mt-3 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {componentRows.map((r) => {
                const current = r.values[latest >= 0 ? latest : 0] ?? null;
                const delta = r.deltas[latest >= 0 ? latest : 0] ?? null;
                const points = r.values.filter(
                  (v, i) => v != null && terms[i] != null
                );
                return (
                  <div
                    key={r.key}
                    className="flex flex-col gap-1.5 bg-card px-3.5 py-3"
                  >
                    <p className="text-[12.5px] font-medium text-foreground">
                      {r.label}
                      {weightFor(r.key) && (
                        <span className="ml-1.5 font-mono text-[9.5px] text-muted-foreground">
                          {weightFor(r.key)}
                        </span>
                      )}
                    </p>
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'font-serif text-[23px] font-semibold leading-none tabular-nums',
                          delta != null && delta <= -GRADE_ALERT_THRESHOLD
                            ? 'text-destructive'
                            : 'text-foreground'
                        )}
                      >
                        {current == null ? '—' : `${fmtGrade(current)}%`}
                      </span>
                      {delta != null && (
                        <span
                          className={cn(
                            'font-mono text-[11px] font-semibold tabular-nums',
                            toneFor(delta)
                          )}
                        >
                          {signedGrade(delta)}
                        </span>
                      )}
                    </div>
                    {points.length > 1 && (
                      <TrendChart
                        label={r.label}
                        variant="compact"
                        height={38}
                        yFormat="percent"
                        current={terms
                          .map((t, i) => ({ x: t.label, y: r.values[i] }))
                          .filter(
                            (pt): pt is { x: string; y: number } => pt.y != null
                          )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {(headline != null || componentRows.length > 0) && (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            The marks behind it
          </summary>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left tabular-nums">
              <caption className="sr-only">
                {subject} marks, by term and component
              </caption>
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <th scope="col" className="pb-2 text-left">
                    Term
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Score
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Out of
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Percentage
                  </th>
                  <th scope="col" className="pb-2 text-right">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* The result first, then the parts that produce it. Score and
                    Out of stay empty: a term grade is a weighted figure out of
                    100, so inventing a denominator for it would be a lie. */}
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={5}
                    className="pb-1 pt-1 text-left font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    Term grade
                  </th>
                </tr>
                {terms.map((t, i) => (
                  <tr key={`quarterly-${t.label}`}>
                    <th
                      scope="row"
                      className="py-1.5 pl-3.5 pr-2 text-left text-[13px] font-normal text-muted-foreground"
                    >
                      {t.label}
                    </th>
                    <td className="py-1.5 pl-2 text-right font-mono text-[12px] text-muted-foreground/60">
                      —
                    </td>
                    <td className="py-1.5 pl-2 text-right font-mono text-[12px] text-muted-foreground/60">
                      —
                    </td>
                    <td className="py-1.5 pl-2 text-right font-serif text-[15px] font-semibold text-foreground">
                      {t.quarterly == null ? (
                        <span className="text-muted-foreground/60">—</span>
                      ) : isExaminable ? (
                        fmtGrade(t.quarterly)
                      ) : (
                        numericToLetter(t.quarterly)
                      )}
                    </td>
                    <td
                      className={cn(
                        'py-1.5 pl-2 text-right font-mono text-[12px] font-semibold',
                        toneFor(isExaminable ? quarterlyDeltas[i] : null)
                      )}
                    >
                      {!isExaminable || quarterlyDeltas[i] == null
                        ? '—'
                        : signedGrade(quarterlyDeltas[i] as number)}
                    </td>
                  </tr>
                ))}
                {componentRows.map((r) => (
                  <>
                    <tr key={`${r.key}-head`}>
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="border-t border-border pb-1 pt-4 text-left font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        {r.label}
                      </th>
                    </tr>
                    {terms.map((t, i) => {
                      const v = r.values[i];
                      const d = r.deltas[i];
                      const m = t.marks?.[r.key];
                      const changed = totalChanged(r.key, i);
                      return (
                        <tr key={`${r.key}-${t.label}`}>
                          <th
                            scope="row"
                            className="py-1.5 pl-3.5 pr-2 text-left text-[13px] font-normal text-muted-foreground"
                          >
                            {t.label}
                          </th>
                          <td className="py-1.5 pl-2 text-right font-mono text-[12px] text-muted-foreground">
                            {m?.scored == null ? '—' : fmtGrade(m.scored)}
                          </td>
                          <td
                            className={cn(
                              'py-1.5 pl-2 text-right font-mono text-[12px]',
                              changed
                                ? 'font-semibold text-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {m?.max == null ? '—' : fmtGrade(m.max)}
                            {changed && (
                              <span
                                className="ml-0.5 text-[9px] text-primary"
                                aria-label="total changed this term"
                              >
                                &#8593;
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pl-2 text-right font-serif text-[15px] font-semibold text-foreground">
                            {v == null ? (
                              <span className="text-muted-foreground/60">
                                —
                              </span>
                            ) : (
                              `${fmtGrade(v)}%`
                            )}
                          </td>
                          <td
                            className={cn(
                              'py-1.5 pl-2 text-right font-mono text-[12px] font-semibold',
                              toneFor(d)
                            )}
                          >
                            {d == null ? '—' : signedGrade(d)}
                          </td>
                        </tr>
                      );
                    })}
                  </>
                ))}
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
                {anyTotalChanged
                  ? 'The paper changed size that term, so the score is not comparable with the one above it — the percentage is. '
                  : ''}
                Marks are counted out of the assessments this student actually
                sat, so a missed assessment lowers both halves rather than
                scoring zero.
              </span>
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
