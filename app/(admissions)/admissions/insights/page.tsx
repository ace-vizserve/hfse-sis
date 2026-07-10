import { ArrowLeft, Clock, FileStack, Percent, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AyComparisonLineChart } from '@/components/dashboard/charts/ay-comparison-line-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  getAverageTimeToEnrollment,
  getConversionFunnel,
} from '@/lib/admissions/dashboard';
import {
  getConversionByLevel,
  getReferralConversion,
  sortLevelsByConversionAsc,
} from '@/lib/admissions/insights-funnel';
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
  'registrar',
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

  const [
    funnel,
    priorFunnel,
    terminal,
    intakeTrendPoints,
    conversionByLevel,
    referralConversion,
    timeToEnroll,
  ] = await Promise.all([
    getConversionFunnel(selectedAy),
    compareAy ? getConversionFunnel(compareAy) : Promise.resolve(null),
    getAdmissionsTerminalReasons(selectedAy),
    getIntakeTrendByAy(trendAys),
    // Conversion breakdowns (by level / referral).
    getConversionByLevel(selectedAy),
    getReferralConversion(selectedAy),
    // Time to enrol — real enrolledAt timestamp (migration 075). sampleSize=0
    // is expected on existing data; folded into §1's headline row when it has
    // data, hidden entirely otherwise (no lib change, KD #140 honesty rule).
    getAverageTimeToEnrollment(selectedAy),
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
      inProgressPeriod: currentInProgressMonthLabel(selectedAy),
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

  // Levels sorted worst-converter-first so the bar list is scannable without
  // reading the callout below it (requirement: ascending on conversionPct).
  const levelsWorstFirst = sortLevelsByConversionAsc(conversionByLevel);

  // Referrals sorted best-converter-first — the bar now encodes conversion %
  // (the story), volume stays visible as mono meta text alongside it.
  const referralsByConversion = [...referralConversion].sort(
    (a, b) => b.conversionPct - a.conversionPct
  );

  // Cancellation reasons — top 5 + an overflow bucket for the sorted bar list.
  // terminal.overall is already sorted desc by count (lib/admissions/insights.ts).
  // The overflow bucket carries a sentinel key + the label "Other reasons" —
  // deliberately distinct from the real `other` reason code, whose display
  // label is already "Other" (APPLICATION_TERMINAL_REASON_LABELS) and which
  // can legitimately rank in the top 5 alongside the overflow row.
  const OVERFLOW_REASON_KEY = '__overflow__';
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
            key: OVERFLOW_REASON_KEY,
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

  // 3a — Funnel: biggest leak, derived above from the real applicationStatus
  // pipeline (largest stage-to-stage drop, or null when none). Title states the
  // finding; callout (act) quantifies the drop. Neutral when no leak.
  const funnelTitle = biggestLeakStage
    ? `Applicants drop most at ${biggestLeakStage.label}`
    : 'Application pipeline';

  // 3b — Conversion by level: worst-converting level, but only claim it when
  // the gap below the overall conversion rate is meaningful (≥ 10pp) and there
  // is no tie. Otherwise stay neutral.
  const worstLevel = pickExtreme(
    conversionByLevel,
    (r) => r.conversionPct,
    'min'
  );
  const levelGap =
    worstLevel.value !== null ? conversionPct - worstLevel.value : null;
  const LEVEL_GAP_PP = 10;
  const showWorstLevel =
    !worstLevel.isTie &&
    worstLevel.item !== null &&
    meetsThreshold(levelGap, LEVEL_GAP_PP);
  const levelTitle = showWorstLevel
    ? `${worstLevel.item!.level} converts the least`
    : 'Conversion by level';

  // 5c — Referral channels: best + worst converting source, each guarded by a
  // minimum sample so a 1-of-1 channel can't masquerade as the "best". Title
  // names both ends when both clear the guard; neutral otherwise.
  const REFERRAL_MIN_SAMPLE = 5;
  const eligibleRefs = referralConversion.filter(
    (r) => r.applied >= REFERRAL_MIN_SAMPLE
  );
  const bestRef = pickExtreme(eligibleRefs, (r) => r.conversionPct, 'max');
  const worstRef = pickExtreme(eligibleRefs, (r) => r.conversionPct, 'min');
  const showBestRef = !bestRef.isTie && bestRef.item !== null;
  const referralTitle = showBestRef
    ? `${bestRef.item!.source} converts best`
    : 'Referral sources: conversion';

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

      {/* ═══ Chapter 1 — Demand & conversion ═══
          How much demand the funnel takes in, and how well it converts. */}
      <div className="space-y-8 border-t-2 border-brand-indigo/25 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-indigo">
            Chapter 1
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Demand &amp; conversion
          </h2>
        </div>

        {/* 1 — Funnel headline: application demand + conversion (NOT enrolled
          headcount — that's the enrolled body, owned by Records Insights).
          Primary-AY metrics (Conversion rate, Applications cancelled) always
          render. Only the demand-comparison subtext reacts to `demandState`
          (FIX 2 — matches Records' Section-1 pattern). */}
        <InsightsSection
          eyebrow="Headline"
          title="Is the funnel healthy?"
          description={
            demandState === 'ok'
              ? `Application demand this year compared with ${compareAy}.`
              : compareAy === null
                ? 'Pick a comparison year above to see year-over-year demand. Until then, this is the current cycle.'
                : `No application data found for ${compareAy}. Try a different comparison year.`
          }
        >
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Applications received"
              value={applicationsCount}
              icon={FileStack}
              intent="default"
              {...(applicationsDelta
                ? {
                    delta: applicationsDelta,
                    deltaGoodWhen: 'up' as const,
                    comparisonLabel: `${priorApplications?.toLocaleString('en-SG')} in ${compareAy}`,
                  }
                : {
                    subtext:
                      demandState === 'no-data'
                        ? `No data for ${compareAy}`
                        : compareAy === null
                          ? 'Pick a comparison year above'
                          : undefined,
                  })}
            />
            <MetricCard
              label="Conversion rate"
              value={conversionPct}
              format="percent"
              icon={Percent}
              intent="good"
              {...(conversionDelta
                ? {
                    delta: conversionDelta,
                    deltaGoodWhen: 'up' as const,
                    deltaFormat: 'absolute' as const,
                    deltaUnit: 'pp',
                    comparisonLabel: `${priorConversionPct?.toFixed(1)}% in ${compareAy}`,
                  }
                : {
                    subtext: `${enrolledCount.toLocaleString('en-SG')} of ${applicationsCount.toLocaleString('en-SG')} applicants enrolled`,
                  })}
            />
            {timeToEnroll.sampleSize > 0 && (
              <MetricCard
                label="Avg. days to enrol"
                value={timeToEnroll.avgDays}
                icon={Clock}
                intent="default"
                subtext={`from ${timeToEnroll.sampleSize.toLocaleString('en-SG')} ${timeToEnroll.sampleSize === 1 ? 'enrolment' : 'enrolments'} since tracking began`}
              />
            )}
          </section>
        </InsightsSection>

        {/* 2 — Intake trend: per-month, two-AY overlay.
          Shows applications received per month across the full Jan–Nov HFSE
          AY window. When a comparison AY is selected, it overlays as a muted
          dashed line so the registrar can read seasonal patterns at a glance.
          Future months in the current AY render as gaps (null) so the line
          doesn't misleadingly flatline to zero. */}
        <InsightsSection
          eyebrow="Demand"
          title="How is intake trending?"
          description={
            compareAy
              ? `Applications received per month — ${selectedAy} (solid) vs ${compareAy} (dashed).`
              : 'Applications received per month across the academic year.'
          }
        >
          {intakeTrend.data.some((d) =>
            intakeTrend.series.some((s) => d[s.key] !== null)
          ) ? (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Applications per month
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Intake trend
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {intakeTrendSummary.currentValue !== null && (
                  <TrendDeltaCaption
                    value={intakeTrendSummary.currentValue.toLocaleString(
                      'en-SG'
                    )}
                    caption={`applications in ${intakeTrendSummary.periodLabel}`}
                    delta={intakeTrendDelta}
                  />
                )}
                <AyComparisonLineChart
                  series={intakeTrend.series}
                  data={intakeTrend.data}
                  yFormat="number"
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No applications recorded yet for this academic year.
              </CardContent>
            </Card>
          )}
        </InsightsSection>

        {/* 3 — Funnel: where applicants stall, on the REAL applicationStatus
            pipeline (490/490 populated). Submitted → Ongoing Verification →
            Processing → Enrolled, counted cumulatively. */}
        <InsightsSection
          eyebrow="Funnel"
          title="Where do applicants stall?"
          description={
            biggestLeakStage
              ? `Biggest leak: at ${biggestLeakStage.label} — ${biggestLeakStage.dropOffPct}% of applicants who reached the prior step don't move on.`
              : 'Each bar shows how many applicants reached that stage of the application pipeline. The funnel is cumulative — every enrolled applicant also passed verification and processing.'
          }
        >
          {/* 3a — Application-status pipeline funnel */}
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Stage reach — {applicationsCount.toLocaleString('en-SG')} total
                applications
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {funnelTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {applicationsCount === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No applications recorded yet for this academic year.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {funnel.map((stage) => {
                      const widthPct =
                        applicationsCount > 0
                          ? Math.max(
                              4,
                              Math.round(
                                (stage.count / applicationsCount) * 100
                              )
                            )
                          : 0;
                      const isBiggestLeak =
                        biggestLeakStage !== null &&
                        stage.stage === biggestLeakStage.label &&
                        stage.dropOffPct === biggestLeakStage.dropOffPct;
                      return (
                        <li key={stage.stage} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {stage.stage}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                              {stage.count.toLocaleString('en-SG')}
                              {stage.dropOffPct > 0 && (
                                <>
                                  <span className="text-destructive">
                                    −{stage.dropOffPct}%
                                  </span>
                                  {isBiggestLeak && (
                                    <Badge
                                      variant="destructive"
                                      className="px-1.5 py-0 text-[10px] font-semibold"
                                    >
                                      Biggest leak
                                    </Badge>
                                  )}
                                </>
                              )}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                isBiggestLeak
                                  ? 'h-full rounded-full bg-gradient-to-r from-destructive/70 to-destructive/40'
                                  : 'h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy'
                              }
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Callout (act): the biggest leak, quantified. Renders only
                      when the loader flagged a real leak; otherwise omitted. */}
                  {biggestLeakStage && biggestLeakStage.dropOffPct > 0 ? (
                    <RecommendationCallout tone="act">
                      {biggestLeakStage.dropOffPct}% of applicants fall away at{' '}
                      {biggestLeakStage.label} — focus follow-up there to
                      recover the most.
                    </RecommendationCallout>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 1 ═══ */}

      {/* ═══ Chapter 2 — Who & why we lose ═══
          Which levels convert worst, and the reasons applicants give for
          dropping out before enrolling. */}
      <div className="space-y-8 border-t-2 border-brand-amber/30 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-amber">
            Chapter 2
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Who &amp; why we lose
          </h2>
        </div>

        {/* 2.1 — Conversion by level */}
        <InsightsSection
          eyebrow="Conversion gaps"
          title="Which levels convert worst?"
          description="How many applicants at each level go on to enrol — terminal statuses excluded so this reflects the active pipeline."
        >
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Active pipeline only — terminal statuses excluded
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {levelTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {levelsWorstFirst.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No level data available.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {levelsWorstFirst.map((row) => {
                      const isWorst =
                        showWorstLevel && row.level === worstLevel.item!.level;
                      const widthPct = Math.max(4, row.conversionPct);
                      return (
                        <li key={row.level} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {row.level}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                              {row.applied.toLocaleString('en-SG')} applied ·{' '}
                              {row.enrolled.toLocaleString('en-SG')} enrolled
                              <span
                                className={
                                  isWorst
                                    ? 'font-semibold text-brand-amber'
                                    : 'text-foreground'
                                }
                              >
                                {row.conversionPct}%
                              </span>
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                isWorst
                                  ? 'h-full rounded-full bg-gradient-to-r from-brand-amber/80 to-brand-amber/40'
                                  : 'h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy'
                              }
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Callout (watch): the worst-converting level, but only when
                      its gap below the overall rate is meaningful and unambiguous. */}
                  {showWorstLevel ? (
                    <RecommendationCallout tone="watch">
                      {worstLevel.item!.level} converts at{' '}
                      {worstLevel.item!.conversionPct}% — {levelGap}pp below the{' '}
                      {conversionPct}% overall rate. Worth a closer look at this
                      level&rsquo;s pipeline.
                    </RecommendationCallout>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </InsightsSection>

        {/* 2.2 — Why applicants are lost (pre-enrolment; distinct from Records'
            enrolled-student withdrawals). */}
        {terminal.total > 0 && (
          <InsightsSection
            eyebrow="Lost applicants"
            title="Why don't they enroll?"
            description="Reasons recorded when an application is withdrawn or cancelled before enrolling — overall and per level. (Students who leave after enrolling are in Records → Insights.)"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Cancellation reasons
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    {reasonTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-3">
                    {reasonBars.map((r) => {
                      const pct =
                        terminal.total > 0
                          ? Math.round((r.count / terminal.total) * 100)
                          : 0;
                      const isTop = showTopReason && r.key === topReason.reason;
                      return (
                        <li key={r.key} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {r.label}
                            </span>
                            <span
                              className={
                                isTop
                                  ? 'font-mono text-xs font-semibold tabular-nums text-brand-amber'
                                  : 'font-mono text-xs tabular-nums text-muted-foreground'
                              }
                            >
                              {r.count.toLocaleString('en-SG')} · {pct}%
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                isTop
                                  ? 'h-full rounded-full bg-gradient-to-r from-brand-amber/80 to-brand-amber/40'
                                  : 'h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy'
                              }
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Callout (watch): the top cancellation cause + its share.
                      Suppressed on an empty set or a tie for first. */}
                  {showTopReason ? (
                    <RecommendationCallout tone="watch">
                      {reasonLabel(topReason.reason)} accounts for{' '}
                      {topReason.count} of {terminal.total} cancellations
                      {topReasonPct !== null ? ` (${topReasonPct}%)` : ''} — the
                      clearest place to address drop-out.
                    </RecommendationCallout>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Top reason per level
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    By level
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y divide-hairline">
                    {terminal.byLevel.map((lvl) => {
                      const lvlTopReason = lvl.reasons[0];
                      return (
                        <li
                          key={lvl.level}
                          className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {lvl.level}
                          </span>
                          <span className="min-w-0 truncate text-right text-muted-foreground">
                            {lvlTopReason
                              ? reasonLabel(lvlTopReason.reason)
                              : '—'}
                            <span className="ml-2 font-mono text-xs tabular-nums text-foreground">
                              {lvl.count.toLocaleString('en-SG')}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </InsightsSection>
        )}
      </div>
      {/* ═══ end Chapter 2 ═══ */}

      {/* ═══ Chapter 3 — Channels & segments ═══
          Where applicants come from, which channels convert, how long they
          take, and how applicant segments differ. */}
      <div className="space-y-8 border-t-2 border-brand-mint/40 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-mint">
            Chapter 3
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Channels &amp; segments
          </h2>
        </div>

        <InsightsSection
          eyebrow="Sources"
          title="Which channels bring enrolments?"
          description="How applicants heard about HFSE, and how well each channel converts to enrolment."
        >
          {/* 3.1 — Referral conversion, sorted by conversion % descending —
              the bar encodes conversion (the story); volume stays as meta. */}
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                All applicants (including cancelled/withdrawn) — true conversion
                rate
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {referralTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {referralsByConversion.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No referral sources recorded yet.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {referralsByConversion.map((r) => {
                      const isBest =
                        showBestRef && r.source === bestRef.item!.source;
                      const isWorst =
                        showBestRef &&
                        !worstRef.isTie &&
                        worstRef.item !== null &&
                        r.source === worstRef.item.source &&
                        worstRef.item.source !== bestRef.item!.source;
                      const widthPct = Math.max(2, r.conversionPct);
                      return (
                        <li key={r.source} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {r.source}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                              {r.applied.toLocaleString('en-SG')} applied ·{' '}
                              {r.enrolled.toLocaleString('en-SG')} enrolled
                              <span
                                className={
                                  isBest
                                    ? 'font-semibold text-brand-mint'
                                    : isWorst
                                      ? 'font-semibold text-brand-amber'
                                      : 'text-foreground'
                                }
                              >
                                {r.conversionPct}%
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {/* Callout (positive): the best-converting channel, guarded by
                      a minimum sample so a tiny channel can't win on noise.
                      Names the worst end too when it also clears the guard. */}
                  {showBestRef ? (
                    <RecommendationCallout tone="positive">
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
            </CardContent>
          </Card>
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 3 ═══ */}

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
