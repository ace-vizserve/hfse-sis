import {
  ArrowLeft,
  FileStack,
  Percent,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
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
  getAdmissionsKpisRange,
  getAverageTimeToEnrollment,
  getConversionFunnel,
  getOutdatedApplications,
} from '@/lib/admissions/dashboard';
import {
  getDeepFunnelStats,
  getConversionByLevel,
  getReferralConversion,
  getEnroleeTypeConversion,
} from '@/lib/admissions/insights-funnel';
import {
  getAdmissionsTerminalReasons,
  growthDelta,
} from '@/lib/admissions/insights';
import {
  AY_MONTH_LABELS,
  getIntakeTrendByAy,
} from '@/lib/admissions/insights-compare';
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import { buildAyTrend } from '@/lib/dashboard/insights-trend';
import { admissionsInsights } from '@/lib/dashboard/insights';
import {
  computeDelta,
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
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

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(
    resolvedSearch,
    windows,
    selectedAy,
    undefined,
    {
      defaultPreset: 'thisMonth',
    }
  );

  // Build the AY list for the two-AY overlay: selected AY first (solid),
  // comparison AY second (muted/dashed), or just the selected AY alone.
  const trendAys = compareAy ? [selectedAy, compareAy] : [selectedAy];

  const [
    funnel,
    priorFunnel,
    terminal,
    timeToEnroll,
    kpisResult,
    intakeTrendPoints,
    outdatedRows,
    deepFunnel,
    conversionByLevel,
    referralConversion,
    enroleeTypeConversion,
  ] = await Promise.all([
    getConversionFunnel(selectedAy),
    compareAy ? getConversionFunnel(compareAy) : Promise.resolve(null),
    getAdmissionsTerminalReasons(selectedAy),
    getAverageTimeToEnrollment(selectedAy),
    getAdmissionsKpisRange(rangeInput),
    getIntakeTrendByAy(trendAys),
    // BUG 2 fix: load real stalled-applicant count for the takeaways panel.
    getOutdatedApplications(selectedAy),
    // Deep funnel + conversion breakdowns.
    getDeepFunnelStats(selectedAy),
    getConversionByLevel(selectedAy),
    getReferralConversion(selectedAy),
    getEnroleeTypeConversion(selectedAy),
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

  // Deep funnel: find the biggest leak stage (for section description + takeaways).
  const biggestLeakStage = deepFunnel.stages.find((s) => s.isBiggestLeak);

  // Referral inputs for the takeaways panel — derived from the conversion data.
  const topRef = referralConversion[0];
  const totalRef = referralConversion.reduce((s, r) => s + r.applied, 0);

  // Donut slices for cancellation reasons, humanized.
  const reasonSlices = terminal.overall.map((r) => ({
    name: reasonLabel(r.reason),
    value: r.count,
  }));

  // Takeaways — fed AY-wide funnel figures (same period as §1/§3 charts) so
  // the narrative describes the same window the user is looking at. Previously
  // this used the range-windowed kpisResult (defaultPreset: 'thisMonth'), which
  // made the "conversion dropping" takeaway irreconcilable with the AY conversion
  // rate displayed above it (BUG 3 fix).
  //
  // `avgDaysToEnrollPrior` is left as undefined — the prior-AY time-to-enrol
  // is not computed here (the compare-AY funnel is not a RangeInput load), so
  // the time-to-enrol drift insight only fires when kpisResult has comparison
  // data (i.e. the operational dashboard path that uses the range comparison).
  const insights = admissionsInsights({
    // AY-wide figures (match §1 headline cards and §3 funnel).
    applications: applicationsCount,
    enrolled: enrolledCount,
    conversionPct,
    conversionPctPrior: priorConversionPct ?? undefined,
    // Time-to-enrol: AY-wide average (§5 card). Prior-AY comparison not
    // available on this page (no prior-AY RangeInput), so drift insight
    // is suppressed — that's honest given the data available.
    avgDaysToEnroll: timeToEnroll.avgDays,
    avgDaysToEnrollPrior: undefined,
    appsDelta: kpisResult.delta ?? undefined,
    // BUG 2 fix: real stalled-applicant count instead of hardcoded 0.
    outdatedCount: outdatedRows.length,
    outdatedHref: `/admissions/applications?students.staleness=Warning,Critical`,
    topReferral: topRef
      ? { source: topRef.source, count: topRef.applied, totalCount: totalRef }
      : undefined,
    funnelDropOff: biggestLeakStage
      ? {
          stage: biggestLeakStage.label,
          dropOffPct: biggestLeakStage.dropOffPct,
        }
      : undefined,
  });

  // ────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from these live values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded stage names, level codes, channel names, or "most"
  // claims in literals. (Storytelling pass.)
  // ────────────────────────────────────────────────────────────────────────

  // 3a — Deep funnel: biggest leak (uses the loader's own isBiggestLeak flag,
  // which already encodes the single-leak / no-leak rule). Title states the
  // finding; callout (act) quantifies the drop. Neutral when no leak.
  const funnelTitle =
    biggestLeakStage && biggestLeakStage.dropOffPct > 0
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
            <MetricCard
              label="Applications cancelled"
              value={terminal.total}
              icon={UserMinus}
              intent={terminal.total > 0 ? 'warning' : 'default'}
              subtext="withdrawn or cancelled before enrolling"
            />
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
              <CardContent>
                <MultiSeriesTrendChart
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

        {/* 3 — Deep funnel: where applicants stall (Chapter 1 closes after). */}
        <InsightsSection
          eyebrow="Funnel"
          title="Where do applicants stall?"
          description={
            biggestLeakStage && biggestLeakStage.dropOffPct > 0
              ? `Biggest leak: at ${biggestLeakStage.label} — ${biggestLeakStage.dropOffPct}% of applicants who reached the prior step fall away here.`
              : 'Each bar shows how many applicants reached that stage. A non-null stage date means the admissions team worked that row — the funnel is cumulative.'
          }
        >
          {/* 3a — Deep funnel (registration → class assignment) */}
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Stage reach — {deepFunnel.totalPool.toLocaleString('en-SG')}{' '}
                total applications
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                {funnelTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {deepFunnel.stages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No stage data available yet.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {deepFunnel.stages.map((stage) => {
                      const widthPct =
                        deepFunnel.totalPool > 0
                          ? Math.max(
                              4,
                              Math.round(
                                (stage.count / deepFunnel.totalPool) * 100
                              )
                            )
                          : 0;
                      return (
                        <li key={stage.key} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {stage.label}
                            </span>
                            <span className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground">
                              {stage.count.toLocaleString('en-SG')}
                              {stage.dropOffPct > 0 && (
                                <>
                                  <span className="text-destructive">
                                    −{stage.dropOffPct}%
                                  </span>
                                  {stage.isBiggestLeak && (
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
                                stage.isBiggestLeak
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
              {conversionByLevel.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No level data available.
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="pb-2 pr-3 font-semibold">Level</th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Applied
                        </th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Enrolled
                        </th>
                        <th className="pb-2 text-right font-semibold tabular-nums">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {conversionByLevel.map((row) => {
                        const isWorst =
                          showWorstLevel &&
                          row.level === worstLevel.item!.level;
                        return (
                          <tr key={row.level}>
                            <td className="py-2 pr-3 font-medium text-foreground">
                              {row.level}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                              {row.applied.toLocaleString('en-SG')}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">
                              {row.enrolled.toLocaleString('en-SG')}
                            </td>
                            <td
                              className={
                                isWorst
                                  ? 'py-2 text-right font-mono text-xs font-semibold tabular-nums text-brand-amber'
                                  : 'py-2 text-right font-mono text-xs tabular-nums text-muted-foreground'
                              }
                            >
                              {row.conversionPct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
        <InsightsSection
          eyebrow="Lost applicants"
          title="Why don't they enroll?"
          description="Reasons recorded when an application is withdrawn or cancelled before enrolling — overall and per level. (Students who leave after enrolling are in Records → Insights.)"
        >
          {terminal.total === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No cancelled or withdrawn applications recorded this year —
                nothing to break down. That&rsquo;s a good sign.
              </CardContent>
            </Card>
          ) : (
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
                  <DonutChart
                    data={reasonSlices}
                    centerLabel="Cancelled"
                    centerValue={terminal.total}
                  />
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
          )}
        </InsightsSection>
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
          eyebrow="Sources & speed"
          title="How fast, and from where?"
          description="How long applicants take to convert, which channels send them, and how New vs Current students differ."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 3.1a — Time to enroll */}
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Average across the year
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Time to enroll
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-serif text-[40px] font-semibold leading-none tabular-nums text-foreground">
                  {timeToEnroll.avgDays}
                  <span className="ml-1 text-lg font-normal text-muted-foreground">
                    days
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Mean days from application to enrolment, over{' '}
                  {timeToEnroll.sampleSize.toLocaleString('en-SG')} completed
                  enrolment{timeToEnroll.sampleSize === 1 ? '' : 's'}.
                </p>
              </CardContent>
            </Card>

            {/* 3.1b — Enrolee type conversion */}
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  New vs returning applicants
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Conversion by applicant type
                </CardTitle>
              </CardHeader>
              <CardContent>
                {enroleeTypeConversion.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No applicant type data available.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="pb-2 pr-3 font-semibold">Type</th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Applied
                        </th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Enrolled
                        </th>
                        <th className="pb-2 text-right font-semibold tabular-nums">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {enroleeTypeConversion.map((row) => (
                        <tr key={row.type}>
                          <td className="py-2 pr-3 font-medium text-foreground">
                            {row.type}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                            {row.applied.toLocaleString('en-SG')}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums text-foreground">
                            {row.enrolled.toLocaleString('en-SG')}
                          </td>
                          <td className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {row.conversionPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 3.1c — Referral conversion table (full width) */}
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
              {referralConversion.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No referral sources recorded yet.
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <th className="pb-2 pr-3 font-semibold">Source</th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Applied
                        </th>
                        <th className="pb-2 pr-3 text-right font-semibold tabular-nums">
                          Enrolled
                        </th>
                        <th className="pb-2 text-right font-semibold">Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {referralConversion.map((r) => {
                        const barWidth =
                          totalRef > 0
                            ? Math.max(
                                2,
                                Math.round((r.applied / totalRef) * 100)
                              )
                            : 0;
                        return (
                          <tr key={r.source}>
                            <td className="py-2.5 pr-3">
                              <div className="space-y-1">
                                <span className="font-medium text-foreground">
                                  {r.source}
                                </span>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky"
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                              {r.applied.toLocaleString('en-SG')}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-foreground">
                              {r.enrolled.toLocaleString('en-SG')}
                            </td>
                            <td className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                              {r.conversionPct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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

      {/* 6 — Takeaways narrative. */}
      <InsightsSection
        eyebrow="Takeaways"
        title="What stands out"
        description="Automatic observations from this year's funnel and the selected period."
      >
        {insights.length > 0 ? (
          <InsightsPanel insights={insights} title="Admissions takeaways" />
        ) : (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Nothing notable to flag for this period — the funnel is steady.
            </CardContent>
          </Card>
        )}
      </InsightsSection>

      {/* 7 — Seasonal (building history). */}
      <InsightsSection
        eyebrow="Seasonality"
        title="When do applications peak?"
        description="Month-by-month seasonal patterns become reliable once a few full intake cycles are on record."
      >
        <BuildingHistoryCard
          label="Seasonal intake patterns"
          detail="Once the school has several completed admission cycles, this will show which months consistently drive applications — so you can time outreach. It fills in automatically each year."
        />
      </InsightsSection>

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
