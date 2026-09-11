// Builds the "Export CSV" file for the Attendance Insights page
// (app/(attendance)/attendance/insights/page.tsx). Pure: every value here
// comes from data the page already loaded and already derived — no DB reads,
// no clock reads, no re-implemented selection rules. Mirrors the page
// exactly: one section per widget the page renders, in the order it renders
// them.

import type {
  CompassionateUsageRow,
  TermTopAbsent,
  VacationLeaveUsageRow,
} from '@/lib/attendance/drill';
import type { AyTrendResult } from '@/lib/dashboard/insights-trend';
import type { Delta } from '@/lib/dashboard/range';
import {
  insightsFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildAttendanceInsightsExportInput = {
  ayCode: string;
  compareAy: string | null;

  // ── "Attendance health" KPI strip ─────────────────────────────────────────
  hasCurrentPeriodData: boolean;
  rate: number;
  priorRate: number | null;
  /** Same `Delta` the "Attendance rate" card's chip is built from — the
   *  builder must consume it, never recompute current−previous. Undefined
   *  when the card shows no chip. */
  rateDelta: Delta | undefined;
  absent: number;
  late: number;

  // ── Attendance mix pie ───────────────────────────────────────────────────
  attendanceMixPieData: { name: string; value: number }[];

  // ── Term-by-term attendance rate (two-AY overlay) ───────────────────────
  haveTrend: boolean;
  rateTrend: AyTrendResult;

  // ── Composition per term ────────────────────────────────────────────────
  hasMixByTerm: boolean;
  compositionData: {
    x: string;
    present: number;
    late: number;
    excused: number;
    absent: number;
  }[];

  // ── Absence watchlist ────────────────────────────────────────────────────
  /** Already filtered to terms with ≥1 absence — same list the page maps
   *  into per-term cards. Empty when the page shows the single
   *  "No absences recorded" placeholder instead (no per-term cards at all). */
  termsWithAbsences: TermTopAbsent[];

  // ── Leave quotas ─────────────────────────────────────────────────────────
  /** True when the page renders the two leave-quota cards; false when it
   *  shows the single "Everyone is within allowance" placeholder instead
   *  (neither card is rendered, so neither section exists). */
  haveQuotaRisk: boolean;
  compassionateOver: CompassionateUsageRow[];
  vacationOver: VacationLeaveUsageRow[];
  vacationApproaching: VacationLeaveUsageRow[];
};

export function buildAttendanceInsightsExport(
  input: BuildAttendanceInsightsExportInput
): DashboardExport {
  const {
    ayCode,
    compareAy,
    hasCurrentPeriodData,
    rate,
    priorRate,
    rateDelta,
    absent,
    late,
    attendanceMixPieData,
    haveTrend,
    rateTrend,
    hasMixByTerm,
    compositionData,
    termsWithAbsences,
    haveQuotaRisk,
    compassionateOver,
    vacationOver,
    vacationApproaching,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Attendance insights'],
    ['Academic year', ayCode],
  ];
  if (compareAy) {
    scope.push(['Compared with', compareAy]);
  }

  const sections: ExportSection[] = [];

  // 4 MetricCards → one Key figures section. The rate card is the only one
  // that ever shows a delta chip (`deltaFormat="absolute"`, unit "pp") — and
  // the page only passes it through when `hasCurrentPeriodData`. Change must
  // carry that same `delta.abs`, never a re-derived current−previous. The
  // other three cards show a plain subtext note (not a "N prior" comparison),
  // so their Previous/Change stay blank.
  const showRateChange = hasCurrentPeriodData && !!rateDelta;
  const kpiRows: KpiRow[] = [
    {
      label: 'Attendance rate (%)',
      current: hasCurrentPeriodData ? roundTo(rate, 1) : null,
      previous: showRateChange ? roundTo(priorRate, 1) : undefined,
      change: showRateChange ? roundTo(rateDelta!.abs, 1) : undefined,
    },
    {
      label: 'Days absent',
      current: hasCurrentPeriodData ? absent : null,
    },
    {
      label: 'Late incidents',
      current: hasCurrentPeriodData ? late : null,
    },
    {
      label: 'Over their leave quota',
      current: compassionateOver.length + vacationOver.length,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Attendance mix pie — the P/L/EX/A partition for the selected period.
  // `attendanceMixPieData` is already empty when the card shows its
  // EmptyChartState, so this naturally yields zero rows in that case.
  sections.push({
    title: 'Attendance mix',
    headers: ['Status', 'Days'],
    rows: attendanceMixPieData.map((d) => [d.name, d.value]),
  });

  // Term-by-term attendance rate — one column per AY plotted, headers named
  // by AY code (matches the chart's own series keys, not the "This year
  // (AYxxxx)" label used only for the legend). The card shows an
  // EmptyChartState instead of the chart when no term has any data at all
  // (`haveTrend` false) — section stays, with zero rows.
  //
  // Rounded to WHOLE numbers, not 1 decimal — this chart is rendered with
  // `yFormat="percent"`, whose formatter (`chart-primitives.ts`) is
  // `Math.round(n)` with no decimals, and that same formatter drives the
  // axis ticks, tooltip, AND on-bar value labels. A fractional cell here
  // (e.g. 84.7) would disagree with the whole-number "85%" the viewer
  // actually sees on the bar.
  sections.push({
    title: 'Term-by-term attendance',
    headers: ['Term', ...rateTrend.series.map((s) => `${s.key} rate (%)`)],
    rows: haveTrend
      ? rateTrend.data.map((row) => [
          String(row.x),
          ...rateTrend.series.map((s) => {
            const v = row[s.key];
            return typeof v === 'number' ? roundTo(v, 0) : null;
          }),
        ])
      : [],
  });

  // Composition per term — each status's share of that term's marked days
  // (%), same values the grouped-bar chart plots. Empty rows when no term
  // has any encoded data (`hasMixByTerm` false), matching the card's own
  // EmptyChartState.
  //
  // Rounded to WHOLE numbers for the same reason as the term-rate section
  // above: this chart also renders with `yFormat="percent"`, whose
  // zero-decimal formatter drives the ticks/tooltip/value-labels the viewer
  // actually sees. The page computes `compositionData` to 1 decimal
  // (`Math.round(... * 1000) / 10`), which is one decimal MORE than what
  // the bars display — round again here to match the chart, not the page's
  // intermediate value.
  sections.push({
    title: "What's behind the rate",
    headers: ['Term', 'Present (%)', 'Late (%)', 'Excused (%)', 'Absent (%)'],
    rows: hasMixByTerm
      ? compositionData.map((r) => [
          r.x,
          roundTo(r.present, 0),
          roundTo(r.late, 0),
          roundTo(r.excused, 0),
          roundTo(r.absent, 0),
        ])
      : [],
  });

  // Absence watchlist — one section per term that actually has an absence.
  // When no term has any (`termsWithAbsences` empty), the page shows a
  // single generic "No absences recorded" card instead of per-term cards —
  // there is no per-term widget instance to mirror, so no sections here.
  for (const term of termsWithAbsences) {
    sections.push({
      title: `Term ${term.termNumber}`,
      headers: [
        'Student',
        'Section',
        'Absences',
        'Attendance %',
        'Excused',
        'Late',
      ],
      rows: term.rows.map((r) => [
        r.studentName,
        r.sectionName,
        r.absences,
        r.attendancePct,
        r.excused,
        r.lates,
      ]),
    });
  }

  // Leave quotas — when `haveQuotaRisk` is false the page shows one generic
  // "Everyone is within allowance" placeholder instead of these two cards;
  // neither card is actually rendered, so neither section exists.
  if (haveQuotaRisk) {
    sections.push({
      title: 'Compassionate leave — over quota',
      headers: ['Student', 'Section', 'Used', 'Allowance', 'Status'],
      rows: compassionateOver.map((r) => [
        r.studentName,
        r.sectionName,
        r.used,
        r.allowance,
        'Over',
      ]),
    });

    sections.push({
      title: 'Vacation leave — over quota',
      headers: ['Student', 'Section', 'Used this term', 'Allowance', 'Status'],
      rows: [
        ...vacationOver.map((r) => [
          r.studentName,
          r.sectionName,
          r.usedThisTerm,
          r.allowance,
          'Over',
        ]),
        ...vacationApproaching.map((r) => [
          r.studentName,
          r.sectionName,
          r.usedThisTerm,
          r.allowance,
          'Approaching',
        ]),
      ],
    });
  }

  return {
    filename: insightsFilename({ module: 'attendance', ayCode, compareAy }),
    scope,
    sections,
  };
}
