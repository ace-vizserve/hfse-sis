import {
  ArrowLeft,
  CalendarCheck,
  Clock,
  HeartHandshake,
  Umbrella,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DonutChart } from '@/components/dashboard/charts/donut-chart';
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
import { IdentifierLink } from '@/components/ui/identifier-link';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getAttendanceKpisRange,
  getDailyAttendanceRange,
  getExReasonMixRange,
  getTopAbsentRange,
} from '@/lib/attendance/dashboard';
import { buildAllRowSets } from '@/lib/attendance/drill';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  comparisonCardState,
  resolveCompareAy,
} from '@/lib/dashboard/comparison';
import {
  resolveRange,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
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

  const [kpis, dailySeries, exMix, topAbsent, quotaRows, priorKpis] =
    await Promise.all([
      getAttendanceKpisRange(rangeInput),
      getDailyAttendanceRange(rangeInput),
      getExReasonMixRange(rangeInput),
      getTopAbsentRange(rangeInput, 10),
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
    ]);

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
  const growthBadge =
    priorRate === null
      ? { label: 'Building history', tone: 'muted' as const }
      : {
          label: `${rate}% vs ${priorRate}% in ${compareAy}`,
          tone: (rate >= priorRate ? 'mint' : 'amber') as 'mint' | 'amber',
        };

  const chronic = topAbsent.filter((r) => r.absences > 0);
  const maxAbsences = chronic.reduce((m, r) => Math.max(m, r.absences), 0);

  const compassionateOver = quotaRows.compassionate.filter(
    (r) => r.isOverQuota
  );
  const vacationOver = quotaRows.vacationLeave.filter((r) => r.isOverTermQuota);
  const haveQuotaRisk = compassionateOver.length > 0 || vacationOver.length > 0;

  const haveTrend = dailySeries.current.length > 1;

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
        description="How steadily students show up — the overall attendance rate, who is chronically absent, why students are away, and whether anyone is running over their leave quota."
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

      {/* 1 — Rate headline: this period vs comparison AY. */}
      <InsightsSection
        eyebrow="Health"
        title="How steady is attendance?"
        description={
          rateState === 'ok'
            ? `Attendance rate for the selected period, compared with ${compareAy}.`
            : compareAy === null
              ? 'Pick a comparison year above to see year-over-year attendance. Until then, this is the rate for the selected period.'
              : `No attendance data found for ${compareAy}. Try a different comparison year.`
        }
      >
        {rateState === 'building' ? (
          <BuildingHistoryCard
            label="Year-over-year attendance rate"
            detail="Pick a comparison year above to see how the attendance rate compares to a prior year. It fills in automatically each year."
          />
        ) : rateState === 'no-data' ? (
          <BuildingHistoryCard
            variant="no-data"
            label={`No attendance data for ${compareAy}`}
          />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Attendance rate"
              value={rate}
              format="percent"
              icon={CalendarCheck}
              intent={rate >= 95 ? 'good' : rate >= 90 ? 'default' : 'warning'}
              subtext={
                priorRate !== null
                  ? `${priorRate}% in ${compareAy}`
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
        )}
      </InsightsSection>

      {/* 2 — Rate trend across the period. */}
      <InsightsSection
        eyebrow="Trend"
        title="How does attendance move day to day?"
        description="The daily attendance rate across the selected period — the rhythm behind the headline number."
      >
        {!haveTrend ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Not enough days encoded in this period to plot a trend yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Attendance rate per day
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Daily attendance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                label="Attendance %"
                current={dailySeries.current}
                yFormat="percent"
              />
            </CardContent>
          </Card>
        )}
      </InsightsSection>

      {/* 3 — Chronic absentees. */}
      <InsightsSection
        eyebrow="Watchlist"
        title="Who is chronically absent?"
        description="The students with the most full-day absences over the selected period — the first place to look when attendance dips."
      >
        {chronic.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No absences recorded in this period — every student has been
              showing up.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Most absences
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Top absentees
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {chronic.map((r) => {
                  const widthPct =
                    maxAbsences > 0
                      ? Math.max(
                          4,
                          Math.round((r.absences / maxAbsences) * 100)
                        )
                      : 0;
                  return (
                    <li key={r.sectionStudentId} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex items-baseline gap-2">
                          <span className="font-medium text-foreground">
                            {r.studentName}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                            {r.sectionName}
                          </span>
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {r.absences.toLocaleString('en-SG')} absences
                          {r.lates > 0 ? ` · ${r.lates} late` : ''}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-destructive to-brand-amber"
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

      {/* 4 — The diagnostic: why are students absent? */}
      <InsightsSection
        eyebrow="Diagnosis"
        title="Why are they absent?"
        description="The mix of recorded excuse reasons across the period — and how often students simply arrived late."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Excused-leave reasons
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Reasons for absence
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
      </InsightsSection>

      {/* 5 — Leave-quota risk: compassionate + vacation over/near quota. */}
      <InsightsSection
        eyebrow="Quotas"
        title="Is anyone over their leave quota?"
        description="Students who have used up — or gone past — their compassionate (per year) or vacation (per term) leave allowance."
      >
        {!haveQuotaRisk ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No student is over a leave quota this period. Everyone is within
              their allowance.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
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
            <Card>
              <CardHeader>
                <CardDescription className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <Umbrella className="size-3" strokeWidth={2.25} />
                  Vacation leave · per term
                </CardDescription>
                <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                  Over quota
                </CardTitle>
              </CardHeader>
              <CardContent>
                {vacationOver.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No one over the vacation-leave allowance this term.
                  </p>
                ) : (
                  <ul className="divide-y divide-hairline">
                    {vacationOver.map((r) => (
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
                          {r.usedThisTerm} / {r.allowance} used
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </InsightsSection>

      {/* 6 — Seasonal patterns: building history. */}
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

      {/* Footer trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <CalendarCheck className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Attendance health</span>
        <span className="text-border">·</span>
        <span>Refreshes every few minutes</span>
      </div>
    </PageShell>
  );
}
