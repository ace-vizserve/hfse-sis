import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CalendarX,
  Clock,
  Filter,
  HeartHandshake,
  Layers,
  ShieldAlert,
  TrendingUp,
  Umbrella,
  User,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';

import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart';
import {
  LabeledPieChart,
  type LabeledPieSlice,
} from '@/components/dashboard/charts/labeled-pie-chart';
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
import { IdentifierLink } from '@/components/ui/identifier-link';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import { cn } from '@/lib/utils';
import { getAttendanceKpisRange } from '@/lib/attendance/dashboard';
import {
  buildAllRowSets,
  getTopAbsentByTerm,
  type TermWindowInput,
} from '@/lib/attendance/drill';
import { isApproachingVlQuota } from '@/lib/attendance/insights-watchlist';
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
  resolveRange,
  type DashboardSearchParams,
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

const ALLOWED_ROLES = new Set([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

// The P/L/EX/A attendance partition, in one place — the school-wide mix donut
// and the per-term composition bars both read the same series so colours can
// never drift (design system §10.2). Real CSS custom properties only (Hard
// Rule #7): mint=present, sky=late, amber=excused, destructive=absent.
type MixSeries = { key: string; label: string; color: string };
const ATTENDANCE_MIX_SERIES: MixSeries[] = [
  { key: 'present', label: 'Present', color: 'var(--color-brand-mint)' },
  { key: 'late', label: 'Late', color: 'var(--color-chart-3)' },
  { key: 'excused', label: 'Excused', color: 'var(--color-brand-amber)' },
  { key: 'absent', label: 'Absent', color: 'var(--color-destructive)' },
];

// Roster-row icon-tile gradients, keyed by semantic tone (real Aurora Vault
// tokens; the canonical recipe is `from-brand-indigo to-brand-navy`).
type RosterTone = 'indigo' | 'destructive' | 'amber' | 'mint';
const ROSTER_TILE: Record<RosterTone, string> = {
  indigo: 'from-brand-indigo to-brand-navy',
  destructive: 'from-destructive to-destructive/80',
  amber: 'from-brand-amber to-brand-amber/80',
  mint: 'from-brand-mint to-brand-sky',
};
const ROSTER_BADGE: Record<'destructive' | 'amber', string> = {
  destructive:
    'border-destructive/40 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive',
  amber:
    'border-brand-amber bg-gradient-to-b from-brand-amber/25 to-brand-amber/10 text-ink',
};

// ── Page-local presentation helpers — same shell the Admissions/Records
// Insights pages use (mono cap + serif title + gradient icon tile). ─────────

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

// One roster row — gradient icon tile + name + subtitle + right value + an
// optional status badge. Replaces the bento ProjectListRow.
function RosterRow({
  icon: Icon,
  iconGradient,
  name,
  subtitle,
  value,
  badge,
}: {
  icon: LucideIcon;
  iconGradient: RosterTone;
  name: ReactNode;
  subtitle: string;
  value: string;
  badge?: { text: string; tone: 'destructive' | 'amber' };
}) {
  return (
    <div className="flex items-center gap-3.5 border-t border-hairline py-3 first:border-t-0 first:pt-1">
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br text-white shadow-brand-tile',
          ROSTER_TILE[iconGradient]
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {name}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
              ROSTER_BADGE[badge.tone]
            )}
          >
            {badge.text}
          </span>
        )}
        <span className="font-mono text-[12px] font-bold tabular-nums text-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

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

  // Comparison-AY headline rate, when a comparison year is set. Align the
  // comparison to the SAME term when it's derivable — find which term number
  // `rangeInput` resolved to (by matching it against the selected AY's own
  // `windows.term.byNumber`), then look up that same term number in the
  // comparison AY's own terms. When `rangeInput` doesn't match a term window
  // (custom range, or between-terms/cross-AY fallback), fall back to the
  // comparison AY's whole year (the card copy reads generically, so the
  // fallback never overclaims scope parity).
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

  // Term windows (T1–T4) for the per-term absence watchlist — only terms whose
  // date window is defined in the selected AY.
  const absenceTermWindows: TermWindowInput[] = ([1, 2, 3, 4] as const)
    .map((n) => {
      const w = windows.term.byNumber[n];
      return w ? { termNumber: n, from: w.from, to: w.to } : null;
    })
    .filter(
      (t): t is { termNumber: 1 | 2 | 3 | 4; from: string; to: string } =>
        t !== null
    );

  const [
    kpis,
    allRowSets,
    priorKpis,
    rateTrendPoints,
    mixByTerm,
    topAbsentByTerm,
  ] = await Promise.all([
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
    getAttendanceMixByTerm(selectedAy),
    // Top 5 most-absent students per term (whole-year view, not range-scoped).
    getTopAbsentByTerm(selectedAy, absenceTermWindows, 5),
  ]);

  // ── Derived row sets (already computed — no extra DB work) ─────────────────

  // Per-term absence watchlist — only terms that actually have ≥1 absence.
  // Reasons for a plain Absent mark aren't tracked, so this ranks WHO is
  // absent most per term, nothing about WHY.
  const termsWithAbsences = topAbsentByTerm.filter((t) => t.rows.length > 0);

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

  // True when the selected/current period itself has any encoded attendance.
  const hasCurrentPeriodData = kpis.current.encodedDays > 0;

  // Rate comparison card state — encodedDays > 0 means real marks.
  const hasRateData = (priorKpis?.current.encodedDays ?? 0) > 0;
  const rateState = comparisonCardState(compareAy, hasRateData);

  const growthBadge = hasCurrentPeriodData
    ? rateBadge(rate, priorRate, hasRateData, compareAy)
    : { label: 'Not yet encoded', tone: 'muted' as const };

  // Per-term two-AY trend. `buildAyTrend` is pure — safe on the server.
  const rateTrend = buildAyTrend(
    rateTrendPoints,
    ['T1', 'T2', 'T3', 'T4'],
    trendAys
  );
  const haveTrend = rateTrendPoints.some((p) => p.value !== null);
  const rateSparkline = sparklineFromAyTrend(rateTrend);

  // Grouped-bar trend labels: current-AY series reads "This year (AYxxxx)"; the
  // comparison series keeps its bare AY code + stays muted (grey).
  const rateTrendSeries = rateTrend.series.map((s, i) =>
    i === 0 ? { ...s, label: `This year (${selectedAy})` } : s
  );

  // Headline + delta caption above the trend chart (honesty guard:
  // summariseAyTrend anchors the comparison at the same term index).
  const rateTrendSummary = summariseAyTrend(rateTrend.data, rateTrend.series);
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
  // Derived narrative — every finding-title + RecommendationCallout is
  // templated from live values with a neutral fallback. (Storytelling pass.)
  // ────────────────────────────────────────────────────────────────────────

  const ledeDescription =
    kpis.current.encodedDays > 0
      ? `${rate}% attendance this period. The watchlist ranks the top 5 most-absent students in each term.`
      : 'How steadily students show up — the overall attendance rate, who has been absent the most per term, and whether anyone is running over their leave quota.';

  // ── Rate stat-card caption (delta context) ────────────────────────────────
  const rateCaption = !hasCurrentPeriodData
    ? 'No attendance encoded yet'
    : rateState === 'ok' && priorRate !== null
      ? `vs ${compareAy} · ${priorRate.toFixed(1)}%`
      : rateState === 'no-data'
        ? `No data for ${compareAy}`
        : 'This period';

  // ── Chart-data derivations (pure reshaping into chart-prop shapes) ─────────

  // Attendance mix (period) — the P/L/EX/A partition as a labelled pie: every
  // marked day is exactly one status, so the four slices are a genuine share
  // of the encoded-days total. The % is rendered ON each slice (thin slices
  // fall back to the legend). Colours align with ATTENDANCE_MIX_SERIES order
  // so the pie, composition bars, and legend never drift.
  const attendanceMixPieData: LabeledPieSlice[] =
    hasCurrentPeriodData && kpis.current.encodedDays > 0
      ? [
          { name: 'Present', value: kpis.current.present },
          { name: 'Late', value: kpis.current.late },
          { name: 'Excused', value: kpis.current.excused },
          { name: 'Absent', value: kpis.current.absent },
        ]
      : [];
  const attendanceMixColors = ATTENDANCE_MIX_SERIES.map((s) => s.color);

  // Composition per term — grouped (non-stacked) bars, one cluster per term.
  // Values are each status's SHARE of that term's marked days (%), not raw
  // counts, so a term with more encoded days doesn't dwarf a lighter one and
  // the comparison stays a like-for-like mix (same proportion semantic the
  // stacked version had). Present dominates the y-axis by nature — the small
  // Late/Excused/Absent bars sit near the floor.
  const compositionData = [1, 2, 3, 4].map((t) => {
    const point = mixByTerm.find((p) => p.level === `T${t}`);
    const total =
      (point?.Present ?? 0) +
      (point?.Late ?? 0) +
      (point?.Excused ?? 0) +
      (point?.Absent ?? 0);
    const pct = (n: number) =>
      total > 0 ? Math.round((n / total) * 1000) / 10 : 0;
    return {
      x: `T${t}`,
      present: pct(point?.Present ?? 0),
      late: pct(point?.Late ?? 0),
      excused: pct(point?.Excused ?? 0),
      absent: pct(point?.Absent ?? 0),
    };
  });

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

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Attendance rate this period"
            value={hasCurrentPeriodData ? rate : '—'}
            format="percent"
            icon={CalendarCheck}
            delta={hasCurrentPeriodData ? rateDelta : undefined}
            deltaGoodWhen="up"
            deltaFormat="absolute"
            deltaUnit="pp"
            subtext={rateCaption}
            sparkline={rateSparkline.length > 1 ? rateSparkline : undefined}
          />
          <MetricCard
            label="Days absent this period"
            value={hasCurrentPeriodData ? kpis.current.absent : '—'}
            format="number"
            icon={CalendarX}
            subtext={
              hasCurrentPeriodData
                ? 'Marked absent (reason not tracked)'
                : 'Not yet encoded'
            }
          />
          <MetricCard
            label="Late incidents this period"
            value={hasCurrentPeriodData ? kpis.current.late : '—'}
            format="number"
            icon={Clock}
            subtext={hasCurrentPeriodData ? 'This period' : 'Not yet encoded'}
          />
          <MetricCard
            label="Over their leave quota"
            value={compassionateOver.length + vacationOver.length}
            format="number"
            icon={ShieldAlert}
            subtext="Leave quotas"
          />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <InsightChartCard
            cap="This period"
            title="Attendance mix"
            icon={CalendarCheck}
          >
            {attendanceMixPieData.length === 0 ? (
              <EmptyChartState message="No attendance encoded yet — the mix appears once this period has marks." />
            ) : (
              <>
                <LabeledPieChart
                  data={attendanceMixPieData}
                  colors={attendanceMixColors}
                />
                <p className="mt-4 font-mono text-[10.5px] text-muted-foreground">
                  {kpis.current.encodedDays.toLocaleString('en-SG')} days marked
                  this period
                </p>
              </>
            )}
          </InsightChartCard>

          <InsightChartCard
            cap="Attendance rate per term"
            title="Term-by-term attendance"
            icon={TrendingUp}
          >
            {!haveTrend ? (
              <EmptyChartState message="No attendance data encoded yet — the chart appears once terms have marks." />
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
          </InsightChartCard>
        </div>

        <InsightChartCard
          cap="Composition, term by term"
          title="What's behind the rate"
          icon={Layers}
        >
          {mixByTerm.length === 0 ? (
            <EmptyChartState message="No attendance data encoded yet — the composition appears once terms have marks." />
          ) : (
            <GroupedBarChart
              series={ATTENDANCE_MIX_SERIES}
              data={compositionData}
              yFormat="percent"
              height={260}
            />
          )}
        </InsightChartCard>
      </div>
      {/* ═══ end Attendance health ═══ */}

      {/* ═══ Absence watchlist — top 5 most absent per term ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-amber">
          Absence watchlist
        </p>
        <p className="-mt-3 text-xs text-muted-foreground">
          The top 5 students by days absent in each term. Reasons aren&rsquo;t
          tracked in-system — this ranks who, not why.
        </p>

        {termsWithAbsences.length === 0 ? (
          <InsightChartCard
            cap="Ranked by days absent"
            title="No absences recorded"
            icon={CalendarX}
          >
            <EmptyChartState message="No absences recorded this year — every student has been showing up." />
          </InsightChartCard>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {termsWithAbsences.map((t) => (
              <InsightChartCard
                key={t.termNumber}
                cap="Top 5 · ranked by days absent"
                title={`Term ${t.termNumber}`}
                icon={CalendarX}
              >
                {t.rows.map((r) => (
                  <div key={r.studentSectionId}>
                    <RosterRow
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
                      value={`${r.absences} absent`}
                    />
                    <div className="-mt-1.5 mb-2 flex gap-2 pl-[46px] font-mono text-[10px] tabular-nums text-muted-foreground">
                      <span>{r.attendancePct}% attendance</span>
                      {r.excused > 0 && (
                        <>
                          <span>·</span>
                          <span>{r.excused} excused leave</span>
                        </>
                      )}
                      {r.lates > 0 && (
                        <>
                          <span>·</span>
                          <span>{r.lates} late</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </InsightChartCard>
            ))}
          </div>
        )}
      </div>
      {/* ═══ end Absence watchlist ═══ */}

      {/* ═══ Leave quotas — the reason-tracked leaves (vacation/compassionate) ═══ */}
      <div className="space-y-5 border-t border-hairline pt-7">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-mint">
          Leave quotas
        </p>

        {!haveQuotaRisk ? (
          <InsightChartCard
            cap="Leave quotas"
            title="Everyone is within allowance"
            icon={HeartHandshake}
          >
            <EmptyChartState message="No student is over or approaching a leave quota this period." />
          </InsightChartCard>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Compassionate — over quota only (per-year) */}
              <InsightChartCard
                cap="Compassionate leave · per year"
                title="Over quota"
                icon={HeartHandshake}
              >
                {compassionateOver.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No one over the compassionate-leave allowance.
                  </p>
                ) : (
                  compassionateOver.map((r) => (
                    <RosterRow
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
                      badge={{ text: 'Over', tone: 'destructive' }}
                    />
                  ))
                )}
              </InsightChartCard>

              {/* Vacation — over quota + approaching (per term) */}
              <InsightChartCard
                cap="Vacation leave · per term"
                title={
                  vacationApproaching.length > 0
                    ? `Over quota · +${vacationApproaching.length} approaching`
                    : 'Over quota'
                }
                icon={Umbrella}
              >
                {vacationOver.length === 0 &&
                vacationApproaching.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No one over the vacation-leave allowance this term.
                  </p>
                ) : (
                  <>
                    {vacationOver.map((r) => (
                      <RosterRow
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
                        value={`${r.usedThisTerm} / ${r.allowance} trips`}
                        badge={{ text: 'Over', tone: 'destructive' }}
                      />
                    ))}
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
                          <RosterRow
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
                            value={`${r.usedThisTerm} / ${r.allowance} trips`}
                            badge={{ text: 'Approaching', tone: 'amber' }}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}
              </InsightChartCard>
            </div>

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
