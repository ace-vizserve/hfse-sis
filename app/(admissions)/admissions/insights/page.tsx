import {
  ArrowLeft,
  FileStack,
  Percent,
  TrendingUp,
  UserMinus,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
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
  getReferralSourceBreakdown,
} from '@/lib/admissions/dashboard';
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
    referral,
    kpisResult,
    intakeTrendPoints,
    outdatedRows,
  ] = await Promise.all([
    getConversionFunnel(selectedAy),
    compareAy ? getConversionFunnel(compareAy) : Promise.resolve(null),
    getAdmissionsTerminalReasons(selectedAy),
    getAverageTimeToEnrollment(selectedAy),
    getReferralSourceBreakdown(selectedAy),
    getAdmissionsKpisRange(rangeInput),
    getIntakeTrendByAy(trendAys),
    // BUG 2 fix: load real stalled-applicant count for the takeaways panel.
    getOutdatedApplications(selectedAy),
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

  // Biggest drop-off stage — the single point where the funnel leaks most.
  const biggestDrop = funnel.reduce<(typeof funnel)[number] | null>(
    (acc, stage) => (stage.dropOffPct > (acc?.dropOffPct ?? 0) ? stage : acc),
    funnel[0] ?? null
  );

  // Referral inputs for the takeaways panel (same derivation as the dashboard).
  const topRef = referral[0];
  const totalRef = referral.reduce((s, r) => s + r.count, 0);

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
    outdatedHref: `/admissions/applications?al.staleness=Warning,Critical`,
    topReferral: topRef
      ? { source: topRef.source, count: topRef.count, totalCount: totalRef }
      : undefined,
    funnelDropOff: biggestDrop
      ? { stage: biggestDrop.stage, dropOffPct: biggestDrop.dropOffPct }
      : undefined,
  });

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
        description="The story behind the funnel — how application demand is trending, how well we convert applicants, and where they fall away before enrolling."
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

      {/* 1 — Funnel headline: application demand + conversion (NOT enrolled
          headcount — that's the enrolled body, owned by Records Insights).
          Primary-AY metrics (Conversion rate, Applications cancelled) always
          render. Only the demand-comparison subtext reacts to `demandState`
          (FIX 2 — matches Records' Section-1 pattern). */}
      <InsightsSection
        eyebrow="Demand & conversion"
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

      {/* 3 — Funnel drop-off. */}
      <InsightsSection
        eyebrow="Funnel"
        title="Where do applicants drop?"
        description={
          biggestDrop && biggestDrop.dropOffPct > 0
            ? `The largest leak is at ${biggestDrop.stage} — ${biggestDrop.dropOffPct}% fall away before reaching it.`
            : 'Each stage shows how many applications reached it. The funnel is cumulative — every enrolled applicant also passed through every earlier stage.'
        }
      >
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Reached each stage
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Conversion funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {funnel.map((stage) => {
                const top = funnel[0]?.count ?? 0;
                const widthPct =
                  top > 0
                    ? Math.max(4, Math.round((stage.count / top) * 100))
                    : 0;
                return (
                  <li key={stage.stage} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-foreground">
                        {stage.stage}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {stage.count.toLocaleString('en-SG')}
                        {stage.dropOffPct > 0 ? (
                          <span className="ml-2 text-destructive">
                            −{stage.dropOffPct}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </InsightsSection>

      {/* 4 — Why applicants are lost (pre-enrolment; distinct from Records'
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
                  Overall
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DonutChart
                  data={reasonSlices}
                  centerLabel="Cancelled"
                  centerValue={terminal.total}
                />
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
                    const topReason = lvl.reasons[0];
                    return (
                      <li
                        key={lvl.level}
                        className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                      >
                        <span className="font-medium text-foreground">
                          {lvl.level}
                        </span>
                        <span className="min-w-0 truncate text-right text-muted-foreground">
                          {topReason ? reasonLabel(topReason.reason) : '—'}
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

      {/* 5 — Time to enroll + referral, two-col. */}
      <InsightsSection
        eyebrow="Sources & speed"
        title="How fast, and from where?"
        description="How long applicants take to convert, and which channels send them."
      >
        <div className="grid gap-4 lg:grid-cols-2">
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
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Where applicants hear about us
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Referral sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              {referral.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No referral sources recorded yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {referral.map((r) => {
                    const widthPct =
                      totalRef > 0
                        ? Math.max(4, Math.round((r.count / totalRef) * 100))
                        : 0;
                    return (
                      <li key={r.source} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">
                            {r.source}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {r.count.toLocaleString('en-SG')}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </InsightsSection>

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
