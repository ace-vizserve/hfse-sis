import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ClipboardCheck,
  FileCheck2,
  GitPullRequestArrow,
  Lock,
  Minus,
  Timer,
  TrendingDown,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
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
  const { data: trendData, series: trendSeries } = buildMultiAyTrend(
    trendPoints,
    periods,
    trendAys
  );
  const haveTrend = trendPoints.length > 0 && trendSeries.length > 0;

  // ── Subjects to watch ─────────────────────────────────────────────────────
  // From the LATEST term that has any trend data in the PRIMARY AY, the lowest-
  // averaging subjects. Always primary-AY only — comparison is context, not the
  // target of the watchlist.
  const primaryTrendPoints = trendPoints.filter((p) => p.ayCode === selectedAy);
  const latestPeriodWithData = [...periods]
    .reverse()
    .find((p) => primaryTrendPoints.some((pt) => pt.periodLabel === p));
  const watchRows: SubjectTrendPoint[] = latestPeriodWithData
    ? primaryTrendPoints
        .filter(
          (p) => p.periodLabel === latestPeriodWithData && p.avgGrade !== null
        )
        .sort((a, b) => (a.avgGrade ?? 0) - (b.avgGrade ?? 0))
        .slice(0, 6)
    : [];

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
        description="How students are performing in graded subjects, which subjects need attention, and how steadily grades are entered, locked, and published across the year."
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

      {/* 1 — Performance headline: total graded + top-band share. */}
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
            throughput section below, with its full context (filed / pending /
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

      {/* 2 — Subject performance trend across terms. */}
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
                Subject performance —{' '}
                {compareAy ? `${selectedAy} vs ${compareAy}` : selectedAy}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MultiSeriesTrendChart
                series={trendSeries}
                data={trendData}
                yFormat="number"
                yDomain={[0, 100]}
                height={280}
              />
            </CardContent>
          </Card>
        </InsightsSection>
      ) : null}

      {/* 3 — Grade distribution. */}
      <InsightsSection
        eyebrow="Distribution"
        title="Where do the grades land?"
        description="The spread of quarterly grades across mastery bands for the current term."
      >
        {totalGraded === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No quarterly grades recorded yet for the current term — nothing to
              chart.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Quarterly grades by band
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Grade distribution
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

      {/* 4 — Subjects to watch: lowest-averaging subjects in the latest term. */}
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
                Subjects to watch
              </CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        )}
      </InsightsSection>

      {/* 5 — Grading throughput: change requests + lock readiness + coverage. */}
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
                Lock readiness
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lockProgress.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No grading sheets created yet for this year.
                </p>
              ) : (
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
                            {t.locked.toLocaleString('en-SG')} / {total} locked
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
                            {t.published.toLocaleString('en-SG')} / {t.sections}{' '}
                            sections
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

      {/* 6 — Seasonal: building history. */}
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
