// Builds the "Export CSV" file for the Markbook Insights page
// (app/(markbook)/markbook/insights/page.tsx). Pure: every value here comes
// from data the page already loaded and already derived — no DB reads, no
// clock reads, and no re-implemented selection rule. The "top 5 movers",
// "lowest 6" and "top 6 drops" rankings are the SAME pure functions the page
// itself calls (selectTopMovementSubjects / selectSubjectsToWatch in
// insights-compare.ts, selectTopRegressionMovers in insights-level.ts) — this
// file only reshapes their already-selected output into CSV rows. Mirrors
// the page exactly: one section per widget the page renders, in the order it
// renders them.

import type { ChangeRequestSummary } from '@/lib/markbook/dashboard';
import type { SubjectLevelDelta } from '@/lib/markbook/insights-level';
import type { TrendPoint } from '@/lib/markbook/insights-compare';
import {
  insightsFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildMarkbookInsightsExportInput = {
  ayCode: string;
  compareAy: string | null;

  // ── Subject performance trend (top-N-by-movement bars, current AY only) ────
  /** True when the page renders this chart at all (no section otherwise —
   *  not an empty state, the card itself is absent). */
  haveTrend: boolean;
  /** `buildMultiAyTrend`'s own series list — one entry per plotted subject,
   *  `key` indexes into each `trendBarData` row, `label` is the display name
   *  (bare subject name here — this chart is always current-AY only). */
  trendBarSeries: { key: string; label: string }[];
  trendBarData: Array<Record<string, string | number | null>>;

  // ── Subjects to watch (always rendered; empty state when no rows) ─────────
  /** `selectSubjectsToWatch` output — the lowest 6 in the latest period with
   *  data. Already the exact rows the card lists. */
  watchRows: TrendPoint[];

  // ── Which levels are struggling (omitted entirely when no level data) ─────
  levelLineData: { x: string; y: number }[];
  /** The reference line drawn across the chart — also a genuinely plotted
   *  number, so it gets its own labelled row. */
  schoolAvgAcrossLevels: number;

  // ── Term-over-term movement (omitted entirely when no movers) ─────────────
  /** `selectTopRegressionMovers` output — up to 6 (subject × level) pairs by
   *  |delta|, re-sorted worst-first. Same rows the paired bar chart plots. */
  regressionMovers: SubjectLevelDelta[];

  // ── Grading throughput ──────────────────────────────────────────────────
  /** Always fetched — `getChangeRequestSummary` never returns null. None of
   *  its 3 MetricCards pass a `delta` prop, so Previous/Change stay blank. */
  changeRequests: ChangeRequestSummary;
  /** Sheets locked · per term — always rendered (empty state when no rows).
   *  Already whole-number percents, matching the chart's `yFormat="percent"`
   *  value labels (`Math.round`, zero decimals). */
  lockBarData: { x: string; locked: number }[];
};

export function buildMarkbookInsightsExport(
  input: BuildMarkbookInsightsExportInput
): DashboardExport {
  const {
    ayCode,
    compareAy,
    haveTrend,
    trendBarSeries,
    trendBarData,
    watchRows,
    levelLineData,
    schoolAvgAcrossLevels,
    regressionMovers,
    changeRequests,
    lockBarData,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Markbook insights'],
    ['Academic year', ayCode],
  ];
  if (compareAy) {
    scope.push(['Compared with', compareAy]);
  }

  const sections: ExportSection[] = [];

  // Subject performance trend — the page hides this card entirely when
  // `haveTrend` is false (no primary-AY trend points at all), so no section
  // in that case. Values are already 1dp from getSubjectPerformanceTrend and
  // this chart renders with `yFormat="number"` — a formatter that shows the
  // value as given (`toLocaleString`), never rounds coarser — so 1dp here
  // matches what's on screen; `roundTo(v, 1)` only guards against float
  // drift, it never changes the displayed precision.
  if (haveTrend) {
    sections.push({
      title: 'Subject performance trend',
      headers: ['Term', ...trendBarSeries.map((s) => s.label)],
      rows: trendBarData.map((row) => [
        String(row.x),
        ...trendBarSeries.map((s) => {
          const v = row[s.key];
          return typeof v === 'number' ? roundTo(v, 1) : null;
        }),
      ]),
    });
  }

  // Subjects to watch — the card's shell always renders (EmptyChartState
  // when watchRows is empty), so the section always exists too.
  sections.push({
    title: 'Subjects to watch',
    headers: ['Subject', 'Average grade'],
    rows: watchRows.map((r) => [r.subjectName, roundTo(r.avgGrade, 1)]),
  });

  // Which levels are struggling — the page omits this card ENTIRELY when
  // there's no level data (`levelLineData.length > 0` gates the JSX), so no
  // section when empty — not an empty-state row. The reference line is a
  // second genuinely plotted value, not narrative, so it gets its own row.
  if (levelLineData.length > 0) {
    sections.push({
      title: 'Which levels are struggling',
      headers: ['Level', 'Average grade'],
      rows: [
        ...levelLineData.map((l) => [l.x, roundTo(l.y, 1)]),
        ['School average', roundTo(schoolAvgAcrossLevels, 1)],
      ],
    });
  }

  // Term-over-term movement — the page omits this card ENTIRELY when there
  // are no regression movers (`regressionPairData.length > 0` gates the
  // JSX), so no section when empty. firstAvg/lastAvg are already 1dp from
  // computeTermDelta.
  if (regressionMovers.length > 0) {
    sections.push({
      title: 'Term-over-term movement',
      headers: [
        'Subject · Level',
        'From term',
        'From average',
        'To term',
        'To average',
      ],
      rows: regressionMovers.map((d) => [
        `${d.subjectName} · ${d.levelCode}`,
        d.fromPeriod,
        roundTo(d.firstAvg, 1),
        d.toPeriod,
        roundTo(d.lastAvg, 1),
      ]),
    });
  }

  // Grading throughput — 3 MetricCards → one Key figures section. None pass
  // a `delta` prop, so Previous/Change stay blank for every row (never a
  // derived current−previous). `avgDecisionHours` is null when no decisions
  // fall in the window — the card renders "—", but a missing figure exports
  // as an empty cell, not the display dash.
  const kpiRows: KpiRow[] = [
    {
      label: `Change requests (last ${changeRequests.windowDays} days)`,
      current: changeRequests.total,
    },
    {
      label: 'Pending decisions',
      current: changeRequests.byStatus.pending,
    },
    {
      label: 'Avg decision time (hours)',
      current: changeRequests.avgDecisionHours,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Sheets locked · per term — always rendered (empty state when no rows).
  sections.push({
    title: 'Sheets locked · per term',
    headers: ['Term', 'Locked (%)'],
    rows: lockBarData.map((t) => [t.x, t.locked]),
  });

  return {
    filename: insightsFilename({ module: 'markbook', ayCode, compareAy }),
    scope,
    sections,
  };
}
