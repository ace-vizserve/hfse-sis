import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  GraduationCap,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart';
import { SparklineChart } from '@/components/dashboard/charts/sparkline-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import {
  BentoCard,
  BentoGrid,
} from '@/components/dashboard/insights/bento/bento-grid';
import {
  StatCard,
  type StatCardDelta,
} from '@/components/dashboard/insights/bento/stat-card';
import {
  BarStack,
  type BarStackColumn,
} from '@/components/dashboard/insights/bento/bar-stack';
import {
  RateDial,
  type RateDialTotalRow,
} from '@/components/dashboard/insights/bento/rate-dial';
import {
  RankedBar,
  type RankedBarLegendItem,
  type RankedBarRow,
} from '@/components/dashboard/insights/bento/ranked-bar';
import {
  PillBarChart,
  type PillBarColumn,
} from '@/components/dashboard/insights/bento/pill-bar-chart';
import { ProjectListRow } from '@/components/dashboard/insights/bento/project-list-row';
import {
  GanttTimeline,
  type GanttRow,
} from '@/components/dashboard/insights/bento/gantt-timeline';
import {
  qualityRampColorKey,
  type ColorKey,
} from '@/components/dashboard/insights/bento/tokens';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  formatDeltaLabel,
  type DashboardSearchParams,
  type Delta,
} from '@/lib/dashboard/range';
import {
  compareLevelLabels,
  LEVEL_LABELS,
  levelTypeForAudienceLookup,
} from '@/lib/sis/levels';
import { getMovementEvents } from '@/lib/sis/movements';
import {
  getInsightsHeadcount,
  getRecordsRetention,
  getRecordsRetentionByLevel,
  growthDelta,
  MONTH_LABELS,
  monthlyMovementSeries,
  rollupMovements,
  WITHDRAWAL_CONTROLLABILITY,
  type MonthlyMovementPoint,
  type RecordsHeadcount,
} from '@/lib/sis/records-insights';
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

const TERM_LABELS: Record<number, string> = {
  1: 'Term 1',
  2: 'Term 2',
  3: 'Term 3',
  4: 'Term 4',
};

// HFSE's AY calendar runs January–November (KD #13) — every month-axis chart
// on this page (the movement pill chart + the late-enrollee Gantt timeline)
// shares this 11-column axis, matching the locked mockup.
const AY_MONTHS: string[] = MONTH_LABELS.slice(0, 11);

// Quality-ramp cut points for the retention-by-level ranked bar — mirrors
// Admissions Insights' own LEVEL_CONVERSION_THRESHOLDS (tokens.ts documents
// that each page hand-picks its own cut points; there's no universal rule).
const RETENTION_QUALITY_THRESHOLDS = { low: 70, high: 90 };

// Pixel budget for the "Joins vs departures per month" pill chart — mirrors
// Admissions Insights' intake-trend chart (buildIntakePillColumns), but with
// an even up/down split rather than a biased one: unlike Admissions' pill
// chart (one metric shown twice — current AY vs muted comparison AY), this
// chart plots two genuinely distinct metrics (enrollments, withdrawals),
// neither of which should get a default pixel-budget advantage.
const MOVEMENT_PLOT_HEIGHT_PX = 240;
const MOVEMENT_ZERO_OFFSET_PX = 144;
const MOVEMENT_GRID_INTERVALS = 5;

// Level-label → short code (e.g. "Primary One" → "P1") for the population-
// by-level column headers — derived from the canonical LEVEL_LABELS map so
// the codes can never drift from the level catalog.
const LABEL_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(LEVEL_LABELS).map(([code, label]) => [label, code])
);
function levelShortCode(label: string): string {
  return LABEL_TO_CODE[label] ?? label;
}

// Reverse lookup: humanized withdrawal-reason label -> raw enum key, so the
// reasons ranked-bar can colour each bar by the SAME controllability
// classification the banner above it already reports (§10.2 — one source of
// truth for a colour, never a second hand-picked palette).
const REASON_LABEL_TO_RAW: Record<string, WithdrawalReason> =
  Object.fromEntries(
    Object.entries(WITHDRAWAL_REASON_LABELS).map(([raw, label]) => [
      label,
      raw as WithdrawalReason,
    ])
  );
function withdrawalReasonColorKey(reasonLabel: string): ColorKey {
  if (reasonLabel === 'Unspecified') return 'grey';
  const raw = REASON_LABEL_TO_RAW[reasonLabel];
  if (!raw) return 'indigo';
  return WITHDRAWAL_CONTROLLABILITY[raw] === 'controllable'
    ? 'destructive'
    : 'sky';
}

// ── Small page-local presentation helpers ──────────────────────────────────
// Not part of the shared bento/ library — mirrors the "mono cap + serif
// title" text block every bento card in the locked mockups carries, composed
// here from plain Tailwind (same pattern as Attendance/Admissions Insights'
// own page-local SectionHeading).

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

function EmptyStateCard({ children }: { children: React.ReactNode }) {
  return (
    <BentoCard span={12} className="border-dashed">
      <p className="py-6 text-center text-sm text-muted-foreground">
        {children}
      </p>
    </BentoCard>
  );
}

/** Resolves an existing `Delta` into the bento `StatCard`'s already-semantic
 * up=good/down=bad direction (see `DELTA_PILL_CLASS` in tokens.ts) — mirrors
 * Attendance/Admissions Insights' own `toStatDelta`. */
function toStatDelta(
  delta: Delta | undefined,
  goodWhen: 'up' | 'down'
): StatCardDelta | undefined {
  if (!delta || delta.direction === 'flat') return undefined;
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return {
    value: formatDeltaLabel(delta, { format: 'percent' }),
    direction: isGood ? 'up' : 'down',
  };
}

/** Splits a headcount-by-level array into Primary/Secondary tiers, sorted in
 * canonical catalog order. Reuses `levelTypeForAudienceLookup` — the SAME
 * classifier the attendance calendar-audience gate already uses (KD #50) —
 * rather than inventing a new primary/secondary rule for this page. */
function splitByTier(byLevel: RecordsHeadcount['byLevel']): {
  primary: RecordsHeadcount['byLevel'];
  secondary: RecordsHeadcount['byLevel'];
} {
  const primary: RecordsHeadcount['byLevel'] = [];
  const secondary: RecordsHeadcount['byLevel'] = [];
  for (const row of byLevel) {
    const tier = levelTypeForAudienceLookup(row.level);
    if (tier === 'primary') primary.push(row);
    else if (tier === 'secondary') secondary.push(row);
    // An unrecognised label (shouldn't occur against the fixed P1–S4
    // catalog, migration 086) is dropped from the tier tabs but still
    // counted in the headline `headcount.total`.
  }
  primary.sort((a, b) => compareLevelLabels(a.level, b.level));
  secondary.sort((a, b) => compareLevelLabels(a.level, b.level));
  return { primary, secondary };
}

/** Builds one bar-stack column per level in a tier — a single indigo bar
 * whose width is proportional to that level's share of the tier's largest
 * level (never a quality ramp — population size isn't a better/worse axis
 * the way a conversion or retention rate is). */
function buildTierColumns(
  rows: RecordsHeadcount['byLevel'],
  tierTotal: number
): BarStackColumn[] {
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  return rows.map((r) => {
    const sharePct =
      tierTotal > 0 ? Math.round((r.count / tierTotal) * 100) : 0;
    const barPct = Math.max(4, Math.round((r.count / maxCount) * 100));
    return {
      key: r.level,
      label: levelShortCode(r.level),
      value: `${sharePct}%`,
      bars: [
        {
          key: r.level,
          pct: barPct,
          colorKey: 'indigo',
          value: r.count.toLocaleString('en-SG'),
        },
      ],
    };
  });
}

/** Scales a monthly {enrollments, withdrawals} series into pill-bar-chart
 * pixel heights — same technique as Admissions Insights' own
 * `buildIntakePillColumns` (page-local; pill-bar-chart.tsx's own doc comment
 * notes the component only ever takes resolved pixel heights, so every
 * caller does its own value→px scale math). */
function buildMovementPillColumns(points: MonthlyMovementPoint[]): {
  columns: PillBarColumn[];
  axisLabels: string[];
} {
  const upValues = points.map((p) => p.enrollments);
  const downValues = points.map((p) => p.withdrawals);
  const upRegionPx = MOVEMENT_ZERO_OFFSET_PX;
  const downRegionPx = MOVEMENT_PLOT_HEIGHT_PX - MOVEMENT_ZERO_OFFSET_PX;
  const maxUp = Math.max(1, ...upValues);
  const maxDown = Math.max(1, ...downValues);
  const scale = Math.min(upRegionPx / maxUp, downRegionPx / maxDown);
  const intervalPx = MOVEMENT_PLOT_HEIGHT_PX / MOVEMENT_GRID_INTERVALS;
  const unit = intervalPx / scale;
  const axisLabels = [3, 2, 1, 0, -1, -2].map((m) => {
    const v = Math.round(m * unit);
    if (v === 0) return '0';
    return v < 0
      ? `−${Math.abs(v).toLocaleString('en-SG')}`
      : v.toLocaleString('en-SG');
  });
  const columns: PillBarColumn[] = points.map((p) => ({
    key: p.month,
    label: p.month,
    upHeightPx: Math.round(p.enrollments * scale),
    downHeightPx: Math.round(p.withdrawals * scale),
  }));
  return { columns, axisLabels };
}

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

  // ──────────────────────────────────────────────────────────────────────────
  // Bento presentation-layer derivations — pure reshaping of the values
  // already computed above into the shared bento primitives' prop shapes.
  // No new queries, no changed data shapes.
  // ──────────────────────────────────────────────────────────────────────────

  const enrolledStatDelta = toStatDelta(enrolledDelta, 'up');

  // §2 population by level — tier split + per-tier bar-stack columns.
  const { primary: primaryLevels, secondary: secondaryLevels } = splitByTier(
    headcount.byLevel
  );
  const primaryTotal = primaryLevels.reduce((s, r) => s + r.count, 0);
  const secondaryTotal = secondaryLevels.reduce((s, r) => s + r.count, 0);
  const primaryPct =
    headcount.total > 0
      ? Math.round((primaryTotal / headcount.total) * 100)
      : 0;
  const secondaryPct =
    headcount.total > 0
      ? Math.round((secondaryTotal / headcount.total) * 100)
      : 0;
  const primaryColumns = buildTierColumns(primaryLevels, primaryTotal);
  const secondaryColumns = buildTierColumns(secondaryLevels, secondaryTotal);

  // §3 student movement — real enrollments (late + re-enrolled) vs
  // withdrawals, per month, for the selected AY only. Both series are honest
  // by construction: `movementEvents` only ever contains real, already-
  // happened audit rows, so a not-yet-arrived month simply has no events (0)
  // — never a fabricated or clamped value, so this needs no separate future-
  // month guard (contrast the old net-movement AY trend it replaces, which
  // read a pre-aggregated monthly series and DID need one — see KD #140/#141's
  // calendar-clamp rule, `netMovementByMonth`'s `isCurrent` param).
  const monthlySeries = monthlyMovementSeries(movementEvents, AY_MONTHS);
  const haveMovementActivity = monthlySeries.some(
    (p) => p.enrollments > 0 || p.withdrawals > 0
  );
  const { columns: movementColumns, axisLabels: movementAxisLabels } =
    buildMovementPillColumns(monthlySeries);

  // §3 growth dial.
  const showGrowthDial = growth.pct !== null && compareAy !== null;
  const growthDialTotals: RateDialTotalRow[] = showGrowthDial
    ? [
        {
          icon: Users,
          iconGradient: 'indigo',
          value: headcount.total.toLocaleString('en-SG'),
          label: selectedAy,
        },
        {
          icon: Users,
          iconGradient: 'grey',
          value: (priorTotal ?? 0).toLocaleString('en-SG'),
          label: compareAy ?? '',
        },
      ]
    : [];

  // §4 retention-by-level ranked bar.
  const levelRetentionRows: RankedBarRow[] = retentionByLevel.map((row) => {
    const pct = row.pct ?? 0;
    return {
      key: row.level,
      label: `${row.level} · ${pct}%`,
      pct: Math.max(4, pct),
      colorKey: qualityRampColorKey(pct, RETENTION_QUALITY_THRESHOLDS),
    };
  });

  // §5 late enrollees — enrolled denominator per level (for the "N late / M
  // enrolled" fraction), and the Gantt timeline rows. Term start/end dates
  // aren't already loaded on this page, so each term's span is an even 1/4
  // slice of the 11-month axis in term order (an illustrative proportional
  // width, matching the locked mockup's own hand-picked spans) rather than
  // exact calendar dates.
  const enrolledByLevel = new Map(
    headcount.byLevel.map((l) => [l.level, l.count])
  );
  const maxLateTermCount = rollup.lateByTerm.reduce(
    (m, t) => Math.max(m, t.count),
    0
  );
  const ganttRows: GanttRow[] = rollup.lateByTerm.map((t) => {
    const widthPct = 100 / 4;
    return {
      key: String(t.termNumber),
      label: TERM_LABELS[t.termNumber] ?? `Term ${t.termNumber}`,
      startPct: (t.termNumber - 1) * widthPct,
      widthPct,
      value: `${t.count.toLocaleString('en-SG')} late enrollee${t.count === 1 ? '' : 's'}`,
      colorKey: 'amber',
      highlighted: maxLateTermCount > 0 && t.count === maxLateTermCount,
    };
  });

  // §6 withdrawal reasons — ranked bar + legend, coloured by the SAME
  // controllability classification the banner above it reports.
  const reasonRows: RankedBarRow[] = rollup.withdrawalsByReason.map((r) => {
    const pct =
      controllability.total > 0
        ? Math.round((r.count / controllability.total) * 100)
        : 0;
    return {
      key: r.reason,
      label: r.reason,
      pct: Math.max(4, pct),
      colorKey: withdrawalReasonColorKey(r.reason),
    };
  });
  const reasonLegend: RankedBarLegendItem[] = rollup.withdrawalsByReason.map(
    (r) => {
      const pct =
        controllability.total > 0
          ? Math.round((r.count / controllability.total) * 100)
          : 0;
      return {
        key: r.reason,
        colorKey: withdrawalReasonColorKey(r.reason),
        name: r.reason,
        value: `${r.count.toLocaleString('en-SG')} · ${pct}%`,
      };
    }
  );

  // §7 withdrawal reason by level — "Conversion rate" anatomy: real AY
  // total, a sparkline built from the SAME monthly withdrawals series as §3
  // (never a fabricated second series), real per-level share %.
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

      {/* ═══ Chapter 1 — Population & Growth ═══
          How many students are enrolled, how they're spread across levels,
          and what the mid-year movement looks like. */}
      <div className="space-y-6 border-t-2 border-brand-indigo/25 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-indigo">
            Chapter 1
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Population &amp; growth
          </h2>
        </div>

        <div>
          <SectionHeading cap="Headcount" title={enrolledTitle} />
          <BentoGrid>
            <BentoCard span={4}>
              <StatCard
                icon={Users}
                iconGradient="indigo"
                value={headcount.total.toLocaleString('en-SG')}
                label="Enrolled"
                delta={enrolledStatDelta}
                caption={selectedAy}
              />
            </BentoCard>
            <BentoCard span={4}>
              <StatCard
                icon={CheckCircle2}
                iconGradient="mint"
                value={
                  retentionState === 'ok' && retention.pct !== null
                    ? `${retention.pct}%`
                    : '—'
                }
                label="Retention rate"
                caption={
                  retentionState === 'ok'
                    ? `vs ${compareAy}`
                    : retentionState === 'no-data'
                      ? `No data for ${compareAy}`
                      : 'Pick a comparison year above'
                }
              />
            </BentoCard>
            <BentoCard span={4}>
              <StatCard
                icon={Clock}
                iconGradient="sky"
                value={rollup.counts.lateEnrolled}
                label="Late enrollees"
                caption={selectedAy}
              />
            </BentoCard>
          </BentoGrid>
        </div>

        {/* Student population by level — comparison-only (a primary-AY-only
            snapshot dupes the /records dashboard's level distribution) —
            auto-hides entirely when no compareAy is chosen. */}
        {compareAy && priorHeadcount && (
          <div>
            <SectionHeading cap="Distribution" title={distributionTitle} />
            {headcount.byLevel.length === 0 ? (
              <EmptyStateCard>
                No enrolled students recorded for this year yet.
              </EmptyStateCard>
            ) : (
              <BentoGrid>
                <BentoCard span={12}>
                  <BarStack
                    headline={{
                      value: headcount.total.toLocaleString('en-SG'),
                      label: `Enrolled students vs ${compareAy} · ${priorHeadcount.total.toLocaleString('en-SG')}`,
                      delta: enrolledStatDelta,
                    }}
                    columns={[]}
                  />
                  <Tabs defaultValue="primary">
                    <TabsList variant="segmented" className="mb-5">
                      <TabsTrigger value="primary">
                        Primary · {primaryTotal.toLocaleString('en-SG')} ·{' '}
                        {primaryPct}%
                      </TabsTrigger>
                      <TabsTrigger value="secondary">
                        Secondary · {secondaryTotal.toLocaleString('en-SG')} ·{' '}
                        {secondaryPct}%
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="primary">
                      {primaryColumns.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No primary-level students recorded.
                        </p>
                      ) : (
                        <BarStack columns={primaryColumns} />
                      )}
                    </TabsContent>
                    <TabsContent value="secondary">
                      {secondaryColumns.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No secondary-level students recorded.
                        </p>
                      ) : (
                        <BarStack columns={secondaryColumns} />
                      )}
                    </TabsContent>
                  </Tabs>
                </BentoCard>
              </BentoGrid>
            )}
          </div>
        )}

        {/* Student movement + growth */}
        <div>
          <SectionHeading cap="Movement" title="Who moves in and out?" />
          <BentoGrid>
            <BentoCard span={8}>
              {!haveMovementActivity ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No mid-year movement recorded this year yet.
                </p>
              ) : (
                <PillBarChart
                  columns={movementColumns}
                  plotHeightPx={MOVEMENT_PLOT_HEIGHT_PX}
                  zeroOffsetPx={MOVEMENT_ZERO_OFFSET_PX}
                  axisLabels={movementAxisLabels}
                  legend={[
                    { colorKey: 'indigo', label: 'Enrollments' },
                    { colorKey: 'grey', label: 'Withdrawals' },
                  ]}
                  defaultUpColorKey="indigo"
                  defaultDownColorKey="grey"
                />
              )}
            </BentoCard>
            <BentoCard span={4}>
              {showGrowthDial ? (
                <RateDial
                  value={`${growth.pct}%`}
                  label="Growth"
                  caption={`${headcount.total.toLocaleString('en-SG')} students this AY, ${growth.pct! >= 0 ? 'up' : 'down'} from ${(priorTotal ?? 0).toLocaleString('en-SG')} in ${compareAy}.`}
                  colorKey="indigo"
                  totals={growthDialTotals}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 py-6 text-center">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Growth
                  </p>
                  <p className="max-w-55 text-sm text-muted-foreground">
                    {compareAy === null
                      ? 'Pick a comparison year above to see year-over-year growth.'
                      : `No enrolment data found for ${compareAy}.`}
                  </p>
                </div>
              )}
            </BentoCard>
          </BentoGrid>
        </div>
      </div>
      {/* ═══ end Chapter 1 ═══ */}

      {/* ═══ Chapter 2 — Retention ═══
          Did last year's students come back, and which levels returned least. */}
      <div className="space-y-6 border-t-2 border-brand-amber/30 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-amber">
            Chapter 2
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Retention
          </h2>
        </div>

        <div>
          <SectionHeading cap="Year over year" title={retentionTitle} />
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
            <BentoGrid>
              <BentoCard span={haveRetentionByLevel ? 4 : 12}>
                <RateDial
                  value={`${retention.pct ?? 0}%`}
                  label="Retention"
                  caption={`${retention.returned.toLocaleString('en-SG')} of ${retention.priorTotal.toLocaleString('en-SG')} returned from ${compareAy}.`}
                  colorKey="mint"
                  totals={[
                    {
                      icon: Check,
                      iconGradient: 'mint',
                      value: retention.returned.toLocaleString('en-SG'),
                      label: 'Returned',
                    },
                    {
                      icon: X,
                      iconGradient: 'grey',
                      value: retention.didNotReturn.toLocaleString('en-SG'),
                      label: 'Did not return',
                    },
                  ]}
                />
                {showPositiveRetention ? (
                  <RecommendationCallout tone="positive" className="mt-4">
                    {heroPct}% retention — the school is holding on to its
                    families well year over year.
                  </RecommendationCallout>
                ) : null}
              </BentoCard>

              {haveRetentionByLevel && (
                <BentoCard span={8}>
                  <SectionHeading
                    cap={`Worst first · counted in the level they were in during ${compareAy}`}
                    title="Which cohorts didn't return?"
                  />
                  <RankedBar rows={levelRetentionRows} />
                  {showWorstRetentionLevel ? (
                    <RecommendationCallout tone="watch" className="mt-5">
                      {worstRetentionLevel.item!.level} returned at{' '}
                      {worstRetentionLevel.item!.pct}% —{' '}
                      {Math.round(retentionLevelGap!)}pp below the {heroPct}%
                      school-wide rate. Worth a closer look at what&rsquo;s
                      driving families away from this level.
                    </RecommendationCallout>
                  ) : null}
                </BentoCard>
              )}
            </BentoGrid>
          )}
        </div>
      </div>
      {/* ═══ end Chapter 2 ═══ */}

      {/* ═══ Chapter 3 — Attrition ═══
          Where late joiners land, and why enrolled students leave. */}
      <div className="space-y-6 border-t-2 border-brand-mint/40 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-mint">
            Chapter 3
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Attrition
          </h2>
        </div>

        {/* Late enrollees */}
        <div>
          <SectionHeading cap="Late joins" title={lateTitle} />
          {!haveLate ? (
            <EmptyStateCard>
              No late enrollees recorded this year — every student started on
              time.
            </EmptyStateCard>
          ) : (
            <BentoGrid>
              <BentoCard span={4}>
                <SectionHeading
                  cap="Late enrollees per level"
                  title="By level"
                />
                {rollup.lateByLevel.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No level breakdown available.
                  </p>
                ) : (
                  <div>
                    {rollup.lateByLevel.map((l) => {
                      const enrolled = enrolledByLevel.get(l.level);
                      return (
                        <ProjectListRow
                          key={l.level}
                          icon={GraduationCap}
                          iconGradient="amber"
                          name={l.level}
                          subtitle={
                            enrolled !== undefined
                              ? `${l.count.toLocaleString('en-SG')} late / ${enrolled.toLocaleString('en-SG')} enrolled`
                              : `${l.count.toLocaleString('en-SG')} late enrollees`
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </BentoCard>
              <BentoCard span={8}>
                <SectionHeading
                  cap={`When they joined · ${selectedAy}`}
                  title="By term"
                />
                {rollup.lateByTerm.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No term breakdown available.
                  </p>
                ) : (
                  <GanttTimeline axisLabels={AY_MONTHS} rows={ganttRows} />
                )}
              </BentoCard>
            </BentoGrid>
          )}
        </div>

        {/* Withdrawal analysis */}
        <div>
          <SectionHeading cap="Attrition" title={attritionTitle} />
          <p className="-mt-3 mb-4 text-xs text-muted-foreground">
            Applicants who cancelled before enrolling are in Admissions →
            Insights.
          </p>
          {!haveWithdrawals ? (
            <EmptyStateCard>
              No withdrawals recorded this year — nothing to break down.
              That&rsquo;s a good sign.
            </EmptyStateCard>
          ) : (
            <>
              <BentoGrid>
                <BentoCard span={7}>
                  {hasSpecifiedWithdrawalReasons ? (
                    <>
                      <SectionHeading
                        cap="Reasons recorded when an enrolled student withdraws mid-year"
                        title="Withdrawal reasons"
                      />
                      <div
                        className={
                          controllability.controllableCount > 0
                            ? 'mb-5 flex gap-3 rounded-xl border border-brand-amber/40 bg-gradient-to-r from-brand-amber/7 to-transparent p-4'
                            : 'mb-5 flex gap-3 rounded-xl border border-hairline bg-muted p-4'
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
                      <RankedBar rows={reasonRows} legend={reasonLegend} />
                      {showActCallout ? (
                        <RecommendationCallout tone="act" className="mt-5">
                          {controllability.topControllableTakeaway}
                        </RecommendationCallout>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <SectionHeading
                        cap="No withdrawal reasons recorded yet"
                        title="Withdrawal reasons"
                      />
                      <p className="text-sm text-muted-foreground">
                        No reason has been recorded for any withdrawal on record
                        yet — once a reason is logged, it breaks down here. The
                        per-level breakdown is alongside.
                      </p>
                    </>
                  )}
                </BentoCard>

                <BentoCard span={5}>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Where withdrawals concentrate
                  </p>
                  <p className="mt-0.5 font-serif text-base font-semibold text-foreground">
                    Withdrawal reason by level
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-4">
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
                          <div
                            key={l.level}
                            className="flex items-center justify-between border-t border-hairline py-3 first:border-t-0 first:pt-1"
                          >
                            <div>
                              <div className="text-[13.5px] font-semibold text-foreground">
                                {l.level}
                              </div>
                              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                                {l.count.toLocaleString('en-SG')} student
                                {l.count === 1 ? '' : 's'}
                              </div>
                            </div>
                            <span className="font-mono text-[13px] font-bold text-foreground">
                              {pct}%
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </BentoCard>
              </BentoGrid>

              {hasSpecifiedWithdrawalReasons && haveAttritionMatrix && (
                <BentoGrid className="mt-4">
                  <BentoCard span={12}>
                    <SectionHeading
                      cap="Which reasons are concentrated where?"
                      title="Reason concentration by level"
                    />
                    <AttritionStackedBarChart
                      data={attritionStackedData}
                      reasonKeys={rollup.withdrawalReasonKeys}
                    />
                  </BentoCard>
                </BentoGrid>
              )}
            </>
          )}
        </div>
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
