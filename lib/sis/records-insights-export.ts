// Builds the "Export CSV" file for the Records Insights page
// (app/(records)/records/insights/page.tsx). Pure: every value here comes
// from data the page already loaded and already derived (rollupMovements,
// the composed-chart reshapes, the retention/attrition selections) — no DB
// reads, no clock reads, and no re-implemented selection rule. Mirrors the
// page exactly: one section per widget the page renders, in the order it
// renders them, including the comparison-only widgets (Population by level,
// Category mix, Retention) which are absent entirely without a compareAy.

import type { ComparisonCardState } from '@/lib/dashboard/comparison';
import type { Delta } from '@/lib/dashboard/range';
import type {
  LevelCountRow,
  MonthlyMovementPoint,
  Retention,
} from '@/lib/sis/records-insights';
import type { RetentionStackRow } from '@/components/dashboard/charts/retention-stacked-bar-chart';
import type { AttritionStackedBarPoint } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import type { ComposedBarLinePoint } from '@/components/dashboard/charts/composed-bar-line-chart';
import type { ComparisonBarPoint } from '@/components/dashboard/charts/comparison-bar-chart';
import type { DonutSlice } from '@/components/dashboard/charts/donut-chart';
import type {
  NationalityByLevel,
  NationalityMixRow,
} from '@/lib/admissions/insights-funnel';
import {
  insightsFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildRecordsInsightsExportInput = {
  ayCode: string;
  compareAy: string | null;

  // ── Key figures: Enrolled / Retention rate / Late enrollees ────────────
  headcountTotal: number;
  /** Prior-AY headcount total, or null when there's no comparison. */
  priorTotal: number | null;
  /** Same `Delta` the "Enrolled" card's chip is built from (computeDelta) —
   *  the builder must consume it, never recompute current−previous.
   *  Undefined when the card shows no chip (no comparison). */
  enrolledDelta: Delta | undefined;
  /** Same 3-state the "Retention rate" card's value is gated on
   *  (comparisonCardState). Only 'ok' shows a real number on the card. */
  retentionState: ComparisonCardState;
  /** retention.pct — only meaningful (and only read) when retentionState
   *  is 'ok'; the card shows "—" otherwise, which exports as a blank cell. */
  retentionPct: number | null;
  lateEnrolledCount: number;

  // ── Population by level — comparison-only ──────────────────────────────
  /** ComposedBarLineChart's own plotted points (bar = this year, line =
   *  prior year), already sorted + short-coded exactly as the chart shows. */
  populationComposedData: ComposedBarLinePoint[];

  // ── Category mix — comparison-only ─────────────────────────────────────
  /** True when the card renders the GroupedBarChart; false when it shows
   *  its EmptyChartState instead (categoryMixData may still hold rows of
   *  all-zero counts in that case — nothing is actually plotted). */
  haveCategoryMixData: boolean;
  categoryMixData: { x: string; current: number; compare: number }[];

  // ── Nationality mix — always rendered (no comparison series plotted) ───
  nationalityMix: NationalityMixRow[];

  // ── Nationality by level — always rendered ─────────────────────────────
  nationalityByLevel: NationalityByLevel;

  // ── Mid-year movement — always rendered, empty-state gated ─────────────
  haveMovementActivity: boolean;
  movementBarData: MonthlyMovementPoint[];

  // ── Retention — absent entirely when the card shows Building history /
  //    no-data (those carry no figures, same treatment as a narrative card)
  retention: Retention;
  haveRetentionByLevel: boolean;
  retentionStackData: RetentionStackRow[];

  // ── Late joins — one shared gate for both charts (a single generic
  //    empty-state card replaces both when there are none) ───────────────
  haveLate: boolean;
  lateLevelDonutData: DonutSlice[];
  lateTermBarData: ComparisonBarPoint[];

  // ── Attrition — one shared top-level gate for all three widgets below
  //    (a single generic empty-state card replaces all three when there are
  //    no withdrawals at all) ─────────────────────────────────────────────
  haveWithdrawals: boolean;
  /** False when every recorded reason is Unspecified — the card then shows
   *  narrative text instead of the donut (zero rows, section still exists). */
  hasSpecifiedWithdrawalReasons: boolean;
  reasonDonutData: DonutSlice[];
  withdrawalsByLevel: LevelCountRow[];
  withdrawnTotal: number;
  /** Gates the reason×level stacked-bar card, which is entirely absent
   *  (not an empty state) unless both this AND hasSpecifiedWithdrawalReasons
   *  are true. */
  haveAttritionMatrix: boolean;
  attritionStackedData: AttritionStackedBarPoint[];
  withdrawalReasonKeys: string[];
};

export function buildRecordsInsightsExport(
  input: BuildRecordsInsightsExportInput
): DashboardExport {
  const {
    ayCode,
    compareAy,
    headcountTotal,
    priorTotal,
    enrolledDelta,
    retentionState,
    retentionPct,
    lateEnrolledCount,
    populationComposedData,
    haveCategoryMixData,
    categoryMixData,
    nationalityMix,
    nationalityByLevel,
    haveMovementActivity,
    movementBarData,
    retention,
    haveRetentionByLevel,
    retentionStackData,
    haveLate,
    lateLevelDonutData,
    lateTermBarData,
    haveWithdrawals,
    hasSpecifiedWithdrawalReasons,
    reasonDonutData,
    withdrawalsByLevel,
    withdrawnTotal,
    haveAttritionMatrix,
    attritionStackedData,
    withdrawalReasonKeys,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Records insights'],
    ['Academic year', ayCode],
  ];
  if (compareAy) {
    scope.push(['Compared with', compareAy]);
  }

  const sections: ExportSection[] = [];

  // 3 MetricCards → one Key figures section. Only "Enrolled" ever shows a
  // delta chip (no `deltaFormat` passed, so the default 'percent' mode
  // applies — 1 decimal) — Change carries that same delta.pct, never a
  // re-derived current−previous. "Retention rate" shows no chip at all
  // (its own card passes no `delta` prop); when the card can't show a real
  // number (retentionState !== 'ok', displayed as "—") the cell is blank,
  // never the display dash. "Late enrollees" has no comparison at all.
  const kpiRows: KpiRow[] = [
    {
      label: 'Enrolled',
      current: headcountTotal,
      previous: priorTotal !== null ? priorTotal : undefined,
      change: enrolledDelta ? roundTo(enrolledDelta.pct, 1) : undefined,
    },
    {
      label: 'Retention rate',
      current: retentionState === 'ok' ? roundTo(retentionPct, 1) : null,
    },
    {
      label: 'Late enrollees',
      current: lateEnrolledCount,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Population by level — comparison-only (page gate: `compareAy &&
  // priorHeadcount`; priorHeadcount is always a real object once compareAy
  // is set, so `compareAy` alone is the same gate). Values are already
  // whole-number headcounts — this chart renders with yFormat="number",
  // which never rounds coarser than given.
  if (compareAy) {
    sections.push({
      title: 'Population by level',
      headers: ['Level', ayCode, compareAy],
      rows: populationComposedData.map((d) => [d.category, d.bar, d.line]),
    });
  }

  // Category mix — comparison-only (same gate as above: `compareAy &&
  // priorCategoryMix`, and priorCategoryMix is always a real array once
  // compareAy is set). The card shows its EmptyChartState instead of the
  // GroupedBarChart when `haveCategoryMixData` is false — nothing is
  // actually plotted then, so zero rows, even though categoryMixData may
  // still hold all-zero-count entries.
  if (compareAy) {
    sections.push({
      title: 'Category mix',
      headers: ['Category', ayCode, compareAy],
      rows: haveCategoryMixData
        ? categoryMixData.map((r) => [r.x, r.current, r.compare])
        : [],
    });
  }

  // Nationality mix — always rendered (the standing "who is enrolled here"
  // fact, not gated on a comparison). NationalityMixPie only ever plots the
  // current-year counts on the pie itself; the prior-year overlay feeds a
  // narrative "biggest shift" caption only (excluded, like every other
  // narrative caption), so no comparison column here.
  sections.push({
    title: 'Nationality mix',
    headers: ['Nationality', 'Students'],
    rows: nationalityMix.map((r) => [r.nationality, r.count]),
  });

  // Nationality by level — always rendered. NationalityByLevelBars plots a
  // per-level, per-nationality count (bar segment widths); `segments` omits
  // nationalities absent from a level, so those are zero-filled here to
  // build a stable matrix across the shared legend.
  sections.push({
    title: 'Nationality by level',
    headers: ['Level', ...nationalityByLevel.legend, 'Total'],
    rows: nationalityByLevel.rows.map((row) => {
      const byName = new Map(row.segments.map((s) => [s.nationality, s.count]));
      return [
        row.level,
        ...nationalityByLevel.legend.map((name) => byName.get(name) ?? 0),
        row.total,
      ];
    }),
  });

  // Mid-year movement — always rendered; the card shows its EmptyChartState
  // instead of the GroupedBarChart when `haveMovementActivity` is false, so
  // zero rows then even though movementBarData holds 11 all-zero months.
  sections.push({
    title: 'Monthly moves in/out',
    headers: ['Month', 'Enrollments', 'Withdrawals'],
    rows: haveMovementActivity
      ? movementBarData.map((p) => [p.month, p.enrollments, p.withdrawals])
      : [],
  });

  // Retention — absent entirely (not an empty state) when the card shows
  // Building history ('building', no compareAy) or "No data for {compareAy}"
  // ('no-data') — both are narrative placeholders with no figures to
  // tabulate, the same treatment as any other narrative-only card. When
  // 'ok', an "All levels" row carries the overall figures shown in the
  // card's own prose sentence (returned/priorTotal/pct — real numbers, not
  // narrative opinion), and the per-level rows (RetentionStackedBarChart's
  // own plotted rows, already worst-first and excluding S4 graduates) are
  // appended only when the card actually draws that chart
  // (haveRetentionByLevel); pct is already 1dp from the loader, matching
  // the chart's own `${pct}%` label (no `formatterFor('percent')` rounding
  // applied there — that formatter only drives axis/tooltip charts, not
  // this LabelList).
  if (retentionState === 'ok') {
    sections.push({
      title: 'Retention',
      headers: [
        'Level',
        'Returned',
        'Did not return',
        'Prior cohort',
        'Retention %',
      ],
      rows: [
        [
          'All levels',
          retention.returned,
          retention.didNotReturn,
          retention.priorTotal,
          roundTo(retention.pct, 1),
        ],
        ...(haveRetentionByLevel
          ? retentionStackData.map((r) => [
              r.level,
              r.returned,
              r.didNotReturn,
              r.priorTotal,
              roundTo(r.pct, 1),
            ])
          : []),
      ],
    });
  }

  // Late joins — the page shows ONE generic empty-state card in place of
  // BOTH the by-level donut and the by-term bar when there are no late
  // enrollees at all (`!haveLate`) — neither actual widget instance
  // renders, so neither section exists (same treatment as the Markbook
  // quota-risk placeholder).
  if (haveLate) {
    sections.push({
      title: 'Late joins by level',
      headers: ['Level', 'Late enrollees'],
      rows: lateLevelDonutData.map((d) => [d.name, d.value]),
    });
    sections.push({
      title: 'Late joins by term',
      headers: ['Term', 'Late enrollees'],
      rows: lateTermBarData.map((t) => [t.category, t.current]),
    });
  }

  // Attrition — the page shows ONE generic empty-state card in place of all
  // three withdrawal widgets (reasons donut, by-level list, reason×level
  // matrix) when there are no withdrawals at all (`!haveWithdrawals`) — none
  // of the three actual widget instances render, so none of the sections do.
  if (haveWithdrawals) {
    // Reasons donut — the card shows narrative text instead of the donut
    // when every recorded reason is Unspecified (`!hasSpecifiedWithdrawalReasons`),
    // so zero rows then even though reasonDonutData may still hold an
    // 'Unspecified' slice.
    sections.push({
      title: 'Withdrawal reasons',
      headers: ['Reason', 'Withdrawals'],
      rows: hasSpecifiedWithdrawalReasons
        ? reasonDonutData.map((d) => [d.name, d.value])
        : [],
    });

    // By-level list — always rendered whenever there are withdrawals,
    // regardless of whether reasons are specified. Share % uses the SAME
    // Math.round formula the on-screen LevelStatRow computes
    // (page.tsx: `Math.round((l.count / rollup.counts.withdrawn) * 100)`),
    // reproduced here rather than extracted since it's a formatter, not a
    // selection/slicing rule.
    sections.push({
      title: 'Withdrawals by level',
      headers: ['Level', 'Students', 'Share (%)'],
      rows: withdrawalsByLevel.map((l) => {
        const pct =
          withdrawnTotal > 0 ? Math.round((l.count / withdrawnTotal) * 100) : 0;
        return [l.level, l.count, pct];
      }),
    });

    // Reason concentration by level — the AttritionStackedBarChart card is
    // entirely absent (not an empty state) unless BOTH gates hold.
    if (hasSpecifiedWithdrawalReasons && haveAttritionMatrix) {
      sections.push({
        title: 'Attrition',
        headers: ['Level', ...withdrawalReasonKeys],
        rows: attritionStackedData.map((row) => [
          row.level,
          ...withdrawalReasonKeys.map((key) => (row[key] as number) ?? 0),
        ]),
      });
    }
  }

  return {
    filename: insightsFilename({ module: 'records', ayCode, compareAy }),
    scope,
    sections,
  };
}
