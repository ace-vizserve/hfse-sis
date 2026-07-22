import {
  Activity,
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Filter,
  GitPullRequestArrow,
  GraduationCap,
  Lock,
  TrendingDown,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';

import {
  CategoryLineChart,
  type CategoryLinePoint,
} from '@/components/dashboard/charts/category-line-chart';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { MetricCard } from '@/components/dashboard/metric-card';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
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
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { buildCompareCells } from '@/lib/dashboard/compare';
import { resolveCompareAy } from '@/lib/dashboard/comparison';
import { meetsThreshold } from '@/lib/dashboard/narrative';
import { type DashboardSearchParams } from '@/lib/dashboard/range';
import { summariseSeriesMovement } from '@/lib/dashboard/trend-delta';
import {
  getChangeRequestSummary,
  getGradeDistribution,
  getSheetLockProgressByTerm,
} from '@/lib/markbook/dashboard';
import {
  getSubjectLevelTrend,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
  type SubjectTrendPoint,
} from '@/lib/markbook/compare';
import {
  buildMultiAyTrend,
  selectTopMovementSubjects,
  topBandBadge,
} from '@/lib/markbook/insights-compare';
import {
  buildSubjectLevelPoints,
  computeTermDelta,
  highlightedLockTermNumber,
  selectTopRegressionMovers,
  type SubjectLevelTrendPoint,
} from '@/lib/markbook/insights-level';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

// The two top bands ("very satisfactory" 85–89 + "outstanding" 90–100) are the
// "top performing" share we headline. Keyed off GRADE_BANDS so it tracks any
// future band re-definition.
const TOP_BAND_KEYS = new Set(['vs', 'o']);

const REGRESSION_MIN_PTS = 3;
const PENDING_CR_MIN = 3;
const TOP_SUBJECT_LIMIT = 5;
// Up to this many (subject × level) pairs plotted in the term-over-term
// movement chart, selected by |delta| via selectTopRegressionMovers.
const REGRESSION_CHART_LIMIT = 6;

// ── Page-local presentation helpers — same shell the other Insights pages
// use (mono cap + serif title + gradient icon tile). ────────────────────────

function InsightChartCard({
  cap,
  title,
  icon: Icon,
  action,
  children,
}: {
  cap: string;
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
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
        <CardAction>
          {action ?? (
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          )}
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

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
  // (uuid), the rest by code. Also resolve the comparison AY's UUID when set.
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

  // Subject-performance trend needs term cells (termId + termNumber). Include
  // both AYs when a comparison is set. getSubjectPerformanceTrend reads only
  // cell.{termId,termNumber,ayCode} — the `data` payload is irrelevant.
  const [trendCells, levelTrendCells] = await Promise.all([
    buildCompareCells({
      kind: 'term',
      ays: compareAy ? [selectedAy, compareAy] : [selectedAy],
      terms: [1, 2, 3, 4],
    }),
    // Level breakdown always uses the primary AY only — comparison AY context
    // is for the school-wide trend chart; the level watchlist is diagnostic.
    buildCompareCells({ kind: 'term', ays: [selectedAy], terms: [1, 2, 3, 4] }),
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
    rawLevelPoints,
  ] = await Promise.all([
    ayId ? getGradeDistribution(ayId) : Promise.resolve(null),
    compareAy && compareAyId
      ? getGradeDistribution(compareAyId)
      : Promise.resolve(null),
    getSubjectPerformanceTrend(trendCellResults),
    getChangeRequestSummary(selectedAy, 30),
    ayId ? getSheetLockProgressByTerm(ayId) : Promise.resolve([]),
    getSubjectLevelTrend(levelTrendCellResults),
  ]);

  // Headline: total graded + share in the top band(s).
  const totalGraded = (gradeDist ?? []).reduce((s, b) => s + b.count, 0);
  const topBandCount = (gradeDist ?? [])
    .filter((b) => TOP_BAND_KEYS.has(b.key))
    .reduce((s, b) => s + b.count, 0);
  const topBandPct =
    totalGraded > 0 ? Math.round((topBandCount / totalGraded) * 100) : null;

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

  // Term periods across whichever AYs are in scope — shared x-axis.
  const periods = [
    ...new Set(
      trendCells
        .map((c) => (c.termNumber ? `T${c.termNumber}` : null))
        .filter((p): p is string => p !== null)
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  // ── Subjects to watch (school-wide) ────────────────────────────────────────
  const primaryTrendPoints = trendPoints.filter((p) => p.ayCode === selectedAy);
  const latestPeriodWithData = [...periods]
    .reverse()
    .find((p) => primaryTrendPoints.some((pt) => pt.periodLabel === p));

  // ── Performance trend chart, top-N-by-movement bars (current-AY only) ──────
  const topMovementSubjects = selectTopMovementSubjects(
    primaryTrendPoints,
    periods,
    TOP_SUBJECT_LIMIT
  );
  const totalSubjectCount = new Set(
    primaryTrendPoints.map((p) => p.subjectName)
  ).size;
  const { data: trendBarData, series: trendBarSeries } = buildMultiAyTrend(
    primaryTrendPoints.filter((p) =>
      topMovementSubjects.includes(p.subjectName)
    ),
    periods,
    [selectedAy]
  );

  const haveTrend = primaryTrendPoints.length > 0 && trendBarSeries.length > 0;

  // Overall average per period across every plotted-AY subject (the honest
  // schoolwide headline behind the chart).
  const overallTrendSummary = summariseSeriesMovement(
    periods.map((period) => {
      const values = primaryTrendPoints
        .filter((p) => p.periodLabel === period && p.avgGrade !== null)
        .map((p) => p.avgGrade as number);
      return {
        x: period,
        value:
          values.length > 0
            ? Math.round(
                (values.reduce((a, b) => a + b, 0) / values.length) * 10
              ) / 10
            : null,
      };
    })
  );

  const watchRows: SubjectTrendPoint[] = latestPeriodWithData
    ? primaryTrendPoints
        .filter(
          (p) => p.periodLabel === latestPeriodWithData && p.avgGrade !== null
        )
        .sort((a, b) => (a.avgGrade ?? 0) - (b.avgGrade ?? 0))
        .slice(0, 6)
    : [];

  // ── Level-breakdown layer (primary AY only) ────────────────────────────────
  const levelPoints: SubjectLevelTrendPoint[] =
    buildSubjectLevelPoints(rawLevelPoints);
  const termDeltas = computeTermDelta(levelPoints);

  // Per-level average across its subjects in the latest period (unweighted
  // mean of subject averages — a diagnostic level signal, not an exact GA),
  // plus the mean across levels as the "school average" baseline.
  const levelAvgByLevel = (() => {
    if (!latestPeriodWithData)
      return [] as { levelCode: string; avg: number }[];
    const byLevel = new Map<string, number[]>();
    for (const p of levelPoints) {
      if (p.periodLabel !== latestPeriodWithData || p.avgGrade === null)
        continue;
      const arr = byLevel.get(p.levelCode) ?? [];
      arr.push(p.avgGrade);
      byLevel.set(p.levelCode, arr);
    }
    return [...byLevel.entries()].map(([levelCode, avgs]) => ({
      levelCode,
      avg:
        Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10,
    }));
  })();
  const schoolAvgAcrossLevels =
    levelAvgByLevel.length > 0
      ? Math.round(
          (levelAvgByLevel.reduce((s, l) => s + l.avg, 0) /
            levelAvgByLevel.length) *
            10
        ) / 10
      : 0;

  // ── Throughput ────────────────────────────────────────────────────────────
  const crs = changeRequests;

  // ──────────────────────────────────────────────────────────────────────────
  // Derived narrative — templated from live values with neutral fallbacks.
  // ──────────────────────────────────────────────────────────────────────────

  // `termDeltas` is sorted ascending by delta (biggest regression first).
  const biggestRegression = termDeltas[0] ?? null;
  const showRegression =
    biggestRegression !== null &&
    meetsThreshold(-biggestRegression.delta, REGRESSION_MIN_PTS);

  const ledeDescription = showRegression
    ? `${biggestRegression.subjectName} (${biggestRegression.levelCode}) fell ${Math.abs(biggestRegression.delta).toFixed(1)} pts from ${biggestRegression.fromPeriod} to ${biggestRegression.toPeriod} — the biggest drop across all subjects and levels.`
    : 'How students are performing in graded subjects, which subjects need attention, and how steadily grades are moving across the year.';

  const worstWatchRow = watchRows[0] ?? null;
  const watchTie =
    watchRows.length > 1 && watchRows[0].avgGrade === watchRows[1].avgGrade;
  const showWorstWatch = worstWatchRow !== null && !watchTie;
  const watchTitle = showWorstWatch
    ? `${worstWatchRow.subjectName} averages lowest in ${latestPeriodWithData ?? 'the latest term'}`
    : 'Subjects to watch';

  const regressionCalloutText = showRegression
    ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) dropped ${Math.abs(biggestRegression!.delta).toFixed(1)} pts from ${biggestRegression!.fromPeriod} to ${biggestRegression!.toPeriod}.`
    : null;

  const pendingCrs = crs?.byStatus.pending ?? 0;
  const unlockedSheets = lockProgress.reduce((s, t) => s + t.open, 0);
  const showCrBottleneck = meetsThreshold(pendingCrs, PENDING_CR_MIN);
  const throughputTitle = showCrBottleneck
    ? `${pendingCrs} change request${pendingCrs === 1 ? '' : 's'} awaiting a decision`
    : unlockedSheets > 0
      ? `${unlockedSheets} grading sheet${unlockedSheets === 1 ? '' : 's'} still open`
      : 'Grading throughput';

  // ── Chart-data derivations ─────────────────────────────────────────────────

  // Subjects to watch — avg per subject, worst-first (watchRows is already
  // sorted ascending by avg) as a ranked horizontal bar. The old per-bar
  // quality-ramp colour is dropped (single hue) — these are the LOW subjects
  // by construction, and the worst-first order + exact averages carry it.
  const watchBarData: ComparisonBarPoint[] = watchRows.map((r) => ({
    category: r.subjectName,
    current: Math.round((r.avgGrade ?? 0) * 10) / 10,
  }));

  // Which levels are struggling — the actual average grade traced across the
  // level progression P1→P6→S1→S4 (natural code order), with the school
  // average drawn as a reference line. Real grades on the line + a "below the
  // line = struggling" reference read far clearer than a delta-from-average.
  const levelLineData: CategoryLinePoint[] = [...levelAvgByLevel]
    .sort((a, b) =>
      a.levelCode.localeCompare(b.levelCode, undefined, { numeric: true })
    )
    .map((l) => ({ x: l.levelCode, y: l.avg }));

  // Term-over-term movement — paired First→Latest bars per (subject × level):
  // the actual first-term grade (comparison, muted) beside the latest-term
  // grade (current). "Fell the most" reads as the current bar being visibly
  // shorter than its first-term bar — actual grades, not an abstract delta.
  // Biggest decline first.
  const regressionMovers = selectTopRegressionMovers(
    termDeltas,
    REGRESSION_CHART_LIMIT
  );
  const regressionPairData: ComparisonBarPoint[] = [...regressionMovers]
    .sort((a, b) => a.delta - b.delta)
    .map((d) => ({
      category: `${d.subjectName} · ${d.levelCode}`,
      current: Math.round(d.lastAvg * 10) / 10,
      comparison: Math.round(d.firstAvg * 10) / 10,
    }));

  // Sheets locked · per term — lock % per term as a single-series grouped bar,
  // with the term to highlight (KD-style: the earliest term still with open
  // sheets) dimmed-vs-emphasised via GroupedBarChart's highlightX.
  const highlightTermNumber = highlightedLockTermNumber(lockProgress);
  const highlightTermLabel =
    lockProgress.find((t) => t.termNumber === highlightTermNumber)?.termLabel ??
    undefined;
  const lockBarData = lockProgress.map((t) => {
    const total = t.locked + t.open;
    return {
      x: t.termLabel,
      locked: total > 0 ? Math.round((t.locked / total) * 100) : 0,
    };
  });
  const LOCK_SERIES = [
    { key: 'locked', label: 'Sheets locked', color: 'var(--color-brand-mint)' },
  ];

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

      {/* ═══ Academic performance ═══ */}
      <div className="space-y-5 pt-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
          Academic performance
        </p>

        {/* Subject performance trend, full width. */}
        {haveTrend ? (
          <InsightChartCard
            cap={
              totalSubjectCount > topMovementSubjects.length
                ? `${topMovementSubjects.length} of ${totalSubjectCount} subjects · those that moved most across the terms`
                : 'Average quarterly grade per examinable subject, term by term'
            }
            title="How does performance move across terms?"
            icon={Activity}
          >
            {overallTrendSummary.currentValue !== null && (
              <TrendDeltaCaption
                value={overallTrendSummary.currentValue.toString()}
                caption={`overall average in ${overallTrendSummary.periodLabel}`}
                delta={overallTrendSummary.delta ?? undefined}
                className="mb-4"
              />
            )}
            <GroupedBarChart
              series={trendBarSeries}
              data={trendBarData}
              yFormat="number"
              yDomain={[60, 100]}
              height={280}
              highlightX={overallTrendSummary.periodLabel ?? undefined}
            />
          </InsightChartCard>
        ) : null}

        {/* Subjects to watch — full-width row. */}
        <InsightChartCard
          cap={
            latestPeriodWithData
              ? `Lowest average · ${latestPeriodWithData}`
              : 'Lowest average'
          }
          title={watchTitle}
          icon={TrendingDown}
        >
          {watchBarData.length === 0 ? (
            <EmptyChartState message="Not enough graded subjects yet to rank — this fills in as grades are entered." />
          ) : (
            <>
              <ComparisonBarChart
                data={watchBarData}
                orientation="horizontal"
                yFormat="number"
                height={Math.max(200, watchBarData.length * 42 + 40)}
              />
              {showWorstWatch ? (
                <RecommendationCallout tone="watch" className="mt-5">
                  {worstWatchRow!.subjectName} averaged{' '}
                  {worstWatchRow!.avgGrade?.toFixed(1)} in{' '}
                  {latestPeriodWithData ?? 'the latest term'} — lowest across
                  all recorded subjects.
                </RecommendationCallout>
              ) : null}
            </>
          )}
        </InsightChartCard>

        {/* Which levels are struggling — full-width row, actual average grade
            traced across the level progression, vs a school-average line. */}
        {levelLineData.length > 0 ? (
          <InsightChartCard
            cap={`Average grade per level · ${latestPeriodWithData}`}
            title="Which levels are struggling?"
            icon={GraduationCap}
          >
            <CategoryLineChart
              data={levelLineData}
              yFormat="number"
              referenceValue={schoolAvgAcrossLevels}
              referenceLabel={`School avg ${schoolAvgAcrossLevels}`}
              height={280}
            />
          </InsightChartCard>
        ) : null}

        {/* Term-over-term movement, full width — first-term vs latest-term
            actual grades side by side. */}
        {regressionPairData.length > 0 ? (
          <InsightChartCard
            cap="First term vs latest recorded term · actual averages"
            title={
              showRegression
                ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) fell the most`
                : 'Term-over-term movement'
            }
            icon={TrendingDown}
          >
            <ComparisonBarChart
              data={regressionPairData}
              orientation="horizontal"
              yFormat="number"
              height={Math.max(220, regressionPairData.length * 48 + 48)}
            />
            {regressionCalloutText ? (
              <RecommendationCallout tone="watch" className="mt-5">
                {regressionCalloutText}
              </RecommendationCallout>
            ) : null}
          </InsightChartCard>
        ) : null}
      </div>
      {/* ═══ end Academic performance ═══ */}

      {/* ═══ Grading throughput ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Grading throughput
        </p>

        {crs ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Change requests (30d)"
              value={crs.total}
              format="number"
              icon={GitPullRequestArrow}
              subtext="Post-lock edits filed"
            />
            <MetricCard
              label="Pending decisions"
              value={crs.byStatus.pending}
              format="number"
              icon={ClipboardCheck}
              subtext="Awaiting an approver"
            />
            <MetricCard
              label="Avg decision time"
              value={
                crs.avgDecisionHours === null ? '—' : `${crs.avgDecisionHours}h`
              }
              format="raw"
              icon={Timer}
              subtext={
                crs.avgDecisionHours === null
                  ? 'No decisions in the window'
                  : 'Request to decision'
              }
            />
          </section>
        ) : null}

        {/* Sheets locked · per term. */}
        <InsightChartCard
          cap="Sheets locked · per term"
          title={throughputTitle}
          icon={Lock}
        >
          {lockBarData.length === 0 ? (
            <EmptyChartState message="No grading sheets created yet for this year." />
          ) : (
            <>
              <GroupedBarChart
                series={LOCK_SERIES}
                data={lockBarData}
                yFormat="percent"
                yDomain={[0, 100]}
                showValueLabels
                height={220}
                highlightX={highlightTermLabel}
              />
              {showCrBottleneck ? (
                <RecommendationCallout tone="act" className="mt-4">
                  {pendingCrs} change request{pendingCrs === 1 ? '' : 's'} still
                  awaiting a decision — grades locked pending approval.
                </RecommendationCallout>
              ) : null}
            </>
          )}
        </InsightChartCard>
      </div>
      {/* ═══ end Grading throughput ═══ */}

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
