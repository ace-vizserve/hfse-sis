import {
  ArrowLeft,
  Clock,
  FileStack,
  FileX,
  GraduationCap,
  HeartPulse,
  HelpCircle,
  Layers,
  Percent,
  Plane,
  School,
  TrendingUp,
  UserMinus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { TrendDeltaCaption } from '@/components/dashboard/insights/trend-delta-caption';
import {
  BentoCard,
  BentoGrid,
} from '@/components/dashboard/insights/bento/bento-grid';
import {
  StatCard,
  type StatCardDelta,
} from '@/components/dashboard/insights/bento/stat-card';
import {
  SegmentedBar,
  type SegmentedBarSegment,
} from '@/components/dashboard/insights/bento/segmented-bar';
import {
  RankedBar,
  type RankedBarLegendItem,
  type RankedBarRow,
} from '@/components/dashboard/insights/bento/ranked-bar';
import {
  RateDial,
  type RateDialTotalRow,
} from '@/components/dashboard/insights/bento/rate-dial';
import {
  PillBarChart,
  type PillBarColumn,
} from '@/components/dashboard/insights/bento/pill-bar-chart';
import { ProjectListRow } from '@/components/dashboard/insights/bento/project-list-row';
import { BadgeTooltip } from '@/components/dashboard/insights/bento/badge-tooltip';
import {
  qualityRampColorKey,
  type ColorKey,
} from '@/components/dashboard/insights/bento/tokens';
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
import {
  buildAyTrend,
  type AyTrendResult,
} from '@/lib/dashboard/insights-trend';
import { pickExtreme, meetsThreshold } from '@/lib/dashboard/narrative';
import { summariseAyTrend } from '@/lib/dashboard/trend-delta';
import {
  computeDelta,
  formatDeltaLabel,
  type DashboardSearchParams,
  type Delta,
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

// ── Small page-local presentation helpers ──────────────────────────────────
// Not part of the shared bento/ library — mirrors the "mono cap + serif
// title" text block every bento card in the locked mockups carries
// (`.cap`/`.title`), composed here from plain Tailwind (same pattern as
// Attendance Insights' own page-local SectionHeading).

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

/** Resolves an existing `Delta` into the bento `StatCard`'s already-semantic
 * up=good/down=bad direction (see `DELTA_PILL_CLASS` in tokens.ts) — mirrors
 * `deltaChipClass`'s goodWhen resolution and Attendance Insights' own
 * `toStatDelta`, generalised with an explicit format/unit since this page
 * needs both a plain-percent delta (applications) and an absolute-pp one
 * (conversion rate). */
function toStatDelta(
  delta: Delta | undefined,
  goodWhen: 'up' | 'down',
  format: 'percent' | 'absolute' = 'percent',
  unit?: string
): StatCardDelta | undefined {
  if (!delta || delta.direction === 'flat') return undefined;
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return {
    value: formatDeltaLabel(delta, { format, unit }),
    direction: isGood ? 'up' : 'down',
  };
}

// "Which levels convert worst?" quality-ramp bands — below 70% is a real
// concern, 70–80 amber, 80–90 sky, 90+ mint. A page-local judgment call (the
// locked mockups hand-picked their own per-page cut points; tokens.ts
// documents this as expected — see qualityRampColorKey's doc comment).
const LEVEL_CONVERSION_THRESHOLDS = { low: 70, high: 90 };

// Reason-code → icon map for the cancellation-reasons segmented bar. Bounded
// set (APPLICATION_TERMINAL_REASON_VALUES, KD #111) + the two sentinels this
// page's own derivation introduces ('Unspecified' when the DB reason is
// blank, OVERFLOW_REASON_KEY for the "Other reasons" overflow bucket).
const OVERFLOW_REASON_KEY = '__overflow__';
const REASON_ICONS: Record<string, LucideIcon> = {
  chose_another_school: School,
  visa_denied: FileX,
  lost_interest: UserMinus,
  financial: Wallet,
  family_relocation: Plane,
  health: HeartPulse,
  other: HelpCircle,
  Unspecified: HelpCircle,
  [OVERFLOW_REASON_KEY]: Layers,
};
function reasonIcon(key: string): LucideIcon {
  return REASON_ICONS[key] ?? HelpCircle;
}

// ── "Total Revenue" pill-bar-chart reshaping (intake trend) ────────────────
// Two always-positive monthly count series (selected AY / compare AY) —
// structurally the exact case pill-bar-chart.tsx's doc comment calls out
// (case 1: "up"/"down" is a visual split, not a sign). A future month in the
// current AY is `null` in intakeTrend.data (buildAyTrend/shapeIntakeTrendPoints)
// — that already renders as a 0-height pill pair here (no separate "gap" state
// needed: a 0px pill and a missing pill are visually identical), so no prop
// addition to pill-bar-chart.tsx was required.
const INTAKE_PLOT_HEIGHT_PX = 260;
// 3 of 5 grid intervals (156 = 3 × 52) — keeps the "0" gridline exactly on a
// tick position for PillBarChart's evenly-spaced axisLabels. The up region
// (156px) is taller than the down region (104px) since the selected AY is
// the more consequential series to give headroom to.
const INTAKE_ZERO_OFFSET_PX = 156;
const INTAKE_GRID_INTERVALS = 5;

function buildIntakePillColumns(
  data: AyTrendResult['data'],
  series: AyTrendResult['series']
): {
  columns: PillBarColumn[];
  axisLabels: string[];
} {
  const currentKey = series[0]?.key;
  const compareKey = series[1]?.key;
  const numeric = (v: unknown): number | null =>
    typeof v === 'number' ? v : null;

  const upValues = currentKey
    ? data
        .map((d) => numeric(d[currentKey]))
        .filter((v): v is number => v !== null)
    : [];
  const downValues = compareKey
    ? data
        .map((d) => numeric(d[compareKey]))
        .filter((v): v is number => v !== null)
    : [];

  const upRegionPx = INTAKE_ZERO_OFFSET_PX;
  const downRegionPx = INTAKE_PLOT_HEIGHT_PX - INTAKE_ZERO_OFFSET_PX;
  const maxUp = Math.max(1, ...upValues);
  const maxDown = Math.max(1, ...downValues);
  const scale =
    downValues.length > 0
      ? Math.min(upRegionPx / maxUp, downRegionPx / maxDown)
      : upRegionPx / maxUp;

  const intervalPx = INTAKE_PLOT_HEIGHT_PX / INTAKE_GRID_INTERVALS;
  const unit = intervalPx / scale; // data value per grid interval
  const axisLabels = [3, 2, 1, 0, -1, -2].map((m) => {
    const v = Math.round(m * unit);
    if (v === 0) return '0';
    return v < 0
      ? `−${Math.abs(v).toLocaleString('en-SG')}`
      : v.toLocaleString('en-SG');
  });

  const columns: PillBarColumn[] = data.map((row, i) => {
    const upVal = currentKey ? numeric(row[currentKey]) : null;
    const downVal = compareKey ? numeric(row[compareKey]) : null;
    return {
      key: `${row.x}-${i}`,
      label: String(row.x),
      upHeightPx: upVal !== null ? Math.round(upVal * scale) : 0,
      downHeightPx: downVal !== null ? Math.round(downVal * scale) : 0,
    };
  });

  return { columns, axisLabels };
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
  // isCurrent is DB-derived (getCurrentAcademicYear), never inferred from the
  // AY code's own digits — the clamp fix keys on this flag alone. compareAy
  // is never equal to selectedAy (resolveCompareAy guarantees that), but it
  // CAN be the DB-current AY when the user explicitly compares against it.
  const compareIsCurrentAy = compareAy === currentAy.ay_code;
  const trendAyRequests = compareAy
    ? [
        { ayCode: selectedAy, isCurrent: isCurrentAy },
        { ayCode: compareAy, isCurrent: compareIsCurrentAy },
      ]
    : [{ ayCode: selectedAy, isCurrent: isCurrentAy }];

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
    getIntakeTrendByAy(trendAyRequests),
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
      inProgressPeriod: currentInProgressMonthLabel(isCurrentAy),
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

  // ────────────────────────────────────────────────────────────────────────
  // Bento presentation-layer derivations — pure reshaping of the values
  // already computed above into the shared bento primitives' prop shapes.
  // No new queries, no changed data shapes.
  // ────────────────────────────────────────────────────────────────────────

  const applicationsStatDelta = toStatDelta(
    applicationsDelta ?? undefined,
    'up'
  );
  const applicationsCaption = applicationsDelta
    ? `${priorApplications?.toLocaleString('en-SG')} in ${compareAy}`
    : demandState === 'no-data'
      ? `No data for ${compareAy}`
      : compareAy === null
        ? 'Pick a comparison year above'
        : undefined;

  const conversionStatDelta = toStatDelta(
    conversionDelta ?? undefined,
    'up',
    'absolute',
    'pp'
  );
  const conversionCaption = conversionDelta
    ? `${priorConversionPct?.toFixed(1)}% in ${compareAy}`
    : `${enrolledCount.toLocaleString('en-SG')} of ${applicationsCount.toLocaleString('en-SG')} applicants enrolled`;

  // §2 — intake trend pill-bar-chart + growth dial.
  const { columns: intakeColumns, axisLabels: intakeAxisLabels } =
    buildIntakePillColumns(intakeTrend.data, intakeTrend.series);
  const showGrowthDial = growth.pct !== null && compareAy !== null;
  const growthDialTotals: RateDialTotalRow[] = showGrowthDial
    ? [
        {
          icon: FileStack,
          iconGradient: 'indigo',
          value: applicationsCount.toLocaleString('en-SG'),
          label: selectedAy,
        },
        {
          icon: FileStack,
          iconGradient: 'grey',
          value: (priorApplications ?? 0).toLocaleString('en-SG'),
          label: compareAy ?? '',
        },
      ]
    : [];

  // §3 — funnel stall list. `funnel` is CUMULATIVE stage reach (Submitted
  // includes everyone who ever reached it or beyond), not a mutually-exclusive
  // partition of applicationsCount — so this uses ranked-bar (numbered
  // stage-reach ranking), not segmented-bar (which requires segments to sum
  // to 100%, per its own doc comment).
  const funnelBars = funnel.map((stage) => {
    const pct =
      applicationsCount > 0
        ? Math.max(4, Math.round((stage.count / applicationsCount) * 100))
        : 0;
    const isBiggestLeak =
      biggestLeakStage !== null &&
      stage.stage === biggestLeakStage.label &&
      stage.dropOffPct === biggestLeakStage.dropOffPct;
    const colorKey: ColorKey =
      stage.stage === 'Enrolled'
        ? 'mint'
        : isBiggestLeak
          ? 'destructive'
          : 'indigo';
    return { stage, pct, colorKey };
  });
  const funnelRows: RankedBarRow[] = funnelBars.map(
    ({ stage, pct, colorKey }) => ({
      key: stage.stage,
      label: stage.stage,
      pct,
      colorKey,
    })
  );
  const funnelLegend: RankedBarLegendItem[] = funnelBars.map(
    ({ stage, colorKey }) => ({
      key: stage.stage,
      colorKey,
      name: stage.stage,
      value: `${stage.count.toLocaleString('en-SG')}`,
    })
  );

  // §4 — conversion by level ranked-bar + legend.
  const levelBars = levelsWorstFirst.map((row) => {
    const isWorst = showWorstLevel && row.level === worstLevel.item!.level;
    const colorKey: ColorKey = isWorst
      ? 'destructive'
      : qualityRampColorKey(row.conversionPct, LEVEL_CONVERSION_THRESHOLDS);
    return { row, colorKey };
  });
  const levelRows: RankedBarRow[] = levelBars.map(({ row, colorKey }) => ({
    key: row.level,
    label: row.level,
    pct: Math.max(4, row.conversionPct),
    colorKey,
  }));
  const levelLegend: RankedBarLegendItem[] = levelBars.map(
    ({ row, colorKey }) => ({
      key: row.level,
      colorKey,
      name: row.level,
      value: `${row.conversionPct}%`,
    })
  );

  // §5 — cancellation reasons: topReasons + the overflow bucket are a genuine
  // partition of terminal.total (otherReasonsCount is explicitly the
  // remainder) — this DOES fit segmented-bar's "sums to 100%" contract.
  const reasonSegments: SegmentedBarSegment[] = reasonBars.map((r) => {
    const pct =
      terminal.total > 0 ? Math.round((r.count / terminal.total) * 100) : 0;
    const isTop = showTopReason && r.key === topReason.reason;
    const colorKey: ColorKey =
      r.key === OVERFLOW_REASON_KEY ? 'grey' : isTop ? 'amber' : 'indigo';
    return {
      key: r.key,
      label: r.label,
      value: `${r.count.toLocaleString('en-SG')} cancellation${r.count === 1 ? '' : 's'}`,
      pct,
      colorKey,
      icon: reasonIcon(r.key),
    };
  });

  // §6 — referral channels ranked-bar. Same shape as conversion-by-level
  // (ReferralConversionRow mirrors LevelConversionRow: applied/enrolled/
  // conversionPct) — the mockup's "no source recorded" framing doesn't exist
  // in the real loader, so this reuses ranked-bar on the real per-source
  // conversion data instead, placed in its own Chapter-3 section.
  const referralRows: RankedBarRow[] = referralsByConversion.map((r) => {
    const isBest = showBestRef && r.source === bestRef.item!.source;
    const isWorst =
      showBestRef &&
      !worstRef.isTie &&
      worstRef.item !== null &&
      r.source === worstRef.item.source &&
      worstRef.item.source !== bestRef.item!.source;
    const colorKey: ColorKey = isBest ? 'mint' : isWorst ? 'amber' : 'indigo';
    return {
      key: r.source,
      label: r.source,
      pct: Math.max(4, r.conversionPct),
      colorKey,
    };
  });

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

      {/* ═══ Demand & conversion ═══
          How much demand the funnel takes in, and how well it converts. */}
      <div className="space-y-5 pt-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
          Demand &amp; conversion
        </p>

        <BentoGrid>
          {/* row 1 — stat cards. Primary-AY metrics always render; only the
              demand-comparison caption reacts to `demandState`. */}
          <BentoCard span={4}>
            <StatCard
              icon={FileStack}
              iconGradient="indigo"
              value={applicationsCount.toLocaleString('en-SG')}
              label="Applications received"
              delta={applicationsStatDelta}
              caption={applicationsCaption}
            />
          </BentoCard>

          <BentoCard span={4}>
            <StatCard
              icon={Percent}
              iconGradient="mint"
              value={`${conversionPct}%`}
              label="Conversion rate"
              delta={conversionStatDelta}
              caption={conversionCaption}
            />
          </BentoCard>

          {/* Avg. days to enrol — CONDITIONAL: only when sampleSize > 0
              (early-in-AY / sparse cohorts suppress it rather than show a
              near-zero-sample average). */}
          {timeToEnroll.sampleSize > 0 && (
            <BentoCard span={4}>
              <StatCard
                icon={Clock}
                iconGradient="sky"
                value={`${timeToEnroll.avgDays}d`}
                label="Avg. days to enrol"
                caption={`${selectedAy} · n=${timeToEnroll.sampleSize.toLocaleString('en-SG')}`}
              />
            </BentoCard>
          )}

          {/* row 2 — intake trend + growth panel */}
          <BentoCard span={8}>
            <SectionHeading cap="Applications per month" title="Intake trend" />
            {intakeTrend.data.some((d) =>
              intakeTrend.series.some((s) => d[s.key] !== null)
            ) ? (
              <div className="space-y-4">
                {intakeTrendSummary.currentValue !== null && (
                  <TrendDeltaCaption
                    value={intakeTrendSummary.currentValue.toLocaleString(
                      'en-SG'
                    )}
                    caption={`applications in ${intakeTrendSummary.periodLabel}`}
                    delta={intakeTrendDelta}
                  />
                )}
                <PillBarChart
                  columns={intakeColumns}
                  plotHeightPx={INTAKE_PLOT_HEIGHT_PX}
                  zeroOffsetPx={INTAKE_ZERO_OFFSET_PX}
                  axisLabels={intakeAxisLabels}
                  legend={[
                    { colorKey: 'indigo', label: selectedAy },
                    ...(compareAy
                      ? [{ colorKey: 'grey' as const, label: compareAy }]
                      : []),
                  ]}
                  defaultUpColorKey="indigo"
                  defaultDownColorKey="grey"
                />
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No applications recorded yet for this academic year.
              </p>
            )}
          </BentoCard>

          <BentoCard span={4}>
            {showGrowthDial ? (
              <RateDial
                value={`${growth.pct}%`}
                label="Growth"
                caption={`${applicationsCount.toLocaleString('en-SG')} application${applicationsCount === 1 ? '' : 's'} this AY, ${growth.pct! >= 0 ? 'up' : 'down'} from ${(priorApplications ?? 0).toLocaleString('en-SG')} in ${compareAy}`}
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
                    : `No application data found for ${compareAy}.`}
                </p>
              </div>
            )}
          </BentoCard>

          {/* row 3 — funnel stall list */}
          <BentoCard span={12}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Stage reach — {applicationsCount.toLocaleString('en-SG')}{' '}
                  total applications
                </p>
                <p className="mt-0.5 font-serif text-base font-semibold text-foreground">
                  {funnelTitle}
                </p>
              </div>
              {biggestLeakStage && (
                <BadgeTooltip
                  label="Biggest leak"
                  colorKey="destructive"
                  tooltip={`${biggestLeakStage.dropOffPct}% of applicants fall away at ${biggestLeakStage.label} — focus follow-up there to recover the most.`}
                />
              )}
            </div>
            {applicationsCount === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No applications recorded yet for this academic year.
              </p>
            ) : (
              <>
                <RankedBar rows={funnelRows} legend={funnelLegend} />
                {biggestLeakStage && biggestLeakStage.dropOffPct > 0 ? (
                  <RecommendationCallout tone="act" className="mt-5">
                    {biggestLeakStage.dropOffPct}% of applicants fall away at{' '}
                    {biggestLeakStage.label} — focus follow-up there to recover
                    the most.
                  </RecommendationCallout>
                ) : null}
              </>
            )}
          </BentoCard>
        </BentoGrid>
      </div>
      {/* ═══ end Demand & conversion ═══ */}

      {/* ═══ Who & why we lose ═══
          Which levels convert worst, and the reasons applicants give for
          dropping out before enrolling. */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-amber">
          Who &amp; why we lose
        </p>

        {/* Conversion by level */}
        <BentoCard span={12}>
          <SectionHeading
            cap="Active pipeline only — terminal statuses excluded"
            title={levelTitle}
          />
          {levelsWorstFirst.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No level data available.
            </p>
          ) : (
            <>
              <RankedBar rows={levelRows} legend={levelLegend} />
              {showWorstLevel ? (
                <RecommendationCallout tone="watch" className="mt-5">
                  {worstLevel.item!.level} converts at{' '}
                  {worstLevel.item!.conversionPct}% — {levelGap}pp below the{' '}
                  {conversionPct}% overall rate. Worth a closer look at this
                  level&rsquo;s pipeline.
                </RecommendationCallout>
              ) : null}
            </>
          )}
        </BentoCard>

        {/* Why applicants are lost (pre-enrolment; distinct from Records'
            enrolled-student withdrawals). */}
        {terminal.total > 0 && (
          <BentoGrid>
            <BentoCard span={6}>
              <SectionHeading cap="Cancellation reasons" title={reasonTitle} />
              <SegmentedBar segments={reasonSegments} />
              {showTopReason ? (
                <RecommendationCallout tone="watch" className="mt-5">
                  {reasonLabel(topReason.reason)} accounts for {topReason.count}{' '}
                  of {terminal.total} cancellations
                  {topReasonPct !== null ? ` (${topReasonPct}%)` : ''} — the
                  clearest place to address drop-out.
                </RecommendationCallout>
              ) : null}
            </BentoCard>
            <BentoCard span={6}>
              <SectionHeading cap="Top reason per level" title="By level" />
              <div>
                {terminal.byLevel.map((lvl) => {
                  const lvlTopReason = lvl.reasons[0];
                  return (
                    <ProjectListRow
                      key={lvl.level}
                      icon={GraduationCap}
                      iconGradient="indigo"
                      name={lvl.level}
                      subtitle={
                        lvlTopReason ? reasonLabel(lvlTopReason.reason) : '—'
                      }
                      value={lvl.count.toLocaleString('en-SG')}
                    />
                  );
                })}
              </div>
            </BentoCard>
          </BentoGrid>
        )}
      </div>
      {/* ═══ end Who & why we lose ═══ */}

      {/* ═══ Channels & segments ═══
          Where applicants come from, and which channels convert. */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Channels &amp; segments
        </p>

        <BentoCard span={12}>
          <SectionHeading
            cap="All applicants (including cancelled/withdrawn) — true conversion rate"
            title={referralTitle}
          />
          {referralsByConversion.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No referral sources recorded yet.
            </p>
          ) : (
            <>
              <RankedBar rows={referralRows} />
              {showBestRef ? (
                <RecommendationCallout tone="positive" className="mt-5">
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
        </BentoCard>
      </div>
      {/* ═══ end Channels & segments ═══ */}

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
