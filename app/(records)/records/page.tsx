import {
  AlertTriangle,
  ArrowRight,
  ChartBar,
  GraduationCap,
  History,
  Tag,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActionList, type ActionItem } from "@/components/dashboard/action-list";
import { TrendChart } from "@/components/dashboard/charts/trend-chart";
import { ComparisonToolbar } from "@/components/dashboard/comparison-toolbar";
import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ClassAssignmentReadinessCard } from "@/components/sis/class-assignment-readiness-card";
import { DocumentChaseQueueStrip } from "@/components/sis/document-chase-queue-strip";
import {
  DocumentBacklogDrillCard,
  ExpiringDocsDrillCard,
  LevelDistributionDrillCard,
  PipelineStageDrillCard,
} from "@/components/sis/drills/chart-drill-cards";
import { RecordsDrillSheet } from "@/components/sis/drills/records-drill-sheet";
import { RecentActivityFeed } from "@/components/sis/recent-activity-feed";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { getCurrentAcademicYear, listAyCodes as listAcademicAyCodes } from "@/lib/academic-year";
import { recordsInsights } from "@/lib/dashboard/insights";
import { formatRangeLabel, resolveRange, type DashboardSearchParams } from "@/lib/dashboard/range";
import { getDashboardWindows } from "@/lib/dashboard/windows";
import {
  getClassAssignmentReadiness,
  getDocumentValidationBacklog,
  getEnrollmentVelocityRange,
  getExpiringDocuments,
  getLevelDistribution,
  getPipelineStageBreakdown,
  getRecentSisActivity,
  getRecordsKpisRange,
  getWithdrawalVelocityRange,
} from "@/lib/sis/dashboard";
import { freshenAyDocuments } from "@/lib/p-files/freshen-document-statuses";
import { getSisDashboardSummary } from "@/lib/sis/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const EXPIRY_WINDOW_DAYS = 60;

// Records dashboard — enrolled students only. Pre-enrolment funnel
// analytics live on /admissions. This page surfaces the permanent
// record view: who's enrolled, doc validation backlog, document
// expiry, level distribution, recent edits.
export default async function RecordsDashboard({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (
    sessionUser.role !== "registrar" &&
    sessionUser.role !== "school_admin" &&
    sessionUser.role !== "admin" &&
    sessionUser.role !== "superadmin"
  ) {
    redirect("/");
  }
  // Registrar = operational user (writes admissions data per KD #37); the
  // other allowed roles (school_admin/admin/superadmin) are oversight. The
  // analytics + KPIs are shared, but the operational top-of-fold pieces
  // (chase queue strip, "Documents to collect" action list, class-assignment
  // readiness) only matter to the registrar; oversight users see the
  // dashboard framed as a school-wide overview.
  const isOperational = sessionUser.role === "registrar";

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const resolvedSearch = await searchParams;
  const ayParam = typeof resolvedSearch.ay === "string" ? resolvedSearch.ay : undefined;
  const ayCodes = await listAcademicAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(resolvedSearch, windows, selectedAy);

  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the dashboard reads the column. Cached 60s; existing PATCH routes
  // invalidate via the sis:${ayCode} tag.
  await freshenAyDocuments(selectedAy);

  const [
    summary,
    docBacklog,
    levels,
    expiring,
    activity,
    pipelineStages,
    kpisResult,
    enrolVelocity,
    withdrawVelocity,
    classAssignment,
  ] = await Promise.all([
    getSisDashboardSummary(selectedAy),
    getDocumentValidationBacklog(selectedAy),
    getLevelDistribution(selectedAy),
    getExpiringDocuments(selectedAy, EXPIRY_WINDOW_DAYS, 8),
    getRecentSisActivity(8),
    getPipelineStageBreakdown(selectedAy),
    getRecordsKpisRange(rangeInput),
    getEnrollmentVelocityRange(rangeInput),
    getWithdrawalVelocityRange(rangeInput),
    getClassAssignmentReadiness(selectedAy),
  ]);

  const comparisonLabel = kpisResult.comparisonRange
    ? `vs ${formatRangeLabel(kpisResult.comparisonRange)}`
    : undefined;

  const insights = recordsInsights({
    newEnrollments: kpisResult.current.enrollmentsInRange,
    withdrawals: kpisResult.current.withdrawalsInRange,
    newEnrollmentsPrior: kpisResult.comparison?.enrollmentsInRange,
    withdrawalsPrior: kpisResult.comparison?.withdrawalsInRange,
    activeEnrolled: kpisResult.current.activeEnrolled,
    expiringSoon: kpisResult.current.expiringSoon,
    enrollmentDelta: kpisResult.delta ?? undefined,
  });

  // Expiring-doc action list: top N students whose docs expire soonest.
  const expiringItems: ActionItem[] = expiring.slice(0, 6).map((row) => ({
    label: row.studentName,
    sublabel: `${row.slotLabel}`,
    meta: row.daysUntilExpiry < 0 ? `${Math.abs(row.daysUntilExpiry)}d overdue` : `${row.daysUntilExpiry}d left`,
    severity: row.daysUntilExpiry < 0 ? "bad" : row.daysUntilExpiry <= 14 ? "warn" : "info",
    href: `/records/students/by-enrolee/${row.enroleeNumber}`,
  }));

  return (
    <PageShell>
      <DashboardHero
        eyebrow={isOperational ? "Records · Enrolled students" : "Records · School-wide overview"}
        title={isOperational ? "Student records" : "Student records — oversight"}
        description={
          isOperational
            ? "Permanent cross-year record of every enrolled student. Document backlog, expiring documents, level distribution, recent edits. Pre-enrolment applications live on Admissions."
            : "Read-only oversight of enrolled students across every academic year. Day-to-day record management is owned by the registrar."
        }
        badges={[
          { label: selectedAy },
          { label: isCurrentAy ? "Current" : "Historical", tone: isCurrentAy ? "mint" : "muted" },
        ]}
      />

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
      />

      {/* Document chase queue — registrar-only operational top-of-fold.
          Oversight roles see the same data via the analytical cards below
          but skip this top strip because they don't act on the buckets. */}
      {isOperational && <DocumentChaseQueueStrip ayCode={selectedAy} />}

      <InsightsPanel insights={insights} />

      {/* Range-aware KPIs */}
      <section className="grid gap-4 xl:grid-cols-4">
        <MetricCard
          label="New enrollments"
          value={kpisResult.current.enrollmentsInRange}
          icon={UserPlus}
          intent="default"
          delta={kpisResult.delta ?? undefined}
          deltaGoodWhen="up"
          comparisonLabel={comparisonLabel}
          sparkline={enrolVelocity.current.slice(-14)}
          subtext={
            kpisResult.current.lateEnroleesInRange > 0
              ? `${kpisResult.current.lateEnroleesInRange} late enrollee${
                  kpisResult.current.lateEnroleesInRange === 1 ? "" : "s"
                } (KD #68)`
              : undefined
          }
          drillSheet={
            <RecordsDrillSheet
              target="enrollments-range"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
        <MetricCard
          label="Withdrawals"
          value={kpisResult.current.withdrawalsInRange}
          icon={UserMinus}
          intent={kpisResult.current.withdrawalsInRange > 0 ? "warning" : "good"}
          deltaGoodWhen="down"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.withdrawalsInRange} prior`
              : undefined
          }
          drillSheet={
            <RecordsDrillSheet
              target="withdrawals-range"
              ayCode={selectedAy}
              initialScope="range"
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          }
        />
        <MetricCard
          label="Active enrolled"
          value={kpisResult.current.activeEnrolled}
          icon={GraduationCap}
          intent="good"
          subtext="Total headcount"
          drillSheet={
            <RecordsDrillSheet
              target="active-enrolled"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
        <MetricCard
          label="Docs expiring ≤60d"
          value={kpisResult.current.expiringSoon}
          icon={AlertTriangle}
          intent={kpisResult.current.expiringSoon > 0 ? "warning" : "good"}
          subtext="From end of range"
          drillSheet={
            <RecordsDrillSheet
              target="expiring-docs"
              ayCode={selectedAy}
              initialScope="ay"
            />
          }
        />
      </section>

      {/* Velocity trends — enrollment + withdrawal side by side */}
      <section className="grid gap-4 lg:grid-cols-2">
        {enrolVelocity.current.length > 1 && (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Enrollment velocity
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                New students per day
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart label="Enrollments" current={enrolVelocity.current} comparison={enrolVelocity.comparison} />
            </CardContent>
          </Card>
        )}
        {withdrawVelocity.current.length > 1 && (
          <Card>
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Withdrawal velocity
              </CardDescription>
              <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
                Withdrawals per day
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                label="Withdrawals"
                current={withdrawVelocity.current}
                comparison={withdrawVelocity.comparison}
              />
            </CardContent>
          </Card>
        )}
      </section>

      {/* All-time AY counters — dashboard-01 SectionCards pattern */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <SummaryStat
            label="Enrolled (all)"
            value={summary.enrolled}
            icon={GraduationCap}
            footnote="Active + conditional"
          />
          <SummaryStat
            label="Total applications"
            value={summary.totalStudents}
            icon={Users}
            footnote="All stages — see Admissions"
          />
          <SummaryStat
            label="Withdrawn (all)"
            value={summary.withdrawn}
            icon={UserMinus}
            footnote="Left during the year"
          />
          <SummaryStat
            label="Doc expiring ≤ 60d"
            value={expiring.length}
            icon={History}
            footnote="Per-student, top 8 shown"
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <QuickLink
          href={`/records/students?ay=${selectedAy}`}
          icon={Users}
          title="Students"
          description="Enrolled students across all years. Open any profile to see cross-year academic and attendance history."
        />
        <QuickLink
          href={`/sis/admin/discount-codes?ay=${selectedAy}`}
          icon={Tag}
          title="Discount Codes"
          description="Enrolment-portal promotion codes for this AY. Lives in SIS Admin — cross-module link for convenience."
        />
        <QuickLink
          href="/records/audit-log"
          icon={History}
          title="Audit Log"
          description="A history of every change to enrolled student records."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DocumentBacklogDrillCard data={docBacklog} ayCode={selectedAy} />
        </div>
        <div className="lg:col-span-1">
          <LevelDistributionDrillCard data={levels} ayCode={selectedAy} />
        </div>
      </section>

      {/* Spec §2 row 8 — pipeline breakdown + expiring docs panel (2+1) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineStageDrillCard data={pipelineStages} ayCode={selectedAy} />
        </div>
        <div className="lg:col-span-1">
          <ExpiringDocsDrillCard rows={expiring} ayCode={selectedAy} />
        </div>
      </section>

      {/* Operational action lists — registrar-only. Oversight roles see the
          underlying counts in the KPI grid + drill sheets, but the
          chase-style action list + class-assignment readiness card frame
          the data as work to do, which doesn't fit the oversight role. */}
      {isOperational && (
        <>
          <ActionList
            id="recent-withdrawals"
            title="Documents to collect"
            description="Students with documents expiring soon or already overdue."
            items={expiringItems}
            emptyLabel="No documents expiring in range."
            viewAllHref="/p-files"
          />

          <ClassAssignmentReadinessCard data={classAssignment} ayCode={selectedAy} />
        </>
      )}

      <RecentActivityFeed rows={activity} />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ChartBar className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Enrolled only</span>
        <span className="text-border">·</span>
        <span>Refreshes every 10 minutes</span>
      </div>
    </PageShell>
  );
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
          {value.toLocaleString("en-SG")}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">{footnote}</CardFooter>
    </Card>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-xl border border-hairline bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-sm">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-base font-semibold text-foreground">{title}</h3>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
}
