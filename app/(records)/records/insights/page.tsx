import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Filter,
  GraduationCap,
  Info,
  LogOut,
  Megaphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';

import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import {
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import {
  ComposedBarLineChart,
  type ComposedBarLinePoint,
} from '@/components/dashboard/charts/composed-bar-line-chart';
import {
  DonutChart,
  type DonutSlice,
} from '@/components/dashboard/charts/donut-chart';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import {
  RetentionStackedBarChart,
  type RetentionStackRow,
} from '@/components/dashboard/charts/retention-stacked-bar-chart';
import { SparklineChart } from '@/components/dashboard/charts/sparkline-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { MetricCard } from '@/components/dashboard/metric-card';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
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
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import {
  sparklineFromAyTrend,
  type AyTrendResult,
} from '@/lib/dashboard/insights-trend';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import {
  computeDelta,
  type DashboardSearchParams,
  type Delta,
} from '@/lib/dashboard/range';
import { compareLevelLabels, LEVEL_LABELS } from '@/lib/sis/levels';
import { getMovementEvents } from '@/lib/sis/movements';
import {
  getInsightsHeadcount,
  getRecordsRetention,
  getRecordsRetentionByLevel,
  growthDelta,
  isTerminalLevel,
  MONTH_LABELS,
  monthlyMovementSeries,
  rollupMovements,
  WITHDRAWAL_CONTROLLABILITY,
} from '@/lib/sis/records-insights';
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

const TERM_LABELS: Record<number, string> = {
  1: 'Term 1',
  2: 'Term 2',
  3: 'Term 3',
  4: 'Term 4',
};

// HFSE's AY calendar runs January–November (KD #13) — the monthly movement
// chart shares this 11-column axis.
const AY_MONTHS: string[] = MONTH_LABELS.slice(0, 11);

// Level-label → short code (e.g. "Primary One" → "P1") for the compact
// population-by-level bar axis — derived from the canonical LEVEL_LABELS map so
// the codes can never drift from the level catalog.
const LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LEVEL_LABELS).map(([code, label]) => [label, code])
);
function levelShortCode(label: string): string {
  return LABEL_TO_CODE[label] ?? label;
}

// Reverse lookup: humanized withdrawal-reason label → raw enum key, so each
// reason donut slice is coloured by the SAME controllability classification
// the banner above it reports (§10.2 — one source of truth for a colour).
const REASON_LABEL_TO_RAW: Record<string, WithdrawalReason> =
  Object.fromEntries(
    Object.entries(WITHDRAWAL_REASON_LABELS).map(([raw, label]) => [
      label,
      raw as WithdrawalReason,
    ])
  );
// Controllable (school can act) → destructive; structural (external) → sky;
// unspecified → grey. Real CSS custom properties only (Hard Rule #7) — never
// an interpolated colour.
function withdrawalReasonColor(reasonLabel: string): string {
  if (reasonLabel === 'Unspecified') return 'var(--color-muted-foreground)';
  const raw = REASON_LABEL_TO_RAW[reasonLabel];
  if (!raw) return 'var(--color-chart-1)';
  return WITHDRAWAL_CONTROLLABILITY[raw] === 'controllable'
    ? 'var(--color-destructive)'
    : 'var(--color-chart-3)';
}

// ── Page-local presentation helpers ─────────────────────────────────────────
// Same shell the Admissions Insights page uses — a mono cap + serif title +
// gradient icon tile Card wrapper around each chart. Page-scoped (both pages
// carry their own copy today; a future extraction can share one).

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

// A non-blank empty-state body for a chart panel (§7.6) — icon + guidance
// sentence, never a bare muted <p>.
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

// One row for the withdrawal-by-level list — level name + count + share %.
function LevelStatRow({
  name,
  detail,
  value,
}: {
  name: string;
  detail: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-1">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {name}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {detail}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[13px] font-bold text-foreground">
        {value}
      </span>
    </div>
  );
}

// Records · Insights — a narrative, read-first companion to the operational
// dashboard. Retention & Population: are we growing, who moves in and out
// across the year, do students come back, and where do late joins and
// withdrawals concentrate (KD #141).
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

  const [
    headcount,
    priorHeadcount,
    retention,
    retentionByLevel,
    movementEvents,
  ] = await Promise.all([
    getInsightsHeadcount(selectedAy),
    compareAy ? getInsightsHeadcount(compareAy) : Promise.resolve(null),
    getRecordsRetention(selectedAy, compareAy),
    getRecordsRetentionByLevel(selectedAy, compareAy),
    getMovementEvents(selectedAy),
  ]);

  const priorTotal = priorHeadcount ? priorHeadcount.total : null;
  const growth = growthDelta(headcount.total, priorTotal);
  const rollup = rollupMovements(movementEvents);

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

  const haveLate =
    rollup.lateByLevel.length > 0 || rollup.lateByTerm.length > 0;
  const haveWithdrawals = rollup.counts.withdrawn > 0;
  const { controllability } = rollup;

  // Reason×level matrix for the stacked-bar attrition chart.
  const attritionStackedData = rollup.withdrawalsByReasonAndLevel.map(
    (row) => ({ level: row.level, ...row.reasonCounts })
  );
  const haveAttritionMatrix =
    attritionStackedData.length > 0 && rollup.withdrawalReasonKeys.length > 0;

  // Retention-by-level excludes the terminal grade (S4) — those students
  // graduated, they didn't fail to return (see TERMINAL_LEVEL_CODES). This
  // filtered list drives the chart, the worst-level callout, and the section
  // visibility gate so all three agree.
  const retentionByLevelDisplay = retentionByLevel.filter(
    (r) => !isTerminalLevel(r.level)
  );

  // Per-level retention only means something once a compareAy is selected.
  const haveRetentionByLevel =
    compareAy !== null && retentionByLevelDisplay.length > 0;

  // §6 controllability fallback: when every withdrawal reason on record is
  // Unspecified, the "% preventable" story is unknown, not zero.
  const hasSpecifiedWithdrawalReasons =
    controllability.total > 0 &&
    controllability.unspecifiedCount < controllability.total;

  const monthlySeries = monthlyMovementSeries(movementEvents, AY_MONTHS);
  const haveMovementActivity = monthlySeries.some(
    (p) => p.enrollments > 0 || p.withdrawals > 0
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout is
  // templated from these live values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded claim strings, level codes, or reason names.
  // ──────────────────────────────────────────────────────────────────────────

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

  const distributionTitle =
    headcount.byLevel.length > 0
      ? `Students are spread across ${headcount.byLevel.length} level${headcount.byLevel.length === 1 ? '' : 's'}`
      : 'Where are the students?';

  const retentionTitle =
    heroPct !== null
      ? `${heroPct}% returned year over year`
      : 'Do students come back?';

  const showPositiveRetention =
    heroPct !== null && heroPct >= 85 && retentionState === 'ok';

  // Worst-returning level, only when the gap below the overall rate is ≥ 10pp
  // and there is no tie.
  const RETENTION_GAP_PP = 10;
  const worstRetentionLevel = pickExtreme(
    retentionByLevelDisplay,
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

  // Late joins: most-concentrated level title / neutral.
  const topLateLevel = rollup.lateByLevel[0]; // sorted desc already
  const topLateLevelTie =
    rollup.lateByLevel.length > 1 &&
    rollup.lateByLevel[1].count === topLateLevel?.count;
  const showTopLateLevel =
    !!topLateLevel && topLateLevel.count > 0 && !topLateLevelTie;
  const lateTitle = showTopLateLevel
    ? `Late joiners concentrate in ${topLateLevel.level}`
    : 'Where do late enrollees land?';

  // Attrition: top reason label + % of withdrawals / neutral.
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

  const showActCallout =
    !!controllability.topControllableTakeaway &&
    controllability.topControllableTakeaway.trim().length > 0;

  // ──────────────────────────────────────────────────────────────────────────
  // Chart-data derivations — pure reshaping into the approved chart primitives'
  // prop shapes. No new queries, no changed data shapes.
  // ──────────────────────────────────────────────────────────────────────────

  // §Population by level — this-year BARS with a prior-year LINE overlaid on
  // the same axis (both are student counts, one unit/scale). Levels are an
  // ordered sequence (P1→S4), so the line honestly traces last year's
  // population shape as a reference curve — showing the per-level YoY move
  // that is the whole reason this section exists (KD #141), which a partition
  // donut can't. Canonical level order (not value-sorted) so the line reads
  // as a real progression, not a zig-zag.
  const priorByLevel = new Map(
    (priorHeadcount?.byLevel ?? []).map((l) => [l.level, l.count])
  );
  const populationComposedData: ComposedBarLinePoint[] = [...headcount.byLevel]
    .sort((a, b) => compareLevelLabels(a.level, b.level))
    .map((l) => ({
      category: levelShortCode(l.level),
      bar: l.count,
      line: priorByLevel.get(l.level) ?? 0,
    }));

  // §Movement — enrollments (late + re-enrolled) vs withdrawals per month, two
  // genuinely distinct flows over time → grouped (never stacked) bars.
  const movementBarData = monthlySeries.map((p) => ({
    x: p.month,
    enrollments: p.enrollments,
    withdrawals: p.withdrawals,
  }));
  const MOVEMENT_SERIES = [
    {
      key: 'enrollments',
      label: 'Enrollments',
      color: 'var(--color-chart-1)',
    },
    { key: 'withdrawals', label: 'Withdrawals', color: 'var(--color-chart-4)' },
  ];

  // §Retention by level — returned + did-not-return per level, worst-first
  // (loader-sorted). A stacked bar (returned mint + left grey) shows the RATE
  // and the ABSOLUTE cohort size in one row — the size context a pure rate bar
  // drops. returned + didNotReturn is a genuine partition of the prior cohort.
  const retentionStackData: RetentionStackRow[] = retentionByLevelDisplay.map(
    (r) => ({
      level: levelShortCode(r.level),
      returned: r.returned,
      didNotReturn: r.didNotReturn,
      priorTotal: r.priorTotal,
      pct: r.pct,
    })
  );

  // §Late by level — every late enrollee belongs to exactly one level →
  // partition → donut.
  const lateLevelDonutData: DonutSlice[] = rollup.lateByLevel.map((l) => ({
    name: l.level,
    value: l.count,
  }));

  // §Late by term — count per ordered term (T1→T4) → horizontal bar (keeps the
  // term sequence a donut would scramble).
  const lateTermBarData: ComparisonBarPoint[] = rollup.lateByTerm.map((t) => ({
    category: TERM_LABELS[t.termNumber] ?? `Term ${t.termNumber}`,
    current: t.count,
  }));

  // §Withdrawal reasons — each withdrawal has one reason → partition → donut,
  // sliced in controllability colours.
  const reasonDonutData: DonutSlice[] = rollup.withdrawalsByReason.map((r) => ({
    name: r.reason,
    value: r.count,
  }));
  const reasonDonutColors = rollup.withdrawalsByReason.map((r) =>
    withdrawalReasonColor(r.reason)
  );

  // §Withdrawal by level — total + a monthly sparkline (same withdrawals series
  // as the movement chart, never a fabricated second series).
  const withdrawalsSparklineTrend: AyTrendResult = {
    series: [{ key: selectedAy, label: selectedAy }],
    data: monthlySeries.map((p) => ({
      x: p.month,
      [selectedAy]: p.withdrawals,
    })),
  };
  const withdrawalsSparkline = sparklineFromAyTrend(withdrawalsSparklineTrend);

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

      {/* ═══ Population & growth ═══ */}
      <div className="space-y-5 pt-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
          Population &amp; growth
        </p>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            label="Enrolled"
            value={headcount.total}
            format="number"
            icon={Users}
            delta={enrolledDelta}
            deltaGoodWhen="up"
            comparisonLabel={
              compareAy && priorTotal !== null
                ? `${priorTotal.toLocaleString('en-SG')} in ${compareAy}`
                : undefined
            }
            subtext={selectedAy}
          />
          <MetricCard
            label="Retention rate"
            value={
              retentionState === 'ok' && retention.pct !== null
                ? retention.pct
                : '—'
            }
            format="percent"
            icon={CheckCircle2}
            subtext={
              retentionState === 'ok'
                ? `vs ${compareAy}`
                : retentionState === 'no-data'
                  ? `No data for ${compareAy}`
                  : 'Pick a comparison year above'
            }
          />
          <MetricCard
            label="Late enrollees"
            value={rollup.counts.lateEnrolled}
            format="number"
            icon={Clock}
            subtext={selectedAy}
          />
        </section>

        {/* Population by level — comparison-only (a primary-AY-only snapshot
            dupes the /records dashboard's level distribution), so it auto-hides
            until a compareAy is chosen. */}
        {compareAy && priorHeadcount && (
          <InsightChartCard
            cap="Distribution"
            title={distributionTitle}
            icon={Users}
            scopeNote={`This year vs ${compareAy}`}
          >
            {populationComposedData.length === 0 ? (
              <EmptyChartState message="No enrolled students recorded for this year yet." />
            ) : (
              <ComposedBarLineChart
                data={populationComposedData}
                barLabel={selectedAy}
                lineLabel={compareAy}
                yFormat="number"
                height={300}
              />
            )}
          </InsightChartCard>
        )}

        {/* Mid-year movement — enrollments vs withdrawals per month. */}
        <InsightChartCard
          cap={`Mid-year movement · ${selectedAy}`}
          title="Who moves in and out?"
          icon={ArrowLeftRight}
        >
          {!haveMovementActivity ? (
            <EmptyChartState message="No mid-year movement recorded this year yet." />
          ) : (
            <GroupedBarChart
              series={MOVEMENT_SERIES}
              data={movementBarData}
              yFormat="number"
              height={260}
            />
          )}
        </InsightChartCard>
      </div>
      {/* ═══ end Population & growth ═══ */}

      {/* ═══ Retention ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-amber">
          Retention
        </p>

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
          <InsightChartCard
            cap={`Year over year · vs ${compareAy}`}
            title={retentionTitle}
            icon={CheckCircle2}
            scopeNote={`Counted in the level they were in during ${compareAy}`}
          >
            <p className="mb-4 text-sm text-muted-foreground">
              {retention.returned.toLocaleString('en-SG')} of{' '}
              {retention.priorTotal.toLocaleString('en-SG')} students returned
              from {compareAy}.
            </p>
            {haveRetentionByLevel ? (
              <>
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Which cohorts didn&rsquo;t return? · worst first · bar height
                  = cohort size · excludes S4 (graduates)
                </p>
                <RetentionStackedBarChart data={retentionStackData} />
                {showWorstRetentionLevel ? (
                  <RecommendationCallout tone="watch" className="mt-5">
                    {worstRetentionLevel.item!.level} returned at{' '}
                    {worstRetentionLevel.item!.pct}% —{' '}
                    {Math.round(retentionLevelGap!)}pp below the {heroPct}%
                    school-wide rate. Worth a closer look at what&rsquo;s
                    driving families away from this level.
                  </RecommendationCallout>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                The per-level breakdown appears once there&rsquo;s comparison
                data on record.
              </p>
            )}
            {showPositiveRetention ? (
              <RecommendationCallout tone="positive" className="mt-5">
                {heroPct}% retention — the school is holding on to its families
                well year over year.
              </RecommendationCallout>
            ) : null}
          </InsightChartCard>
        )}
      </div>
      {/* ═══ end Retention ═══ */}

      {/* ═══ Attrition ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Attrition
        </p>
        <p className="-mt-3 text-xs text-muted-foreground">
          Applicants who cancelled before enrolling are in Admissions →
          Insights. This is enrolled students who left.
        </p>

        {/* Late enrollees */}
        {!haveLate ? (
          <InsightChartCard
            cap="Late joins"
            title="Where do late enrollees land?"
            icon={Clock}
          >
            <EmptyChartState message="No late enrollees recorded this year — every student started on time." />
          </InsightChartCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <InsightChartCard
              cap="Late joins · by level"
              title={lateTitle}
              icon={Clock}
            >
              {lateLevelDonutData.length === 0 ? (
                <EmptyChartState message="No level breakdown available." />
              ) : (
                <DonutChart
                  data={lateLevelDonutData}
                  centerValue={rollup.counts.lateEnrolled.toLocaleString(
                    'en-SG'
                  )}
                  centerLabel="Late"
                />
              )}
            </InsightChartCard>
            <InsightChartCard
              cap={`When they joined · ${selectedAy}`}
              title="By term"
              icon={CalendarDays}
            >
              {lateTermBarData.length === 0 ? (
                <EmptyChartState message="No term breakdown available." />
              ) : (
                <ComparisonBarChart
                  data={lateTermBarData}
                  orientation="horizontal"
                  yFormat="number"
                  height={200}
                />
              )}
            </InsightChartCard>
          </div>
        )}

        {/* Withdrawal analysis */}
        {!haveWithdrawals ? (
          <InsightChartCard
            cap="Attrition"
            title="Why do enrolled students leave?"
            icon={LogOut}
          >
            <EmptyChartState message="No withdrawals recorded this year — nothing to break down. That's a good sign." />
          </InsightChartCard>
        ) : (
          <>
            {hasSpecifiedWithdrawalReasons && (
              <div
                className={
                  controllability.controllableCount > 0
                    ? 'flex gap-3 rounded-xl border border-brand-amber/40 bg-gradient-to-b from-brand-amber/15 to-brand-amber/5 p-4'
                    : 'flex gap-3 rounded-xl border border-hairline bg-muted p-4'
                }
              >
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
                    Preventable = <span className="font-medium">financial</span>
                    , <span className="font-medium">disciplinary</span>,{' '}
                    <span className="font-medium">academic fit</span>.
                    Structural = <span className="font-medium">relocation</span>
                    , <span className="font-medium">transfer</span>,{' '}
                    <span className="font-medium">health</span>.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <InsightChartCard
                cap="Reasons recorded when an enrolled student withdraws"
                title={attritionTitle}
                icon={LogOut}
              >
                {hasSpecifiedWithdrawalReasons ? (
                  <>
                    <DonutChart
                      data={reasonDonutData}
                      colors={reasonDonutColors}
                      centerValue={rollup.counts.withdrawn.toLocaleString(
                        'en-SG'
                      )}
                      centerLabel="Withdrawn"
                    />
                    {showActCallout ? (
                      <RecommendationCallout tone="act" className="mt-5">
                        {controllability.topControllableTakeaway}
                      </RecommendationCallout>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No reason has been recorded for any withdrawal on record yet
                    — once a reason is logged, it breaks down here. The
                    per-level breakdown is alongside.
                  </p>
                )}
              </InsightChartCard>

              <InsightChartCard
                cap="Where withdrawals concentrate"
                title="By level"
                icon={GraduationCap}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-serif text-[32px] font-bold leading-none text-foreground">
                      {rollup.counts.withdrawn.toLocaleString('en-SG')}
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Total withdrawals this AY
                    </p>
                  </div>
                  {withdrawalsSparkline.length > 1 && (
                    <div className="h-[46px] w-[130px] shrink-0">
                      <SparklineChart points={withdrawalsSparkline} />
                    </div>
                  )}
                </div>
                <div className="mt-5">
                  {rollup.withdrawalsByLevel.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No level breakdown available.
                    </p>
                  ) : (
                    rollup.withdrawalsByLevel.map((l) => {
                      const pct =
                        rollup.counts.withdrawn > 0
                          ? Math.round(
                              (l.count / rollup.counts.withdrawn) * 100
                            )
                          : 0;
                      return (
                        <LevelStatRow
                          key={l.level}
                          name={l.level}
                          detail={`${l.count.toLocaleString('en-SG')} student${l.count === 1 ? '' : 's'}`}
                          value={`${pct}%`}
                        />
                      );
                    })
                  )}
                </div>
              </InsightChartCard>
            </div>

            {hasSpecifiedWithdrawalReasons && haveAttritionMatrix && (
              <InsightChartCard
                cap="Which reasons are concentrated where?"
                title="Reason concentration by level"
                icon={Megaphone}
              >
                <AttritionStackedBarChart
                  data={attritionStackedData}
                  reasonKeys={rollup.withdrawalReasonKeys}
                />
              </InsightChartCard>
            )}
          </>
        )}
      </div>
      {/* ═══ end Attrition ═══ */}

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
