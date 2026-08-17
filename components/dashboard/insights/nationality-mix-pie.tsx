import { Globe2 } from 'lucide-react';

import { LabeledPieChart } from '@/components/dashboard/charts/labeled-pie-chart';
import type { NationalityMixRow } from '@/lib/admissions/insights-funnel';

// Nationality composition — a labelled pie plus a ranked legend carrying the
// exact counts.
//
// WHY THE PIE CARRIES ITS OWN LEGEND rather than external leader lines: the
// mix measured on production 2026-08-17 is extremely concentrated — two
// nationalities are 92% of applicants and seven of the remaining slices are
// under 2% each. Leader-line labels would collide into an unreadable stack on
// one side; LabeledPieChart instead suppresses the on-slice label below ~3%
// and lets the legend carry every exact figure, so nothing is lost.
//
// The headline states the concentration outright, because that is the actual
// answer to "how diverse are we" and a reader should not have to add the top
// two slices themselves.
//
// COLOUR. A blue ramp ordered by slice size (the --chart-1..4 tokens are one),
// with the two synthetic buckets held in neutral so they never read as a
// nationality. Tokens only — no raw hex (hard rule #7).

const RAMP = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-brand-indigo)',
  'var(--color-chart-5)',
  'var(--color-brand-amber)',
  'var(--color-brand-mint)',
];
const OTHER_COLOR = 'var(--color-muted-foreground)';
const UNSPECIFIED_COLOR = 'var(--color-border)';
const SYNTHETIC = new Set(['Other', 'Unspecified']);

function shareOf(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

export function NationalityMixPie({
  rows,
  compareRows,
  compareLabel,
  unitLabel,
}: {
  rows: NationalityMixRow[];
  /** Prior-AY rows, or null when no comparison year is selected. */
  compareRows?: NationalityMixRow[] | null;
  compareLabel?: string | null;
  /** What one slice counts, e.g. "applicants" or "enrolled students". */
  unitLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);

  const named = rows.filter((r) => !SYNTHETIC.has(r.nationality));
  const other = rows.find((r) => r.nationality === 'Other');
  const distinct = named.length + (other?.foldedCount ?? 0);

  // Colours are positional, so build them in the same order as `rows`
  // (already sorted descending, with Other/Unspecified last).
  let rampCursor = 0;
  const colors = rows.map((r) => {
    if (r.nationality === 'Other') return OTHER_COLOR;
    if (r.nationality === 'Unspecified') return UNSPECIFIED_COLOR;
    const c = RAMP[rampCursor % RAMP.length];
    rampCursor += 1;
    return c;
  });

  const topTwo = named.slice(0, 2);
  const topTwoShare = shareOf(
    topTwo.reduce((s, r) => s + r.count, 0),
    total
  );

  // The single biggest change in share, kept because the pie itself cannot
  // show movement. Neutral wording: a nationality's share rising or falling
  // is not good or bad news (docs/context/09a-design-patterns.md §9).
  const priorTotal = (compareRows ?? []).reduce((s, r) => s + r.count, 0);
  let biggestShift: { name: string; diff: number } | null = null;
  if (compareRows && priorTotal > 0) {
    const priorShare = new Map(
      compareRows.map((r) => [r.nationality, shareOf(r.count, priorTotal)])
    );
    for (const r of named) {
      const diff =
        shareOf(r.count, total) - (priorShare.get(r.nationality) ?? 0);
      if (!biggestShift || Math.abs(diff) > Math.abs(biggestShift.diff)) {
        biggestShift = { name: r.nationality, diff };
      }
    }
    if (biggestShift && Math.abs(biggestShift.diff) < 0.05) biggestShift = null;
  }

  return (
    <div>
      <div className="flex items-start gap-3 pb-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Globe2 className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="font-serif text-[19px] font-semibold leading-tight tracking-tight text-foreground">
            {distinct.toLocaleString('en-SG')}{' '}
            {distinct === 1 ? 'nationality' : 'nationalities'}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {topTwo.length === 2 ? (
              <>
                {topTwo[0].nationality} and {topTwo[1].nationality} together are{' '}
                <span className="font-semibold text-foreground">
                  {topTwoShare.toFixed(1)}%
                </span>{' '}
                of {total.toLocaleString('en-SG')} {unitLabel}
              </>
            ) : (
              <>
                Across {total.toLocaleString('en-SG')} {unitLabel}
              </>
            )}
          </p>
        </div>
      </div>

      <LabeledPieChart
        data={rows.map((r) => ({ name: r.nationality, value: r.count }))}
        colors={colors}
        height={240}
      />

      {biggestShift && compareLabel && (
        <p className="mt-3.5 border-t border-hairline pt-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Biggest shift vs {compareLabel} · {biggestShift.name}{' '}
          {biggestShift.diff > 0 ? '+' : '−'}
          {Math.abs(biggestShift.diff).toFixed(1)}pp
        </p>
      )}
    </div>
  );
}
