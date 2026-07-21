import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  Clock,
  HeartHandshake,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Umbrella,
  User,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import { SparklineChart } from '@/components/dashboard/charts/sparkline-chart';
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
import { SegmentedBar } from '@/components/dashboard/insights/bento/segmented-bar';
import { ProjectListRow } from '@/components/dashboard/insights/bento/project-list-row';
import {
  BarStack,
  type BarStackBar,
  type BarStackColumn,
} from '@/components/dashboard/insights/bento/bar-stack';
import {
  DOT_GRADIENT,
  TILE_GRADIENT,
  type ColorKey,
} from '@/components/dashboard/insights/bento/tokens';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { cn } from '@/lib/utils';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import { buildAllRowSets } from '@/lib/attendance/drill';
import {
  computeAbsenceMix,
  isApproachingVlQuota,
  splitWatchlist,
} from '@/lib/attendance/insights-watchlist';
import {
  getAttendanceMixByTerm,
  getAttendanceRateTrendByAy,
  rateBadge,
} from '@/lib/attendance/insights-compare';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import {
  computeDelta,
  formatDeltaLabel,
  resolveRange,
  type DashboardSearchParams,
  type Delta,
  type RangeInput,
} from '@/lib/dashboard/range';
import {
  buildAyTrend,
  sparklineFromAyTrend,
} from '@/lib/dashboard/insights-trend';
import {
  summariseAyTrend,
  type TrendDeltaDirection,
} from '@/lib/dashboard/trend-delta';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

// ── Small page-local presentation helpers ──────────────────────────────────
// Not part of the shared bento/ library — these are just the repeated
// "mono cap + serif title" and "gradient icon tile + cap/title" text blocks
// every bento card in the locked mockup carries (`.cap`/`.title`/`.perf-head`),
// composed here from plain Tailwind so the library stays free of one-off
// page-specific text layouts.

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

function TileHeading({
  icon: Icon,
  iconGradient,
  cap,
  title,
}: {
  icon: LucideIcon;
  iconGradient: ColorKey;
  cap: string;
  title: string;
}) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        className={cn(
          'flex size-9 items-center justify-center rounded-xl',
          TILE_GRADIENT[iconGradient]
        )}
      >
        <Icon className="size-4" />
      </div>
      <div>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {cap}
        </p>
        <p className="mt-0.5 font-serif text-base font-semibold text-foreground">
          {title}
        </p>
      </div>
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
 * the `deltaGoodWhen` resolution `MetricCard`'s `DeltaChip` used to do. */
function toStatDelta(
  delta: Delta | undefined,
  goodWhen: 'up' | 'down'
): StatCardDelta | undefined {
  if (!delta || delta.direction === 'flat') return undefined;
  const isGood =
    (goodWhen === 'up' && delta.direction === 'up') ||
    (goodWhen === 'down' && delta.direction === 'down');
  return {
    value: formatDeltaLabel(delta, { format: 'absolute', unit: 'pp' }),
    direction: isGood ? 'up' : 'down',
  };
}

/** Term-composition quality tier — mirrors `rateHealthTitle`'s 95/90 cuts. */
function compositionQualityBadge(pct: number): {
  text: string;
  colorKey: ColorKey;
} {
  if (pct >= 95) return { text: 'Good', colorKey: 'mint' };
  if (pct >= 90) return { text: 'Watch', colorKey: 'amber' };
  return { text: 'Needs attention', colorKey: 'destructive' };
}

// Decorative-only skeleton widths for a term with no encoded data yet — no
// numeric claim is attached (no value/badge rendered alongside), matching
// the muted/dashed "nothing yet" treatment used elsewhere in the design
// system (§7.6) rather than fabricating a plausible-looking composition.
const MUTED_COMPOSITION_SKELETON: BarStackBar[] = [
  { key: 'a', pct: 88, colorKey: 'grey' },
  { key: 'b', pct: 55, colorKey: 'grey' },
  { key: 'c', pct: 36, colorKey: 'grey' },
  { key: 'd', pct: 24, colorKey: 'grey' },
];

// Attendance · Insights — the "Attendance Health" companion to the operational
// dashboard. Are we attending steadily, who is chronically absent, why are
// students away, and is anyone running over their leave quota. Read-first; all
// aggregates are derived from the attendance daily writer (read-only per KD
// #47) over the selected period.
export default async function AttendanceInsightsPage({
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
  // Attendance is term-scoped (KD #79) — mirror the operational dashboard,
  // which resolves the default range via the thisTerm cascade (no preset).
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);

  // Resolve current term so the vacation-leave quota (per-term, KD #94) can be
  // counted. Prefer the current-flagged term in the selected AY; fall back to
  // the earliest term.
  let currentTermId: string | null = null;
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', selectedAy)
    .maybeSingle();
  if (ayRow) {
    const { data: termRows } = await service
      .from('terms')
      .select('id, term_number, is_current')
      .eq('academic_year_id', (ayRow as { id: string }).id)
      .order('term_number', { ascending: true });
    type TermRow = { id: string; term_number: number; is_current: boolean };
    const terms = (termRows ?? []) as TermRow[];
    const active = terms.find((t) => t.is_current) ?? terms[0] ?? null;
    if (active) currentTermId = active.id;
  }

  const schoolConfig = await getSchoolConfig();

  // Comparison-AY headline rate, when a comparison year is set. Previously
  // this was hard-forced to the comparison AY's WHOLE calendar year
  // (`defaultPreset: 'thisAY'`) while `rangeInput` above resolves the
  // selected AY's current TERM window — comparing a single term's rate
  // against a full year's rate is an apples-to-oranges scope mismatch that
  // can silently inflate or deflate the "vs {compareAy}" delta.
  //
  // Fix: align the comparison to the SAME term when it's derivable — find
  // which term number `rangeInput` resolved to (by matching it against the
  // selected AY's own `windows.term.byNumber`), then look up that same term
  // number in the comparison AY's own terms. When `rangeInput` doesn't match
  // a term window (a custom date range, or the between-terms/cross-AY
  // fallback in `getDashboardWindows`), there is no well-defined "same term"
  // to align to — fall back to the comparison AY's whole year, same as
  // before (the card copy already reads generically as "compared with
  // {compareAy}", not "same term as {compareAy}", so this fallback never
  // overclaims scope parity).
  const selectedTermNumber = compareAy
    ? (
        Object.entries(windows.term.byNumber) as [
          string,
          { from: string; to: string } | null,
        ][]
      ).find(
        ([, w]) => w && w.from === rangeInput.from && w.to === rangeInput.to
      )?.[0]
    : undefined;

  const compareWindows = compareAy
    ? await getDashboardWindows(compareAy)
    : null;
  const compareTermWindow =
    compareWindows && selectedTermNumber
      ? compareWindows.term.byNumber[
          Number(selectedTermNumber) as 1 | 2 | 3 | 4
        ]
      : null;

  const priorRangeInput: RangeInput | null = compareAy
    ? compareTermWindow
      ? {
          ayCode: compareAy,
          from: compareTermWindow.from,
          to: compareTermWindow.to,
          cmpFrom: null,
          cmpTo: null,
        }
      : resolveRange({}, compareWindows!, compareAy, undefined, {
          defaultPreset: 'thisAY',
        })
    : null;

  const trendAys = compareAy ? [selectedAy, compareAy] : [selectedAy];

  const [kpis, allRowSets, priorKpis, rateTrendPoints, mixByTerm] =
    await Promise.all([
      getAttendanceKpisRange(rangeInput),
      buildAllRowSets({
        ayCode: selectedAy,
        from: rangeInput.from,
        to: rangeInput.to,
        vacationTermId: currentTermId,
        defaultVlAllowance: schoolConfig.defaultVlAllowancePerTerm,
      }),
      priorRangeInput
        ? getAttendanceKpisRange(priorRangeInput)
        : Promise.resolve(null),
      getAttendanceRateTrendByAy(trendAys),
      // Reuses the same React.cache()-deduped loadDailyRows(selectedAy) that
      // getAttendanceKpisRange/getAttendanceRateTrendByAy already trigger
      // above — no extra Supabase round-trip.
      getAttendanceMixByTerm(selectedAy),
    ]);

  // ── Derived row sets (already computed — no extra DB work) ─────────────────

  // Full topAbsent array from buildAllRowSets (carries absences + excused +
  // attendancePct). The old getTopAbsentRange call is replaced by this; all
  // students with ≥1 absence are eligible for the watchlist.
  const allTopAbsent = allRowSets.topAbsent.filter((r) => r.absences > 0);

  // Split into intervene (truancy signal) vs monitor (health narrative).
  // Cap at 8 per bucket — beyond that the list becomes unactionable.
  const watchlist = splitWatchlist(allTopAbsent, 8);

  // A-vs-EX mix for the school-wide split card.
  const absenceMix = computeAbsenceMix(
    kpis.current.absent,
    kpis.current.excused
  );
  // Same computation on the already-fetched, term-aligned prior-period KPIs
  // — powers the §1 "Absence mix" comparison card. Null when there's no
  // comparison AY/period at all (priorKpis itself is null in that case).
  const priorAbsenceMix = priorKpis
    ? computeAbsenceMix(priorKpis.current.absent, priorKpis.current.excused)
    : null;

  // Quota rows — over quota and approaching (used allowance but not breached).
  const compassionateOver = allRowSets.compassionate.filter(
    (r) => r.isOverQuota
  );
  const vacationOver = allRowSets.vacationLeave.filter(
    (r) => r.isOverTermQuota
  );
  const vacationApproaching = allRowSets.vacationLeave.filter((r) =>
    isApproachingVlQuota(r.remainingThisTerm, r.isOverTermQuota)
  );
  const haveQuotaRisk =
    compassionateOver.length > 0 ||
    vacationOver.length > 0 ||
    vacationApproaching.length > 0;

  const rate = Math.round(kpis.current.attendancePct * 10) / 10;
  const priorRate =
    priorKpis != null
      ? Math.round(priorKpis.current.attendancePct * 10) / 10
      : null;

  // True when the selected/current period itself has any encoded attendance —
  // independent of whether a comparison AY is chosen. `windows.term.thisTerm`
  // resolves to "the term containing today" (KD #79 cascade), which can be a
  // term that exists but hasn't been encoded yet (e.g. today sits in T3
  // before T3's import has run) — without this guard the headline silently
  // renders a literal 0.0% (kpisFor returns 0, not null, for an empty slice)
  // instead of an honest "not yet encoded" state, contradicting the
  // term-trend chart below it (which already treats zero-encoded-days as a
  // gap, not 0%).
  const hasCurrentPeriodData = kpis.current.encodedDays > 0;

  // Rate comparison card state — encodedDays > 0 means that AY has
  // actual attendance marks, so we can show a meaningful comparison.
  const hasRateData = (priorKpis?.current.encodedDays ?? 0) > 0;
  const rateState = comparisonCardState(compareAy, hasRateData);

  // Rate is itself a %, so we do a plain vs-prior comparison rather than a
  // percent-of-growth badge. growthDelta is reserved for count-based metrics.
  // Gate on `hasRateData` (same signal as Section 1) so the hero badge and
  // the section card always agree — prevents a misleading "X% vs 0%" when the
  // comparison AY exists but has no encoded attendance days (FIX 1).
  // Short-circuit on `hasCurrentPeriodData` first — a real comparison AY rate
  // is meaningless paired with a bogus current-side 0 (FIX 2).
  const growthBadge = hasCurrentPeriodData
    ? rateBadge(rate, priorRate, hasRateData, compareAy)
    : { label: 'Not yet encoded', tone: 'muted' as const };

  // Build the per-term two-AY trend. `buildAyTrend` is pure — safe to call on
  // the server. Only show the chart when at least one AY has a non-null value.
  const rateTrend = buildAyTrend(
    rateTrendPoints,
    ['T1', 'T2', 'T3', 'T4'],
    trendAys
  );
  const haveTrend = rateTrendPoints.some((p) => p.value !== null);
  // §1 "Attendance rate" sparkline — the current-AY per-term line already
  // computed for §2, previewed at tile scale. Always reads the dashboard-
  // rollup % (never the sheet-export formula, KD #151) since it's derived
  // from the same rateTrend data driving the section below.
  const rateSparkline = sparklineFromAyTrend(rateTrend);

  // §1 "Absence mix" comparison card — % of absences unexplained, this
  // period vs. the same term last AY. Delta only renders when BOTH periods
  // have real away-days; a zero-away-days period isn't "0% unexplained",
  // it's "no data" (mirrors §4's own awayDays===0 empty state).
  const absenceMixDelta =
    absenceMix.awayDays > 0 &&
    priorAbsenceMix !== null &&
    priorAbsenceMix.awayDays > 0
      ? computeDelta(absenceMix.unexplainedPct, priorAbsenceMix.unexplainedPct)
      : undefined;

  // Grouped-bar presentation labels (design: "Insights Trend Charts —
  // Redesign Preview"): the current-AY series reads "This year (AYxxxx)" in
  // the legend; the comparison series keeps its bare AY code and stays
  // `muted` (buildAyTrend already marks every non-first series muted, which
  // GroupedBarChart renders as neutral grey — never a second blue).
  const rateTrendSeries = rateTrend.series.map((s, i) =>
    i === 0 ? { ...s, label: `This year (${selectedAy})` } : s
  );

  // Headline + delta caption sat above the trend chart (KD-style honesty
  // guard: summariseAyTrend anchors the comparison at the same term index as
  // the current AY's latest data, so no fake delta ever renders).
  const rateTrendSummary = summariseAyTrend(rateTrend.data, rateTrend.series);
  // Round to 1dp (matches summariseSeriesMovement's convention elsewhere on
  // this page family) and derive the arrow direction from THAT rounded value
  // — deriving it from the raw delta let a genuine +0.4pt move read "+0 pts"
  // next to an up arrow, a visible inconsistency (bug-hunt finding).
  const rateTrendDeltaAbs = rateTrendSummary.delta
    ? Math.round(rateTrendSummary.delta.abs * 10) / 10
    : null;
  const rateTrendDeltaDirection: TrendDeltaDirection | null =
    rateTrendDeltaAbs === null
      ? null
      : rateTrendDeltaAbs > 0
        ? 'up'
        : rateTrendDeltaAbs < 0
          ? 'down'
          : 'flat';
  const rateTrendDelta =
    rateTrendDeltaAbs !== null &&
    rateTrendDeltaDirection !== null &&
    rateTrendSummary.comparisonLabel
      ? {
          label: `${rateTrendDeltaAbs >= 0 ? '+' : ''}${rateTrendDeltaAbs} pts vs ${rateTrendSummary.comparisonLabel}`,
          direction: rateTrendDeltaDirection,
        }
      : undefined;

  // Delta between current and prior AY headline rates (percentage points).
  const rateDelta =
    rateState === 'ok' && priorRate !== null
      ? computeDelta(rate, priorRate)
      : undefined;

  // ────────────────────────────────────────────────────────────────────────
  // Derived narrative — every finding-title + RecommendationCallout below is
  // templated from these live values, each with a tie/empty/threshold neutral
  // fallback. No hardcoded section names, percentages, or "worst" claims in
  // literals. (Storytelling pass.)
  // ────────────────────────────────────────────────────────────────────────

  // Lede: attendance rate + the intervene count. Neutral fallback when no data.
  const interveneCount = watchlist.intervene.length;
  const ledeDescription =
    kpis.current.encodedDays > 0
      ? interveneCount > 0
        ? `${rate}% attendance this period — ${interveneCount} student${interveneCount === 1 ? '' : 's'} with unexplained absences warrant a follow-up.`
        : `${rate}% attendance this period — no students with a truancy pattern right now.`
      : 'How steadily students show up — the overall attendance rate, who is chronically absent, why students are away, and whether anyone is running over their leave quota.';

  // Ch2 watchlist — intervene title: states the count (neutral when zero).
  const interveneTitle =
    interveneCount > 0
      ? `${interveneCount} student${interveneCount === 1 ? '' : 's'} to follow up with`
      : 'Intervene';

  // Ch3 A/EX mix title — describes the dominant signal.
  const absenceMixTitle =
    absenceMix.awayDays === 0
      ? 'Unexplained vs excused'
      : absenceMix.unexplainedPct > 50
        ? 'Mostly unexplained absences this period'
        : absenceMix.unexplainedPct > 25
          ? 'Largely excused, with some unexplained absences'
          : 'Almost all absences are excused';

  // ────────────────────────────────────────────────────────────────────────
  // Bento presentation-layer derivations — pure arithmetic/shaping over the
  // values already computed above (kpis / allRowSets / mixByTerm). No new
  // queries, no changed data shapes — this only reshapes existing numbers
  // into the shared bento primitives' prop shapes.
  // ────────────────────────────────────────────────────────────────────────

  const rateStatDelta = toStatDelta(
    hasCurrentPeriodData ? rateDelta : undefined,
    'up'
  );
  const rateCaption = !hasCurrentPeriodData
    ? 'No attendance encoded yet'
    : rateState === 'ok' && priorRate !== null
      ? `vs ${compareAy} · ${priorRate.toFixed(1)}%`
      : rateState === 'no-data'
        ? `No data for ${compareAy}`
        : 'This period';

  const absenceMixStatDelta = toStatDelta(absenceMixDelta, 'down');
  const absenceMixCaption = absenceMixDelta
    ? `vs ${compareAy} · ${priorAbsenceMix!.unexplainedPct}% unexplained`
    : `${absenceMix.unexplained} of ${absenceMix.awayDays} away-days unexplained`;

  // "Attendance mix" ranked/segmented bar (§2) — the whole-period P/L/EX/A
  // partition, straight from kpis.current (same source the row-1 stat cards
  // read). Guarded the same way as the rate/late tiles: an empty array
  // renders the section's own "not yet encoded" state instead of a fake
  // all-zero bar.
  const mixSegments =
    hasCurrentPeriodData && kpis.current.encodedDays > 0
      ? [
          {
            key: 'present',
            label: 'Present',
            value: `${kpis.current.present} days`,
            pct: Math.round(
              (kpis.current.present / kpis.current.encodedDays) * 100
            ),
            colorKey: 'mint' as const,
            icon: CheckCircle2,
          },
          {
            key: 'late',
            label: 'Late',
            value: `${kpis.current.late} days`,
            pct: Math.round(
              (kpis.current.late / kpis.current.encodedDays) * 100
            ),
            colorKey: 'sky' as const,
            icon: Clock,
          },
          {
            key: 'excused',
            label: 'Excused',
            value: `${kpis.current.excused} days`,
            pct: Math.round(
              (kpis.current.excused / kpis.current.encodedDays) * 100
            ),
            colorKey: 'amber' as const,
            icon: ShieldCheck,
          },
          {
            key: 'absent',
            label: 'Absent',
            value: `${kpis.current.absent} days`,
            pct: Math.round(
              (kpis.current.absent / kpis.current.encodedDays) * 100
            ),
            colorKey: 'destructive' as const,
            icon: AlertTriangle,
          },
        ]
      : [];

  // "What's behind the rate" bar-stack (§3) — one column per term, sourced
  // from mixByTerm (already loaded above). Terms with no encoded rows render
  // a muted decorative skeleton instead of a fabricated composition.
  const compositionColumns: BarStackColumn[] = [1, 2, 3, 4].map((t) => {
    const point = mixByTerm.find((p) => p.level === `T${t}`);
    if (!point) {
      return {
        key: `T${t}`,
        label: `Term ${t}`,
        muted: true,
        bars: MUTED_COMPOSITION_SKELETON,
      };
    }
    const total = point.Present + point.Late + point.Excused + point.Absent;
    const pct =
      total > 0
        ? Math.round(
            ((point.Present + point.Late + point.Excused) / total) * 100
          )
        : 0;
    return {
      key: `T${t}`,
      label: `Term ${t}`,
      value: `${pct}%`,
      badge: compositionQualityBadge(pct),
      bars: [
        {
          key: 'present',
          pct: total > 0 ? (point.Present / total) * 100 : 0,
          colorKey: 'mint' as const,
        },
        {
          key: 'late',
          pct: total > 0 ? (point.Late / total) * 100 : 0,
          colorKey: 'sky' as const,
        },
        {
          key: 'excused',
          pct: total > 0 ? (point.Excused / total) * 100 : 0,
          colorKey: 'amber' as const,
        },
        {
          key: 'absent',
          pct: total > 0 ? (point.Absent / total) * 100 : 0,
          colorKey: 'destructive' as const,
        },
      ],
    };
  });

  // "Why are they absent?" segmented bar (§4) — the school-wide A-vs-EX
  // partition, same numbers as the row-1 "Unexplained of absences" tile.
  const absenceMixSegments =
    absenceMix.awayDays > 0
      ? [
          {
            key: 'unexplained',
            label: 'Unexplained',
            value: `${absenceMix.unexplained} days`,
            pct: absenceMix.unexplainedPct,
            colorKey: 'destructive' as const,
            icon: AlertTriangle,
          },
          {
            key: 'excused',
            label: 'Excused',
            value: `${absenceMix.excused} days`,
            pct: absenceMix.excusedPct,
            colorKey: 'mint' as const,
            icon: ShieldCheck,
          },
        ]
      : [];

  return (
    <PageShell>
      <Link
        href={`/attendance?ay=${encodeURIComponent(selectedAy)}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Attendance
      </Link>

      <DashboardHero
        eyebrow="Attendance · Insights"
        title="Attendance Health"
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

      {/* ═══ Attendance health — rate + trend + composition ═══ */}
      <div className="space-y-5 pt-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
          Attendance health
        </p>

        <BentoGrid>
          {/* row 1 — stat cards */}
          <BentoCard span={3}>
            <StatCard
              icon={CalendarCheck}
              iconGradient="mint"
              value={hasCurrentPeriodData ? `${rate.toFixed(1)}%` : '—'}
              label="Attendance rate this period"
              delta={rateStatDelta}
              caption={rateCaption}
            />
            {rateSparkline.length > 1 && (
              <div className="-mx-1 mt-3 h-10 w-full">
                <SparklineChart points={rateSparkline} />
              </div>
            )}
          </BentoCard>

          {absenceMix.awayDays > 0 ? (
            <BentoCard span={3}>
              <StatCard
                icon={AlertTriangle}
                iconGradient="amber"
                value={`${absenceMix.unexplainedPct}%`}
                label="Unexplained of absences"
                delta={absenceMixStatDelta}
                caption={absenceMixCaption}
              />
            </BentoCard>
          ) : null}

          <BentoCard span={3}>
            <StatCard
              icon={Clock}
              iconGradient="sky"
              value={hasCurrentPeriodData ? kpis.current.late : '—'}
              label="Late incidents this period"
              caption={hasCurrentPeriodData ? 'This period' : 'Not yet encoded'}
            />
          </BentoCard>

          <BentoCard span={3}>
            <StatCard
              icon={ShieldAlert}
              iconGradient="indigo"
              value={compassionateOver.length + vacationOver.length}
              label="Over their leave quota"
              caption="Leave quotas"
            />
          </BentoCard>

          {/* row 2 — attendance mix + term trend */}
          <BentoCard span={7}>
            <SectionHeading cap="This period" title="Attendance mix" />
            {mixSegments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No attendance encoded yet — the mix will appear once this period
                has marks.
              </p>
            ) : (
              <SegmentedBar segments={mixSegments} />
            )}
          </BentoCard>

          <BentoCard span={5}>
            <SectionHeading
              cap="Attendance rate per term"
              title="Term-by-term attendance"
            />
            {!haveTrend ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No attendance data encoded yet — the chart will appear once
                terms have marks.
              </p>
            ) : (
              <div className="space-y-4">
                {rateTrendSummary.currentValue !== null && (
                  <TrendDeltaCaption
                    value={`${Math.round(rateTrendSummary.currentValue)}%`}
                    caption={`attendance rate in ${rateTrendSummary.periodLabel}`}
                    delta={rateTrendDelta}
                  />
                )}
                <GroupedBarChart
                  series={rateTrendSeries}
                  data={rateTrend.data}
                  yFormat="percent"
                  yDomain={[80, 100]}
                  showValueLabels
                  highlightX={rateTrendSummary.periodLabel ?? undefined}
                />
              </div>
            )}
          </BentoCard>

          {/* row 3 — composition per term */}
          <BentoCard span={12}>
            <TileHeading
              icon={TrendingUp}
              iconGradient="indigo"
              cap="Composition, term by term"
              title="What's behind the rate"
            />
            {mixByTerm.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No attendance data encoded yet — the composition chart will
                appear once terms have marks.
              </p>
            ) : (
              <>
                <BarStack columns={compositionColumns} />
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10.5px] text-muted-foreground">
                  {(
                    [
                      ['Present', 'mint'],
                      ['Late', 'sky'],
                      ['Excused', 'amber'],
                      ['Absent', 'destructive'],
                    ] as [string, ColorKey][]
                  ).map(([label, key]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className={cn('size-2.5 rounded-sm', DOT_GRADIENT[key])}
                      />
                      {label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </BentoCard>
        </BentoGrid>
      </div>
      {/* ═══ end Attendance health ═══ */}

      {/* ═══ Who to act on — chronic absentee watchlist ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-amber">
          Who to act on
        </p>

        {allTopAbsent.length === 0 ? (
          <EmptyStateCard>
            No absences recorded in this period — every student has been showing
            up.
          </EmptyStateCard>
        ) : (
          <BentoGrid>
            {/* Intervene bucket */}
            <BentoCard span={6}>
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                <ShieldAlert className="size-3" strokeWidth={2.25} />
                Follow up · mostly unexplained
              </p>
              <p className="mt-0.5 mb-1 font-serif text-base font-semibold leading-tight text-foreground">
                {interveneTitle}
              </p>
              {watchlist.intervene.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No students with a truancy pattern right now.
                </p>
              ) : (
                <>
                  <div className="mt-2">
                    {watchlist.intervene.map((r) => (
                      <div key={r.studentSectionId}>
                        <ProjectListRow
                          icon={User}
                          iconGradient="indigo"
                          name={
                            <IdentifierLink
                              href={`/attendance/students/${r.studentNumber}`}
                            >
                              {r.studentName}
                            </IdentifierLink>
                          }
                          subtitle={r.sectionName}
                          value={`${r.attendancePct}%`}
                        />
                        <div className="-mt-1.5 mb-2 space-y-1 pl-[46px]">
                          <div className="flex h-1.5 w-full overflow-hidden rounded-full">
                            <div
                              className="h-full bg-gradient-to-r from-destructive to-destructive/80"
                              style={{ width: `${r.unexplainedPct}%` }}
                              title={`${r.absences} unexplained`}
                            />
                            <div
                              className="h-full bg-muted"
                              style={{ width: `${100 - r.unexplainedPct}%` }}
                              title={`${r.excused} excused`}
                            />
                          </div>
                          <div className="flex gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                            <span className="text-destructive">
                              {r.absences}A unexplained
                            </span>
                            <span>·</span>
                            <span>{r.excused}EX excused</span>
                            {r.lates > 0 && (
                              <>
                                <span>·</span>
                                <span>{r.lates} late</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <RecommendationCallout tone="act" className="mt-2">
                    {interveneCount} student
                    {interveneCount === 1 ? '' : 's'} need
                    {interveneCount === 1 ? 's' : ''} a truancy follow-up —
                    unexplained absences are the majority of their away-days.
                  </RecommendationCallout>
                </>
              )}
            </BentoCard>

            {/* Monitor bucket */}
            <BentoCard span={6}>
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-amber">
                <ShieldCheck className="size-3" strokeWidth={2.25} />
                Health streak · mostly excused
              </p>
              <p className="mt-0.5 mb-1 font-serif text-base font-semibold text-foreground">
                Monitor
              </p>
              {watchlist.monitor.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No students with a prolonged health absence pattern.
                </p>
              ) : (
                <div className="mt-2">
                  {watchlist.monitor.map((r) => (
                    <div key={r.studentSectionId}>
                      <ProjectListRow
                        icon={User}
                        iconGradient="indigo"
                        name={
                          <IdentifierLink
                            href={`/attendance/students/${r.studentNumber}`}
                          >
                            {r.studentName}
                          </IdentifierLink>
                        }
                        subtitle={r.sectionName}
                        value={`${r.attendancePct}%`}
                      />
                      <div className="-mt-1.5 mb-2 space-y-1 pl-[46px]">
                        <div className="flex h-1.5 w-full overflow-hidden rounded-full">
                          <div
                            className="h-full bg-gradient-to-r from-brand-amber to-brand-amber/70"
                            style={{ width: `${r.unexplainedPct}%` }}
                            title={`${r.absences} unexplained`}
                          />
                          <div
                            className="h-full bg-muted"
                            style={{ width: `${100 - r.unexplainedPct}%` }}
                            title={`${r.excused} excused`}
                          />
                        </div>
                        <div className="flex gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                          <span>{r.absences}A unexplained</span>
                          <span>·</span>
                          <span className="text-brand-amber">
                            {r.excused}EX excused
                          </span>
                          {r.lates > 0 && (
                            <>
                              <span>·</span>
                              <span>{r.lates} late</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </BentoCard>
          </BentoGrid>
        )}
      </div>
      {/* ═══ end Who to act on ═══ */}

      {/* ═══ Causes & limits — why they're away + leave-quota risk ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Causes &amp; limits
        </p>

        {absenceMix.awayDays === 0 ? (
          <EmptyStateCard>No absences recorded in this period.</EmptyStateCard>
        ) : (
          <BentoCard span={12}>
            <SectionHeading cap="Away-day mix" title={absenceMixTitle} />
            <SegmentedBar segments={absenceMixSegments} />
            <p className="mt-4 text-xs text-muted-foreground">
              {absenceMix.unexplainedPct > 50
                ? 'Unexplained absences are the majority of away-days this period — the watchlist above is the place to act.'
                : absenceMix.unexplainedPct > 25
                  ? 'Most away-days are covered by an excuse, but there is a meaningful unexplained minority worth monitoring.'
                  : 'Almost all away-days are excused — attendance is largely health-driven this period.'}
            </p>
          </BentoCard>
        )}

        {!haveQuotaRisk ? (
          <EmptyStateCard>
            No student is over or approaching a leave quota this period.
            Everyone is within their allowance.
          </EmptyStateCard>
        ) : (
          <>
            <BentoGrid>
              {/* Compassionate — over quota only (per-year, at-quota is fine mid-year) */}
              <BentoCard span={6}>
                <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <HeartHandshake className="size-3" strokeWidth={2.25} />
                  Compassionate leave · per year
                </p>
                <p className="mt-0.5 mb-1 font-serif text-base font-semibold text-foreground">
                  Over quota
                </p>
                {compassionateOver.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No one over the compassionate-leave allowance.
                  </p>
                ) : (
                  <div className="mt-2">
                    {compassionateOver.map((r) => (
                      <ProjectListRow
                        key={r.studentSectionId}
                        icon={AlertTriangle}
                        iconGradient="destructive"
                        name={
                          r.studentNumber ? (
                            <IdentifierLink
                              href={`/attendance/students/${r.studentNumber}`}
                            >
                              {r.studentName}
                            </IdentifierLink>
                          ) : (
                            r.studentName
                          )
                        }
                        subtitle={r.sectionName}
                        value={`${r.used} / ${r.allowance} used`}
                        badge={{ text: 'Over', colorKey: 'destructive' }}
                      />
                    ))}
                  </div>
                )}
              </BentoCard>

              {/* Vacation leave — over quota + approaching tier */}
              <BentoCard span={6}>
                <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <Umbrella className="size-3" strokeWidth={2.25} />
                  Vacation leave · per term
                </p>
                <p className="mt-0.5 mb-1 font-serif text-base font-semibold text-foreground">
                  Over quota
                  {vacationApproaching.length > 0 && (
                    <span className="ml-2 font-mono text-xs font-normal text-brand-amber">
                      +{vacationApproaching.length} approaching
                    </span>
                  )}
                </p>
                {vacationOver.length === 0 &&
                vacationApproaching.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No one over the vacation-leave allowance this term.
                  </p>
                ) : (
                  <div className="mt-2">
                    {/* Over quota — destructive signal */}
                    {vacationOver.map((r) => (
                      <ProjectListRow
                        key={`over-${r.studentSectionId}`}
                        icon={AlertTriangle}
                        iconGradient="destructive"
                        name={
                          r.studentNumber ? (
                            <IdentifierLink
                              href={`/attendance/students/${r.studentNumber}`}
                            >
                              {r.studentName}
                            </IdentifierLink>
                          ) : (
                            r.studentName
                          )
                        }
                        subtitle={r.sectionName}
                        value={`${r.usedThisTerm} / ${r.allowance} used`}
                        badge={{ text: 'Over', colorKey: 'destructive' }}
                      />
                    ))}
                    {/* Approaching separator */}
                    {vacationApproaching.length > 0 && (
                      <>
                        {vacationOver.length > 0 && (
                          <div className="flex items-center gap-2 py-2.5">
                            <div className="h-px flex-1 bg-hairline" />
                            <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-brand-amber">
                              <AlertTriangle
                                className="size-2.5"
                                strokeWidth={2.25}
                              />
                              Approaching limit
                            </span>
                            <div className="h-px flex-1 bg-hairline" />
                          </div>
                        )}
                        {vacationApproaching.map((r) => (
                          <ProjectListRow
                            key={`approaching-${r.studentSectionId}`}
                            icon={Clock}
                            iconGradient="amber"
                            name={
                              r.studentNumber ? (
                                <IdentifierLink
                                  href={`/attendance/students/${r.studentNumber}`}
                                >
                                  {r.studentName}
                                </IdentifierLink>
                              ) : (
                                r.studentName
                              )
                            }
                            subtitle={r.sectionName}
                            value={`${r.usedThisTerm} / ${r.allowance} used`}
                            badge={{ text: 'Approaching', colorKey: 'amber' }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </BentoCard>
            </BentoGrid>

            {/* Callout (act/watch): summarise quota risk when any rows exist.
                Over-quota = act; approaching-only = watch. Both guarded by counts. */}
            {compassionateOver.length > 0 || vacationOver.length > 0 ? (
              <RecommendationCallout tone="act">
                {[
                  compassionateOver.length > 0
                    ? `${compassionateOver.length} student${compassionateOver.length === 1 ? '' : 's'} over the compassionate-leave allowance`
                    : null,
                  vacationOver.length > 0
                    ? `${vacationOver.length} student${vacationOver.length === 1 ? '' : 's'} over the vacation-leave quota this term`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                — these cases need a review.
              </RecommendationCallout>
            ) : vacationApproaching.length > 0 ? (
              <RecommendationCallout tone="watch">
                {vacationApproaching.length} student
                {vacationApproaching.length === 1 ? '' : 's'}{' '}
                {vacationApproaching.length === 1 ? 'has' : 'have'} used up
                their vacation-leave allowance this term — worth a heads-up
                before any further requests.
              </RecommendationCallout>
            ) : null}
          </>
        )}
      </div>
      {/* ═══ end Causes & limits ═══ */}

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <TrendingUp className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Attendance health</span>
        <span className="text-border">·</span>
        <span>Refreshes every few minutes</span>
      </div>
    </PageShell>
  );
}
