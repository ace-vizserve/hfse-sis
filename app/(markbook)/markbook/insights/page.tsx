import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  FileCheck2,
  GitPullRequestArrow,
  Lock,
  Timer,
  TrendingDown,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
import { MetricCard } from '@/components/dashboard/metric-card';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
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
import { buildCompareCells } from '@/lib/dashboard/compare';
import { resolveCompareAy } from '@/lib/dashboard/comparison';
import {
  computeDelta,
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getChangeRequestSummary,
  getGradeDistribution,
  getGradeEntryVelocityRange,
  getPublicationCoverage,
  getSheetLockProgressByTerm,
  GRADE_BANDS,
} from '@/lib/markbook/dashboard';
import {
  getSubjectLevelTrend,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
  type SubjectTrendPoint,
} from '@/lib/markbook/compare';
import {
  buildMultiAyTrend,
  topBandBadge,
} from '@/lib/markbook/insights-compare';
import {
  buildSubjectLevelPoints,
  computeFailingTailBySubject,
  computeTermDelta,
  getWatchRowsByLevel,
  type SubjectLevelTrendPoint,
} from '@/lib/markbook/insights-level';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

// The two top bands ("very satisfactory" 85–89 + "outstanding" 90–100) are the
// "top performing" share we headline. Keyed off GRADE_BANDS so it tracks any
// future band re-definition.
const TOP_BAND_KEYS = new Set(['vs', 'o']);

// Minimum magnitude for a regression to be called out in a RecommendationCallout.
// Below this threshold we don't claim "biggest regression" — noise, not signal.
const REGRESSION_MIN_PTS = 3;

// Minimum failing-tail % before calling out a subject's at-risk population.
const FAILING_TAIL_MIN_PCT = 15;

// Minimum pending change-request count to surface a throughput bottleneck callout.
const PENDING_CR_MIN = 3;

// Markbook · Insights — the "Academic Performance" companion to the operational
// dashboard. How students are performing in graded subjects, where attention is
// needed, and how steadily grading + publishing is moving. Read-first; all
// aggregates derive from grade entries (server-computed per Hard Rule #2) over
// the selected period. Award tiers + GA bands live on Records → Academic
// Summary, NOT here — this page is grading performance + throughput only.
export default async function MarkbookInsightsPage({
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

  // Resolve the selected AY's UUID — getGradeDistribution is keyed by id
  // (uuid), the rest by code. Mirrors the markbook dashboard page.
  // Also resolve the comparison AY's UUID when one is set.
  const [{ data: ayRow }, { data: compareAyRow }] = await Promise.all([
    service
      .from('academic_years')
      .select('id')
      .eq('ay_code', selectedAy)
      .maybeSingle(),
    compareAy
      ? service
          .from('academic_years')
          .select('id')
          .eq('ay_code', compareAy)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const ayId = (ayRow as { id: string } | null)?.id ?? null;
  const compareAyId = (compareAyRow as { id: string } | null)?.id ?? null;

  const windows = await getDashboardWindows(selectedAy);
  // Markbook is term-scoped (KD #79) — mirror the operational dashboard, which
  // resolves the default range via the thisTerm cascade (no preset).
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);

  // Subject-performance trend needs term cells (termId + termNumber). When a
  // comparison AY is selected we include both AYs so the trend chart can show
  // two lines per subject. getSubjectPerformanceTrend reads only
  // cell.{termId,termNumber,ayCode} — the `data` payload is irrelevant.
  const [trendCells, levelTrendCells] = await Promise.all([
    buildCompareCells({
      kind: 'term',
      ays: compareAy ? [selectedAy, compareAy] : [selectedAy],
      terms: [1, 2, 3, 4],
    }),
    // Level breakdown always uses the primary AY only — comparison AY context
    // is for the school-wide trend chart; the level watchlist is diagnostic,
    // so mixing AYs would obscure the signal.
    buildCompareCells({
      kind: 'term',
      ays: [selectedAy],
      terms: [1, 2, 3, 4],
    }),
  ]);
  const trendCellResults = trendCells.map((cell) => ({
    cell,
    data: null as unknown as MarkbookCompareKpis,
  }));
  const levelTrendCellResults = levelTrendCells.map((cell) => ({
    cell,
    data: null as unknown as MarkbookCompareKpis,
  }));

  const [
    gradeDist,
    compareGradeDist,
    trendPoints,
    changeRequests,
    lockProgress,
    pubCoverage,
    velocity,
    rawLevelPoints,
  ] = await Promise.all([
    ayId ? getGradeDistribution(ayId) : Promise.resolve(null),
    compareAy && compareAyId
      ? getGradeDistribution(compareAyId)
      : Promise.resolve(null),
    getSubjectPerformanceTrend(trendCellResults),
    getChangeRequestSummary(selectedAy, 30),
    ayId ? getSheetLockProgressByTerm(ayId) : Promise.resolve([]),
    ayId ? getPublicationCoverage(ayId) : Promise.resolve([]),
    getGradeEntryVelocityRange(rangeInput),
    getSubjectLevelTrend(levelTrendCellResults),
  ]);

  // Headline: total graded + share in the top band(s). Honest — a single
  // performance % isn't fabricated; we report the count and the top-band share.
  const totalGraded = (gradeDist ?? []).reduce((s, b) => s + b.count, 0);
  const topBandCount = (gradeDist ?? [])
    .filter((b) => TOP_BAND_KEYS.has(b.key))
    .reduce((s, b) => s + b.count, 0);
  const topBandPct =
    totalGraded > 0 ? Math.round((topBandCount / totalGraded) * 100) : null;

  // Comparison AY top-band share (null when no comparison dist or it's empty).
  function computeTopBandPct(dist: typeof gradeDist): number | null {
    if (!dist) return null;
    const total = dist.reduce((s, b) => s + b.count, 0);
    if (total === 0) return null;
    const topCount = dist
      .filter((b) => TOP_BAND_KEYS.has(b.key))
      .reduce((s, b) => s + b.count, 0);
    return Math.round((topCount / total) * 100);
  }

  const compareTopBandPct = computeTopBandPct(compareGradeDist);
  const growthBadge = topBandBadge(topBandPct, compareTopBandPct, compareAy);

  // Delta for the §1 "In the top bands" headline card — shown only when we have
  // both a current reading AND a comparison AY with data. Expressed in percentage
  // points (pp) so +3pp means 3 percentage-point improvement, not 3% more.
  const topBandDelta =
    topBandPct !== null && compareTopBandPct !== null && compareAy !== null
      ? computeDelta(topBandPct, compareTopBandPct)
      : null;

  // ── Performance trend chart ───────────────────────────────────────────────
  // One line per examinable subject (× AY when comparison is set); X axis =
  // terms in order. buildMultiAyTrend handles namespacing so each
  // (subject × AY) becomes its own series key with no collision.
  const periods = [
    ...new Set(
      trendCells
        .map((c) => (c.termNumber ? `T${c.termNumber}` : null))
        .filter((p): p is string => p !== null)
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const trendAys = compareAy ? [selectedAy, compareAy] : [selectedAy];
  // Only the series count is needed here — this AY×comparison shape gated the
  // section's visibility before the bar reshape below existed; `trendBarData`
  // (current-AY-only) is what actually renders.
  const { series: trendSeries } = buildMultiAyTrend(
    trendPoints,
    periods,
    trendAys
  );
  const haveTrend = trendPoints.length > 0 && trendSeries.length > 0;

  // ── Subjects to watch (school-wide, unchanged) ─────────────────────────────
  // From the LATEST term that has any trend data in the PRIMARY AY, the lowest-
  // averaging subjects. Always primary-AY only — comparison is context, not the
  // target of the watchlist.
  const primaryTrendPoints = trendPoints.filter((p) => p.ayCode === selectedAy);
  const latestPeriodWithData = [...periods]
    .reverse()
    .find((p) => primaryTrendPoints.some((pt) => pt.periodLabel === p));

  // ── Performance trend chart, bar view ──────────────────────────────────────
  // Grouped bars read cleanly with the 4-term period count, but a bar per
  // (subject × AY) — the line chart's shape — becomes an unreadable tangle
  // once a comparison AY is added on top of several subjects. So the bar view
  // is deliberately CURRENT-AY-ONLY (one bar per subject, distinct hues); the
  // AY-over-AY read for Markbook already lives in the hero's topBandBadge and
  // on /markbook/compare.
  const { data: trendBarData, series: trendBarSeries } = buildMultiAyTrend(
    primaryTrendPoints,
    periods,
    [selectedAy]
  );

  function averageAvgGrade(
    points: SubjectTrendPoint[],
    period: string
  ): number | null {
    const values = points
      .filter((p) => p.periodLabel === period && p.avgGrade !== null)
      .map((p) => p.avgGrade as number);
    if (values.length === 0) return null;
    return (
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    );
  }

  const firstPeriod = periods[0] ?? null;
  const latestOverallAvg = latestPeriodWithData
    ? averageAvgGrade(primaryTrendPoints, latestPeriodWithData)
    : null;
  const firstOverallAvg = firstPeriod
    ? averageAvgGrade(primaryTrendPoints, firstPeriod)
    : null;
  const trendCaptionDelta =
    latestOverallAvg !== null &&
    firstOverallAvg !== null &&
    firstPeriod !== latestPeriodWithData
      ? {
          label: `${latestOverallAvg - firstOverallAvg >= 0 ? '+' : ''}${Math.round((latestOverallAvg - firstOverallAvg) * 10) / 10} vs ${firstPeriod}`,
          direction: (latestOverallAvg > firstOverallAvg
            ? 'up'
            : latestOverallAvg < firstOverallAvg
              ? 'down'
              : 'flat') as 'up' | 'down' | 'flat',
        }
      : undefined;
  const watchRows: SubjectTrendPoint[] = latestPeriodWithData
    ? primaryTrendPoints
        .filter(
          (p) => p.periodLabel === latestPeriodWithData && p.avgGrade !== null
        )
        .sort((a, b) => (a.avgGrade ?? 0) - (b.avgGrade ?? 0))
        .slice(0, 6)
    : [];

  // ── Level-breakdown layer ─────────────────────────────────────────────────
  // Converts raw aggregation points (sum/count per subject×level×term) into
  // typed trend points, then derives: delta list, per-level watch rows, failing
  // tail. All primary AY only (level diagnostics are current-AY specific).
  const levelPoints: SubjectLevelTrendPoint[] =
    buildSubjectLevelPoints(rawLevelPoints);

  // Level periods are always the primary AY only, so reuse `periods`.
  const termDeltas = computeTermDelta(levelPoints);
  const watchRowsByLevel = getWatchRowsByLevel(levelPoints, periods);
  const failingTail = computeFailingTailBySubject(rawLevelPoints, periods);

  // ── Grade distribution token-bar ─────────────────────────────────────────
  const maxBand = (gradeDist ?? []).reduce((m, b) => Math.max(m, b.count), 0);
  const compareMaxBand = (compareGradeDist ?? []).reduce(
    (m, b) => Math.max(m, b.count),
    0
  );
  const hasCompareDistData =
    compareAy !== null &&
    compareGradeDist !== null &&
    compareGradeDist.some((b) => b.count > 0);

  // ── Throughput ────────────────────────────────────────────────────────────
  const crs = changeRequests;
  const haveVelocity = velocity.current.length > 1;

  // ──────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from live computed values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded subject names, level codes, or "worst" in literals.
  // ──────────────────────────────────────────────────────────────────────────

  // Ch1 — lede: most-regressed (subject × level) pair, guarded by magnitude.
  // `termDeltas` is sorted ascending by delta (biggest regression first).
  const biggestRegression = termDeltas[0] ?? null;
  const showRegression =
    biggestRegression !== null &&
    meetsThreshold(-biggestRegression.delta, REGRESSION_MIN_PTS);

  const ledeDescription = showRegression
    ? `${biggestRegression.subjectName} (${biggestRegression.levelCode}) fell ${Math.abs(biggestRegression.delta).toFixed(1)} pts from ${biggestRegression.fromPeriod} to ${biggestRegression.toPeriod} — the biggest drop across all subjects and levels.`
    : 'How students are performing in graded subjects, which subjects need attention, and how steadily grades are moving across the year.';

  // Ch1 — §1 grade-distribution title: names the dominant lower band when it
  // accounts for a notable share, neutral otherwise.
  const worstBand = pickExtreme(
    (gradeDist ?? []).filter((b) => !TOP_BAND_KEYS.has(b.key)),
    (b) => b.count,
    'max'
  );
  const worstBandIsLarge =
    !worstBand.isTie &&
    worstBand.item !== null &&
    totalGraded > 0 &&
    meetsThreshold((worstBand.value ?? 0) / totalGraded, 0.25);
  const distTitle = worstBandIsLarge
    ? `${worstBand.item!.label} is the largest band`
    : 'Grade distribution';

  // Ch2 — subjects-to-watch title: worst subject in the watchlist (guard: list
  // must be non-empty and no tie with the second-worst avg).
  const worstWatchRow = watchRows[0] ?? null;
  const watchTie =
    watchRows.length > 1 && watchRows[0].avgGrade === watchRows[1].avgGrade;
  const showWorstWatch = worstWatchRow !== null && !watchTie;
  const watchTitle = showWorstWatch
    ? `${worstWatchRow.subjectName} averages lowest in ${latestPeriodWithData ?? 'the latest term'}`
    : 'Subjects to watch';

  // Ch2 — term-over-term regression callout (same as lede, reused in the
  // Subjects to watch section for in-context callout).
  const regressionCalloutText = showRegression
    ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) dropped ${Math.abs(biggestRegression!.delta).toFixed(1)} pts from ${biggestRegression!.fromPeriod} to ${biggestRegression!.toPeriod}.`
    : null;

  // Ch2 — failing-tail callout: worst subject (largest failing %) guarded by
  // minimum threshold.
  const worstTail = pickExtreme(failingTail, (r) => r.failingPct, 'max');
  const showWorstTail =
    !worstTail.isTie &&
    worstTail.item !== null &&
    meetsThreshold(worstTail.value, FAILING_TAIL_MIN_PCT);
  const tailCalloutText = showWorstTail
    ? `${worstTail.item!.subjectName} — ${worstTail.item!.failingPct}% of entries in ${worstTail.item!.periodLabel} landed below 80.`
    : null;

  // Ch3 — grading bottleneck: pending CRs or unlocked overdue sheets.
  const pendingCrs = crs?.byStatus.pending ?? 0;
  const unlockedSheets = lockProgress.reduce((s, t) => s + t.open, 0);
  const showCrBottleneck = meetsThreshold(pendingCrs, PENDING_CR_MIN);
  const throughputTitle = showCrBottleneck
    ? `${pendingCrs} change request${pendingCrs === 1 ? '' : 's'} awaiting a decision`
    : unlockedSheets > 0
      ? `${unlockedSheets} grading sheet${unlockedSheets === 1 ? '' : 's'} still open`
      : 'Grading throughput';

  return (
    <PageShell>
      <Link
        href={`/markbook?ay=${encodeURIComponent(selectedAy)}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Markbook
      </Link>

      <DashboardHero
        eyebrow="Markbook · Insights"
        title="Academic Performance"
        description={ledeDescription}
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

      {/* ═══ Chapter 1 — How they're performing ═══
          Performance headline, subject trend across terms, grade distribution. */}
      <div className="space-y-8 border-t-2 border-brand-indigo/25 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-indigo">
            Chapter 1
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            How they&rsquo;re performing
          </h2>
        </div>

        {/* 1a — Performance headline: total graded + top-band share. */}
        <InsightsSection
          eyebrow="Performance"
          title="How are students doing?"
          description={
            totalGraded === 0
              ? 'No quarterly grades recorded yet for the current term — performance fills in as teachers enter grades.'
              : 'Quarterly grades recorded for the current term, and the share scoring in the top bands.'
          }
        >
          {/* Two cards only — "Change requests pending" lives in the Grading
              throughput chapter below, with its full context (filed / pending /
              avg-decision); duplicating it here read as redundant. */}
          <section className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Grades recorded"
              value={totalGraded}
              icon={ClipboardCheck}
              intent="default"
              subtext="quarterly grades in the current term"
            />
            <MetricCard
              label="In the top bands"
              value={topBandPct ?? 0}
              format="percent"
              icon={BarChart3}
              intent={
                topBandPct === null
                  ? 'default'
                  : topBandPct >= 50
                    ? 'good'
                    : 'default'
              }
              subtext={topBandDelta ? undefined : 'scoring 85 and above'}
              delta={topBandDelta ?? undefined}
              deltaGoodWhen="up"
              deltaFormat="absolute"
              deltaUnit="pp"
              comparisonLabel={
                topBandDelta && compareAy
                  ? `vs ${compareAy} · ${compareTopBandPct}%`
                  : undefined
              }
            />
          </section>
        </InsightsSection>

        {/* 1b — Subject performance trend across terms. */}
        {haveTrend ? (
          <InsightsSection
            eyebrow="Trend"
            title="How does performance move across terms?"
            description="Average quarterly grade per examinable subject, term by term — the shape behind the headline."
          >
            <Card className="@container/card">
              <CardHeader className="space-y-1">
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Average quarterly grade
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Subject performance — {selectedAy}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {latestOverallAvg !== null && (
                  <TrendDeltaCaption
                    value={latestOverallAvg.toString()}
                    caption={`overall average in ${latestPeriodWithData}`}
                    delta={trendCaptionDelta}
                  />
                )}
                <GroupedBarChart
                  series={trendBarSeries}
                  data={trendBarData}
                  yFormat="number"
                  yDomain={[0, 100]}
                  height={280}
                />
              </CardContent>
            </Card>
          </InsightsSection>
        ) : null}

        {/* 1c — Grade distribution. */}
        <InsightsSection
          eyebrow="Distribution"
          title="Where do the grades land?"
          description="The spread of quarterly grades across mastery bands for the current term."
        >
          {totalGraded === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No quarterly grades recorded yet for the current term — nothing
                to chart.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Quarterly grades by band
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {distTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Primary AY distribution */}
                <ul className="space-y-3">
                  {(gradeDist ?? []).map((band) => {
                    const widthPct =
                      maxBand > 0
                        ? Math.max(
                            band.count > 0 ? 4 : 0,
                            Math.round((band.count / maxBand) * 100)
                          )
                        : 0;
                    const isTop = TOP_BAND_KEYS.has(band.key);
                    return (
                      <li key={band.key} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">
                            {band.label}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {band.count.toLocaleString('en-SG')}
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={
                              'h-full rounded-full bg-gradient-to-r ' +
                              (isTop
                                ? 'from-brand-mint to-brand-sky'
                                : 'from-brand-indigo to-brand-navy')
                            }
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Comparison AY distribution — subordinated, shown only when data exists */}
                {compareAy && !hasCompareDistData ? (
                  <BuildingHistoryCard
                    variant="no-data"
                    label={`No data for ${compareAy}`}
                  />
                ) : hasCompareDistData ? (
                  <div className="border-t border-border pt-4">
                    <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {compareAy} distribution
                    </p>
                    <ul className="space-y-3 opacity-70">
                      {(compareGradeDist ?? []).map((band) => {
                        const widthPct =
                          compareMaxBand > 0
                            ? Math.max(
                                band.count > 0 ? 4 : 0,
                                Math.round((band.count / compareMaxBand) * 100)
                              )
                            : 0;
                        const isTop = TOP_BAND_KEYS.has(band.key);
                        return (
                          <li key={band.key} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-muted-foreground">
                                {band.label}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {band.count.toLocaleString('en-SG')}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={
                                  'h-full rounded-full bg-gradient-to-r opacity-60 ' +
                                  (isTop
                                    ? 'from-brand-mint to-brand-sky'
                                    : 'from-brand-indigo to-brand-navy')
                                }
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 1 ═══ */}

      {/* ═══ Chapter 2 — Subjects to watch ═══
          Per-subject + per-level diagnostic layer: lowest averages, term-over-
          term regression, and the share of entries scoring below 80. */}
      <div className="space-y-8 border-t-2 border-brand-amber/30 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-amber">
            Chapter 2
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Subjects to watch
          </h2>
        </div>

        {/* 2a — School-wide lowest-averaging subjects in the latest term. */}
        <InsightsSection
          eyebrow="Watchlist"
          title="Which subjects need attention?"
          description={
            latestPeriodWithData
              ? `The lowest-averaging examinable subjects in ${latestPeriodWithData} — the first place to look when performance dips.`
              : 'The lowest-averaging examinable subjects, once grades are recorded.'
          }
        >
          {watchRows.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                Not enough graded subjects yet to rank — this fills in as grades
                are entered.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Lowest average · {latestPeriodWithData}
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {watchTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {watchRows.map((r) => {
                    const avg = r.avgGrade ?? 0;
                    // Bar fills against a 100-point scale; lower = shorter.
                    const widthPct = Math.max(4, Math.round(avg));
                    return (
                      <li key={r.subjectName} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">
                            {r.subjectName}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {avg.toFixed(1)} avg
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
                  })}
                </ul>
                {/* Callout (watch): the lowest subject, guarded against a tie. */}
                {showWorstWatch ? (
                  <RecommendationCallout tone="watch">
                    {worstWatchRow!.subjectName} averaged{' '}
                    {worstWatchRow!.avgGrade?.toFixed(1)} in{' '}
                    {latestPeriodWithData ?? 'the latest term'} — lowest across
                    all recorded subjects.
                  </RecommendationCallout>
                ) : null}
              </CardContent>
            </Card>
          )}
        </InsightsSection>

        {/* 2b — Per-level breakdown in the latest term. */}
        {watchRowsByLevel.length > 0 ? (
          <InsightsSection
            eyebrow="By level"
            title="Which levels are struggling?"
            description={`The lowest-averaging subject per level in ${latestPeriodWithData ?? 'the latest term'} — narrows school-wide signals to individual year groups.`}
          >
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Lowest subject per level · {latestPeriodWithData}
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Level breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="pb-2 pr-3 font-semibold">Level</th>
                      <th className="pb-2 pr-3 font-semibold">
                        Lowest subject
                      </th>
                      <th className="pb-2 text-right font-semibold tabular-nums">
                        Avg
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {watchRowsByLevel.map((r) => (
                      <tr key={`${r.levelCode}-${r.subjectName}`}>
                        <td className="py-2 pr-3 font-mono text-xs font-semibold text-muted-foreground">
                          {r.levelCode}
                        </td>
                        <td className="py-2 pr-3 font-medium text-foreground">
                          {r.subjectName}
                        </td>
                        <td className="py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {r.avgGrade?.toFixed(1) ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </InsightsSection>
        ) : null}

        {/* 2c — Term-over-term regression (Δ per subject × level). */}
        {termDeltas.length > 0 ? (
          <InsightsSection
            eyebrow="Regression"
            title="Which subjects are falling over time?"
            description="Term-over-term change per subject and level — negative delta means the average fell from the earliest to the latest recorded term."
          >
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Δ from first to latest recorded term
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {showRegression
                    ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) fell the most`
                    : 'Term-over-term movement'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <th className="pb-2 pr-3 font-semibold">Subject</th>
                      <th className="pb-2 pr-3 font-semibold">Level</th>
                      <th className="pb-2 pr-2 text-right font-semibold tabular-nums">
                        From
                      </th>
                      <th className="pb-2 pr-2 text-right font-semibold tabular-nums">
                        To
                      </th>
                      <th className="pb-2 text-right font-semibold tabular-nums">
                        Δ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {termDeltas.slice(0, 10).map((d) => {
                      const isRegression = d.delta < 0;
                      return (
                        <tr key={`${d.subjectName}-${d.levelCode}`}>
                          <td className="py-2 pr-3 font-medium text-foreground">
                            {d.subjectName}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                            {d.levelCode}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {d.firstAvg.toFixed(1)}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-foreground">
                            {d.lastAvg.toFixed(1)}
                          </td>
                          <td
                            className={
                              isRegression
                                ? 'py-2 text-right font-mono text-xs font-semibold tabular-nums text-brand-amber'
                                : 'py-2 text-right font-mono text-xs tabular-nums text-brand-mint'
                            }
                          >
                            {d.delta >= 0 ? '+' : ''}
                            {d.delta.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Callout (watch): the biggest regression, quantified. */}
                {regressionCalloutText ? (
                  <RecommendationCallout tone="watch">
                    {regressionCalloutText}
                  </RecommendationCallout>
                ) : null}
              </CardContent>
            </Card>
          </InsightsSection>
        ) : null}

        {/* 2d — Failing tail: share of entries below 80 per subject. */}
        {failingTail.length > 0 ? (
          <InsightsSection
            eyebrow="At-risk"
            title="Where are students scoring below 80?"
            description={`Share of entries in the failing bands (below 80) per subject in ${failingTail[0]?.periodLabel ?? 'the latest term'}.`}
          >
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  % entries below 80 · {failingTail[0]?.periodLabel}
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {showWorstTail
                    ? `${worstTail.item!.subjectName} has the largest at-risk share`
                    : 'Failing tail by subject'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {failingTail.slice(0, 8).map((r) => {
                    const widthPct = Math.max(
                      r.failingCount > 0 ? 4 : 0,
                      Math.round(r.failingPct)
                    );
                    return (
                      <li key={r.subjectName} className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="font-medium text-foreground">
                            {r.subjectName}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {r.failingCount} / {r.totalCount} (
                            {r.failingPct.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-amber/70 to-brand-amber/40"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {/* Callout (watch): worst-tail subject when it clears the threshold. */}
                {tailCalloutText ? (
                  <RecommendationCallout tone="watch">
                    {tailCalloutText}
                  </RecommendationCallout>
                ) : null}
              </CardContent>
            </Card>
          </InsightsSection>
        ) : null}
      </div>
      {/* ═══ end Chapter 2 ═══ */}

      {/* ═══ Chapter 3 — Grading throughput ═══
          Change-request turnaround, sheet-lock readiness, publication coverage,
          and grade-entry velocity — the operational pulse behind the grades. */}
      <div className="space-y-8 border-t-2 border-brand-mint/40 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-mint">
            Chapter 3
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Grading throughput
          </h2>
        </div>

        <InsightsSection
          eyebrow="Throughput"
          title="How steadily is grading moving?"
          description="Change-request turnaround, how many sheets are locked per term, and how widely report cards are published — the operational pulse behind the grades."
        >
          {crs ? (
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Change requests (30d)"
                value={crs.total}
                icon={GitPullRequestArrow}
                intent="default"
                subtext="post-lock edits filed in the last 30 days"
              />
              <MetricCard
                label="Pending decisions"
                value={crs.byStatus.pending}
                icon={ClipboardCheck}
                intent={crs.byStatus.pending > 0 ? 'warning' : 'good'}
                subtext="awaiting an approver"
              />
              <MetricCard
                label="Avg decision time"
                value={crs.avgDecisionHours ?? 0}
                format="hours"
                icon={Timer}
                intent="default"
                subtext={
                  crs.avgDecisionHours === null
                    ? 'no decisions in the window'
                    : 'from request to decision'
                }
              />
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <Lock className="size-3" strokeWidth={2.25} />
                  Sheets locked · per term
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  {throughputTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {lockProgress.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No grading sheets created yet for this year.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-3">
                      {lockProgress.map((t) => {
                        const total = t.locked + t.open;
                        const pct =
                          total > 0
                            ? Math.max(
                                t.locked > 0 ? 4 : 0,
                                Math.round((t.locked / total) * 100)
                              )
                            : 0;
                        return (
                          <li key={t.termNumber} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {t.termLabel}
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {t.locked.toLocaleString('en-SG')} / {total}{' '}
                                locked
                              </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-brand-mint to-brand-sky"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {/* Callout (act): pending CRs are a bottleneck that needs a
                        decision. Guard: must clear PENDING_CR_MIN. */}
                    {showCrBottleneck ? (
                      <RecommendationCallout tone="act">
                        {pendingCrs} change request
                        {pendingCrs === 1 ? '' : 's'} still awaiting a decision
                        — grades locked pending approval.
                      </RecommendationCallout>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <FileCheck2 className="size-3" strokeWidth={2.25} />
                  Report cards published · per term
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Publication coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pubCoverage.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No sections to publish for yet this year.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {pubCoverage.map((t) => {
                      const pct =
                        t.sections > 0
                          ? Math.max(
                              t.published > 0 ? 4 : 0,
                              Math.round((t.published / t.sections) * 100)
                            )
                          : 0;
                      return (
                        <li key={t.termNumber} className="space-y-1.5">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-foreground">
                              {t.termLabel}
                            </span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {t.published.toLocaleString('en-SG')} /{' '}
                              {t.sections} sections
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-brand-indigo to-brand-navy"
                              style={{ width: `${pct}%` }}
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

          {haveVelocity ? (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Grade entries per day
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Grading velocity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart label="Entries" current={velocity.current} />
              </CardContent>
            </Card>
          ) : null}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 3 ═══ */}

      {/* Seasonal: building history. */}
      <InsightsSection
        eyebrow="Seasonal"
        title="When does performance shift?"
        description="Term-over-term and year-over-year academic patterns reveal the predictable peaks and dips."
      >
        <BuildingHistoryCard
          label="Seasonal performance"
          detail="Term-over-term and year-over-year academic trends sharpen once more history is on record."
        />
      </InsightsSection>

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <BarChart3 className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Academic performance</span>
        <span className="text-border">·</span>
        <span>Refreshes every minute</span>
        {compareAy ? (
          <>
            <span className="text-border">·</span>
            <span>Comparing with {compareAy}</span>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
