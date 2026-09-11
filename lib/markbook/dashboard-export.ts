// Builds the "Export CSV" file for the registrar/academic-coordinator
// Markbook dashboard (app/(markbook)/markbook/page.tsx, the `canSeeAdmin`
// branch only — a teacher gets no button). Pure: every number here comes
// from data the page already loaded — no DB reads, no clock reads. Mirrors
// the page exactly: one section per widget the admin branch renders, in the
// order it renders them, using the SAME rollup the sheet-readiness card uses
// (imported from lib/markbook/drill.ts) so the file can never disagree with
// the screen it was exported from.

import type {
  ChangeRequestSummary,
  GradeBucket,
  MarkbookRangeKpis,
  TermPubCoverage,
} from '@/lib/markbook/dashboard';
import {
  rollupSheetReadiness,
  selectVisibleSheetReadiness,
  type SheetRow,
  type TeacherVelocityRow,
} from '@/lib/markbook/drill';
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

export type BuildMarkbookDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  kpis: RangeResult<MarkbookRangeKpis>;
  /** Null when the page didn't run the loader (never canSeeAdmin). */
  velocity: RangeResult<VelocityPoint[]> | null;
  /** Null when the page has no current AY, or (never canSeeAdmin). */
  gradeDist: GradeBucket[] | null;
  pubCoverage: TermPubCoverage[] | null;
  changeRequests: ChangeRequestSummary | null;
  /** `drillRowSets?.sheets` — null when buildAllRowSets didn't run. */
  sheets: SheetRow[] | null;
  teacherVelocity: TeacherVelocityRow[] | null;
};

export function buildMarkbookDashboardExport(
  input: BuildMarkbookDashboardExportInput
): DashboardExport {
  const {
    ayCode,
    rangeInput,
    kpis,
    velocity,
    gradeDist,
    pubCoverage,
    changeRequests,
    sheets,
    teacherVelocity,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Markbook dashboard'],
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

  // 3 MetricCards → one Key figures section. Change must carry the SAME
  // number the card's delta chip shows, never a re-derived current−previous.
  // Only "Grades entered" passes a `delta` prop to <MetricCard> (page.tsx),
  // and it passes no `deltaFormat`, so `formatDeltaLabel` (lib/dashboard/
  // range.ts) uses its default `'percent'` mode, which renders `delta.pct`
  // to 1 decimal. "Sheets locked (range)" shows a denominator string ("of N
  // sheets in this AY") instead of a comparison figure, and "Change requests
  // pending" shows a static subtext ("Open across all terms") — neither is a
  // previous-period number, so both stay blank in Previous and Change.
  const kpiRows: KpiRow[] = [
    {
      label: 'Grades entered',
      current: kpis.current.gradesEntered,
      previous: kpis.comparison ? kpis.comparison.gradesEntered : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    {
      label: 'Sheets locked (range)',
      current: kpis.current.sheetsLocked,
    },
    {
      label: 'Change requests pending',
      current: kpis.current.changeRequestsPending,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Grade entry velocity — the page hides this card entirely when there's
  // ≤ 1 point (velocity.current.length > 1). Comparison is aligned by
  // POSITION, not by date — same as TrendChart's own
  // `current.map((pt, i) => ({ ..., comparison: comparison?.[i]?.y }))`.
  //
  // No rounding: page.tsx renders this TrendChart with no `yFormat`, so
  // neither the axis nor the tooltip apply any formatter, and the values are
  // already whole-number daily counts from bucketByDay — nothing to round.
  if (velocity && velocity.current.length > 1) {
    const hasComparison = !!velocity.comparison;
    sections.push({
      title: 'Grade entry velocity',
      headers: hasComparison
        ? ['Date', 'Entries', 'Comparison entries']
        : ['Date', 'Entries'],
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

  // Grade distribution — rendered straight from the loader, no client
  // slicing/sorting to mirror (GradeDistributionChart just plots the bucket
  // array in the order it arrives).
  if (gradeDist) {
    sections.push({
      title: 'Grade distribution',
      headers: ['Grade band', 'Students'],
      rows: gradeDist.map((b) => [b.label, b.count]),
    });
  }

  // Publication coverage — the stacked bar plots `published` and a derived
  // `notPublished` (= sections − published, floored at 0 in the chart
  // component); mirrored here with the identical arithmetic on the same
  // fields, not a re-implemented selection rule.
  if (pubCoverage) {
    sections.push({
      title: 'Publication coverage',
      headers: ['Term', 'Total sections', 'Published', 'Not published'],
      rows: pubCoverage.map((t) => [
        t.termLabel,
        t.sections,
        t.published,
        Math.max(0, t.sections - t.published),
      ]),
    });
  }

  // Change request summary — ChangeRequestPanel's Filed / Avg decision
  // figures + its 5 status rows, in the same order the card lists them.
  // avgDecisionHours arrives already rounded to 1 decimal at the source
  // (loadChangeRequestSummaryUncached), the same value the card prints
  // as "{avgDecisionHours}h" — not re-rounded here.
  if (changeRequests) {
    const { byStatus, total, avgDecisionHours, windowDays } = changeRequests;
    sections.push({
      title: 'Change request summary',
      headers: ['Metric', 'Value'],
      rows: [
        [`Filed (last ${windowDays} days)`, total],
        ['Avg decision (hours)', avgDecisionHours],
        ['Pending', byStatus.pending],
        ['Approved · awaiting apply', byStatus.approved],
        ['Applied', byStatus.applied],
        ['Rejected', byStatus.rejected],
        ['Cancelled', byStatus.cancelled],
      ],
    });
  }

  // Sheet readiness — SAME rollup + sort + cutoff SheetReadinessCard uses
  // (lib/markbook/drill.ts), so this can never drift from the meter on
  // screen. pctLocked is rounded to a whole number INSIDE
  // rollupSheetReadiness (Math.round) — the card's own precision, never a
  // fractional percent.
  if (sheets) {
    const rows = selectVisibleSheetReadiness(rollupSheetReadiness(sheets));
    sections.push({
      title: 'Sheet readiness',
      headers: ['Section', 'Level', 'Locked (%)', 'Open', 'Total sheets'],
      rows: rows.map((r) => [
        r.sectionName,
        r.level,
        r.pctLocked,
        r.open,
        r.total,
      ]),
    });
  }

  // Teacher entry velocity — registrar+ only chart; data arrives pre-sorted
  // desc by entryCount from getTeacherEntryVelocityUncached, no further
  // client slicing to mirror. Label falls back to the same 8-char user-id
  // stub TeacherEntryVelocityCard uses for a teacher with no resolved email.
  if (teacherVelocity) {
    sections.push({
      title: 'Teacher entry velocity',
      headers: ['Teacher', 'Entries'],
      rows: teacherVelocity.map((r) => [
        r.teacherEmail ?? r.teacherUserId.slice(0, 8),
        r.entryCount,
      ]),
    });
  }

  return {
    filename: dashboardFilename({
      module: 'markbook',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
