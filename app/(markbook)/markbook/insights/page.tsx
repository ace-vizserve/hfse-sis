import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  GitPullRequestArrow,
  GraduationCap,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
import {
  BentoCard,
  BentoGrid,
} from '@/components/dashboard/insights/bento/bento-grid';
import { StatCard } from '@/components/dashboard/insights/bento/stat-card';
import {
  RankedBar,
  type RankedBarRow,
} from '@/components/dashboard/insights/bento/ranked-bar';
import {
  PillBarChart,
  type PillBarColumn,
} from '@/components/dashboard/insights/bento/pill-bar-chart';
import { ProjectListRow } from '@/components/dashboard/insights/bento/project-list-row';
import { BadgeTooltip } from '@/components/dashboard/insights/bento/badge-tooltip';
import { qualityRampColorKey } from '@/components/dashboard/insights/bento/tokens';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { cn } from '@/lib/utils';
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
  getWatchRowsByLevel,
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

// Minimum magnitude for a regression to be called out in a RecommendationCallout.
// Below this threshold we don't claim "biggest regression" — noise, not signal.
const REGRESSION_MIN_PTS = 3;

// Minimum pending change-request count to surface a throughput bottleneck callout.
const PENDING_CR_MIN = 3;

// GroupedBarChart reads cleanly with up to 5 distinct-hue bar series; beyond
// that hues repeat and the chart tangles. Only the subjects that moved most
// across the AY's terms are plotted — the rest are named in the section copy.
const TOP_SUBJECT_LIMIT = 5;

// "Subjects to watch" ranked-bar quality-ramp cut points — 75 and 85 aren't
// hand-picked for this page; they're GRADE_BANDS' own DNM/FS boundary (75)
// and S/VS boundary (85), the same "did not meet" / "very satisfactory"
// thresholds already governing grade computation elsewhere (lib/markbook/
// dashboard.ts) — reused, not invented.
const WATCH_QUALITY_THRESHOLDS = { low: 75, high: 85 };

// "Term-over-term regression" pill-bar chart — up to this many (subject ×
// level) pairs, selected by |delta| via selectTopRegressionMovers (see that
// function's doc comment for why magnitude, not the ascending-by-delta table
// order, drives selection). 260px plot height with both the "From" and "To"
// halves independently spanning the TRUE 0-100 grade scale (not an auto-fit
// scale cropped to whatever range this AY's values cluster in) — per the
// locked mockup's own design note: bars read close in height because the
// values genuinely ARE close; the exact numbers + delta pill still carry the
// precise signal (same tradeoff already made for Population-by-level bars
// on Records Insights). zeroOffsetPx sits at the plot's vertical midpoint so
// each half gets an identical 0-100-point pixel budget; axis labels mirror
// the "up" half's ticks with a minus sign on the "down" half purely as a
// labelling convention (same convention Records' movement chart and
// Admissions' intake chart already use for their own always-positive
// up/down splits).
const REGRESSION_CHART_LIMIT = 6;
const REGRESSION_PLOT_HEIGHT_PX = 260;
const REGRESSION_ZERO_OFFSET_PX = REGRESSION_PLOT_HEIGHT_PX / 2;
const REGRESSION_AXIS_LABELS = ['100', '50', '0', '−50', '−100'];

// "Sheets locked · per term" bar chart sizing.
const LOCK_BAR_MAX_HEIGHT_PX = 130;

// ── Small page-local presentation helpers ──────────────────────────────────
// Not part of the shared bento/ library — mirrors the "mono cap + serif
// title" text block every bento card in the locked mockups carries, composed
// here from plain Tailwind (same pattern as Attendance/Admissions/Records
// Insights' own page-local SectionHeading; the ellipsis "more" affordance
// the mockup pairs with several of these headers is decorative-only in the
// mockup — no defined action — and was likewise dropped by every prior
// phase of this redesign).

function SectionHeading({ cap, title }: { cap: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {cap}
      </p>
      <p className="mt-0.5 font-serif text-base font-semibold text-foreground">
        {title}
      </p>
    </div>
  );
}

// Minimal shape buildRegressionColumns actually needs — avoids importing
// SubjectLevelDelta just for this local helper's parameter type.
type SubjectLevelTrendDeltaLike = {
  subjectName: string;
  levelCode: string;
  firstAvg: number;
  lastAvg: number;
  delta: number;
};

/**
 * Reshape the selected regression movers into PillBarChart columns. "From"
 * (the earliest recorded term's average) always renders in neutral grey — a
 * baseline value, not tied to a specific direction; "To" (the latest term's
 * average) is coloured by the pair's own sign — destructive for a decline,
 * mint for an improvement, matching the mv-legend's two "To" entries.
 * PillBarChart natively supports both a per-column colour override
 * (upColorKey/downColorKey) and a two-line "\n" label, so no primitive
 * extension was needed for this card.
 */
function buildRegressionColumns(
  movers: SubjectLevelTrendDeltaLike[]
): PillBarColumn[] {
  const pxPerGradePoint = REGRESSION_ZERO_OFFSET_PX / 100;
  return movers.map((d) => ({
    key: `${d.subjectName}-${d.levelCode}`,
    label: `${d.subjectName}\n${d.levelCode}`,
    upHeightPx: Math.round(d.firstAvg * pxPerGradePoint),
    downHeightPx: Math.round(d.lastAvg * pxPerGradePoint),
    downColorKey: d.delta < 0 ? 'destructive' : 'mint',
  }));
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

  // Subject-performance trend needs term cells (termId + termNumber). When a
  // comparison AY is selected we include both AYs so the trend chart can show
  // two series per subject. getSubjectPerformanceTrend reads only
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

  // Headline: total graded + share in the top band(s). totalGraded is only a
  // denominator here now (the "Grades recorded" stat card it used to feed was
  // cut, KD-mockup-locked decision — see the note below the hero).
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

  // Term periods across whichever AYs are in scope — the shared x-axis for
  // both the subject trend chart and the level-breakdown watchlists below.
  const periods = [
    ...new Set(
      trendCells
        .map((c) => (c.termNumber ? `T${c.termNumber}` : null))
        .filter((p): p is string => p !== null)
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  // ── Subjects to watch (school-wide, unchanged) ─────────────────────────────
  // From the LATEST term that has any trend data in the PRIMARY AY, the lowest-
  // averaging subjects. Always primary-AY only — comparison is context, not the
  // target of the watchlist.
  const primaryTrendPoints = trendPoints.filter((p) => p.ayCode === selectedAy);
  const latestPeriodWithData = [...periods]
    .reverse()
    .find((p) => primaryTrendPoints.some((pt) => pt.periodLabel === p));

  // ── Performance trend chart, top-N-by-movement bars ───────────────────────
  // A bar series per subject reads cleanly up to GroupedBarChart's 5-hue
  // budget; beyond that hues repeat and the chart tangles. So we plot only
  // the subjects that moved most from their first to their latest recorded
  // term this AY — deliberately CURRENT-AY-ONLY (the AY-over-AY read for
  // Markbook already lives in the hero's topBandBadge and on /markbook/compare).
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

  // ── Trend-section visibility gate ─────────────────────────────────────────
  // Gated on what's ACTUALLY plotted (trendBarSeries/primaryTrendPoints,
  // built current-AY-only from the top-movement subjects) — not on the raw
  // trendPoints matrix, which stays non-empty from the comparison AY alone at
  // AY rollover (current AY has no grades yet). Gating on that matrix rendered
  // an empty, axes-only chart instead of hiding the section.
  const haveTrend = primaryTrendPoints.length > 0 && trendBarSeries.length > 0;

  // Overall average per period across every plotted-AY subject (not just the
  // 5 plotted bars) — the honest schoolwide headline behind the chart.
  // summariseSeriesMovement (tested, lib/dashboard/trend-delta.ts) turns the
  // per-period points into the latest value + a first→latest movement delta
  // ("+X vs T1"), and returns delta: null on a single data point so no
  // movement is ever fabricated. Its periodLabel is by construction the same
  // "latest period with data" as `latestPeriodWithData` above.
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

  // ── Level-breakdown layer ─────────────────────────────────────────────────
  // Converts raw aggregation points (sum/count per subject×level×term) into
  // typed trend points, then derives: delta list, per-level watch rows.
  // Primary AY only (level diagnostics are current-AY specific).
  const levelPoints: SubjectLevelTrendPoint[] =
    buildSubjectLevelPoints(rawLevelPoints);

  // Level periods are always the primary AY only, so reuse `periods`.
  const termDeltas = computeTermDelta(levelPoints);
  const watchRowsByLevel = getWatchRowsByLevel(levelPoints, periods);

  // ── Throughput ────────────────────────────────────────────────────────────
  const crs = changeRequests;

  // ──────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from live computed values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded subject names, level codes, or "worst" in literals.
  // ──────────────────────────────────────────────────────────────────────────

  // Lede: most-regressed (subject × level) pair, guarded by magnitude.
  // `termDeltas` is sorted ascending by delta (biggest regression first).
  const biggestRegression = termDeltas[0] ?? null;
  const showRegression =
    biggestRegression !== null &&
    meetsThreshold(-biggestRegression.delta, REGRESSION_MIN_PTS);

  const ledeDescription = showRegression
    ? `${biggestRegression.subjectName} (${biggestRegression.levelCode}) fell ${Math.abs(biggestRegression.delta).toFixed(1)} pts from ${biggestRegression.fromPeriod} to ${biggestRegression.toPeriod} — the biggest drop across all subjects and levels.`
    : 'How students are performing in graded subjects, which subjects need attention, and how steadily grades are moving across the year.';

  // Subjects-to-watch title: worst subject in the watchlist (guard: list
  // must be non-empty and no tie with the second-worst avg).
  const worstWatchRow = watchRows[0] ?? null;
  const watchTie =
    watchRows.length > 1 && watchRows[0].avgGrade === watchRows[1].avgGrade;
  const showWorstWatch = worstWatchRow !== null && !watchTie;
  const watchTitle = showWorstWatch
    ? `${worstWatchRow.subjectName} averages lowest in ${latestPeriodWithData ?? 'the latest term'}`
    : 'Subjects to watch';

  // Term-over-term regression callout (same as lede, reused in the
  // regression pill-chart's badge tooltip + callout).
  const regressionCalloutText = showRegression
    ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) dropped ${Math.abs(biggestRegression!.delta).toFixed(1)} pts from ${biggestRegression!.fromPeriod} to ${biggestRegression!.toPeriod}.`
    : null;

  // Grading bottleneck: pending CRs or unlocked overdue sheets.
  const pendingCrs = crs?.byStatus.pending ?? 0;
  const unlockedSheets = lockProgress.reduce((s, t) => s + t.open, 0);
  const showCrBottleneck = meetsThreshold(pendingCrs, PENDING_CR_MIN);
  const throughputTitle = showCrBottleneck
    ? `${pendingCrs} change request${pendingCrs === 1 ? '' : 's'} awaiting a decision`
    : unlockedSheets > 0
      ? `${unlockedSheets} grading sheet${unlockedSheets === 1 ? '' : 's'} still open`
      : 'Grading throughput';

  // ──────────────────────────────────────────────────────────────────────────
  // Bento presentation-layer derivations — pure reshaping of the values
  // already computed above into the shared bento primitives' prop shapes.
  // No new queries, no changed data shapes.
  // ──────────────────────────────────────────────────────────────────────────

  // Subjects-to-watch ranked bar — the average IS the 0-100 width %.
  const watchRankedRows: RankedBarRow[] = watchRows.map((r) => {
    const avg = r.avgGrade ?? 0;
    return {
      key: r.subjectName,
      label: `${r.subjectName} · ${avg.toFixed(1)}`,
      pct: Math.max(4, Math.round(avg)),
      colorKey: qualityRampColorKey(avg, WATCH_QUALITY_THRESHOLDS),
    };
  });

  // Term-over-term regression pill chart — top movers by magnitude (both
  // directions), reshaped into PillBarChart columns.
  const regressionMovers = selectTopRegressionMovers(
    termDeltas,
    REGRESSION_CHART_LIMIT
  );
  const regressionColumns = buildRegressionColumns(regressionMovers);

  // Sheets-locked bar chart — per-term % + which term to visually highlight.
  const highlightTermNumber = highlightedLockTermNumber(lockProgress);

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

      <BentoGrid className="pt-2">
        {/* Throughput — 3 stat cards, opening the page (moved up from the
            bottom; only these 3 moved, "Sheets locked · per term" stays at
            the bottom). Replaces the old "Grades recorded" / "In the top
            bands" headline cards, which were cut (see report). */}
        {crs ? (
          <>
            <BentoCard span={4}>
              <StatCard
                icon={GitPullRequestArrow}
                iconGradient="indigo"
                value={crs.total.toLocaleString('en-SG')}
                label="Change requests (30d)"
                caption="Post-lock edits filed"
              />
            </BentoCard>
            <BentoCard span={4}>
              <StatCard
                icon={ClipboardCheck}
                iconGradient="amber"
                value={crs.byStatus.pending.toLocaleString('en-SG')}
                label="Pending decisions"
                caption="Awaiting an approver"
              />
            </BentoCard>
            <BentoCard span={4}>
              <StatCard
                icon={Timer}
                iconGradient="sky"
                value={
                  crs.avgDecisionHours === null
                    ? '—'
                    : `${crs.avgDecisionHours}h`
                }
                label="Avg decision time"
                caption={
                  crs.avgDecisionHours === null
                    ? 'No decisions in the window'
                    : 'Request to decision'
                }
              />
            </BentoCard>
          </>
        ) : null}

        {/* Subject performance trend, full width. */}
        {haveTrend ? (
          <BentoCard span={12}>
            <SectionHeading
              cap={
                totalSubjectCount > topMovementSubjects.length
                  ? `${topMovementSubjects.length} of ${totalSubjectCount} subjects shown · those that moved most across the terms`
                  : 'Average quarterly grade per examinable subject, term by term'
              }
              title="How does performance move across terms?"
            />
            {overallTrendSummary.currentValue !== null && (
              <TrendDeltaCaption
                value={overallTrendSummary.currentValue.toString()}
                caption={`overall average in ${overallTrendSummary.periodLabel}`}
                delta={overallTrendSummary.delta ?? undefined}
                className="mb-4"
              />
            )}
            {/* [60,100] per the approved design mock — grouped bars read
                clearly at this compressed range without the empty 0–60
                headroom a full grade-scale domain would add. */}
            <GroupedBarChart
              series={trendBarSeries}
              data={trendBarData}
              yFormat="number"
              yDomain={[60, 100]}
              height={280}
              highlightX={overallTrendSummary.periodLabel ?? undefined}
            />
          </BentoCard>
        ) : null}

        {/* Subjects to watch (true worst-first ranked bar) + which levels
            are struggling (per-level lowest subject). The level card
            auto-hides entirely when empty; the watch card always renders
            (dashed empty-state when there's nothing to rank yet) and widens
            to the full row when its companion is hidden. */}
        <BentoCard span={watchRowsByLevel.length > 0 ? 7 : 12}>
          {watchRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Not enough graded subjects yet to rank — this fills in as grades
              are entered.
            </p>
          ) : (
            <>
              <SectionHeading
                cap={`Lowest average · ${latestPeriodWithData}`}
                title={watchTitle}
              />
              <RankedBar rows={watchRankedRows} />
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
        </BentoCard>

        {watchRowsByLevel.length > 0 ? (
          <BentoCard span={5}>
            <SectionHeading
              cap={`Lowest subject per level · ${latestPeriodWithData}`}
              title="Which levels are struggling?"
            />
            <div>
              {watchRowsByLevel.map((r) => (
                <ProjectListRow
                  key={`${r.levelCode}-${r.subjectName}`}
                  icon={GraduationCap}
                  iconGradient="amber"
                  name={r.levelCode}
                  subtitle={r.subjectName}
                  value={r.avgGrade?.toFixed(1) ?? '—'}
                />
              ))}
            </div>
          </BentoCard>
        ) : null}

        {/* Term-over-term regression, full width. */}
        {termDeltas.length > 0 ? (
          <BentoCard span={12}>
            <div className="mb-1 flex items-start justify-between gap-3">
              <SectionHeading
                cap="Δ from first to latest recorded term · 0-100 grade scale"
                title={
                  showRegression
                    ? `${biggestRegression!.subjectName} (${biggestRegression!.levelCode}) fell the most`
                    : 'Term-over-term movement'
                }
              />
              {showRegression ? (
                <BadgeTooltip
                  label="Biggest drop"
                  colorKey="destructive"
                  tooltip={regressionCalloutText}
                />
              ) : null}
            </div>
            <PillBarChart
              columns={regressionColumns}
              plotHeightPx={REGRESSION_PLOT_HEIGHT_PX}
              zeroOffsetPx={REGRESSION_ZERO_OFFSET_PX}
              axisLabels={REGRESSION_AXIS_LABELS}
              legend={[
                { colorKey: 'grey', label: 'From' },
                { colorKey: 'destructive', label: 'To · declined' },
                { colorKey: 'mint', label: 'To · improved' },
              ]}
              defaultUpColorKey="grey"
              defaultDownColorKey="destructive"
            />
            {regressionCalloutText ? (
              <RecommendationCallout tone="watch" className="mt-5">
                {regressionCalloutText}
              </RecommendationCallout>
            ) : null}
          </BentoCard>
        ) : null}

        {/* Sheets locked · per term, full width, at the bottom. */}
        <BentoCard span={12}>
          <SectionHeading
            cap="Sheets locked · per term"
            title={throughputTitle}
          />
          {lockProgress.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No grading sheets created yet for this year.
            </p>
          ) : (
            <>
              <div
                className="flex items-end gap-3 pt-4"
                style={{ height: 168 }}
              >
                {lockProgress.map((t) => {
                  const total = t.locked + t.open;
                  const pct =
                    total > 0 ? Math.round((t.locked / total) * 100) : 0;
                  const isHighlighted = t.termNumber === highlightTermNumber;
                  const barHeightPx = Math.max(
                    4,
                    Math.round((pct / 100) * LOCK_BAR_MAX_HEIGHT_PX)
                  );
                  return (
                    <div
                      key={t.termNumber}
                      className="flex h-full flex-1 flex-col items-center justify-end"
                    >
                      <span className="mb-1.5 font-mono text-[11px] font-extrabold text-foreground">
                        {pct}%
                      </span>
                      <div
                        className={cn(
                          'w-full max-w-[30px] rounded-t-md rounded-b-[3px] bg-gradient-to-t from-brand-mint to-brand-sky',
                          isHighlighted
                            ? 'opacity-100 shadow-brand-tile-mint'
                            : pct === 0
                              ? 'opacity-20'
                              : 'opacity-30'
                        )}
                        style={{ height: barHeightPx }}
                      />
                      <span className="mt-2.5 text-center font-mono text-[10px] font-semibold text-muted-foreground">
                        {t.termLabel} · {t.locked.toLocaleString('en-SG')}/
                        {total.toLocaleString('en-SG')}
                      </span>
                    </div>
                  );
                })}
              </div>
              {showCrBottleneck ? (
                <RecommendationCallout tone="act" className="mt-4">
                  {pendingCrs} change request
                  {pendingCrs === 1 ? '' : 's'} still awaiting a decision —
                  grades locked pending approval.
                </RecommendationCallout>
              ) : null}
            </>
          )}
        </BentoCard>
      </BentoGrid>

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
