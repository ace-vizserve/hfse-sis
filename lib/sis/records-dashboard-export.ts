// Builds the "Export CSV" file for the Records dashboard
// (app/(records)/records/page.tsx). Pure: every number here comes from data
// the page already loaded, or from the same cached loader a self-fetching
// widget calls (see `chaseQueueCounts` below) — no DB reads, no clock reads.
// Mirrors the page exactly: one section per widget the viewer's role
// renders, in render order, using the SAME cutoff
// <ClassAssignmentReadinessCard> uses (imported from lib/sis/dashboard.ts)
// and the SAME tile-selection rule <DocumentChaseQueueStrip> uses (imported
// from lib/sis/document-chase-queue.ts) so the file can never disagree with
// the screen it was exported from.

import type {
  ClassAssignmentReadinessRow,
  DocumentBacklogRow,
  ExpiringDocRow,
  LevelCount,
  RecordsRangeKpis,
} from '@/lib/sis/dashboard';
import { selectVisibleClassAssignmentReadiness } from '@/lib/sis/dashboard';
import {
  selectVisibleChaseTiles,
  type DocumentChaseQueueCounts,
} from '@/lib/sis/document-chase-queue';
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

export type BuildRecordsDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  /**
   * KD #37 — the registrar (academic_coordinator) is the operational user;
   * school_admin/admissions/superadmin are read-only oversight. Gates the
   * "Documents to chase" and "Enrolled but unassigned" sections the same way
   * page.tsx gates <DocumentChaseQueueStrip> and
   * <ClassAssignmentReadinessCard> — both are framed as work to do, which
   * doesn't fit the oversight role.
   */
  isOperational: boolean;
  kpis: RangeResult<RecordsRangeKpis>;
  enrolVelocity: RangeResult<VelocityPoint[]>;
  withdrawVelocity: RangeResult<VelocityPoint[]>;
  docBacklog: DocumentBacklogRow[];
  levels: LevelCount[];
  expiring: ExpiringDocRow[];
  classAssignment: ClassAssignmentReadinessRow[];
  /**
   * Raw tile counts behind <DocumentChaseQueueStrip lens="p-files">. Null
   * when `!isOperational` — the page never mounts the strip for an
   * oversight viewer, so it never needs these counts either.
   *
   * `getDocumentChaseQueueCounts` is the strip component's OWN loader (it is
   * a self-contained async server component, not fed from the page's
   * Promise.all) — page.tsx calls it a second time, for the export, only
   * when isOperational. That is not a second real query: the loader is
   * wrapped in `unstable_cache` with a 60s TTL and the `sis:${ayCode}` tag
   * specifically so more than one consumer can read it (see the loader's own
   * comment in lib/sis/document-chase-queue.ts) — the same sharing model the
   * strip already relies on across /admissions, /p-files and /records.
   */
  chaseQueueCounts: DocumentChaseQueueCounts | null;
};

export function buildRecordsDashboardExport(
  input: BuildRecordsDashboardExportInput
): DashboardExport {
  const {
    ayCode,
    rangeInput,
    isOperational,
    kpis,
    enrolVelocity,
    withdrawVelocity,
    docBacklog,
    levels,
    expiring,
    classAssignment,
    chaseQueueCounts,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Records dashboard'],
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

  // Documents to chase — DocumentChaseQueueStrip's own tile counts (lens
  // 'p-files'), using the SAME visible-tile selection rule the strip renders
  // with (selectVisibleChaseTiles, shared from
  // lib/sis/document-chase-queue.ts) so this can never disagree about which
  // tiles are showing. The strip itself renders nothing (no section here)
  // when nothing is visible — mirrored.
  if (isOperational && chaseQueueCounts) {
    const visible = selectVisibleChaseTiles(chaseQueueCounts, 'p-files');
    if (visible.length > 0) {
      sections.push({
        title: 'Documents to chase',
        headers: ['Category', 'Students'],
        rows: visible.map((t) => [t.label, t.value]),
      });
    }
  }

  // 4 MetricCards → one Key figures section. Change must carry the SAME
  // number the card's delta chip shows, never a re-derived current−previous.
  // Only "New enrollments" passes a `delta` prop to <MetricCard> (page.tsx),
  // and it passes no `deltaFormat`, so `formatDeltaLabel` (lib/dashboard/
  // range.ts) uses its default `'percent'` mode, which renders `delta.pct`
  // to 1 decimal. "Withdrawals" shows a "N prior · N all-time" subtext
  // instead of a chip — that's Previous (the comparison-period figure), not
  // Change, same as the Attendance-rate precedent
  // (lib/attendance/dashboard-export.ts). "Active enrolled" and "Docs
  // expiring ≤60d" show unrelated static subtext (an all-time count, and
  // "From today") that isn't a range comparison at all, so both stay blank
  // in Previous and Change.
  const kpiRows: KpiRow[] = [
    {
      label: 'New enrollments',
      current: kpis.current.enrollmentsInRange,
      previous: kpis.comparison
        ? kpis.comparison.enrollmentsInRange
        : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    {
      label: 'Withdrawals',
      current: kpis.current.withdrawalsInRange,
      previous: kpis.comparison
        ? kpis.comparison.withdrawalsInRange
        : undefined,
    },
    {
      label: 'Active enrolled',
      current: kpis.current.activeEnrolled,
    },
    {
      label: 'Docs expiring ≤60d',
      current: kpis.current.expiringSoon,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Enrollment velocity — the page hides this card entirely when there's
  // ≤ 1 point (enrolVelocity.current.length > 1). Comparison is aligned by
  // POSITION, not by date — same as TrendChart's own
  // `current.map((pt, i) => ({ ..., comparison: comparison?.[i]?.y }))`.
  //
  // No rounding: page.tsx renders this TrendChart with no `yFormat`, so
  // neither the axis nor the tooltip apply any formatter, and the values are
  // already whole-number daily counts from bucketByDay — nothing to round.
  if (enrolVelocity.current.length > 1) {
    const hasComparison = !!enrolVelocity.comparison;
    sections.push({
      title: 'New students per day',
      headers: hasComparison
        ? ['Date', 'Enrollments', 'Comparison enrollments']
        : ['Date', 'Enrollments'],
      rows: enrolVelocity.current.map((pt, i) => {
        const row: (string | number | null)[] = [pt.x, pt.y];
        if (hasComparison) {
          const cmpPt = enrolVelocity.comparison![i];
          row.push(cmpPt ? cmpPt.y : null);
        }
        return row;
      }),
    });
  }

  // Withdrawal velocity — symmetric sibling, same guard + alignment rule.
  if (withdrawVelocity.current.length > 1) {
    const hasComparison = !!withdrawVelocity.comparison;
    sections.push({
      title: 'Withdrawals per day',
      headers: hasComparison
        ? ['Date', 'Withdrawals', 'Comparison withdrawals']
        : ['Date', 'Withdrawals'],
      rows: withdrawVelocity.current.map((pt, i) => {
        const row: (string | number | null)[] = [pt.x, pt.y];
        if (hasComparison) {
          const cmpPt = withdrawVelocity.comparison![i];
          row.push(cmpPt ? cmpPt.y : null);
        }
        return row;
      }),
    });
  }

  // Document backlog by type — DocumentBacklogChart's stacked bars, straight
  // from the loader (no client slicing/sorting to mirror). Rendered
  // unconditionally on the page — an empty AY still gets the shell with its
  // own "No document data" state, so this section always exists, with zero
  // rows when docBacklog is empty.
  sections.push({
    title: 'Validation backlog by document type',
    headers: [
      'Document type',
      'Valid',
      'Pending review',
      'Rejected',
      'Missing / expired',
    ],
    rows: docBacklog.map((r) => [
      r.label,
      r.valid,
      r.pending,
      r.rejected,
      r.missing,
    ]),
  });

  // Students by level — LevelDistributionChart's donut, straight from the
  // loader. Rendered unconditionally; empty state mirrored as zero rows.
  sections.push({
    title: 'Students by level',
    headers: ['Level', 'Students'],
    rows: levels.map((l) => [l.level, l.count]),
  });

  // Renewals in the next 60 days — ExpiringDocsDrillCard/
  // ExpiringDocumentsPanel's rows, exactly as the page passes them (already
  // capped + sorted soonest-first by getExpiringDocuments). Rendered
  // unconditionally; empty state mirrored as zero rows. The footer's
  // "N already expired" text is a derived aggregate (like a donut's center
  // total), not a row-level datum, so it's left out — same treatment as the
  // narrative exclusions in the design brief.
  sections.push({
    title: 'Renewals in the next 60 days',
    headers: ['Student', 'Document', 'Expiry date', 'Days until expiry'],
    rows: expiring.map((r) => [
      r.studentName,
      r.slotLabel,
      r.expiryDate,
      r.daysUntilExpiry,
    ]),
  });

  // Enrolled but unassigned — registrar-only. SAME rollup + cutoff
  // <ClassAssignmentReadinessCard> uses (selectVisibleClassAssignmentReadiness,
  // shared from lib/sis/dashboard.ts) so this can never drift from the table
  // on screen. The "Action" column is a UI affordance (an "Assign" button),
  // not a figure, so it's left out.
  if (isOperational) {
    const rows = selectVisibleClassAssignmentReadiness(classAssignment);
    sections.push({
      title: 'Enrolled but unassigned',
      headers: ['Student', 'Level', 'Days since enrolment'],
      rows: rows.map((r) => [r.fullName, r.level, r.daysSinceEnrollment]),
    });
  }

  return {
    filename: dashboardFilename({
      module: 'records',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
