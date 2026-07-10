import {
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Users,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import { AyComparisonLineChart } from '@/components/dashboard/charts/ay-comparison-line-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
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
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import { buildAyTrend } from '@/lib/dashboard/insights-trend';
import { summariseAyTrend } from '@/lib/dashboard/trend-delta';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import {
  computeDelta,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { sgToday } from '@/lib/dates';
import { getMovementEvents } from '@/lib/sis/movements';
import {
  getInsightsHeadcount,
  getMovementTrendByAy,
  getRecordsRetention,
  getRecordsRetentionByLevel,
  growthDelta,
  hasMonthlyResolution,
  MONTH_LABELS,
  rollupMovements,
} from '@/lib/sis/records-insights';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

const TERM_LABELS: Record<number, string> = {
  1: 'Term 1',
  2: 'Term 2',
  3: 'Term 3',
  4: 'Term 4',
};

// Records · Insights — a narrative, read-first companion to the operational
// dashboard. Retention & Population: are we growing, who moves in and out
// across the year, do students come back, and where do late joins and
// withdrawals concentrate. Three enclosed chapters mirror Admissions Insights
// structure (KD #141).
export default async function RecordsInsightsPage({
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

  const today = sgToday();
  const movementAys = compareAy ? [selectedAy, compareAy] : [selectedAy];

  const [
    headcount,
    priorHeadcount,
    retention,
    retentionByLevel,
    movementEvents,
    movementTrendPoints,
  ] = await Promise.all([
    getInsightsHeadcount(selectedAy),
    compareAy ? getInsightsHeadcount(compareAy) : Promise.resolve(null),
    getRecordsRetention(selectedAy, compareAy),
    getRecordsRetentionByLevel(selectedAy, compareAy),
    getMovementEvents(selectedAy),
    getMovementTrendByAy(movementAys, today),
  ]);

  const priorTotal = priorHeadcount ? priorHeadcount.total : null;
  const growth = growthDelta(headcount.total, priorTotal);

  const rollup = rollupMovements(movementEvents);

  // Backfill guard (KD honesty rule): a backfilled AY's movement events all
  // carry the backfill run-date, so its whole year piles into 1-2 months —
  // overlaying that on the trend chart would fabricate seasonality. Drop the
  // comparison AY from the chart when its own monthly series fails the
  // resolution check; the current AY's line always renders.
  const compareAyMovementPoints = compareAy
    ? movementTrendPoints.filter((p) => p.ayCode === compareAy)
    : [];
  const compareAyHasMonthlyResolution =
    compareAy !== null && hasMonthlyResolution(compareAyMovementPoints);
  const movementChartAys = compareAyHasMonthlyResolution
    ? movementAys
    : [selectedAy];

  // Net-movement trend: two-AY overlaid line chart (or one line when the
  // comparison AY fails the backfill guard above).
  const movementTrend = buildAyTrend(
    movementTrendPoints,
    MONTH_LABELS as unknown as string[],
    movementChartAys
  );
  // Show the trend chart when there are any non-null, non-zero data points.
  const haveMovementTrend = movementTrend.data.some((row) =>
    movementChartAys.some((ay) => row[ay] !== null && row[ay] !== 0)
  );
  const movementTrendSummary = summariseAyTrend(
    movementTrend.data,
    movementTrend.series
  );
  const movementTrendDelta =
    movementTrendSummary.delta && movementTrendSummary.comparisonLabel
      ? {
          label: `${movementTrendSummary.delta.abs >= 0 ? '+' : ''}${movementTrendSummary.delta.abs} vs ${movementTrendSummary.comparisonLabel}`,
          direction: movementTrendSummary.delta.direction,
        }
      : undefined;

  // §1 enrolled card: delta chip when prior headcount is available.
  const enrolledDelta =
    priorTotal !== null ? computeDelta(headcount.total, priorTotal) : undefined;

  // Retention comparison card state.
  const hasRetentionData = compareAy !== null && retention.priorTotal > 0;
  const retentionState = comparisonCardState(compareAy, hasRetentionData);

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

  const maxLevel = headcount.byLevel.reduce((m, l) => Math.max(m, l.count), 0);

  // §2 population-by-level: comparison-year count per level, for the muted
  // "vs {compareAy}" meta value on each row (section only renders when a
  // compareAy is chosen, so priorHeadcount is populated whenever this is read).
  const priorLevelCounts = new Map(
    (priorHeadcount?.byLevel ?? []).map((l) => [l.level, l.count])
  );

  const haveLate =
    rollup.lateByLevel.length > 0 || rollup.lateByTerm.length > 0;
  const haveWithdrawals = rollup.counts.withdrawn > 0;

  // Stacked-bar: convert reason×level matrix to recharts-friendly rows.
  const attritionStackedData = rollup.withdrawalsByReasonAndLevel.map(
    (row) => ({
      level: row.level,
      ...row.reasonCounts,
    })
  );
  const haveAttritionMatrix =
    attritionStackedData.length > 0 && rollup.withdrawalReasonKeys.length > 0;

  // Per-level retention — only meaningful when a compareAy is selected.
  const haveRetentionByLevel =
    compareAy !== null && retentionByLevel.length > 0;

  const { controllability } = rollup;

  // §6 controllability fallback: when every withdrawal reason on record is
  // Unspecified, the "% preventable" story is unknown, not zero — show the
  // honest withdrawals-per-level bar-list instead of the banner/stacked-bar.
  const hasSpecifiedWithdrawalReasons =
    controllability.total > 0 &&
    controllability.unspecifiedCount < controllability.total;

  // ──────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from these live values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded claim strings, level codes, reason names, or "most"
  // claims in literals. (Storytelling pass — mirrors Admissions Insights.)
  // ──────────────────────────────────────────────────────────────────────────

  // Hero lede: retention % + top controllable loss. Neutral when absent.
  const heroPct = retention.pct;
  const heroTakeaway = controllability.topControllableTakeaway;
  const heroDescription =
    heroPct !== null && heroTakeaway
      ? `${heroPct}% of students returned year over year. ${heroTakeaway}`
      : heroPct !== null
        ? `${heroPct}% of students returned year over year — pick a comparison year above to enable this figure.`
        : heroTakeaway
          ? heroTakeaway
          : 'The shape of the student body — how many are enrolled, who moves in and out across the year, and how steadily the school holds on to its students year over year.';

  // §1 — "N students enrolled" / neutral fallback when no data.
  const enrolledTitle =
    headcount.total > 0
      ? `${headcount.total.toLocaleString('en-SG')} students enrolled`
      : 'Enrolled headcount';

  // §2 — "Students are spread across N levels" / neutral fallback.
  const distributionTitle =
    headcount.byLevel.length > 0
      ? `Students are spread across ${headcount.byLevel.length} level${headcount.byLevel.length === 1 ? '' : 's'}`
      : 'Where are the students?';

  // §4 — "N% returned year over year" / neutral.
  const retentionTitle =
    heroPct !== null
      ? `${heroPct}% returned year over year`
      : 'Do students come back?';

  // RecommendationCallout (positive): good when school-wide retention ≥ 85%.
  const showPositiveRetention =
    heroPct !== null && heroPct >= 85 && retentionState === 'ok';

  // RecommendationCallout (watch): worst-returning level, only when the gap
  // below the overall retention rate is ≥ 10pp and there is no tie.
  const RETENTION_GAP_PP = 10;
  const worstRetentionLevel = pickExtreme(
    retentionByLevel,
    (r) => r.pct,
    'min'
  );
  const retentionLevelGap =
    heroPct !== null && worstRetentionLevel.value !== null
      ? heroPct - worstRetentionLevel.value
      : null;
  const showWorstRetentionLevel =
    !worstRetentionLevel.isTie &&
    worstRetentionLevel.item !== null &&
    meetsThreshold(retentionLevelGap, RETENTION_GAP_PP);

  // §5 — Late joins: most-concentrated level title / neutral.
  const topLateLevel = rollup.lateByLevel[0]; // sorted desc already
  const topLateLevelTie =
    rollup.lateByLevel.length > 1 &&
    rollup.lateByLevel[1].count === topLateLevel?.count;
  const showTopLateLevel =
    !!topLateLevel && topLateLevel.count > 0 && !topLateLevelTie;
  const lateTitle = showTopLateLevel
    ? `Late joiners concentrate in ${topLateLevel.level}`
    : 'Where do late enrollees land?';

  // §6 — Attrition: top reason label + % of withdrawals / neutral.
  const topWithdrawalReason = rollup.withdrawalsByReason[0];
  const topWithdrawalTie =
    rollup.withdrawalsByReason.length > 1 &&
    rollup.withdrawalsByReason[1].count === topWithdrawalReason?.count;
  const showTopWithdrawalReason =
    !!topWithdrawalReason && topWithdrawalReason.count > 0 && !topWithdrawalTie;
  const topWithdrawalPct =
    showTopWithdrawalReason && rollup.counts.withdrawn > 0
      ? Math.round((topWithdrawalReason.count / rollup.counts.withdrawn) * 100)
      : null;
  const attritionTitle = showTopWithdrawalReason
    ? `${topWithdrawalReason.reason} accounts for ${topWithdrawalPct !== null ? `${topWithdrawalPct}%` : 'most'} of withdrawals`
    : 'Why do enrolled students leave?';

  // RecommendationCallout (act): top controllable takeaway.
  const showActCallout =
    !!controllability.topControllableTakeaway &&
    controllability.topControllableTakeaway.trim().length > 0;

  return (
    <PageShell>
      <Link
        href={`/records?ay=${encodeURIComponent(selectedAy)}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Records
      </Link>

      <DashboardHero
        eyebrow="Records · Insights"
        title="Retention & Population"
        description={heroDescription}
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

      {/* ═══ Chapter 1 — Population & Growth ═══
          How many students are enrolled, how they're spread across levels,
          and what the net in-year movement looks like. */}
      <div className="space-y-8 border-t-2 border-brand-indigo/25 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-indigo">
            Chapter 1
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Population &amp; growth
          </h2>
        </div>

        {/* 1 — Enrolled headcount: derived title states the number. */}
        <InsightsSection
          eyebrow="Headcount"
          title={enrolledTitle}
          description={
            growth.pct === null
              ? compareAy === null
                ? 'Pick a comparison year above to see year-over-year growth. Until then, this is the current enrolled headcount.'
                : `No enrolment data found for ${compareAy}. Try a different comparison year.`
              : `Enrolled students this year compared with ${compareAy}.`
          }
        >
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Enrolled students"
              value={headcount.total}
              icon={Users}
              intent="good"
              delta={enrolledDelta}
              deltaGoodWhen="up"
              comparisonLabel={
                priorTotal !== null
                  ? `vs ${compareAy} · ${priorTotal.toLocaleString('en-SG')}`
                  : compareAy === null
                    ? 'Pick a comparison year above'
                    : `No data for ${compareAy}`
              }
            />
          </section>
        </InsightsSection>

        {/* 2 — Student population by level: comparison-only (the primary-AY-only
            snapshot dupes the /records dashboard's level distribution) — auto-
            hides entirely when no compareAy is chosen. */}
        {compareAy && priorHeadcount && (
          <InsightsSection
            eyebrow="Distribution"
            title={distributionTitle}
            description={`Enrolled headcount per level. ${headcount.total.toLocaleString('en-SG')} this year vs ${priorHeadcount.total.toLocaleString('en-SG')} in ${compareAy}.`}
          >
            {headcount.byLevel.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No enrolled students recorded for this year yet.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Enrolled per level
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    Student population
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {headcount.byLevel.map((lvl) => {
                      const widthPct =
                        maxLevel > 0
                          ? Math.max(
                              4,
                              Math.round((lvl.count / maxLevel) * 100)
                            )
                          : 0;
                      const priorCount =
                        priorLevelCounts.get(lvl.level) ?? null;
                      return (
                        <li key={lvl.level} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {lvl.level}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {lvl.count.toLocaleString('en-SG')}
                              {priorCount !== null && (
                                <span className="ml-2 text-muted-foreground/50">
                                  vs {compareAy}{' '}
                                  {priorCount.toLocaleString('en-SG')}
                                </span>
                              )}
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
            )}
          </InsightsSection>
        )}

        {/* 3 — Student movement: net-movement velocity overlay only (the 4
            count tiles are byte-for-byte /records/movements' stat cards). */}
        <InsightsSection
          eyebrow="Movement"
          title="Who moves in and out?"
          description="The net rhythm of joins against departures across the year — late enrolments and re-enrolments count up, withdrawals count down."
        >
          {haveMovementTrend ? (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Net enrolment movement per month
                  {compareAy && compareAyHasMonthlyResolution
                    ? ` · ${selectedAy} vs ${compareAy}`
                    : ''}
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Movement by month
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {movementTrendSummary.currentValue !== null && (
                  <TrendDeltaCaption
                    value={`${movementTrendSummary.currentValue >= 0 ? '+' : ''}${movementTrendSummary.currentValue}`}
                    caption={`net movement in ${movementTrendSummary.periodLabel}`}
                    delta={movementTrendDelta}
                  />
                )}
                <AyComparisonLineChart
                  series={movementTrend.series}
                  data={movementTrend.data}
                  yFormat="number"
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No mid-year movement recorded this year yet.
              </CardContent>
            </Card>
          )}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 1 ═══ */}

      {/* ═══ Chapter 2 — Retention ═══
          Did last year's students come back, and which levels returned least. */}
      <div className="space-y-8 border-t-2 border-brand-amber/30 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-amber">
            Chapter 2
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Retention
          </h2>
        </div>

        {/* 4 — Retention: derived title states the percentage. */}
        <InsightsSection
          eyebrow="Year over year"
          title={retentionTitle}
          description={
            compareAy === null
              ? "Pick a comparison year above to see how many of that year's students returned."
              : `Of the students enrolled in ${compareAy}, how many returned this year — school-wide and broken down by the level they were in.`
          }
        >
          {retentionState === 'building' ? (
            <BuildingHistoryCard
              label="Retention"
              detail="Pick a comparison year above to see how many of last year's students returned — the clearest single measure of how well the school holds on to families."
            />
          ) : retentionState === 'no-data' ? (
            <BuildingHistoryCard
              variant="no-data"
              label={`No data for ${compareAy}`}
            />
          ) : (
            <div className="space-y-4">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard
                  label="Returned"
                  value={retention.returned}
                  icon={UserPlus}
                  intent="good"
                  subtext={`of ${retention.priorTotal.toLocaleString('en-SG')} from ${compareAy}`}
                />
                <MetricCard
                  label="Did not return"
                  value={retention.didNotReturn}
                  icon={UserMinus}
                  intent={retention.didNotReturn > 0 ? 'warning' : 'default'}
                  subtext={`enrolled in ${compareAy}, not this year`}
                />
                <MetricCard
                  label="Retention rate"
                  value={retention.pct ?? 0}
                  format="percent"
                  icon={RotateCcw}
                  intent="default"
                  subtext={
                    retention.priorTotal > 0
                      ? `returned year over year`
                      : 'no prior cohort to measure'
                  }
                />
              </section>

              {/* Callout (positive): good retention. */}
              {showPositiveRetention ? (
                <RecommendationCallout tone="positive">
                  {heroPct}% retention — the school is holding on to its
                  families well year over year.
                </RecommendationCallout>
              ) : null}

              {/* Per-level retention breakdown */}
              {haveRetentionByLevel && (
                <Card>
                  <CardHeader>
                    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      Which cohorts didn&rsquo;t return?
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                      Retention by level
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Sorted worst-first — students are counted in the level
                      they were in during {compareAy}, regardless of where they
                      moved to this year.
                    </p>
                    <ul className="space-y-3">
                      {retentionByLevel.map((row) => {
                        const pct = row.pct ?? 0;
                        // Colour the bar by retention quality:
                        // ≥ 85% mint (healthy), 70–84% amber (watch), < 70% destructive.
                        const barClass =
                          pct >= 85
                            ? 'bg-gradient-to-r from-brand-mint to-brand-sky'
                            : pct >= 70
                              ? 'bg-gradient-to-r from-brand-amber to-brand-sky'
                              : 'bg-gradient-to-r from-destructive to-brand-amber';
                        return (
                          <li key={row.level} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {row.level}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {row.returned}/{row.priorTotal} returned
                                <span className="ml-2 font-semibold text-foreground">
                                  {pct}%
                                </span>
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${barClass}`}
                                style={{ width: `${Math.max(2, pct)}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {/* Callout (watch): worst-returning level, only when gap ≥ 10pp and unambiguous. */}
                    {showWorstRetentionLevel ? (
                      <RecommendationCallout tone="watch">
                        {worstRetentionLevel.item!.level} returned at{' '}
                        {worstRetentionLevel.item!.pct}% —{' '}
                        {Math.round(retentionLevelGap!)}pp below the {heroPct}%
                        school-wide rate. Worth a closer look at what&rsquo;s
                        driving families away from this level.
                      </RecommendationCallout>
                    ) : null}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 2 ═══ */}

      {/* ═══ Chapter 3 — Attrition ═══
          Where late joiners land, and why enrolled students leave. */}
      <div className="space-y-8 border-t-2 border-brand-mint/40 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-mint">
            Chapter 3
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Attrition
          </h2>
        </div>

        {/* 5 — Late enrollees: derived title names the most-concentrated level. */}
        <InsightsSection
          eyebrow="Late joins"
          title={lateTitle}
          description="Students who joined after the year began, by level and by the term they joined in."
        >
          {!haveLate ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No late enrollees recorded this year — every student started on
                time.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Late enrollees per level
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    By level
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rollup.lateByLevel.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No level breakdown available.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {(() => {
                        const maxLate = rollup.lateByLevel.reduce(
                          (m, l) => Math.max(m, l.count),
                          0
                        );
                        return rollup.lateByLevel.map((lvl) => {
                          const widthPct =
                            maxLate > 0
                              ? Math.max(
                                  4,
                                  Math.round((lvl.count / maxLate) * 100)
                                )
                              : 0;
                          return (
                            <li key={lvl.level} className="space-y-1.5">
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="font-medium text-foreground">
                                  {lvl.level}
                                </span>
                                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                  {lvl.count.toLocaleString('en-SG')}
                                </span>
                              </div>
                              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-brand-amber to-brand-sky"
                                  style={{ width: `${widthPct}%` }}
                                />
                              </div>
                            </li>
                          );
                        });
                      })()}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    When they joined
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    By term
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rollup.lateByTerm.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No term breakdown available.
                    </p>
                  ) : (
                    <ul className="divide-y divide-hairline">
                      {rollup.lateByTerm.map((t) => (
                        <li
                          key={t.termNumber}
                          className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {TERM_LABELS[t.termNumber] ??
                              `Term ${t.termNumber}`}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-foreground">
                            {t.count.toLocaleString('en-SG')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </InsightsSection>

        {/* 6 — Withdrawal analysis: derived title + controllability callout +
            reason×level stacked bar when reasons are recorded; the honest
            withdrawals-per-level bar-list fallback when every reason on file
            is Unspecified (the "% preventable" story is unknown, not zero). */}
        <InsightsSection
          eyebrow="Attrition"
          title={attritionTitle}
          description="Reasons recorded when an enrolled student is withdrawn mid-year. The cross below shows which reasons are concentrated in which levels, so you can see where to act. (Applicants who cancelled before enrolling are in Admissions → Insights.)"
        >
          {!haveWithdrawals ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No withdrawals recorded this year — nothing to break down.
                That&rsquo;s a good sign.
              </CardContent>
            </Card>
          ) : hasSpecifiedWithdrawalReasons ? (
            <div className="space-y-4">
              {/* Controllability summary banner */}
              <Card
                className={
                  controllability.controllableCount > 0
                    ? 'border-brand-amber/40 bg-gradient-to-r from-brand-amber/5 to-transparent'
                    : ''
                }
              >
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    {controllability.controllableCount > 0 && (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-amber" />
                    )}
                    <div className="flex-1 space-y-1 text-sm">
                      <p className="font-medium text-foreground">
                        {controllability.controllablePct !== null
                          ? `${controllability.controllablePct}% of withdrawals are potentially preventable`
                          : 'No preventable withdrawals recorded'}
                        {controllability.controllableCount > 0 && (
                          <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">
                            ({controllability.controllableCount} of{' '}
                            {controllability.total})
                          </span>
                        )}
                      </p>
                      {controllability.topControllableTakeaway && (
                        <p className="text-muted-foreground">
                          {controllability.topControllableTakeaway}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Preventable ={' '}
                        <span className="font-medium">financial</span>,{' '}
                        <span className="font-medium">disciplinary</span>,{' '}
                        <span className="font-medium">academic fit</span>.
                        Structural ={' '}
                        <span className="font-medium">relocation</span>,{' '}
                        <span className="font-medium">transfer</span>,{' '}
                        <span className="font-medium">health</span>.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Callout (act): top controllable takeaway when present. */}
              {showActCallout ? (
                <RecommendationCallout tone="act">
                  {controllability.topControllableTakeaway}
                </RecommendationCallout>
              ) : null}

              {/* Reason × level stacked bar — the diagnostic cross */}
              {haveAttritionMatrix && (
                <Card>
                  <CardHeader>
                    <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      Which reasons are concentrated where?
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                      Withdrawal reason by level
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AttritionStackedBarChart
                      data={attritionStackedData}
                      reasonKeys={rollup.withdrawalReasonKeys}
                    />
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            /* Fallback: no reason is ever recorded (all Unspecified) — the
               preventable-% story would be fabricated, so show only what is
               actually known: how many withdrew per level. */
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  No withdrawal reasons recorded yet
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Withdrawals per level
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rollup.withdrawalsByLevel.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No level breakdown available.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {(() => {
                      const maxW = rollup.withdrawalsByLevel.reduce(
                        (m, l) => Math.max(m, l.count),
                        0
                      );
                      return rollup.withdrawalsByLevel.map((lvl) => {
                        const widthPct =
                          maxW > 0
                            ? Math.max(4, Math.round((lvl.count / maxW) * 100))
                            : 0;
                        return (
                          <li key={lvl.level} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {lvl.level}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {lvl.count.toLocaleString('en-SG')}
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-destructive to-brand-amber"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </li>
                        );
                      });
                    })()}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 3 ═══ */}

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Users className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Retention &amp; population</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
      </div>
    </PageShell>
  );
}
