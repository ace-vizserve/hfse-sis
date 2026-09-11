// Builds the "Export CSV" file for the registrar Attendance dashboard
// (app/(attendance)/attendance/page.tsx). Pure: every number here comes from
// data the page already loaded — no DB reads, no clock reads. Mirrors the
// page exactly: one section per widget the registrar branch renders, in the
// order it renders them, using the SAME filter/sort/slice rules the cards
// themselves use (imported from lib/attendance/drill.ts) so the file can
// never disagree with the screen it was exported from.

import type {
  AttendanceKpis,
  DailyAttendancePoint,
} from '@/lib/attendance/dashboard';
import {
  AT_RISK_LEAVE_LIMIT,
  selectAtRiskCompassionate,
  selectAtRiskVacationLeave,
  sortTopActive,
  TOP_ATTENDANCE_LIST_LIMIT,
  type AllRowSets,
} from '@/lib/attendance/drill';
import type { RangeInput, RangeResult } from '@/lib/dashboard/range';
import {
  dashboardFilename,
  kpiSection,
  roundTo,
  type DashboardExport,
  type ExportScopeLine,
  type ExportSection,
  type KpiRow,
} from '@/lib/export/dashboard-export';

export type BuildAttendanceDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  kpis: RangeResult<AttendanceKpis>;
  dailySeries: RangeResult<DailyAttendancePoint[]>;
  exMix: { name: string; value: number }[];
  dayTypes: { name: string; value: number }[];
  rowSets: AllRowSets;
  vacationTermId: string | null;
  currentTermLabel: string | null;
};

export function buildAttendanceDashboardExport(
  input: BuildAttendanceDashboardExportInput
): DashboardExport {
  const {
    ayCode,
    rangeInput,
    kpis,
    dailySeries,
    exMix,
    dayTypes,
    rowSets,
    vacationTermId,
    currentTermLabel,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Attendance dashboard'],
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

  // 4 MetricCards → one Key figures section. Attendance rate is the only
  // card whose card renders a rounded percent (toFixed(1) in MetricCard);
  // the other three show raw counts.
  //
  // Change must carry the SAME number the card's delta chip shows, never a
  // re-derived current−previous. Only the Attendance rate card passes a
  // `delta` prop to <MetricCard> (page.tsx) — and it passes no `deltaFormat`,
  // so `formatDeltaLabel` (lib/dashboard/range.ts) uses its default
  // `'percent'` mode, which renders `delta.pct` (already signed — a fall is
  // negative, computeDelta never needs a separate direction combined back
  // in). The other three cards show "N prior" subtext instead of a chip —
  // that's `previous`, not `change` — so their Change cells stay blank.
  const kpiRows: KpiRow[] = [
    {
      label: 'Attendance rate (%)',
      current: roundTo(kpis.current.attendancePct, 1),
      previous: kpis.comparison
        ? roundTo(kpis.comparison.attendancePct, 1)
        : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    {
      label: 'Late incidents',
      current: kpis.current.late,
      previous: kpis.comparison ? kpis.comparison.late : undefined,
    },
    {
      label: 'Excused',
      current: kpis.current.excused,
      previous: kpis.comparison ? kpis.comparison.excused : undefined,
    },
    {
      label: 'Absences',
      current: kpis.current.absent,
      previous: kpis.comparison ? kpis.comparison.absent : undefined,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Daily attendance trend — the page hides this card entirely when there's
  // ≤ 1 point (dailySeries.current.length > 1), so the export mirrors that.
  // Comparison is aligned by POSITION, not by date — same as TrendChart's
  // `current.map((pt, i) => ({ ..., comparison: comparison?.[i]?.y }))`.
  if (dailySeries.current.length > 1) {
    const hasComparison = !!dailySeries.comparison;
    sections.push({
      title: 'Daily attendance trend',
      headers: hasComparison
        ? ['Date', 'Rate (%)', 'Comparison rate (%)']
        : ['Date', 'Rate (%)'],
      rows: dailySeries.current.map((pt, i) => {
        const row: (string | number | null)[] = [pt.x, roundTo(pt.y, 1)];
        if (hasComparison) {
          const cmpPt = dailySeries.comparison![i];
          row.push(cmpPt ? roundTo(cmpPt.y, 1) : null);
        }
        return row;
      }),
    });
  }

  // Excused reasons donut — rendered straight from the loader, no client
  // slicing/sorting to mirror.
  sections.push({
    title: 'Excused reasons',
    headers: ['Reason', 'Count'],
    rows: exMix.map((d) => [d.name, d.value]),
  });

  // Day-type donut — same as above.
  sections.push({
    title: 'Day types',
    headers: ['Day type', 'Days'],
    rows: dayTypes.map((d) => [d.name, d.value]),
  });

  // Attendance by section — the bar chart plots one number per section
  // (attendancePct); rows already arrive sorted ascending (worst first) from
  // rollupBySection, and the card does no further client-side sort.
  sections.push({
    title: 'Attendance by section',
    headers: ['Section', 'Attendance rate (%)'],
    rows: rowSets.sectionAttendance.map((r) => [
      r.sectionName,
      r.attendancePct,
    ]),
  });

  // Compassionate leave — the card's at-risk table, capped exactly as the
  // card caps it.
  const atRiskCompassionate = selectAtRiskCompassionate(
    rowSets.compassionate
  ).slice(0, AT_RISK_LEAVE_LIMIT);
  sections.push({
    title: 'Compassionate leave quota',
    headers: [
      'Student',
      'Section',
      'Used',
      'Allowance',
      'Remaining',
      'Over quota?',
    ],
    rows: atRiskCompassionate.map((r) => [
      r.studentName,
      r.sectionName,
      r.used,
      r.allowance,
      r.remaining,
      r.isOverQuota ? 'Yes' : 'No',
    ]),
  });

  // Vacation leave — only rendered when the page has a current term
  // (`vacationTermId && currentTermLabel`), exactly like the page's own
  // conditional around <VacationLeaveQuotaCard>.
  if (vacationTermId && currentTermLabel) {
    const atRiskVl = selectAtRiskVacationLeave(rowSets.vacationLeave).slice(
      0,
      AT_RISK_LEAVE_LIMIT
    );
    sections.push({
      title: `Vacation leave quota — ${currentTermLabel}`,
      headers: [
        'Student',
        'Section',
        'Used this term',
        'Allowance',
        'Remaining',
        'Over quota?',
      ],
      rows: atRiskVl.map((r) => [
        r.studentName,
        r.sectionName,
        r.usedThisTerm,
        r.allowance,
        r.remainingThisTerm,
        r.isOverTermQuota ? 'Yes' : 'No',
      ]),
    });
  }

  // Needs attention card — both tabs, each its own section. Top-absent rows
  // arrive pre-sorted (desc by absences) from rollupTopAbsent; top-active
  // uses the shared sortTopActive so this can't drift from the tab.
  sections.push({
    title: 'Top-absent students',
    headers: ['Student', 'Section', 'Absences', 'Lates'],
    rows: rowSets.topAbsent
      .slice(0, TOP_ATTENDANCE_LIST_LIMIT)
      .map((r) => [r.studentName, r.sectionName, r.absences, r.lates]),
  });

  sections.push({
    title: 'Top-active students',
    headers: ['Student', 'Section', 'Absences', 'Attendance %'],
    rows: sortTopActive(rowSets.topAbsent)
      .slice(0, TOP_ATTENDANCE_LIST_LIMIT)
      .map((r) => [r.studentName, r.sectionName, r.absences, r.attendancePct]),
  });

  return {
    filename: dashboardFilename({
      module: 'attendance',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
