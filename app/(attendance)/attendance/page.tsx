import { ArrowRight, CalendarCheck, Clock, UserCheck, UserX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AttendanceBySectionCard } from "@/components/attendance/drills/attendance-by-section-card";
import { AttendanceDrillSheet } from "@/components/attendance/drills/attendance-drill-sheet";
import {
  DailyAttendanceDrillCard,
  DayTypeDrillCard,
  ExReasonDrillCard,
  TopAbsentDrillCard,
} from "@/components/attendance/drills/chart-drill-cards";
import { CompassionateQuotaCard } from "@/components/attendance/drills/compassionate-quota-card";
import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PriorityPanel } from "@/components/dashboard/priority-panel";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import {
  getAttendanceKpisRange,
  getAttendancePriority,
  getDailyAttendanceRange,
  getDayTypeDistributionRange,
  getExReasonMixRange,
  getTopAbsentRange,
} from "@/lib/attendance/dashboard";
import { buildAllRowSets } from "@/lib/attendance/drill";
import { attendanceInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import { createClient, getSessionUser } from "@/lib/supabase/server";

export default async function AttendanceDashboard({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  // Teachers should still land on the section picker — the dashboard is
  // registrar+.
  if (session.role === "teacher") redirect("/attendance/sections");

  const supabase = await createClient();
  const { data: ay } = await supabase
    .from("academic_years")
    .select("id, ay_code, label")
    .eq("is_current", true)
    .single();
  if (!ay) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const selectedAy = typeof resolvedSearch.ay === "string" ? resolvedSearch.ay : ay.ay_code;
  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);
  const ayCodes = [ay.ay_code];

  const [kpisResult, dailySeries, exMix, topAbsent, dayTypes, drillRowSets] = await Promise.all([
    getAttendanceKpisRange(rangeInput),
    getDailyAttendanceRange(rangeInput),
    getExReasonMixRange(rangeInput),
    getTopAbsentRange(rangeInput, 10),
    getDayTypeDistributionRange(rangeInput),
    buildAllRowSets({ ayCode: selectedAy, scope: "range", from: rangeInput.from, to: rangeInput.to }),
  ]);

  // Priority depends on the freshly-loaded compassionate roll-up; compute
  // after buildAllRowSets so we don't refetch entries inside the loader.
  const priority = await getAttendancePriority({
    ayCode: selectedAy,
    compassionate: drillRowSets.compassionate,
  });

  const comparisonLabel = `vs ${formatRangeLabel({ from: rangeInput.cmpFrom, to: rangeInput.cmpTo })}`;

  const insights = attendanceInsights({
    attendancePct: kpisResult.current.attendancePct,
    attendancePctPrior: kpisResult.comparison.attendancePct,
    late: kpisResult.current.late,
    latePrior: kpisResult.comparison.late,
    excused: kpisResult.current.excused,
    absent: kpisResult.current.absent,
    absentPrior: kpisResult.comparison.absent,
    encodedDays: kpisResult.current.encodedDays,
  });

  return (
    <PageShell>
      <DashboardHero
        eyebrow="Attendance · Dashboard"
        title="Attendance at a glance"
        description="Daily attendance, absence patterns, day-type mix, top-absent students. Section picker for marking today's attendance is one click away."
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

      <ComparisonToolbar
        ayCode={selectedAy}
        ayCodes={ayCodes}
        range={{ from: rangeInput.from, to: rangeInput.to }}
        comparison={{ from: rangeInput.cmpFrom, to: rangeInput.cmpTo }}
        termWindows={windows.term}
        ayWindows={windows.ay}
        showAySwitcher={false}
      />

      <PriorityPanel payload={priority} />

      <InsightsPanel insights={insights} />

      {/* KPIs */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="Attendance rate"
          value={kpisResult.current.attendancePct}
          format="percent"
          icon={UserCheck}
          intent={kpisResult.current.attendancePct >= 95 ? "good" : "warning"}
          delta={kpisResult.delta}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={dailySeries.current.slice(-14)}
          drillSheet={
            <AttendanceDrillSheet
              target="attendance-summary"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
        <MetricCard
          label="Late incidents"
          value={kpisResult.current.late}
          icon={Clock}
          intent={kpisResult.current.late > kpisResult.comparison.late ? "warning" : "default"}
          deltaGoodWhen="down"
          subtext={`${kpisResult.comparison.late} prior`}
          drillSheet={
            <AttendanceDrillSheet
              target="lates"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
        <MetricCard
          label="Excused"
          value={kpisResult.current.excused}
          icon={CalendarCheck}
          intent="default"
          subtext={`${kpisResult.comparison.excused} prior`}
          drillSheet={
            <AttendanceDrillSheet
              target="excused"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
        <MetricCard
          label="Absences"
          value={kpisResult.current.absent}
          icon={UserX}
          intent={kpisResult.current.absent > 0 ? "bad" : "good"}
          deltaGoodWhen="down"
          subtext={`${kpisResult.comparison.absent} prior`}
          drillSheet={
            <AttendanceDrillSheet
              target="absent"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
      </section>

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

      {/* Section breakdown + compassionate quota */}
      <section className="grid gap-4 lg:grid-cols-2">
        <AttendanceBySectionCard
          data={drillRowSets.sectionAttendance}
          ayCode={selectedAy}
          rangeFrom={rangeInput.from}
          rangeTo={rangeInput.to}
        />
        <CompassionateQuotaCard
          data={drillRowSets.compassionate}
          ayCode={selectedAy}
        />
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
        <span>{kpisResult.current.encodedDays.toLocaleString("en-SG")} encoded days</span>
        <span className="text-border">·</span>
        <span>Cache 5m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
    </PageShell>
  );
}
