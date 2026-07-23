import {
  ArrowLeft,
  ClipboardCheck,
  Clock,
  FileStack,
  Filter,
  GraduationCap,
  Info,
  Megaphone,
  Percent,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';

import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { MetricCard } from '@/components/dashboard/metric-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
import {
  TrendChart,
  type TrendPoint,
} from '@/components/dashboard/charts/trend-chart';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import {
  DonutChart,
  type DonutSlice,
} from '@/components/dashboard/charts/donut-chart';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { cn } from '@/lib/utils';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  getAverageTimeToEnrollment,
  getConversionByAssessment,
  getConversionFunnel,
  type AssessmentConversionRow,
} from '@/lib/admissions/dashboard';
import {
  getReferralConversion,
  getWithdrawnByLevel,
} from '@/lib/admissions/insights-funnel';
import { getAdmissionsFeedback } from '@/lib/admissions/feedback';
import {
  getAdmissionsTerminalReasons,
  growthDelta,
} from '@/lib/admissions/insights';
import {
  AY_MONTH_LABELS,
  currentInProgressMonthLabel,
  getIntakeTrendByAy,
} from '@/lib/admissions/insights-compare';
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import { buildAyTrend } from '@/lib/dashboard/insights-trend';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import { summariseAyTrend } from '@/lib/dashboard/trend-delta';
import {
  computeDelta,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { APPLICATION_TERMINAL_REASON_LABELS } from '@/lib/schemas/sis';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set([
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

// Humanize a terminal-reason code via the schema label map; fall back to the
// raw stored string (e.g. 'Unspecified' / 'Other free-text') when unmapped.
function reasonLabel(reason: string): string {
  return (
    (APPLICATION_TERMINAL_REASON_LABELS as Record<string, string>)[reason] ??
    reason
  );
}

// ── Small page-local presentation helpers ──────────────────────────────────
// Composed from the app's own established chart-panel idiom (mono
// CardDescription eyebrow + serif CardTitle + gradient icon tile in
// CardAction — docs/context/09a-design-patterns.md §7.4/§8), same
// composition the sibling operational Admissions dashboard already uses
// around its own TrendChart. Page-scoped since only this page's 4 chart
// panels share the exact shell.

function InsightChartCard({
  cap,
  title,
  icon: Icon,
  scopeNote,
  children,
}: {
  cap: string;
  title: string;
  icon: LucideIcon;
  /** A visible badge stating exactly what population this chart counts —
   * use whenever two charts on the page could be mistaken for the same
   * scope (e.g. one excludes cancelled/withdrawn applicants, one doesn't).
   * A mono caption alone is too easy to skim past when the stakes are
   * "these two conversion % bars aren't measuring the same thing." */
  scopeNote?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {cap}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        {scopeNote && (
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-indigo-soft/50 bg-gradient-to-b from-brand-indigo/12 to-brand-indigo/4 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-brand-indigo-deep">
            <Info className="size-3" />
            {scopeNote}
          </span>
        )}
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// One row for "top reason per level" — the ProjectListRow replacement. Too
// small to promote to components/; only used here.
function TopReasonRow({
  level,
  reason,
  count,
}: {
  level: string;
  reason: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-hairline py-3 first:border-t-0 first:pt-1">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <GraduationCap className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {level}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {reason}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[13px] font-bold text-foreground">
        {count.toLocaleString('en-SG')}
      </span>
    </div>
  );
}

// A non-blank empty-state body for a chart panel (§7.6) — icon + serif line
// + a sentence of guidance, never a bare muted <p>.
function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Filter className="size-4" />
      </div>
      <p className="max-w-70 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// Admissions · Insights — a narrative, read-first companion to the operational
// dashboard. Enrollment health: are we growing, where do applicants drop, why
// do they cancel, how long does it take, and where do they come from.
export default async function AdmissionsInsightsPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <NoCurrentAyCard />
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const ayParam =
    typeof resolvedSearch.ay === 'string' ? resolvedSearch.ay : undefined;
  const ayCodes = await listAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  // Resolve the comparison AY: explicit pick > inferred prior > null.
  const compareAy = resolveCompareAy(
    resolvedSearch.compareAy,
    ayCodes,
    selectedAy
  );

  // Build the AY list for the two-AY overlay: selected AY first (solid),
  // comparison AY second (muted/dashed), or just the selected AY alone.
  const trendAys = compareAy ? [selectedAy, compareAy] : [selectedAy];
  // isCurrent is DB-derived (getCurrentAcademicYear), never inferred from the
  // AY code's own digits — the clamp fix keys on this flag alone. compareAy
  // is never equal to selectedAy (resolveCompareAy guarantees that), but it
  // CAN be the DB-current AY when the user explicitly compares against it.
  const compareIsCurrentAy = compareAy === currentAy.ay_code;
  const trendAyRequests = compareAy
    ? [
        { ayCode: selectedAy, isCurrent: isCurrentAy },
        { ayCode: compareAy, isCurrent: compareIsCurrentAy },
      ]
    : [{ ayCode: selectedAy, isCurrent: isCurrentAy }];

  const [
    funnel,
    priorFunnel,
    terminal,
    intakeTrendPoints,
    withdrawnByLevel,
    referralConversion,
    timeToEnroll,
    assessmentConversion,
    feedback,
    priorFeedback,
  ] = await Promise.all([
    getConversionFunnel(selectedAy),
    compareAy ? getConversionFunnel(compareAy) : Promise.resolve(null),
    getAdmissionsTerminalReasons(selectedAy),
    getIntakeTrendByAy(trendAyRequests),
    // Withdrawn applications per level (pre-enrolment; applicationStatus).
    getWithdrawnByLevel(selectedAy),
    getReferralConversion(selectedAy),
    // Time to enrol — real enrolledAt timestamp (migration 075). sampleSize=0
    // is expected on existing data; folded into §1's headline row when it has
    // data, hidden entirely otherwise (no lib change, KD #140 honesty rule).
    getAverageTimeToEnrollment(selectedAy),
    // Does entrance assessment performance predict enrollment? Genuinely new
    // cross-cut — see lib/admissions/dashboard.ts::getConversionByAssessment.
    getConversionByAssessment(selectedAy),
    // Parent satisfaction with the application FORM itself — nothing to do
    // with the pipeline/funnel. lib/admissions/feedback.ts (KD #102).
    getAdmissionsFeedback(selectedAy),
    compareAy ? getAdmissionsFeedback(compareAy) : Promise.resolve(null),
  ]);

  // AY-wide funnel figures (whole-year, not the picker-windowed range count).
  // Admissions owns the FUNNEL: applications in (demand) + conversion out — NOT
  // the enrolled headcount, which is the enrolled body and belongs to Records
  // Insights (KD #51). Enrolment here appears only as the conversion %.
  const appsStage = funnel.find((s) => s.stage === 'Submitted'); // total applications
  const applicationsCount = appsStage?.count ?? 0;
  const priorAppsStage = priorFunnel?.find((s) => s.stage === 'Submitted');
  const priorApplications = priorFunnel ? (priorAppsStage?.count ?? 0) : null;
  // Year-over-year growth is measured on application DEMAND.
  const growth = growthDelta(applicationsCount, priorApplications);

  // Demand comparison card state.
  const hasComparisonData = priorApplications !== null && priorApplications > 0;
  const demandState = comparisonCardState(compareAy, hasComparisonData);

  const enrolledStage = funnel.find((s) => s.stage === 'Enrolled');
  const enrolledCount = enrolledStage?.count ?? 0;
  const conversionPct =
    applicationsCount > 0
      ? Math.round((enrolledCount / applicationsCount) * 1000) / 10
      : 0;

  // Prior-AY conversion rate (for delta chip on the conversion-rate card).
  const priorEnrolledStage = priorFunnel?.find((s) => s.stage === 'Enrolled');
  const priorEnrolledCount = priorEnrolledStage?.count ?? 0;
  const priorConversionPct =
    priorApplications !== null && priorApplications > 0
      ? Math.round((priorEnrolledCount / priorApplications) * 1000) / 10
      : null;

  // Delta chips for §1 headline cards.
  const applicationsDelta =
    demandState === 'ok' && priorApplications !== null
      ? computeDelta(applicationsCount, priorApplications)
      : null;
  const conversionDelta =
    demandState === 'ok' && priorConversionPct !== null
      ? computeDelta(conversionPct, priorConversionPct)
      : null;

  // §2 per-month two-AY overlay chart.
  const intakeTrend = buildAyTrend(
    intakeTrendPoints,
    [...AY_MONTH_LABELS],
    trendAys
  );
  const intakeTrendSummary = summariseAyTrend(
    intakeTrend.data,
    intakeTrend.series,
    {
      // Applications-received is a month-granularity COUNT series — suppress
      // the delta when the anchor is the current in-progress month so a
      // partial month isn't compared against a full historical one as a
      // fabricated decline (only meaningful for the current-calendar-year AY).
      inProgressPeriod: currentInProgressMonthLabel(isCurrentAy),
    }
  );
  const intakeTrendDelta =
    intakeTrendSummary.delta && intakeTrendSummary.comparisonLabel
      ? {
          label:
            intakeTrendSummary.delta.pct !== null
              ? `${intakeTrendSummary.delta.pct >= 0 ? '+' : ''}${intakeTrendSummary.delta.pct}% vs ${intakeTrendSummary.comparisonLabel}`
              : `${intakeTrendSummary.delta.abs >= 0 ? '+' : ''}${intakeTrendSummary.delta.abs} vs ${intakeTrendSummary.comparisonLabel}`,
          direction: intakeTrendSummary.delta.direction,
        }
      : undefined;

  // Funnel: find the biggest stage-to-stage leak from the REAL applicationStatus
  // pipeline (Submitted → Ongoing Verification → Processing → Enrolled, 490/490
  // populated). The deep stage-date funnel was hollow (0/490 stage dates), so it
  // always reported a false "drops at Registration ~99.8%" artifact — replaced.
  // `dropOffPct` is the % drop from the prior stage; stage[0] (Submitted) is
  // always 0. Pick the largest positive drop; neutral when none.
  const biggestLeak = pickExtreme(funnel, (s) => s.dropOffPct, 'max');
  const biggestLeakStage =
    biggestLeak.item && biggestLeak.item.dropOffPct > 0 && !biggestLeak.isTie
      ? {
          label: biggestLeak.item.stage,
          dropOffPct: biggestLeak.item.dropOffPct,
        }
      : null;

  // Application-experience rating distribution — parent satisfaction with
  // the ONLINE APPLICATION FORM itself (feedbackRating, 1-5), collected
  // after submission. Nothing to do with applicationStatus/the funnel; this
  // page has never touched this dimension of the schema before. The
  // dedicated /admissions/feedback page lists individual responses — this is
  // the distribution shape + year-over-year average, which that page doesn't
  // show. A 1-5 star rating is an ordinal histogram — the proper chart for
  // that shape is a plain ordered bar chart (how every star-rating UI shows
  // it), not a donut/radial: bar length is a precise, directly comparable
  // magnitude judgment; a partition-style chart trades that precision for a
  // "share of whole" framing this data doesn't need. Every tier renders
  // (including zero-count ones) so a gap in the distribution is visible,
  // not silently dropped.
  const ratingChartData: ComparisonBarPoint[] = [1, 2, 3, 4, 5].map(
    (stars) => ({
      category: `${stars}★`,
      current: feedback.rows.filter((r) => r.feedbackRating === stars).length,
    })
  );
  const priorAvgRating = priorFeedback?.stats.avgRating ?? null;
  const ratingDelta =
    feedback.stats.avgRating !== null && priorAvgRating !== null
      ? Math.round((feedback.stats.avgRating - priorAvgRating) * 10) / 10
      : null;
  const RATING_DELTA_MIN = 0.3;
  const showRatingDelta =
    ratingDelta !== null && Math.abs(ratingDelta) >= RATING_DELTA_MIN;

  // Withdrawn applications by level — total + the level bearing the most,
  // for the callout below the donut.
  const totalWithdrawn = withdrawnByLevel.reduce((sum, r) => sum + r.count, 0);
  const topWithdrawnLevel = pickExtreme(
    withdrawnByLevel,
    (r) => r.count,
    'max'
  );
  const topWithdrawnPct =
    topWithdrawnLevel.item !== null && totalWithdrawn > 0
      ? Math.round((topWithdrawnLevel.item.count / totalWithdrawn) * 100)
      : null;
  const showTopWithdrawnLevel =
    !topWithdrawnLevel.isTie && topWithdrawnLevel.item !== null;
  const withdrawnTitle = showTopWithdrawnLevel
    ? `${topWithdrawnLevel.item!.level} loses the most applicants`
    : 'Withdrawals by level';

  // Referrals restricted to sources with a real enough sample to trust a
  // RATE claim — a 1-applicant channel that happened to enrol reads as
  // "100% conversion," technically true, statistically meaningless. This
  // guards the best/worst-converter callout text only (below); it does NOT
  // gate the chart, which shows volume mix instead of rate (see §6).
  const REFERRAL_MIN_SAMPLE = 5;
  const eligibleRefs = referralConversion.filter(
    (r) => r.applied >= REFERRAL_MIN_SAMPLE
  );

  // Cancellation reasons — top 5 + an overflow bucket for the sorted bar list.
  // terminal.overall is already sorted desc by count (lib/admissions/insights.ts).
  // The overflow bucket carries a sentinel key + the label "Other reasons" —
  // deliberately distinct from the real `other` reason code, whose display
  // label is already "Other" (APPLICATION_TERMINAL_REASON_LABELS) and which
  // can legitimately rank in the top 5 alongside the overflow row.
  const TOP_REASON_COUNT = 5;
  const topReasons = terminal.overall.slice(0, TOP_REASON_COUNT);
  const otherReasonsCount = terminal.overall
    .slice(TOP_REASON_COUNT)
    .reduce((s, r) => s + r.count, 0);
  const reasonBars = [
    ...topReasons.map((r) => ({
      key: r.reason,
      label: reasonLabel(r.reason),
      count: r.count,
    })),
    ...(otherReasonsCount > 0
      ? [
          {
            key: 'other_reasons',
            label: 'Other reasons',
            count: otherReasonsCount,
          },
        ]
      : []),
  ];

  // ────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from these live values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded stage names, level codes, channel names, or "most"
  // claims in literals. (Storytelling pass.)
  // ────────────────────────────────────────────────────────────────────────

  // 5c — Referral channels: best + worst converting source, from the same
  // sample-guarded `eligibleRefs` computed above. Title names both ends
  // when both clear the guard; neutral otherwise.
  const bestRef = pickExtreme(eligibleRefs, (r) => r.conversionPct, 'max');
  const worstRef = pickExtreme(eligibleRefs, (r) => r.conversionPct, 'min');
  const showBestRef = !bestRef.isTie && bestRef.item !== null;
  const referralTitle = showBestRef
    ? `${bestRef.item!.source} converts best`
    : 'Referral sources: conversion';

  // 3c — Assessment performance vs conversion: does passing/failing the
  // entrance assessment predict enrollment? Guarded by a minimum sample on
  // BOTH the pass and fail buckets (a 1-applicant fail bucket converting at
  // 0% isn't a real signal) and a minimum gap so noise doesn't read as a
  // finding.
  const findAssessmentRow = (
    subject: AssessmentConversionRow['subject'],
    outcome: AssessmentConversionRow['outcome']
  ) =>
    assessmentConversion.find(
      (r) => r.subject === subject && r.outcome === outcome
    );
  const ASSESSMENT_MIN_SAMPLE = 5;
  const assessmentGaps = (['Math', 'English'] as const)
    .map((subject) => {
      const pass = findAssessmentRow(subject, 'Pass');
      const fail = findAssessmentRow(subject, 'Fail');
      if (
        !pass ||
        !fail ||
        pass.applied < ASSESSMENT_MIN_SAMPLE ||
        fail.applied < ASSESSMENT_MIN_SAMPLE
      )
        return null;
      return {
        subject,
        gap: pass.conversionPct - fail.conversionPct,
        passPct: pass.conversionPct,
        failPct: fail.conversionPct,
      };
    })
    .filter(
      (
        g
      ): g is {
        subject: 'Math' | 'English';
        gap: number;
        passPct: number;
        failPct: number;
      } => g !== null
    );
  const biggestAssessmentGap = pickExtreme(
    assessmentGaps,
    (g) => Math.abs(g.gap),
    'max'
  );
  const ASSESSMENT_GAP_MIN_PP = 10;
  const showAssessmentGap =
    !biggestAssessmentGap.isTie &&
    biggestAssessmentGap.item !== null &&
    meetsThreshold(biggestAssessmentGap.value, ASSESSMENT_GAP_MIN_PP);
  const assessmentTitle = showAssessmentGap
    ? `${biggestAssessmentGap.item!.subject} performance predicts enrollment`
    : 'Does assessment performance predict enrollment?';

  // 4 — Terminal reasons: top cancellation cause (terminal.overall is already
  // sorted desc). Title names it; callout quantifies its share. Neutral when
  // nothing is recorded or the top two tie.
  const topReason = terminal.overall[0];
  const reasonTie =
    terminal.overall.length > 1 &&
    terminal.overall[1].count === topReason?.count;
  const showTopReason = !!topReason && topReason.count > 0 && !reasonTie;
  const reasonTitle = showTopReason
    ? `Most cancel due to ${reasonLabel(topReason.reason)}`
    : 'Cancellation reasons';
  const topReasonPct =
    showTopReason && terminal.total > 0
      ? Math.round((topReason.count / terminal.total) * 100)
      : null;

  const growthBadge =
    growth.pct === null
      ? { label: 'Building history', tone: 'muted' as const }
      : {
          label:
            growth.pct >= 0
              ? `▲ ${growth.pct}% vs ${compareAy}`
              : `▼ ${Math.abs(growth.pct)}% vs ${compareAy}`,
          tone: (growth.pct >= 0 ? 'mint' : 'amber') as 'mint' | 'amber',
        };

  // ────────────────────────────────────────────────────────────────────────
  // Chart-primitive presentation derivations — pure reshaping of the values
  // already computed above into each chart component's prop shape. No new
  // queries, no changed data shapes.
  // ────────────────────────────────────────────────────────────────────────

  const applicationsCaption = applicationsDelta
    ? `${priorApplications?.toLocaleString('en-SG')} in ${compareAy}`
    : demandState === 'no-data'
      ? `No data for ${compareAy}`
      : compareAy === null
        ? 'Pick a comparison year above'
        : undefined;

  const conversionCaption = conversionDelta
    ? `${priorConversionPct?.toFixed(1)}% in ${compareAy}`
    : `${enrolledCount.toLocaleString('en-SG')} of ${applicationsCount.toLocaleString('en-SG')} applicants enrolled`;

  // §2 — intake trend: current + optional comparison series for TrendChart.
  // Both are index-aligned (same Jan..Nov month order from buildAyTrend), so
  // TrendChart's default alignComparison holds. A future month in the
  // current AY is `null` in intakeTrend.data — passed through as-is so it
  // renders as an honest chart gap (recharts skips null area points); the
  // TrendPoint type says `y: number` but this mirrors the same pragmatic
  // null-passthrough every other AyTrendResult-consuming chart in this app
  // already relies on.
  const intakeCurrentKey = intakeTrend.series[0]?.key;
  const intakeCompareKey = intakeTrend.series[1]?.key;
  const intakeCurrentPts = (
    intakeCurrentKey
      ? intakeTrend.data.map((row) => ({
          x: String(row.x),
          y: row[intakeCurrentKey],
        }))
      : []
  ) as TrendPoint[];
  const intakeComparePts = (
    intakeCompareKey
      ? intakeTrend.data.map((row) => ({
          x: String(row.x),
          y: row[intakeCompareKey],
        }))
      : null
  ) as TrendPoint[] | null;
  const haveIntakeData = intakeTrend.data.some((d) =>
    intakeTrend.series.some((s) => d[s.key] !== null)
  );

  // §4 — withdrawn applications by level. Every withdrawn applicant belongs
  // to exactly one level, so this is a genuine partition of the total-
  // withdrawn count — the honest fit for a donut (like the by-source volume
  // donut), and it reads which levels are shedding the most applicants at a
  // glance no matter how many levels appear.
  const withdrawnDonutData: DonutSlice[] = withdrawnByLevel.map((row) => ({
    name: row.level,
    value: row.count,
  }));

  // §5 — cancellation reasons: topReasons + the overflow bucket are a genuine
  // partition of terminal.total (otherReasonsCount is explicitly the
  // remainder) — DonutChart is the correct fit for a mutually-exclusive share.
  const reasonDonutData: DonutSlice[] = reasonBars.map((r) => ({
    name: r.label,
    value: r.count,
  }));

  // §4b — assessment performance vs conversion. Matches the operational
  // dashboard's AssessmentOutcomesChart visual language (subject on the
  // x-axis, one clustered bar per outcome, legend) — but GROUPED, not
  // STACKED like that chart, since these are three independent conversion
  // RATES per subject, not parts of one whole that sum to 100% the way
  // pass/fail/unknown VOLUME does on the dashboard's version. A treemap was
  // tried here and reverted: with only 6 buckets (2 subjects × 3 outcomes)
  // a treemap's area/colour channels are overkill — it earns its keep with
  // dozens of leaves — and bucketing rate into 4 colour tiers throws away
  // precision a bar's continuous y-axis keeps.
  const ASSESSMENT_SERIES: {
    key: 'pass' | 'fail' | 'notAssessed';
    label: AssessmentConversionRow['outcome'];
  }[] = [
    { key: 'pass', label: 'Pass' },
    { key: 'fail', label: 'Fail' },
    { key: 'notAssessed', label: 'Not assessed' },
  ];
  const assessmentGroupedData = (['Math', 'English'] as const)
    .map((subject) => ({
      x: subject,
      pass: findAssessmentRow(subject, 'Pass')?.conversionPct ?? null,
      fail: findAssessmentRow(subject, 'Fail')?.conversionPct ?? null,
      notAssessed:
        findAssessmentRow(subject, 'Not assessed')?.conversionPct ?? null,
    }))
    .filter(
      (row) =>
        row.pass !== null || row.fail !== null || row.notAssessed !== null
    );

  // §6 — referral channels: WHERE applicants come from, not how well each
  // converts. Every applicant has exactly one source, so volume-by-source
  // is a genuine partition of the applicant pool — the honest fit for a
  // donut, unlike conversion RATE per source (independent percentages that
  // don't sum to anything, tried as a scatter/radar/bar this session and
  // reverted each time — small/skewed per-channel samples made every rate
  // chart either misleading or visually degenerate). Rate is still the
  // headline finding, but it lives in the guarded callout text below the
  // chart, not in the chart itself. Every source is shown here (no n≥5
  // filter) — a small volume slice is honest; the same channel's RATE
  // masquerading as reliable at that volume is not.
  const totalReferralApplicants = referralConversion.reduce(
    (sum, r) => sum + r.applied,
    0
  );
  const referralDonutData: DonutSlice[] = referralConversion
    .filter((r) => r.applied > 0)
    .map((r) => ({ name: r.source, value: r.applied }));

  return (
    <PageShell>
      <Link
        href={`/admissions?ay=${encodeURIComponent(selectedAy)}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Admissions
      </Link>

      <DashboardHero
        eyebrow="Admissions · Insights"
        title="Enrollment Health"
        description={
          applicationsCount > 0
            ? biggestLeakStage && biggestLeakStage.dropOffPct > 0
              ? `${conversionPct}% of applicants enrol — most who don't fall away at ${biggestLeakStage.label}.`
              : `${conversionPct}% of applicants enrol. This is the story behind the funnel: where demand comes from, and where applicants fall away.`
            : 'The story behind the funnel — how application demand is trending, how well we convert applicants, and where they fall away before enrolling.'
        }
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
          growthBadge,
        ]}
      />

      <div className="flex justify-end">
        <CompareAyPicker
          primaryAy={selectedAy}
          ayCodes={ayCodes}
          compareAy={compareAy}
        />
      </div>

      {/* ═══ Demand & conversion ═══
          How much demand the funnel takes in, and how well it converts. */}
      <div className="space-y-5 pt-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
          Demand &amp; conversion
        </p>

        {/* Stat cards. Primary-AY metrics always render; only the demand-
            comparison caption reacts to `demandState`. The dedicated growth
            panel from the earlier version is gone — applicationsDelta already
            renders as this card's own delta chip, and growth is also stated
            in the hero badge, so a third growth visual was redundant. */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Applications received"
            value={applicationsCount}
            format="number"
            icon={FileStack}
            delta={applicationsDelta ?? undefined}
            deltaGoodWhen="up"
            comparisonLabel={applicationsCaption}
          />
          <MetricCard
            label="Conversion rate"
            value={conversionPct}
            format="percent"
            icon={Percent}
            delta={conversionDelta ?? undefined}
            deltaGoodWhen="up"
            deltaFormat="absolute"
            deltaUnit="pp"
            comparisonLabel={conversionCaption}
          />
          {/* Avg. days to enrol — CONDITIONAL: only when sampleSize > 0
              (early-in-AY / sparse cohorts suppress it rather than show a
              near-zero-sample average). */}
          {timeToEnroll.sampleSize > 0 && (
            <MetricCard
              label="Avg. days to enrol"
              value={timeToEnroll.avgDays}
              format="days"
              icon={Clock}
              subtext={`${selectedAy} · n=${timeToEnroll.sampleSize.toLocaleString('en-SG')}`}
            />
          )}
        </section>

        {/* Intake trend + application experience share a row — neither needs
            full width (the trend reads fine at half width; the rating
            histogram is a 5-bar chart that looked lost in a full-width
            card), and pairing them cuts the empty canvas both had on their
            own row. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightChartCard
            cap={`Applications per month${compareAy ? ` · ${selectedAy} vs ${compareAy}` : ` · ${selectedAy}`}`}
            title={
              intakeTrendDelta?.direction === 'up'
                ? 'Applications are picking up'
                : intakeTrendDelta?.direction === 'down'
                  ? 'Applications are slowing'
                  : 'Intake trend'
            }
            icon={TrendingUp}
          >
            {haveIntakeData ? (
              <div className="space-y-4">
                {intakeTrendSummary.currentValue !== null && (
                  <TrendDeltaCaption
                    value={intakeTrendSummary.currentValue.toLocaleString(
                      'en-SG'
                    )}
                    caption={`applications in ${intakeTrendSummary.periodLabel}`}
                    delta={intakeTrendDelta}
                  />
                )}
                <TrendChart
                  label="Applications"
                  current={intakeCurrentPts}
                  comparison={intakeComparePts}
                  yFormat="number"
                />
              </div>
            ) : (
              <EmptyChartState message="No applications recorded yet for this academic year." />
            )}
          </InsightChartCard>

          {/* Application experience — parent satisfaction with the online
              application FORM, nothing to do with pipeline stage/status.
              Genuinely untouched dimension of the schema (feedbackRating on
              ay{{YYYY}}_enrolment_applications, KD #102). The dedicated
              /admissions/feedback page lists individual responses; this is
              the rating distribution + year-over-year average, which page
              doesn't show. */}
          <InsightChartCard
            cap="Application experience"
            title={
              feedback.stats.avgRating !== null
                ? `${feedback.stats.avgRating.toFixed(1)}/5 average rating`
                : 'How did the application form feel?'
            }
            icon={Star}
          >
            {feedback.stats.ratingCount === 0 ? (
              <EmptyChartState message="No parents have rated the application form yet this academic year." />
            ) : (
              <>
                <ComparisonBarChart
                  data={ratingChartData}
                  orientation="vertical"
                  yFormat="number"
                  height={200}
                  rotateLabels={false}
                />
                <p className="mt-3 font-mono text-[10.5px] text-muted-foreground">
                  {feedback.stats.ratingCount.toLocaleString('en-SG')} response
                  {feedback.stats.ratingCount === 1 ? '' : 's'}
                  {feedback.stats.consentRate !== null
                    ? ` · ${feedback.stats.consentRate}% open to follow-up`
                    : ''}
                </p>
                {showRatingDelta ? (
                  <RecommendationCallout
                    tone={ratingDelta! > 0 ? 'positive' : 'watch'}
                    className="mt-5"
                  >
                    Average rating is {ratingDelta! > 0 ? 'up' : 'down'}{' '}
                    {Math.abs(ratingDelta!).toFixed(1)} vs {compareAy} (
                    {priorAvgRating!.toFixed(1)} →{' '}
                    {feedback.stats.avgRating!.toFixed(1)}).
                  </RecommendationCallout>
                ) : null}
              </>
            )}
          </InsightChartCard>
        </div>
      </div>
      {/* ═══ end Demand & conversion ═══ */}

      {/* ═══ Who & why we lose ═══
          Which levels convert worst, and the reasons applicants give for
          dropping out before enrolling. */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-amber">
          Who &amp; why we lose
        </p>

        {/* Withdrawals by level + entrance assessment share a row — same
            reasoning as the pair above: neither is dense enough to earn a
            full-width row on its own. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <InsightChartCard
            cap="By level"
            title={withdrawnTitle}
            icon={GraduationCap}
            scopeNote="Withdrawn applications — families who pulled out before enrolling"
          >
            {withdrawnDonutData.length === 0 ? (
              <EmptyChartState message="No applications have been withdrawn this academic year." />
            ) : (
              <>
                <DonutChart
                  data={withdrawnDonutData}
                  centerValue={totalWithdrawn.toLocaleString('en-SG')}
                  centerLabel="Withdrawn"
                />
                {showTopWithdrawnLevel ? (
                  <RecommendationCallout tone="watch" className="mt-5">
                    {topWithdrawnLevel.item!.level} accounts for{' '}
                    {topWithdrawnLevel.item!.count} of {totalWithdrawn}{' '}
                    withdrawn application
                    {totalWithdrawn === 1 ? '' : 's'}
                    {topWithdrawnPct !== null ? ` (${topWithdrawnPct}%)` : ''} —
                    the level shedding the most applicants before enrolment.
                  </RecommendationCallout>
                ) : null}
              </>
            )}
          </InsightChartCard>

          {/* Assessment performance vs conversion — new cross-cut: does
              passing/failing the entrance assessment predict who enrolls?
              Never shown anywhere else; the operational dashboard's
              assessment chart shows pass/fail volume only, not tied to
              enrollment. */}
          <InsightChartCard
            cap="Entrance assessment"
            title={assessmentTitle}
            icon={ClipboardCheck}
            scopeNote="All applicants — includes cancelled/withdrawn"
          >
            {assessmentGroupedData.length === 0 ? (
              <EmptyChartState message="No assessment results recorded yet for this academic year." />
            ) : (
              <>
                <GroupedBarChart
                  series={ASSESSMENT_SERIES.map((s) => ({
                    key: s.key,
                    label: s.label,
                  }))}
                  data={assessmentGroupedData}
                  yFormat="percent"
                  height={240}
                />
                {showAssessmentGap ? (
                  <RecommendationCallout tone="watch" className="mt-5">
                    {biggestAssessmentGap.item!.subject} applicants who passed
                    enrol at {biggestAssessmentGap.item!.passPct}%, versus{' '}
                    {biggestAssessmentGap.item!.failPct}% for those who failed —
                    a {biggestAssessmentGap.value}pp gap.
                  </RecommendationCallout>
                ) : null}
              </>
            )}
          </InsightChartCard>
        </div>

        {/* Why applicants are lost (pre-enrolment; distinct from Records'
            enrolled-student withdrawals). */}
        {terminal.total > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <InsightChartCard
              cap="Cancellation reasons"
              title={reasonTitle}
              icon={Megaphone}
            >
              <DonutChart
                data={reasonDonutData}
                centerValue={terminal.total.toLocaleString('en-SG')}
                centerLabel="Cancellations"
              />
              {showTopReason ? (
                <RecommendationCallout tone="watch" className="mt-5">
                  {reasonLabel(topReason.reason)} accounts for {topReason.count}{' '}
                  of {terminal.total} cancellations
                  {topReasonPct !== null ? ` (${topReasonPct}%)` : ''} — the
                  clearest place to address drop-out.
                </RecommendationCallout>
              ) : null}
            </InsightChartCard>

            <InsightChartCard
              cap="Top reason per level"
              title="By level"
              icon={GraduationCap}
            >
              <div>
                {terminal.byLevel.map((lvl) => {
                  const lvlTopReason = lvl.reasons[0];
                  return (
                    <TopReasonRow
                      key={lvl.level}
                      level={lvl.level}
                      reason={
                        lvlTopReason ? reasonLabel(lvlTopReason.reason) : '—'
                      }
                      count={lvl.count}
                    />
                  );
                })}
              </div>
            </InsightChartCard>
          </div>
        )}
      </div>
      {/* ═══ end Who & why we lose ═══ */}

      {/* ═══ Channels & segments ═══
          Where applicants come from, and which channels convert. */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Channels &amp; segments
        </p>

        <InsightChartCard
          cap="By source"
          title={referralTitle}
          icon={Megaphone}
          scopeNote="All applicants — includes cancelled/withdrawn"
        >
          {referralDonutData.length === 0 ? (
            <EmptyChartState message="No referral sources recorded yet." />
          ) : (
            <>
              <DonutChart
                data={referralDonutData}
                centerValue={totalReferralApplicants.toLocaleString('en-SG')}
                centerLabel="Applicants"
              />
              {showBestRef ? (
                <RecommendationCallout tone="positive" className="mt-5">
                  {bestRef.item!.source} converts best at{' '}
                  {bestRef.item!.conversionPct}%
                  {!worstRef.isTie &&
                  worstRef.item !== null &&
                  worstRef.item.source !== bestRef.item!.source
                    ? `, ${worstRef.item.source} the lowest at ${worstRef.item.conversionPct}%`
                    : ''}{' '}
                  — lean into what&rsquo;s working.
                </RecommendationCallout>
              ) : null}
            </>
          )}
        </InsightChartCard>
      </div>
      {/* ═══ end Channels & segments ═══ */}

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <TrendingUp className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Enrollment health</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}
