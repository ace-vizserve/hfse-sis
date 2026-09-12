// Builds the "Export CSV" file for the oversight Evaluation dashboard
// (app/(evaluation)/evaluation/page.tsx, the `canToggle` branch only — a
// teacher gets no button). Pure: every number here comes from data the page
// already loaded — no DB reads, no clock reads. Mirrors the page exactly:
// one section per widget the oversight branch renders, in the order it
// renders them. "Write-ups by section" reuses the SAME rollup
// (rollupBySection, via buildAllRowSets in lib/evaluation/drill.ts) the card
// itself is fed from, already rounded to a whole percent at the source, so
// the file can never disagree with the screen it was exported from.

import type {
  EvaluationChaseKpis,
  EvaluationKpis,
} from '@/lib/evaluation/dashboard';
import type { SectionWriteupRow } from '@/lib/evaluation/drill';
import type { RangeInput, RangeResult } from '@/lib/dashboard/range';
import type { VelocityPoint } from '@/lib/dashboard/velocity';
import {
  dashboardFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildEvaluationDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  kpis: RangeResult<EvaluationKpis>;
  velocity: RangeResult<VelocityPoint[]>;
  /**
   * Null when `!canToggle` (a teacher — the page never renders an export
   * button for that view, so this is never actually null in practice).
   * `getEvaluationChaseKpis` itself never returns null: on T4 / no current
   * writeup term it resolves to `{ available: false, ... }`, and the card
   * shows "—" from that flag, not from this field being null.
   */
  chaseKpis: EvaluationChaseKpis | null;
  /** `drillRowSets?.bySection` — null when buildAllRowSets didn't run. */
  bySection: SectionWriteupRow[] | null;
};

export function buildEvaluationDashboardExport(
  input: BuildEvaluationDashboardExportInput
): DashboardExport {
  const { ayCode, rangeInput, kpis, velocity, chaseKpis, bySection } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Evaluation dashboard'],
    ['Academic year', ayCode],
    ['Date range', `${rangeInput.from} to ${rangeInput.to}`],
  ];
  if (rangeInput.cmpFrom && rangeInput.cmpTo) {
    scope.push([
      'Compared with',
      `${rangeInput.cmpFrom} to ${rangeInput.cmpTo}`,
    ]);
  }

  const sections: ExportSection[] = [];

  // 4 MetricCards → one Key figures section. Change must carry the SAME
  // number the card's delta chip shows, never a re-derived current−previous.
  // Only "Submission %" passes a `delta` prop to <MetricCard> (page.tsx),
  // and it passes no `deltaFormat`, so `formatDeltaLabel` (lib/dashboard/
  // range.ts) uses its default `'percent'` mode, which renders `delta.pct`
  // to 1 decimal.
  //
  // "Submission %" itself is rendered by MetricCard's own `format="percent"`
  // path (`value.toFixed(1)`) — 1 decimal, a SEPARATE check from any chart's
  // rounding (PRECISION rule) — so `roundTo(…, 1)` here.
  //
  // "Submitted" shows a denominator subtext ("of N expected"), not a prior-
  // period figure, so its Previous/Change stay blank. "Outstanding
  // write-ups" and "Advisers behind" are live-state chase metrics with no
  // prior-period concept at all — on T4 / no current term the card itself
  // shows "—"; the export leaves that cell blank (null) rather than the
  // on-screen glyph, per "Missing value = empty cell."
  const kpiRows: KpiRow[] = [
    {
      label: 'Submission %',
      current: roundTo(kpis.current.submissionPct, 1),
      previous: kpis.comparison
        ? roundTo(kpis.comparison.submissionPct, 1)
        : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    {
      label: 'Submitted',
      current: kpis.current.submitted,
    },
    {
      label: 'Outstanding write-ups',
      current: chaseKpis?.available ? chaseKpis.outstandingWriteups : null,
    },
    {
      label: 'Advisers behind',
      current: chaseKpis?.available ? chaseKpis.advisersBehind : null,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Submissions per day — the page hides SubmissionVelocityDrillCard
  // entirely when there's ≤ 1 point (velocity.current.length > 1). Comparison
  // is aligned by POSITION, not by date — same as TrendChart's own
  // `current.map((pt, i) => ({ ..., comparison: comparison?.[i]?.y }))`.
  //
  // No rounding: the card renders this TrendChart with no `yFormat`, so
  // neither the axis nor the tooltip apply any formatter, and the values are
  // already whole-number daily counts from bucketByDay — nothing to round.
  if (velocity.current.length > 1) {
    const hasComparison = !!velocity.comparison;
    sections.push({
      title: 'Submissions per day',
      headers: hasComparison
        ? ['Date', 'Submissions', 'Comparison submissions']
        : ['Date', 'Submissions'],
      rows: velocity.current.map((pt, i) => {
        const row: (string | number | null)[] = [pt.x, pt.y];
        if (hasComparison) {
          const cmpPt = velocity.comparison![i];
          row.push(cmpPt ? cmpPt.y : null);
        }
        return row;
      }),
    });
  }

  // Write-ups by section — WriteupsBySectionCard plots exactly one number
  // per section (submissionPct); rows arrive pre-rounded to a whole percent
  // (rollupBySection: `Math.round((submitted/total)*100)`) — the same
  // precision ComparisonBarChart's `yFormat="percent"` axis/tooltip/value-
  // label formatter (`Math.round`, chart-primitives.ts) shows, so nothing
  // to re-round — AND pre-sorted ascending by rollupBySection, the same
  // rollup the card's `data` prop is built from; no further slicing/sorting
  // here to mirror. The page gates this card on
  // `drillRowSets.bySection.length > 0`, so this section is added under the
  // identical condition (never a section for a widget the page itself never
  // renders).
  if (bySection && bySection.length > 0) {
    sections.push({
      title: 'Write-ups by section',
      headers: ['Section', 'Submission %'],
      rows: bySection.map((r) => [r.sectionName, r.submissionPct]),
    });
  }

  return {
    filename: dashboardFilename({
      module: 'evaluation',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
