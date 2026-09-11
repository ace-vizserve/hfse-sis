// Builds the "Export CSV" file for the Admissions Insights page
// (app/(admissions)/admissions/insights/page.tsx). Pure: every value here
// comes from data the page already loaded and already derived — no DB reads,
// no clock reads, no re-implemented selection rule. The "top 5 cancellation
// reasons + overflow" selection is the SAME pure function the page itself
// calls (`selectTopReasonBars` in lib/admissions/insights.ts) — this file
// only reshapes its already-selected output into CSV rows. Mirrors the page
// exactly: one section per widget the page renders, in the order it renders
// them.

import type { Delta } from '@/lib/dashboard/range';
import type { AyTrendResult } from '@/lib/dashboard/insights-trend';
import {
  insightsFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildAdmissionsInsightsExportInput = {
  ayCode: string;
  compareAy: string | null;

  // ── §1 Demand & conversion — 3 MetricCards → one Key figures section ──────
  applicationsCount: number;
  /** Same `Delta` the "Applications received" card's chip is built from
   *  (deltaFormat unset → relative %) — the builder must consume it, never
   *  recompute current−previous. Null when the card shows no chip. */
  applicationsDelta: Delta | null;
  /** Non-null exactly when a comparison AY is selected (0 counts as data). */
  priorApplications: number | null;
  conversionPct: number;
  /** Same `Delta` the "Conversion rate" card's chip is built from
   *  (`deltaFormat="absolute"`, unit "pp"). Null when the card shows no
   *  chip. */
  conversionDelta: Delta | null;
  priorConversionPct: number | null;
  /** The "Avg. days to enrol" card only renders when `sampleSize > 0` — the
   *  Key figures row mirrors that same gate, not an em-dash. */
  timeToEnroll: { sampleSize: number; avgDays: number };

  // ── Applications per month (two-AY overlay) ────────────────────────────────
  /** True when the chart has at least one non-null point across both series
   *  (the page's own `haveIntakeData` gate — EmptyChartState otherwise). */
  haveIntakeData: boolean;
  intakeTrend: AyTrendResult;

  // ── Application experience — ratings 1-5 histogram ─────────────────────────
  /** True when `feedback.stats.ratingCount > 0` — the card's own gate for
   *  showing the bar chart instead of its EmptyChartState. */
  hasRatingData: boolean;
  ratingChartData: { category: string; current: number }[];

  // ── Withdrawn by level (donut) ──────────────────────────────────────────────
  /** Already empty when there are no withdrawals this AY, matching the
   *  card's own EmptyChartState gate. */
  withdrawnByLevel: { level: string; count: number }[];

  // ── Conversion by assessment outcome (grouped bars) ────────────────────────
  /** Already empty when there is no assessment data, matching the card's own
   *  EmptyChartState gate. Values are the loader's 1-decimal conversionPct —
   *  rounded to WHOLE numbers by this builder (see below), not passed
   *  through. */
  assessmentGroupedData: {
    x: string;
    pass: number | null;
    fail: number | null;
    notAssessed: number | null;
  }[];

  // ── Cancellation reasons + top reason per level ────────────────────────────
  /** Both cards render only as a pair, gated by `terminal.total > 0` — when
   *  false, the page omits BOTH cards entirely (not an empty state), so
   *  neither section exists. */
  hasTerminalData: boolean;
  /** `selectTopReasonBars(terminal.overall)` output — the exact bars the
   *  donut plots. */
  reasonBars: { label: string; count: number }[];
  /** One row per level from `terminal.byLevel`, with the top reason's label
   *  already resolved (or null when the level has none) — the same value
   *  the TopReasonRow list renders. `count` is the LEVEL's total terminal
   *  count (not the top reason's own count), matching the card exactly. */
  terminalByLevel: {
    level: string;
    count: number;
    topReasonLabel: string | null;
  }[];

  // ── Referral volume (donut) ─────────────────────────────────────────────────
  /** Already filtered to `applied > 0`, matching the card's own donut data. */
  referralVolume: { name: string; value: number }[];

  // ── Category mix (grouped bars, two-AY overlay) ────────────────────────────
  /** True when any category has a non-zero count — the card's own gate for
   *  showing the chart instead of its EmptyChartState. */
  hasCategoryMixData: boolean;
  categoryMixData: { x: string; current: number; compare?: number }[];

  // ── Nationality mix (labelled pie) ──────────────────────────────────────────
  /** Already empty when there are no applications, matching the card's own
   *  EmptyChartState gate. Comparison-AY rows feed only the card's narrative
   *  caption, never a second plotted series — left out per the design
   *  brief's "narrative captions aren't figures" rule. */
  nationalityMix: { nationality: string; count: number }[];

  // ── Nationality by level (per-level composition bars) ──────────────────────
  /** Already empty (`rows: []`) when there are no applications, matching the
   *  card's own EmptyChartState gate. */
  nationalityByLevel: {
    legend: string[];
    rows: {
      level: string;
      total: number;
      segments: { nationality: string; count: number }[];
    }[];
  };
};

export function buildAdmissionsInsightsExport(
  input: BuildAdmissionsInsightsExportInput
): DashboardExport {
  const {
    ayCode,
    compareAy,
    applicationsCount,
    applicationsDelta,
    priorApplications,
    conversionPct,
    conversionDelta,
    priorConversionPct,
    timeToEnroll,
    haveIntakeData,
    intakeTrend,
    hasRatingData,
    ratingChartData,
    withdrawnByLevel,
    assessmentGroupedData,
    hasTerminalData,
    reasonBars,
    terminalByLevel,
    referralVolume,
    hasCategoryMixData,
    categoryMixData,
    nationalityMix,
    nationalityByLevel,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Admissions insights'],
    ['Academic year', ayCode],
  ];
  if (compareAy) {
    scope.push(['Compared with', compareAy]);
  }

  const sections: ExportSection[] = [];

  // §1 — 2 or 3 MetricCards → one Key figures section. Change carries the
  // SAME number the card's own delta chip shows, never a re-derived
  // current−previous. "Applications received" passes no `deltaFormat`, so
  // its chip (and Change) is the RELATIVE %; "Conversion rate" passes
  // `deltaFormat="absolute"` + unit "pp", so its chip (and Change) is the
  // ABSOLUTE point difference. "Avg. days to enrol" only appears in Key
  // figures when its card actually renders (`sampleSize > 0`) — mirroring
  // the page's own conditional JSX, not an em-dash row.
  const kpiRows: KpiRow[] = [
    {
      label: 'Applications received',
      current: applicationsCount,
      previous: priorApplications ?? undefined,
      change: applicationsDelta ? roundTo(applicationsDelta.pct, 1) : undefined,
    },
    {
      label: 'Conversion rate (%)',
      current: roundTo(conversionPct, 1),
      previous:
        priorConversionPct !== null
          ? roundTo(priorConversionPct, 1)
          : undefined,
      change: conversionDelta ? roundTo(conversionDelta.abs, 1) : undefined,
    },
  ];
  if (timeToEnroll.sampleSize > 0) {
    kpiRows.push({
      label: 'Avg. days to enrol',
      current: roundTo(timeToEnroll.avgDays, 1),
    });
  }
  sections.push(kpiSection(kpiRows));

  // Applications per month — two-AY overlay, headers named by the trend's
  // own AY-code series labels (matches the series keys `buildAyTrend` uses,
  // not the "This year (AYxxxx)" label used only for chart legends
  // elsewhere). `yFormat="number"` on TrendChart shows the value as given
  // (toLocaleString, no rounding) — these are already whole application
  // counts, so no rounding is applied. A future/un-encoded month is `null`
  // in the underlying data — passed through as an honest blank cell, same
  // as the chart's own gap. The card shows EmptyChartState instead of the
  // chart when there's no data at all (`haveIntakeData` false) — section
  // stays, with zero rows.
  sections.push({
    title: 'Applications per month',
    headers: [
      'Month',
      ...intakeTrend.series.map((s) => `${s.label} applications`),
    ],
    rows: haveIntakeData
      ? intakeTrend.data.map((row) => [
          String(row.x),
          ...intakeTrend.series.map((s) => {
            const v = row[s.key];
            return typeof v === 'number' ? v : null;
          }),
        ])
      : [],
  });

  // Application experience — the 1-5 star rating histogram. The card shows
  // EmptyChartState instead of the chart when no one has rated yet
  // (`hasRatingData` false) — section stays, with zero rows (every tier
  // would otherwise read as a real zero, not "no responses").
  sections.push({
    title: 'Ratings 1–5',
    headers: ['Rating', 'Responses'],
    rows: hasRatingData
      ? ratingChartData.map((r) => [r.category, r.current])
      : [],
  });

  // Withdrawn by level — a genuine partition of all withdrawn applications,
  // already empty when the AY has none (card's own EmptyChartState gate).
  sections.push({
    title: 'Withdrawn by level',
    headers: ['Level', 'Withdrawn applications'],
    rows: withdrawnByLevel.map((r) => [r.level, r.count]),
  });

  // Conversion by assessment outcome — the loader's own conversionPct is
  // already rounded to 1 decimal (computeConversionByAssessment), but this
  // chart renders with `yFormat="percent"`, whose formatter
  // (chart-primitives.ts) is `Math.round(n)` — ZERO decimals — and it drives
  // the axis, tooltip AND value labels the viewer actually sees. Round again
  // here to match the chart, not the loader's intermediate precision. Empty
  // when there's no assessment data yet (card's own EmptyChartState gate).
  sections.push({
    title: 'Conversion by assessment outcome',
    headers: ['Subject', 'Pass (%)', 'Fail (%)', 'Not assessed (%)'],
    rows: assessmentGroupedData.map((r) => [
      r.x,
      roundTo(r.pass, 0),
      roundTo(r.fail, 0),
      roundTo(r.notAssessed, 0),
    ]),
  });

  // Cancellation reasons + top reason per level — the page renders these two
  // cards ONLY as a pair, gated by `terminal.total > 0`. When there is no
  // terminal data, the page omits BOTH cards entirely (not an empty state),
  // so neither section exists here either.
  if (hasTerminalData) {
    sections.push({
      title: 'Cancellation reasons',
      headers: ['Reason', 'Applications'],
      rows: reasonBars.map((r) => [r.label, r.count]),
    });

    sections.push({
      title: 'Top reason per level',
      headers: ['Level', 'Top reason', 'Applicants'],
      rows: terminalByLevel.map((l) => [l.level, l.topReasonLabel, l.count]),
    });
  }

  // Referral volume — WHERE applicants come from (volume mix, not
  // conversion rate — the rate story lives only in the card's narrative
  // callout, left out per the design brief). Every source with ≥1 applicant
  // is shown (no sample-size filter); the card's own EmptyChartState gate
  // leaves this naturally empty when there are no sources recorded yet.
  sections.push({
    title: 'Referral volume',
    headers: ['Source', 'Applications'],
    rows: referralVolume.map((r) => [r.name, r.value]),
  });

  // Category mix — demand-mix counts, this AY vs. the comparison AY when one
  // is picked. `yFormat="number"` on this chart shows counts as given, no
  // rounding. Empty when no application has a countable category yet
  // (card's own EmptyChartState gate — `hasCategoryMixData` false).
  sections.push({
    title: 'Category mix',
    headers: compareAy ? ['Category', ayCode, compareAy] : ['Category', ayCode],
    rows: hasCategoryMixData
      ? categoryMixData.map((r) =>
          compareAy ? [r.x, r.current, r.compare ?? 0] : [r.x, r.current]
        )
      : [],
  });

  // Nationality mix — a genuine partition of all applicants, already empty
  // when there are none yet (card's own EmptyChartState gate). The prior-AY
  // comparison rows feed only the card's "biggest shift" narrative caption,
  // never a second plotted series, so they are not exported.
  sections.push({
    title: 'Nationality mix',
    headers: ['Nationality', 'Applicants'],
    rows: nationalityMix.map((r) => [r.nationality, r.count]),
  });

  // Nationality by level — one row per level, one column per nationality in
  // the shared legend (0-filled where a level has none), plus the level's
  // total. Already empty (`rows: []`) when there are no applications yet
  // (card's own EmptyChartState gate).
  sections.push({
    title: 'Nationality by level',
    headers: ['Level', ...nationalityByLevel.legend, 'Total'],
    rows: nationalityByLevel.rows.map((r) => {
      const countByName = new Map(
        r.segments.map((s) => [s.nationality, s.count])
      );
      return [
        r.level,
        ...nationalityByLevel.legend.map((name) => countByName.get(name) ?? 0),
        r.total,
      ];
    }),
  });

  return {
    filename: insightsFilename({ module: 'admissions', ayCode, compareAy }),
    scope,
    sections,
  };
}
