import {
  ArrowRight,
  CalendarCheck,
  Clock,
  UserCheck,
  UserX,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdviserAttendanceDashboard } from '@/components/attendance/adviser-dashboard';
import { DeclarationsWaitingPanel } from '@/components/attendance/declarations-waiting-panel';
import { countInboxActionable } from '@/lib/approvals/inbox';
import { DECLARATION_APPROVAL_FLOW } from '@/lib/declarations/approval';
import {
  loadAdviserAttendanceDashboard,
  type AdviserDashboard,
} from '@/lib/attendance/adviser-dashboard-queries';
import { resolveCurrentTermId } from '@/lib/sis/current-term';
import { sgToday } from '@/lib/dates';
import { Suspense } from 'react';

import { RecommendationCallout } from '@/components/dashboard/insights/recommendation-callout';

import { AttendanceDrillSection } from '@/components/attendance/drills/attendance-drill-section';
import { AttendanceDrillSheet } from '@/components/attendance/drills/attendance-drill-sheet';
import { DailyAttendanceDrillCard } from '@/components/attendance/drills/chart-drill-cards';
import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PriorityPanel } from '@/components/dashboard/priority-panel';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getAttendanceKpisRange,
  getAttendancePriority,
  getDailyAttendanceRange,
  getDayTypeDistributionRange,
  getExReasonMixRange,
} from '@/lib/attendance/dashboard';
import { getCompassionateOverQuota } from '@/lib/attendance/drill';
import { attendanceInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  TERM_SCOPED_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import { getSchoolConfig } from '@/lib/sis/school-config';
import { createClient } from '@/lib/supabase/server';
import { getViewContext } from '@/lib/auth/view-context';
import { createServiceClient } from '@/lib/supabase/service';
import type { Role } from '@/lib/auth/roles';

// Resolves the adviser's own dashboard, or null when they advise nothing.
//
// Term comes from the canonical resolver (KD #116) rather than `is_current`,
// which is routinely left unmaintained — the same trap that pinned every report
// card to Term 1 (KD #164).
//
// ⚠ THE `'teacher'` LITERAL BELOW IS DELIBERATE AND MUST STAY A LITERAL.
//
// Phase 3c briefly made it a `viewRole` parameter, on the reasoning that a
// `school_admin` who advises a class now reaches this function too (through the
// lens) and the two halves of the decision should be spelled the same way. That
// was the wrong direction and it was reverted before shipping. The sole call
// site is already inside `if (view === 'teacher')` — the BRANCH CONDITION is
// the lens — so the argument could only ever be the literal it replaced, while
// the parameter turned a hard-coded safe value into a caller-supplied one.
//
// And the value is not inert. `resolveClassroomScope` returns
// `sectionIds: null` — meaning EVERY SECTION IN THE SCHOOL — for any oversight
// role, and everything under here reads through the service client, so a future
// caller passing `'school_admin'` would get exactly the school-wide read
// `loadAdvisedSections` exists to prevent. The function is named
// `…ForTeacher`; it resolves a teacher's dashboard; the literal says so.
async function loadAdviserDashboardForTeacher(
  userId: string
): Promise<AdviserDashboard | null> {
  const service = createServiceClient();
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('is_current', true)
    .maybeSingle();
  const academicYearId = (ayRow as { id: string } | null)?.id;
  if (!academicYearId) return null;

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date, is_current')
    .eq('academic_year_id', academicYearId);
  const termId = resolveCurrentTermId(
    (termRows ?? []) as Array<{
      id: string;
      term_number: number;
      start_date: string | null;
      end_date: string | null;
      is_current: boolean | null;
    }>,
    sgToday()
  );
  if (!termId) return null;

  return loadAdviserAttendanceDashboard({
    role: 'teacher',
    userId,
    academicYearId,
    termId,
  });
}

/**
 * Declarations waiting on this person.
 *
 * ⚠ Never throws. This is one panel on a dashboard; a failure here must not
 * take the whole page down with it, and zero is the honest fallback — the
 * queue at /attendance/declarations is the authority either way.
 */
async function countDeclarationsWaiting(
  userId: string,
  role: Role | null
): Promise<number> {
  try {
    return await countInboxActionable(createServiceClient(), {
      flow: DECLARATION_APPROVAL_FLOW,
      userId,
      role,
    });
  } catch (e) {
    console.error(
      '[attendance] declarations count failed:',
      e instanceof Error ? e.message : String(e)
    );
    return 0;
  }
}

export default async function AttendanceDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const session = await getViewContext();
  if (!session) redirect('/login');
  // The lens, with the account role as the floor. `session.role` still
  // authorises — the loaders below all re-check, and the write routes and RLS
  // never see this value.
  const view = session.activeRole ?? session.role;

  // A teacher used to be bounced straight to the section picker, so the module
  // had no landing surface for the person who uses it every morning. They get
  // one now — but a SCOPED one. Everything below this branch is school-wide and
  // reads through the service client, so simply lifting the redirect would show
  // an adviser every section's attendance, which is the exposure KD #163
  // closed. `loadAdviserAttendanceDashboard` returns null for a teacher who
  // advises nothing (a subject teacher has no attendance work at all — RLS
  // gates `attendance_records` on `is_adviser_for_section`), and those keep the
  // old redirect.
  // How many parent-filed declarations are waiting for THIS person to decide.
  // Rendered as a panel rather than on the notification bell — see
  // components/attendance/declarations-waiting-panel.tsx for why.
  //
  // ⚠ THE COUNT KEEPS THE REAL ROLE. It is an approval-inbox scope
  // (`countInboxActionable`) — "how many filings are waiting on YOU to decide"
  // — and that is an account-level fact the approval routes will answer the
  // same way whichever view is on screen. Lensing it would put a number on the
  // panel that its own queue at /attendance/declarations disagrees with.
  const declarationsWaiting = await countDeclarationsWaiting(
    session.id,
    session.role
  );

  // ⚠ THE BRANCH THAT DECIDES WHICH ATTENDANCE MODULE THIS IS, AND IT IS NOW
  // KEYED ON THE LENS (role-switcher Phase 3c). A teaching admin in the Teacher
  // view gets her own adviser dashboard — the classes she actually takes the
  // register for — instead of the school-wide registrar dashboard below, which
  // is what "viewing as Teacher" is supposed to mean. In the Admin view she
  // gets the registrar dashboard exactly as before, and a plain teacher's
  // entitled set is `['teacher']`, so nothing about a teacher changes.
  //
  // It narrows in one direction only: the adviser dashboard is built from her
  // own assignment rows, which are a strict subset of the school-wide read
  // below.
  if (view === 'teacher') {
    const teacherView = await loadAdviserDashboardForTeacher(session.id);
    // Advises nothing in this view → the section picker, which now scopes the
    // same way and says so. A subject-teacher-only account lands on its empty
    // state rather than on a dashboard with no classes on it.
    if (!teacherView) redirect('/attendance/sections');
    return (
      <PageShell>
        <DeclarationsWaitingPanel count={declarationsWaiting} />
        <AdviserAttendanceDashboard data={teacherView} />
      </PageShell>
    );
  }

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

  const [kpisResult, dailySeries, exMix, dayTypes, compassionateOverQuota] =
    await Promise.all([
      getAttendanceKpisRange(rangeInput),
      getDailyAttendanceRange(rangeInput),
      getExReasonMixRange(rangeInput),
      getDayTypeDistributionRange(rangeInput),
      // Fast, narrow query — independent of the ~180k-row buildAllRowSets
      // scan, so the top-of-fold hero + PriorityPanel stay fast (KD #56/#57
      // streaming split; the full-scan cards render below via
      // <AttendanceDrillSection>, deferred behind Suspense).
      getCompassionateOverQuota(selectedAy),
    ]);

  const priority = await getAttendancePriority({
    ayCode: selectedAy,
    compassionate: compassionateOverQuota,
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
  // still useful when attendance can’t be marked. `compassionateOverQuota`
  // is already filtered to over-quota rows (see getCompassionateOverQuota).
  const overQuotaCount = compassionateOverQuota.length;

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

      <DeclarationsWaitingPanel count={declarationsWaiting} />

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

      {/* EX reason + Day type donuts, section breakdown, leave quotas
          (compassionate per-year + vacation per-term, KD #94), top-absent —
          everything the ~180k-row buildAllRowSets scan feeds streams in
          together, independent of the fast top-of-fold above (KD #56/#57). */}
      <Suspense
        fallback={
          <>
            <section className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </section>
            <Skeleton className="h-64 w-full rounded-xl" />
            <section className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </section>
            <Skeleton className="h-64 w-full rounded-xl" />
          </>
        }
      >
        <AttendanceDrillSection
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
          vacationTermId={currentTermId}
          currentTermLabel={currentTermLabel}
          defaultVlAllowance={schoolConfig.defaultVlAllowancePerTerm}
          exMix={exMix}
          dayTypes={dayTypes}
        />
      </Suspense>

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
