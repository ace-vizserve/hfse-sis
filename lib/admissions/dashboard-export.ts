// Builds the "Export CSV" file for the Admissions dashboard
// (app/(admissions)/admissions/page.tsx, the main funnel view only — the
// `?status=to-follow|rejected|uploaded|expired` focused view has its own
// DataTable CSV and never mounts this button). Pure: every number here comes
// from data the page already loaded — no DB reads, no clock reads. Mirrors
// the page exactly: one section per widget the viewer's role renders, in
// render order.

import type {
  AdmissionsRangeKpis,
  ApplicationsByLevelResult,
  AssessmentOutcomes,
  DocCompletionResult,
  ReferralSource,
  TimeToEnrollBucket,
} from '@/lib/admissions/dashboard';
import type { FeedbackStats, PreCourseStats } from '@/lib/admissions/feedback';
import type { PipelineStage } from '@/lib/sis/dashboard';
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

export type BuildAdmissionsDashboardExportInput = {
  ayCode: string;
  rangeInput: RangeInput;
  /**
   * KD #51 — admissions/academic_coordinator get the chase-first
   * top-of-fold (new-applications priority + document chase cluster);
   * school_admin/superadmin are read-only oversight. Gates the "Documents to
   * chase" section the same way page.tsx gates <DocumentChaseQueueStrip>.
   * <NewApplicationsPriority> renders a PriorityPanel HEADLINE only, so it
   * contributes no section either way — left out per the design brief's
   * "PriorityPanel headline" exclusion.
   */
  isOperational: boolean;
  kpis: RangeResult<AdmissionsRangeKpis>;
  velocity: RangeResult<VelocityPoint[]>;
  pipelineStages: PipelineStage[];
  timeToEnroll: TimeToEnrollBucket[];
  assessment: AssessmentOutcomes;
  appsByLevel: ApplicationsByLevelResult;
  docCompletion: DocCompletionResult;
  referral: ReferralSource[];
  preCourseStats: PreCourseStats;
  feedbackStats: FeedbackStats;
  /**
   * Raw tile counts behind <DocumentChaseQueueStrip lens="admissions">. Null
   * when `!isOperational` — the page never mounts the strip for an
   * oversight viewer, so it never needs these counts either.
   *
   * page.tsx fetches this ONCE (in its own Promise.all) and threads it into
   * both the strip's `counts` prop and this builder, so the strip and the
   * export never issue separate queries for the same (ayCode, lens).
   */
  chaseQueueCounts: DocumentChaseQueueCounts | null;
  /**
   * <UpcomingAyCard>'s figures (KD #77 early-bird signal). Null when there is
   * no upcoming AY open for applications, or the viewer isn't looking at the
   * current AY (page.tsx only fetches this in that case). Renders for EVERY
   * role — unlike the chase cluster, it is not gated by `isOperational`.
   */
  upcomingAy: {
    ayCode: string;
    /** The card's own headline number ("N applications for {ayLabel}") —
     *  exported as its own row since a number rendered on the page belongs
     *  in the file even when it's title-embedded rather than a table cell. */
    applicationCount: number;
    byStage: {
      submitted: number;
      ongoingVerification: number;
      processing: number;
    };
  } | null;
};

export function buildAdmissionsDashboardExport(
  input: BuildAdmissionsDashboardExportInput
): DashboardExport {
  const {
    ayCode,
    rangeInput,
    isOperational,
    kpis,
    velocity,
    pipelineStages,
    timeToEnroll,
    assessment,
    appsByLevel,
    docCompletion,
    referral,
    preCourseStats,
    feedbackStats,
    chaseQueueCounts,
    upcomingAy,
  } = input;

  const scope: ExportScopeLine[] = [
    ['Page', 'Admissions dashboard'],
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

  // Early-bird signal (KD #77) — renders for every role when the page has an
  // upcoming AY open for applications. Not gated by isOperational. "Total
  // applications" is the card's own headline number (CardTitle: "{N}
  // applications for {ayLabel}") — a number rendered on the page belongs in
  // the file even though it's embedded in a title sentence rather than a
  // table cell, so it's listed here as its own row, ahead of the per-stage
  // breakdown the card shows below that headline.
  if (upcomingAy) {
    sections.push({
      title: `Early-bird applications — ${upcomingAy.ayCode}`,
      headers: ['Stage', 'Applications'],
      rows: [
        ['Total applications', upcomingAy.applicationCount],
        ['Submitted', upcomingAy.byStage.submitted],
        ['Ongoing Verification', upcomingAy.byStage.ongoingVerification],
        ['Processing', upcomingAy.byStage.processing],
      ],
    });
  }

  // Documents to chase — DocumentChaseQueueStrip's own tile counts, using the
  // SAME visible-tile selection rule the strip renders with
  // (selectVisibleChaseTiles, shared from lib/sis/document-chase-queue.ts) so
  // this can never disagree about which tiles are showing. The strip itself
  // renders nothing (no section here) when nothing is visible — mirrored.
  // The chase PriorityPanel next to it on the page is a headline only — left
  // out per the design brief's "PriorityPanel headline" exclusion.
  if (isOperational && chaseQueueCounts) {
    const visible = selectVisibleChaseTiles(chaseQueueCounts, 'admissions');
    if (visible.length > 0) {
      sections.push({
        title: 'Documents to chase',
        headers: ['Category', 'Applicants'],
        rows: visible.map((t) => [t.label, t.value]),
      });
    }
  }

  // 4 MetricCards → one Key figures section. Change carries the SAME number
  // the card's delta chip shows, never a re-derived current−previous. Only
  // "Applications (range)" passes a `delta` prop to <MetricCard> (page.tsx),
  // with no `deltaFormat`, so `formatDeltaLabel` (lib/dashboard/range.ts)
  // renders `delta.pct` to 1 decimal by default — that's Change here. The
  // other three cards pass no `delta` prop (only subtext / a comparisonLabel
  // string), so their Change cells stay blank; Previous still carries the
  // comparison-period value whenever a comparison is set, same as the
  // Attendance-rate precedent (lib/attendance/dashboard-export.ts) — the
  // column isn't limited to what happens to be printed as visible subtext.
  //
  // "Conversion rate" uses MetricCard's `format="percent"` (value.toFixed(1))
  // — 1 decimal, never the loader's raw fraction.
  //
  // "Avg time to enrol" mirrors the card's own em-dash rule: current is
  // blank (not 0) when sampleSize is 0, and Previous only appears when the
  // CURRENT period also has samples — the same gate the card's subtext uses.
  const kpiRows: KpiRow[] = [
    {
      label: 'Applications (range)',
      current: kpis.current.applicationsInRange,
      previous: kpis.comparison
        ? kpis.comparison.applicationsInRange
        : undefined,
      change: kpis.delta ? roundTo(kpis.delta.pct, 1) : undefined,
    },
    {
      label: 'Enrolled (range)',
      current: kpis.current.enrolledInRange,
      previous: kpis.comparison ? kpis.comparison.enrolledInRange : undefined,
    },
    {
      label: 'Conversion rate (%)',
      current: roundTo(kpis.current.conversionPct, 1),
      previous: kpis.comparison
        ? roundTo(kpis.comparison.conversionPct, 1)
        : undefined,
    },
    {
      label: 'Avg time to enrol (days)',
      current:
        kpis.current.sampleSize > 0
          ? roundTo(kpis.current.avgDaysToEnroll, 1)
          : null,
      previous:
        kpis.current.sampleSize > 0 && kpis.comparison
          ? roundTo(kpis.comparison.avgDaysToEnroll, 1)
          : undefined,
    },
  ];
  sections.push(kpiSection(kpiRows));

  // Applications per day — hidden entirely when there's ≤ 1 point, same as
  // the page's own `velocity.current.length > 1` guard. No `yFormat` is
  // passed to <TrendChart> here (page.tsx), so neither the axis nor the
  // tooltip round — values are already whole-number daily counts from
  // bucketByDay. Aligned by POSITION, not date, same as the chart's own zip.
  if (velocity.current.length > 1) {
    const hasComparison = !!velocity.comparison;
    sections.push({
      title: 'Applications per day',
      headers: hasComparison
        ? ['Date', 'Applications', 'Comparison applications']
        : ['Date', 'Applications'],
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

  // Pipeline by stage — PipelineStageChart plots getPipelineStageBreakdown's
  // rows straight (no client sort/slice); the loader always returns every
  // canonical status (0-filled), so this section always has rows even when
  // the AY has no applicants yet.
  sections.push({
    title: 'Pipeline by stage',
    headers: ['Stage', 'Applicants'],
    rows: pipelineStages.map((s) => [s.label, s.count]),
  });

  // Time to enrol — every bucket from getTimeToEnrollHistogram, in order.
  // The card swaps in a neutral "building" message when every bucket is 0,
  // but the underlying buckets still exist — mirrored as real (zero) values,
  // matching the "shell always renders" half of the mirror rule.
  sections.push({
    title: 'Time to enrol',
    headers: ['Days to close', 'Enrolments'],
    rows: timeToEnroll.map((b) => [b.label, b.count]),
  });

  // Assessment outcomes — AssessmentOutcomesChart's stacked bars, raw counts
  // (the Y axis is `allowDecimals={false}` counts, not a percent formatter —
  // nothing to round).
  sections.push({
    title: 'Assessment outcomes',
    headers: ['Subject', 'Pass', 'Fail', 'Unknown'],
    rows: [
      [
        'Math',
        assessment.mathPass,
        assessment.mathFail,
        assessment.mathUnknown,
      ],
      [
        'English',
        assessment.engPass,
        assessment.engFail,
        assessment.engUnknown,
      ],
    ],
  });

  // Applications by level — ApplicationsByLevelCard zips `comparison` into
  // `current` BY LEVEL (a Map lookup, defaulting a level absent from the
  // comparison period to 0) — mirrored with the identical join here, not a
  // re-implemented selection rule. Empty-range card still gets a section,
  // with zero rows.
  {
    const hasComparison = !!appsByLevel.comparison;
    const comparisonByLevel = new Map<string, number>();
    if (appsByLevel.comparison) {
      for (const r of appsByLevel.comparison)
        comparisonByLevel.set(r.level, r.count);
    }
    sections.push({
      title: 'Applications by level',
      headers: hasComparison
        ? ['Level', 'Applications', 'Comparison applications']
        : ['Level', 'Applications'],
      rows: appsByLevel.current.map((r) => {
        const row: (string | number | null)[] = [r.level, r.count];
        if (hasComparison) row.push(comparisonByLevel.get(r.level) ?? 0);
        return row;
      }),
    });
  }

  // Document completion by level — DocumentCompletionCard's stacked bars,
  // straight from the loader (no client slicing/sorting). Empty-state card
  // still gets a section, with zero rows.
  sections.push({
    title: 'Document completion by level',
    headers: ['Level', 'Complete', 'Partial', 'Missing'],
    rows: docCompletion.map((r) => [r.level, r.complete, r.partial, r.missing]),
  });

  // Referral sources — ReferralSourceChart's donut, straight from the loader
  // (the "Other" bucket is already computed server-side in
  // getReferralSourceBreakdown — the chart plots the array as-is). Empty
  // state ("no referral data") still gets a section, with zero rows.
  sections.push({
    title: 'Referral sources',
    headers: ['Source', 'Applications'],
    rows: referral.map((r) => [r.source, r.count]),
  });

  // Spotlight — the two summary stats at the foot of the dashboard. Both
  // values arrive already rounded at the loader to the exact precision the
  // card displays (Math.round in getPreCourseStats / getAdmissionsFeedback)
  // — not re-rounded here, same as markbook's avgDecisionHours precedent.
  // Each card shows an em-dash when there's no data yet; mirrored as a blank
  // cell (the loaders return null in that case, same as the card's guard).
  sections.push({
    title: 'Summary',
    headers: ['Metric', 'Value'],
    rows: [
      ['Pre-course counselling complete (%)', preCourseStats.completionPct],
      ['Avg application rating (out of 5)', feedbackStats.avgRating],
    ],
  });

  return {
    filename: dashboardFilename({
      module: 'admissions',
      ayCode,
      from: rangeInput.from,
      to: rangeInput.to,
    }),
    scope,
    sections,
  };
}
