import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Clock,
  HeartHandshake,
  School,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Umbrella,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';
import { CompareAyPicker } from '@/components/dashboard/insights/compare-ay-picker';
import { InsightsSection } from '@/components/dashboard/insights/insights-section';
import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getAttendanceKpisRange,
  getExReasonMixRange,
} from '@/lib/attendance/dashboard';
import { buildAllRowSets } from '@/lib/attendance/drill';
import {
  computeAbsenceMix,
  isApproachingVlQuota,
  splitWatchlist,
} from '@/lib/attendance/insights-watchlist';
import {
  getAttendanceRateTrendByAy,
  rateBadge,
} from '@/lib/attendance/insights-compare';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import { pickExtreme } from '@/lib/dashboard/narrative';
import {
  computeDelta,
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { buildAyTrend } from '@/lib/dashboard/insights-trend';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

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

  // Comparison-AY full-range rate, when a comparison year is set — for the
  // headline rate comparison. Resolved over that AY's whole calendar year.
  const priorRangeInput = compareAy
    ? resolveRange(
        {},
        await getDashboardWindows(compareAy),
        compareAy,
        undefined,
        {
          defaultPreset: 'thisAY',
        }
      )
    : null;

  const trendAys = compareAy ? [selectedAy, compareAy] : [selectedAy];

  const [kpis, exMix, allRowSets, priorKpis, rateTrendPoints] =
    await Promise.all([
      getAttendanceKpisRange(rangeInput),
      getExReasonMixRange(rangeInput),
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
    ]);

  // ── Derived row sets (already computed — no extra DB work) ─────────────────

  // Full topAbsent array from buildAllRowSets (carries absences + excused +
  // attendancePct). The old getTopAbsentRange call is replaced by this; all
  // students with ≥1 absence are eligible for the watchlist.
  const allTopAbsent = allRowSets.topAbsent.filter((r) => r.absences > 0);

  // Split into intervene (truancy signal) vs monitor (health narrative).
  // Cap at 8 per bucket — beyond that the list becomes unactionable.
  const watchlist = splitWatchlist(allTopAbsent, 8);

  // Section-level rollup — worst-attending classes first (already sorted by
  // rollupBySection ascending attendancePct).
  const sectionRows = allRowSets.sectionAttendance;

  // A-vs-EX mix for the school-wide split card.
  const absenceMix = computeAbsenceMix(
    kpis.current.absent,
    kpis.current.excused
  );

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

  // Rate comparison card state — encodedDays > 0 means that AY has
  // actual attendance marks, so we can show a meaningful comparison.
  const hasRateData = (priorKpis?.current.encodedDays ?? 0) > 0;
  const rateState = comparisonCardState(compareAy, hasRateData);

  // Rate is itself a %, so we do a plain vs-prior comparison rather than a
  // percent-of-growth badge. growthDelta is reserved for count-based metrics.
  // Gate on `hasRateData` (same signal as Section 1) so the hero badge and
  // the section card always agree — prevents a misleading "X% vs 0%" when the
  // comparison AY exists but has no encoded attendance days (FIX 1).
  const growthBadge = rateBadge(rate, priorRate, hasRateData, compareAy);

  // Build the per-term two-AY trend. `buildAyTrend` is pure — safe to call on
  // the server. Only show the chart when at least one AY has a non-null value.
  const rateTrend = buildAyTrend(
    rateTrendPoints,
    ['T1', 'T2', 'T3', 'T4'],
    trendAys
  );
  const haveTrend = rateTrendPoints.some((p) => p.value !== null);

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

  // Ch1 rate narrative title — states the finding when the rate is meaningful.
  const rateHealthTitle =
    kpis.current.encodedDays > 0
      ? rate >= 95
        ? 'Attendance is steady'
        : rate >= 90
          ? 'Attendance is holding, but watch the gaps'
          : 'Attendance needs attention'
      : 'How steady is attendance?';

  // Ch2 watchlist — intervene title: states the count (neutral when zero).
  const interveneTitle =
    interveneCount > 0
      ? `${interveneCount} student${interveneCount === 1 ? '' : 's'} to follow up with`
      : 'Intervene';

  // Ch2 sections to watch — worst-attending section (pickExtreme), with tie/empty guard.
  const worstSection = pickExtreme(sectionRows, (s) => s.attendancePct, 'min');
  const sectionsTitle =
    !worstSection.isTie && worstSection.item !== null
      ? `${worstSection.item.sectionName} has the lowest attendance`
      : 'Sections to watch';

  // Ch3 A/EX mix title — describes the dominant signal.
  const absenceMixTitle =
    absenceMix.awayDays === 0
      ? 'Unexplained vs excused'
      : absenceMix.unexplainedPct > 50
        ? 'Mostly unexplained absences this period'
        : absenceMix.unexplainedPct > 25
          ? 'Largely excused, with some unexplained absences'
          : 'Almost all absences are excused';

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

      {/* ═══ Chapter 1 — Attendance health ═══
          Rate headline + trend: how steadily students show up over time. */}
      <div className="space-y-8 border-t-2 border-brand-indigo/25 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-indigo">
            Chapter 1
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Attendance health
          </h2>
        </div>

        {/* 1 — Rate headline: this period vs comparison AY.
            Primary-AY metrics (Late incidents, Absences) always render so the
            registrar always has actionable data. Only the comparison-bearing rate
            card reacts to `rateState` (FIX 2 — matches Records' Section-1 pattern). */}
        <InsightsSection
          eyebrow="Health"
          title={rateHealthTitle}
          description={
            rateState === 'ok'
              ? `Attendance rate for the selected period, compared with ${compareAy}.`
              : compareAy === null
                ? 'Pick a comparison year above to see year-over-year attendance. Until then, this is the rate for the selected period.'
                : `No attendance data found for ${compareAy}. Try a different comparison year.`
          }
        >
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Attendance rate"
              value={rate}
              format="percent"
              icon={CalendarCheck}
              intent={rate >= 95 ? 'good' : rate >= 90 ? 'default' : 'warning'}
              delta={rateDelta}
              deltaGoodWhen="up"
              deltaFormat="absolute"
              deltaUnit="pp"
              comparisonLabel={
                rateState === 'ok' && priorRate !== null
                  ? `vs ${compareAy} · ${priorRate.toFixed(1)}%`
                  : rateState === 'no-data'
                    ? `No data for ${compareAy}`
                    : undefined
              }
              subtext={
                rateState === 'ok' || rateState === 'no-data'
                  ? undefined
                  : 'present, late, or excused of days encoded'
              }
            />
            <MetricCard
              label="Late incidents"
              value={kpis.current.late}
              icon={Clock}
              intent={kpis.current.late > 0 ? 'warning' : 'default'}
              subtext="arrived after the start of the day"
            />
            <MetricCard
              label="Absences"
              value={kpis.current.absent}
              icon={UserX}
              intent={kpis.current.absent > 0 ? 'warning' : 'default'}
              subtext="full days missed without an excuse"
            />
          </section>
        </InsightsSection>

        {/* 2 — Rate trend per term, optionally overlaid with comparison AY. */}
        <InsightsSection
          eyebrow="Trend"
          title="How does attendance move term to term?"
          description={
            compareAy
              ? `Attendance rate per term — ${selectedAy} (solid) alongside ${compareAy} (dashed).`
              : 'Attendance rate per term across the academic year.'
          }
        >
          {!haveTrend ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No attendance data encoded yet — the chart will appear once
                terms have marks.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  Attendance rate per term
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Term-by-term attendance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <MultiSeriesTrendChart
                  series={rateTrend.series}
                  data={rateTrend.data}
                  yFormat="percent"
                  yDomain={[80, 100]}
                />
              </CardContent>
            </Card>
          )}
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 1 ═══ */}

      {/* ═══ Chapter 2 — Who & where to act ═══
          Chronic absentee watchlist (intervene/monitor split) + sections to
          watch. The registrar's action list for this period. */}
      <div className="space-y-8 border-t-2 border-brand-amber/30 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-amber">
            Chapter 2
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Who &amp; where to act
          </h2>
        </div>

        {/* 3 — Chronic absentees — split into Intervene (truancy) vs Monitor
            (health). Switched from getTopAbsentRange → buildAllRowSets.topAbsent
            which carries `excused` + `attendancePct` so we can do the split. */}
        <InsightsSection
          eyebrow="Watchlist"
          title="Who needs attention?"
          description="Students with unexplained absences are split by cause — those away mostly without excuse warrant a follow-up call; those away mostly with excuse are worth monitoring but are likely unwell."
        >
          {allTopAbsent.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No absences recorded in this period — every student has been
                showing up.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Intervene bucket */}
                <Card>
                  <CardHeader>
                    <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                      <ShieldAlert className="size-3" strokeWidth={2.25} />
                      Follow up · mostly unexplained
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                      {interveneTitle}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {watchlist.intervene.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No students with a truancy pattern right now.
                      </p>
                    ) : (
                      <>
                        <ul className="space-y-4">
                          {watchlist.intervene.map((r) => (
                            <li
                              key={r.studentSectionId}
                              className="space-y-1.5"
                            >
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="flex items-baseline gap-2">
                                  <IdentifierLink
                                    href={`/attendance/students/${r.studentNumber}`}
                                  >
                                    {r.studentName}
                                  </IdentifierLink>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                    {r.sectionName}
                                  </span>
                                </span>
                                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                  {r.attendancePct}%
                                </span>
                              </div>
                              {/* A/EX split bar */}
                              <div className="flex h-2 w-full overflow-hidden rounded-full">
                                <div
                                  className="h-full bg-gradient-to-r from-destructive to-destructive/80"
                                  style={{ width: `${r.unexplainedPct}%` }}
                                  title={`${r.absences} unexplained`}
                                />
                                <div
                                  className="h-full bg-muted"
                                  style={{
                                    width: `${100 - r.unexplainedPct}%`,
                                  }}
                                  title={`${r.excused} excused`}
                                />
                              </div>
                              <div className="flex gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
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
                            </li>
                          ))}
                        </ul>
                        {/* Callout (act): quantifies the follow-up burden. */}
                        <RecommendationCallout tone="act">
                          {interveneCount} student
                          {interveneCount === 1 ? '' : 's'} need
                          {interveneCount === 1 ? 's' : ''} a truancy follow-up
                          — unexplained absences are the majority of their
                          away-days.
                        </RecommendationCallout>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Monitor bucket */}
                <Card>
                  <CardHeader>
                    <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-amber">
                      <ShieldCheck className="size-3" strokeWidth={2.25} />
                      Health streak · mostly excused
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                      Monitor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {watchlist.monitor.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No students with a prolonged health absence pattern.
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {watchlist.monitor.map((r) => (
                          <li key={r.studentSectionId} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="flex items-baseline gap-2">
                                <IdentifierLink
                                  href={`/attendance/students/${r.studentNumber}`}
                                >
                                  {r.studentName}
                                </IdentifierLink>
                                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                  {r.sectionName}
                                </span>
                              </span>
                              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                {r.attendancePct}%
                              </span>
                            </div>
                            {/* A/EX split bar */}
                            <div className="flex h-2 w-full overflow-hidden rounded-full">
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
                            <div className="flex gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
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
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </InsightsSection>

        {/* 4 — Sections to watch: per-section attendance table. Uses the already-
            computed sectionAttendance from buildAllRowSets (sorted worst-first). */}
        {sectionRows.length > 0 && (
          <InsightsSection
            eyebrow="By class"
            title="Which classes are below average?"
            description="Sections sorted by attendance rate — lowest first. A class consistently near the bottom may need a check-in with the form adviser."
          >
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <School className="size-3" strokeWidth={2.25} />
                  Sections · lowest attendance first
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                  {sectionsTitle}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-0 pb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline">
                        <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Section
                        </th>
                        <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Level
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Rate
                        </th>
                        <th className="hidden px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground sm:table-cell">
                          Absences
                        </th>
                        <th className="hidden px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:table-cell">
                          Days encoded
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {sectionRows.map((s, idx) => {
                        const isLow = s.attendancePct < 90;
                        const isMid = !isLow && s.attendancePct < 95;
                        return (
                          <tr
                            key={s.sectionId}
                            className={
                              idx % 2 === 0 ? 'bg-card' : 'bg-muted/30'
                            }
                          >
                            <td className="px-4 py-2.5 font-medium text-foreground">
                              <Link
                                href={`/attendance/${s.sectionId}`}
                                className="transition-colors hover:text-primary hover:underline underline-offset-4"
                              >
                                {s.sectionName}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                              {s.level ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span
                                className={[
                                  'font-mono text-xs font-semibold tabular-nums',
                                  isLow
                                    ? 'text-destructive'
                                    : isMid
                                      ? 'text-brand-amber'
                                      : 'text-foreground',
                                ].join(' ')}
                              >
                                {s.attendancePct}%
                              </span>
                            </td>
                            <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {s.absentCount.toLocaleString('en-SG')}
                            </td>
                            <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground lg:table-cell">
                              {s.encodedDays.toLocaleString('en-SG')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* Callout (watch): worst-attending section, guarded by tie/empty. */}
                {!worstSection.isTie && worstSection.item !== null ? (
                  <div className="px-4">
                    <RecommendationCallout tone="watch">
                      {worstSection.item.sectionName} sits at{' '}
                      {worstSection.item.attendancePct}% — lowest in this
                      period. A check-in with the form adviser is worth
                      considering.
                    </RecommendationCallout>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </InsightsSection>
        )}
      </div>
      {/* ═══ end Chapter 2 ═══ */}

      {/* ═══ Chapter 3 — Causes & limits ═══
          Absence mix (A vs EX), excuse reasons, and leave-quota risk. The
          diagnostic: why students are away and whether policies are being
          stretched. */}
      <div className="space-y-8 border-t-2 border-brand-mint/40 pt-7">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-mint">
            Chapter 3
          </p>
          <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-tight text-foreground">
            Causes &amp; limits
          </h2>
        </div>

        {/* 5 — The diagnostic: why are students absent?
            Now prefixed with the school-wide A-vs-EX mix split so the registrar
            can see the truancy vs health signal at a glance before drilling into
            the EX-reason donut. */}
        <InsightsSection
          eyebrow="Diagnosis"
          title="Why are they absent?"
          description="The split between unexplained absences (follow up) and excused ones (monitor), then the breakdown of excuse reasons."
        >
          <div className="space-y-4">
            {/* A/EX mix signal — school-wide split */}
            {absenceMix.awayDays > 0 && (
              <Card>
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Away-day mix
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                    {absenceMixTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Split bar */}
                  <div className="flex h-3 w-full overflow-hidden rounded-full">
                    <div
                      className="h-full bg-gradient-to-r from-destructive to-destructive/70 transition-all"
                      style={{ width: `${absenceMix.unexplainedPct}%` }}
                      title={`${absenceMix.unexplained} unexplained A days`}
                    />
                    <div
                      className="h-full bg-gradient-to-r from-brand-mint to-brand-mint/60"
                      style={{ width: `${absenceMix.excusedPct}%` }}
                      title={`${absenceMix.excused} excused EX days`}
                    />
                  </div>
                  {/* Legend row */}
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive" />
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {absenceMix.unexplainedPct}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Unexplained ({absenceMix.unexplained} days)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-mint" />
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {absenceMix.excusedPct}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Excused ({absenceMix.excused} days)
                      </span>
                    </div>
                  </div>
                  {/* Interpretive copy — derived, no hardcoded claim */}
                  <p className="text-xs text-muted-foreground">
                    {absenceMix.unexplainedPct > 50
                      ? 'Unexplained absences are the majority of away-days this period — the watchlist above is the place to act.'
                      : absenceMix.unexplainedPct > 25
                        ? 'Most away-days are covered by an excuse, but there is a meaningful unexplained minority worth monitoring.'
                        : 'Almost all away-days are excused — attendance is largely health-driven this period.'}
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Excused-leave reasons
                  </CardDescription>
                  <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    Reasons for excused absence
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {exMix.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No excused-leave days recorded in this period.
                    </p>
                  ) : (
                    <DonutChart
                      data={exMix}
                      centerLabel="Excused"
                      centerValue={kpis.current.excused}
                    />
                  )}
                </CardContent>
              </Card>
              <MetricCard
                label="Late incidents"
                value={kpis.current.late}
                icon={Clock}
                intent={kpis.current.late > 0 ? 'warning' : 'default'}
                subtext="not absent, but not on time either"
              />
            </div>
          </div>
        </InsightsSection>

        {/* 6 — Leave-quota risk: over quota + approaching (vacation-leave only). */}
        <InsightsSection
          eyebrow="Quotas"
          title="Is anyone over — or about to exceed — their leave quota?"
          description="Students who have used up their full allowance or gone past it. Vacation leave is tracked per term; compassionate leave runs across the year."
        >
          {!haveQuotaRisk ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No student is over or approaching a leave quota this period.
                Everyone is within their allowance.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Compassionate — over quota only (per-year, at-quota is fine mid-year) */}
                <Card>
                  <CardHeader>
                    <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      <HeartHandshake className="size-3" strokeWidth={2.25} />
                      Compassionate leave · per year
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                      Over quota
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {compassionateOver.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No one over the compassionate-leave allowance.
                      </p>
                    ) : (
                      <ul className="divide-y divide-hairline">
                        {compassionateOver.map((r) => (
                          <li
                            key={r.studentSectionId}
                            className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                          >
                            <span className="flex items-baseline gap-2">
                              {r.studentNumber ? (
                                <IdentifierLink
                                  href={`/attendance/students/${r.studentNumber}`}
                                >
                                  {r.studentName}
                                </IdentifierLink>
                              ) : (
                                <span className="font-medium text-foreground">
                                  {r.studentName}
                                </span>
                              )}
                              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                {r.sectionName}
                              </span>
                            </span>
                            <span className="font-mono text-xs tabular-nums text-destructive">
                              {r.used} / {r.allowance} used
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>

                {/* Vacation leave — over quota + approaching tier */}
                <Card>
                  <CardHeader>
                    <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                      <Umbrella className="size-3" strokeWidth={2.25} />
                      Vacation leave · per term
                    </CardDescription>
                    <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                      Over quota
                      {vacationApproaching.length > 0 && (
                        <span className="ml-2 font-mono text-xs font-normal text-brand-amber">
                          +{vacationApproaching.length} approaching
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {vacationOver.length === 0 &&
                    vacationApproaching.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No one over the vacation-leave allowance this term.
                      </p>
                    ) : (
                      <ul className="divide-y divide-hairline">
                        {/* Over quota — destructive signal */}
                        {vacationOver.map((r) => (
                          <li
                            key={`over-${r.studentSectionId}`}
                            className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                          >
                            <span className="flex items-baseline gap-2">
                              {r.studentNumber ? (
                                <IdentifierLink
                                  href={`/attendance/students/${r.studentNumber}`}
                                >
                                  {r.studentName}
                                </IdentifierLink>
                              ) : (
                                <span className="font-medium text-foreground">
                                  {r.studentName}
                                </span>
                              )}
                              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                {r.sectionName}
                              </span>
                            </span>
                            <span className="font-mono text-xs tabular-nums text-destructive">
                              {r.usedThisTerm} / {r.allowance} used
                            </span>
                          </li>
                        ))}
                        {/* Approaching separator */}
                        {vacationApproaching.length > 0 && (
                          <>
                            {vacationOver.length > 0 && (
                              <li className="py-1.5">
                                <div className="flex items-center gap-2">
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
                              </li>
                            )}
                            {vacationApproaching.map((r) => (
                              <li
                                key={`approaching-${r.studentSectionId}`}
                                className="flex items-baseline justify-between gap-3 py-2.5 text-sm"
                              >
                                <span className="flex items-baseline gap-2">
                                  {r.studentNumber ? (
                                    <IdentifierLink
                                      href={`/attendance/students/${r.studentNumber}`}
                                    >
                                      {r.studentName}
                                    </IdentifierLink>
                                  ) : (
                                    <span className="font-medium text-foreground">
                                      {r.studentName}
                                    </span>
                                  )}
                                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                                    {r.sectionName}
                                  </span>
                                </span>
                                <span className="font-mono text-xs tabular-nums text-brand-amber">
                                  {r.usedThisTerm} / {r.allowance} used
                                </span>
                              </li>
                            ))}
                          </>
                        )}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

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
            </div>
          )}
        </InsightsSection>

        {/* 7 — Seasonal patterns: building history. */}
        <InsightsSection
          eyebrow="Seasonal"
          title="When does attendance dip?"
          description="Term-by-term and year-over-year patterns reveal the predictable dips — exam weeks, post-break Mondays, end-of-year fatigue."
        >
          <BuildingHistoryCard
            label="Seasonal attendance"
            detail="Term-by-term and year-over-year attendance patterns unlock once more history is on record. It fills in automatically each term and year."
          />
        </InsightsSection>
      </div>
      {/* ═══ end Chapter 3 ═══ */}

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
