// Builds the "Export CSV" file for the P-Files dashboard
// (app/(p-files)/p-files/page.tsx, the main view only — the
// `?status=expired|uploaded` / `?expiring=30|60|90` focused views already have
// their own DataTable CSV and never mount this button). Pure: every number
// here comes from data the page already loaded, or from the same cached
// counts <DocumentChaseQueueStrip> renders from — no DB reads, no clock
// reads. Mirrors the page exactly: one section per widget the viewer's role
// renders, in render order.

import type {
  LevelCompletionRow,
  PFilesRangeKpis,
  RevisionWeek,
  SlotStatusMix,
} from '@/lib/p-files/dashboard';
import type { DashboardSummary } from '@/lib/p-files/queries';
import type { ExpiringDocRow } from '@/lib/sis/dashboard';
import {
  selectVisibleChaseTiles,
  type DocumentChaseQueueCounts,
} from '@/lib/sis/document-chase-queue';
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

export type BuildPFilesDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  /**
   * Chase work is gated by capability, not role name (KD #173) —
   * `documents_post_enrolment.chase`. Gates the "Documents to chase" section
   * the same way page.tsx gates <PriorityPanel> + <DocumentChaseQueueStrip>.
   * <PriorityPanel> itself renders a headline only, so it contributes no
   * section either way — left out per the design brief's "PriorityPanel
   * headline" exclusion.
   */
  isOfficer: boolean;
  kpis: RangeResult<PFilesRangeKpis>;
  summary: DashboardSummary;
  revisions: RevisionWeek[];
  byLevel: LevelCompletionRow[];
  slotMix: SlotStatusMix;
  expiring: ExpiringDocRow[];
  /**
   * Raw tile counts behind <DocumentChaseQueueStrip lens="p-files">. Null
   * when `!isOfficer` — the page never mounts the strip for an oversight
   * viewer, so it never needs these counts either.
   *
   * page.tsx fetches this ONCE (in its own Promise.all) and threads it into
   * both the strip's `counts` prop and this builder, so the strip and the
   * export never issue separate queries for the same (ayCode, lens).
   */
  chaseQueueCounts: DocumentChaseQueueCounts | null;
};

export function buildPFilesDashboardExport(
  input: BuildPFilesDashboardExportInput
): DashboardExport {
  const {
    ayCode,
    rangeInput,
    isOfficer,
    kpis,
    summary,
    revisions,
    byLevel,
    slotMix,
    expiring,
    chaseQueueCounts,
  } = input;

  // The date-range picker only affects the Revisions figure — slot status,
  // expiring counts, and totals are AY-wide live state anchored to today (see
  // the trust-strip copy on the page itself) — so the scope line says so
  // rather than implying every figure below is range-scoped.
  const scope: ExportScopeLine[] = [
    ['Page', 'P-Files dashboard'],
    ['Academic year', ayCode],
    ['Date range (revisions only)', `${rangeInput.from} to ${rangeInput.to}`],
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
  // when nothing is visible — mirrored. The chase PriorityPanel next to it on
  // the page is a headline only — left out per the design brief's
  // "PriorityPanel headline" exclusion.
  if (isOfficer && chaseQueueCounts) {
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
  // Only "Revisions (range)" passes a `delta` prop to <MetricCard>
  // (page.tsx), with no `deltaFormat`, so `formatDeltaLabel`
  // (lib/dashboard/range.ts) uses its default `'percent'` mode, which renders
  // `delta.pct` to 1 decimal — that's Change here. The other three cards
  // ("Expiring ≤30d", "Expiring ≤60d", "Total docs tracked") pass no `delta`
  // prop and their subtext ("From today" / "All slots · all levels") isn't a
  // range comparison at all — they are LIVE totals anchored to today, not to
  // the picker's range (see loadPFilesKpisForRange's comment on this), so
  // both Previous and Change stay blank for them, same as the Records
  // precedent's "Active enrolled" / "Docs expiring ≤60d" rows
  // (lib/sis/records-dashboard-export.ts).
  const kpiRows: KpiRow[] = [
    {
      label: 'Revisions (range)',
      current: kpis.current.revisionsInRange,
      previous: kpis.comparison ? kpis.comparison.revisionsInRange : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    { label: 'Expiring ≤30d', current: kpis.current.expiringSoon30 },
    { label: 'Expiring ≤60d', current: kpis.current.expiringSoon },
    { label: 'Total docs tracked', current: kpis.current.totalDocuments },
  ];
  sections.push(kpiSection(kpiRows));

  // SummaryCards — two headline counts, rendered unconditionally.
  sections.push({
    title: 'Summary',
    headers: ['Metric', 'Value'],
    rows: [
      ['Total Students', summary.totalStudents],
      ['Fully Complete', summary.fullyComplete],
    ],
  });

  // Revisions over time — RevisionsOverTimeChartImpl's 12-week trend, straight
  // from the loader (pre-seeded so every week is present even at 0). No
  // rounding: counts are whole-number weekly totals, and the chart passes no
  // `yFormat` to <TrendChart>. Rendered unconditionally — the card's own
  // "No replacements yet" state is just a placeholder over the same
  // (all-zero) data, not a different dataset.
  sections.push({
    title: 'Document replacements over time',
    headers: ['Week', 'Replacements'],
    rows: revisions.map((w) => [w.weekLabel, w.count]),
  });

  // Completion by grade level — CompletionByLevelChartImpl's stacked bars,
  // straight from the loader (no client slicing/sorting). Bar `name` props
  // are the on-screen legend labels, reused verbatim as headers. Empty-state
  // card ("No document data") still gets a section, with zero rows.
  sections.push({
    title: 'Completion by grade level',
    headers: [
      'Level',
      'Valid',
      'Pending review',
      'Rejected',
      'Missing / expired',
    ],
    rows: byLevel.map((r) => [
      r.level,
      r.valid,
      r.pending,
      r.rejected,
      r.missing,
    ]),
  });

  // Where documents stand — SlotStatusDrillCard's donut + its own dl
  // breakdown below it, in the SAME 4-category order and labels the dl shows
  // (On file / Expired / missing / Awaiting validation / Rejected). The dl
  // only renders when total > 0, but the underlying counts always exist
  // (mirrored as real, possibly-zero values) — same treatment as Admissions'
  // "Pipeline by stage" 0-filled canonical categories.
  sections.push({
    title: 'Where documents stand',
    headers: ['Status', 'Documents'],
    rows: [
      ['On file', slotMix.valid],
      ['Expired / missing', slotMix.missing],
      ['Awaiting validation', slotMix.pending],
      ['Rejected', slotMix.rejected],
    ],
  });

  // Renewals in the next 60 days — ExpiringDocumentsPanel's rows, exactly as
  // the page passes them (already capped at 6 + sorted soonest-first by
  // getExpiringDocuments(selectedAy, 60, 6)). Rendered unconditionally; empty
  // state mirrored as zero rows. The card's "N already expired" footer text
  // is a derived aggregate, not a row-level datum, so it's left out — same
  // treatment as the narrative exclusions in the design brief.
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

  return {
    filename: dashboardFilename({
      module: 'p-files',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
