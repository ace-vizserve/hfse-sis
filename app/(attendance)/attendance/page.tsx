import {
  ArrowRight,
  CalendarCheck,
  Clock,
  UserCheck,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';

import { AttendanceBySectionCard } from '@/components/attendance/drills/attendance-by-section-card';
import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import {
  DailyAttendanceDrillCard,
  DayTypeDrillCard,
  ExReasonDrillCard,
  TopAbsentDrillCard,
} from '@/components/attendance/drills/chart-drill-cards';
import { CompassionateQuotaCard } from '@/components/attendance/drills/compassionate-quota-card';
import { VacationLeaveQuotaCard } from '@/components/attendance/drills/vacation-leave-quota-card';
import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import {
  getAttendanceKpisRange,
  getAttendancePriority,
  getDailyAttendanceRange,
  getDayTypeDistributionRange,
  getExReasonMixRange,
} from '@/lib/attendance/dashboard';
import { buildAllRowSets } from '@/lib/attendance/drill';
import { attendanceInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  TERM_SCOPED_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { createClient, getSessionUser } from '@/lib/supabase/server';

export default async function AttendanceDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const session = await getSessionUser();
  if (!session) redirect('/login');

  // Teachers should still land on the section picker — the dashboard is
  // registrar+.
  if (session.role === 'teacher') redirect('/attendance/sections');

  const supabase = await createClient();
  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();
  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const selectedAy =
    typeof resolvedSearch.ay === 'string' ? resolvedSearch.ay : ay.ay_code;
  // getSchoolConfig() takes no AY/term input, so it's independent of
  // getDashboardWindows() and the term-resolution chain below — parallelized
  // rather than fetched serially after them (§2 of 11-performance-patterns.md).
  const [windows, schoolConfig] = await Promise.all([
    getDashboardWindows(selectedAy),
    getSchoolConfig(),
  ]);
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);
  const ayCodes = [ay.ay_code];

  // Resolve current term for the VL quota card (KD #94 — VL is per-term).
  // Prefer the current-flagged term in the selected AY; fall back to T1.
  // termRow genuinely depends on ayRow, so this pair stays sequential.
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', selectedAy)
    .maybeSingle();
  let currentTermId: string | null = null;
  let currentTermLabel: string | null = null;
  if (ayRow) {
    const ayId = (ayRow as { id: string }).id;
    const { data: termRow } = await supabase
      .from('terms')
      .select('id, label, term_number, is_current')
      .eq('academic_year_id', ayId)
      .order('term_number', { ascending: true });
    type TermRow = {
      id: string;
      label: string;
      term_number: number;
      is_current: boolean;
    };
    const terms = (termRow ?? []) as TermRow[];
    const active = terms.find((t) => t.is_current) ?? terms[0] ?? null;
    if (active) {
      currentTermId = active.id;
      currentTermLabel = active.label;
    }
  }

  const [kpisResult, dailySeries, exMix, dayTypes, drillRowSets] =
    await Promise.all([
      getAttendanceKpisRange(rangeInput),
      getDailyAttendanceRange(rangeInput),
      getExReasonMixRange(rangeInput),
      getDayTypeDistributionRange(rangeInput),
      buildAllRowSets({
        ayCode: selectedAy,
        from: rangeInput.from,
        to: rangeInput.to,
        vacationTermId: currentTermId,
        defaultVlAllowance: schoolConfig.defaultVlAllowancePerTerm,
      }),
    ]);

  // Priority depends on the freshly-loaded compassionate roll-up; compute
  // after buildAllRowSets so we don't refetch entries inside the loader.
  const priority = await getAttendancePriority({
    ayCode: selectedAy,
    compassionate: drillRowSets.compassionate,
  });

  const comparisonLabel = kpisResult.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  const insights = attendanceInsights({
    attendancePct: kpisResult.current.attendancePct,
    attendancePctPrior: kpisResult.comparison?.attendancePct,
    late: kpisResult.current.late,
    latePrior: kpisResult.comparison?.late,
    excused: kpisResult.current.excused,
    absent: kpisResult.current.absent,
    absentPrior: kpisResult.comparison?.absent,
    encodedDays: kpisResult.current.encodedDays,
  });

  // Derive the lede sentence from the priority payload — the single most
  // actionable fact right now. Neutral when everything is in.
  const unmarkedCount = priority.headline.value;

  // Over-quota compassionate students — counts students who have exceeded the
  // annual limit; surfaced in the lede on non-school days so the panel is
  // still useful when attendance can’t be marked.
  const overQuotaCount = drillRowSets.compassionate.filter(
    (r) => r.isOverQuota
  ).length;

  const ledeSentence: string = (() => {
    // School day with unmarked sections — the most urgent operational signal.
    if (unmarkedCount > 0) {
      return unmarkedCount === 1
        ? '1 section hasn’t marked attendance yet today — open the section picker to record it.'
        : `${unmarkedCount} sections haven’t marked attendance yet today — open the section picker to record them.`;
    }
    // All sections in on a school day: surface the attendance rate.
    if (
      priority.headline.severity === 'good' &&
      kpisResult.current.encodedDays > 0
    ) {
      return kpisResult.current.attendancePct >= 95
        ? `${kpisResult.current.attendancePct.toFixed(1)}% attendance rate — all sections marked today. Everything looks healthy.`
        : `${kpisResult.current.attendancePct.toFixed(1)}% attendance rate — all sections marked today. Review the absence patterns below.`;
    }
    // Non-school day with over-quota students: name the signal.
    if (overQuotaCount > 0) {
      return overQuotaCount === 1
        ? '1 student has exceeded the compassionate-leave quota — no school today, but worth reviewing before the next school day.'
        : `${overQuotaCount} students have exceeded the compassionate-leave quota — no school today, but worth reviewing before the next school day.`;
    }
    // All clear — no school, no quota issues.
    if (priority.headline.severity === 'good') {
      return 'No school today. Use the range picker to review attendance trends for the selected period.';
    }
    // Fallback: data loaded but nothing specific to surface yet.
    return 'Daily attendance rate, absence patterns, leave quotas, and top-absent students for the selected period.';
  })();

  // Surface a watch callout for a notably low attendance rate, but only when
  // today’s sections are all in (unmarked sections take priority). The 90%
  // threshold marks a meaningful concern — below 95% is warning-level, below
  // 90% is a real story that warrants a callout.
  const ATTENDANCE_CONCERN_THRESHOLD = 90;
  const showLowRateCallout =
    unmarkedCount === 0 &&
    kpisResult.current.encodedDays > 0 &&
    kpisResult.current.attendancePct < ATTENDANCE_CONCERN_THRESHOLD;

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Attendance · Dashboard"
        title="Attendance at a glance"
        description={ledeSentence}
        badges={[{ label: selectedAy }]}
        actions={
          <Button asChild size="sm">
            <Link href="/attendance/sections">
              Mark attendance
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      {/* Operational top-of-fold per KD #57 — registrar's first question is
          "what needs action right now?" (sections still unmarked, students
          near the compassionate-quota threshold), not "monitor school health
          across this range." Range-aware analytics live below the fold. */}
      <PriorityPanel payload={priority} />

      {/* Directive callout when sections are still unmarked on a school day.
          Omitted on non-school days or when all sections are in. */}
      {unmarkedCount > 0 && (
        <RecommendationCallout tone="act">
          {unmarkedCount === 1
            ? '1 section still needs to mark attendance today.'
            : `${unmarkedCount} sections still need to mark attendance today.`}{' '}
          Open the section picker to record them.
        </RecommendationCallout>
      )}

      {/* Watch callout for a notably low attendance rate (below 90%).
          Only shown when today's marking is complete — so the act callout above
          (unmarked sections) takes priority and these two never compete. */}
      {showLowRateCallout && (
        <RecommendationCallout tone="watch">
          {kpisResult.current.attendancePct.toFixed(1)}% attendance rate for the
          selected period is below 90% — check the section breakdown and
          top-absent list below for patterns.
        </RecommendationCallout>
      )}

      {windows.activeTermFallback && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
          Active term hasn&apos;t started yet. Showing the previous term&apos;s
          data as a default — pick a different range above to override.
        </div>
      )}

      <ComparisonToolbar
        ayCode={selectedAy}
        ayCodes={ayCodes}
        range={{ from: rangeInput.from, to: rangeInput.to }}
        comparison={
          rangeInput.cmpFrom && rangeInput.cmpTo
            ? { from: rangeInput.cmpFrom, to: rangeInput.cmpTo }
            : null
        }
        termWindows={windows.term}
        ayWindows={windows.ay}
        showAySwitcher={false}
        presets={TERM_SCOPED_PRESETS}
      />

      {/* KPIs */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Attendance rate"
          value={kpisResult.current.attendancePct}
          format="percent"
          icon={UserCheck}
          intent={kpisResult.current.attendancePct >= 95 ? 'good' : 'warning'}
          delta={kpisResult.delta ?? undefined}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={dailySeries.current.slice(-14)}
          drillSheet={() => (
            <AttendanceDrillSheet
              target="attendance-summary"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Late incidents"
          value={kpisResult.current.late}
          icon={Clock}
          intent={
            kpisResult.comparison &&
            kpisResult.current.late > kpisResult.comparison.late
              ? 'warning'
              : 'default'
          }
          deltaGoodWhen="down"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.late} prior`
              : undefined
          }
          drillSheet={() => (
            <AttendanceDrillSheet
              target="lates"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Excused"
          value={kpisResult.current.excused}
          icon={CalendarCheck}
          intent="default"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.excused} prior`
              : undefined
          }
          drillSheet={() => (
            <AttendanceDrillSheet
              target="excused"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Absences"
          value={kpisResult.current.absent}
          icon={UserX}
          intent={kpisResult.current.absent > 0 ? 'bad' : 'good'}
          deltaGoodWhen="down"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.absent} prior`
              : undefined
          }
          drillSheet={() => (
            <AttendanceDrillSheet
              target="absent"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
      </section>

      {/* Insights — narrative commentary on the KPIs above. Sits below the
          KPIs (and the operational PriorityPanel up top) so the operational
          surface comes first per KD #57's archetype. */}
      <InsightsPanel insights={insights} />

      {/* Daily attendance % trend */}
      {dailySeries.current.length > 1 && (
        <DailyAttendanceDrillCard
          current={dailySeries.current}
          comparison={dailySeries.comparison}
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
        />
      )}

      {/* EX reason + Day type donuts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ExReasonDrillCard
          data={exMix}
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
        />
        <DayTypeDrillCard
          data={dayTypes}
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
          initialCalendar={drillRowSets.calendar}
        />
      </section>

      {/* Section breakdown — sits with the other range-aware analytics. */}
      <AttendanceBySectionCard
        data={drillRowSets.sectionAttendance}
        ayCode={selectedAy}
        rangeFrom={rangeInput.from}
        rangeTo={rangeInput.to}
      />

      {/* Leave quotas — compassionate (per-year) + vacation (per-term, KD #94)
          are both "students near/over a leave quota," grouped side-by-side.
          The vacation card surfaces only when a term is resolvable (otherwise
          this renders as a single column — that's fine). */}
      <section className="grid gap-4 lg:grid-cols-2">
        <CompassionateQuotaCard
          data={drillRowSets.compassionate}
          ayCode={selectedAy}
        />
        {currentTermId && currentTermLabel && (
          <VacationLeaveQuotaCard
            data={drillRowSets.vacationLeave}
            ayCode={selectedAy}
            termId={currentTermId}
            termLabel={currentTermLabel}
          />
        )}
      </section>

      {/* Top-absent students */}
      <TopAbsentDrillCard
        data={drillRowSets.topAbsent}
        ayCode={selectedAy}
        rangeFrom={rangeInput.from}
        rangeTo={rangeInput.to}
        initialTopAbsent={drillRowSets.topAbsent}
      />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <CalendarCheck className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>
          {kpisResult.current.encodedDays.toLocaleString('en-SG')} school days
          marked
        </span>
        <span className="text-border">·</span>
        <span>Refreshes every 5 minutes</span>
      </div>
    </PageShell>
  );
}
