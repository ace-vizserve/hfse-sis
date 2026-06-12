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
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
import { ComparisonToolbar } from '@/components/dashboard/comparison-toolbar';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { MetricCard } from '@/components/dashboard/metric-card';
import { ClassAssignmentReadinessCard } from '@/components/sis/class-assignment-readiness-card';
import { DocumentChaseQueueStrip } from '@/components/sis/document-chase-queue-strip';
import {
  DocumentBacklogDrillCard,
  ExpiringDocsDrillCard,
  LevelDistributionDrillCard,
} from '@/components/sis/drills/chart-drill-cards';
import { RecordsDrillSheet } from '@/components/sis/drills/records-drill-sheet';
import { RecentActivityFeed } from '@/components/sis/recent-activity-feed';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { NoCurrentAyCard } from '@/components/ui/no-current-ay-card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getCurrentAcademicYear,
  listAyCodes as listAcademicAyCodes,
} from '@/lib/academic-year';
import { recordsInsights } from '@/lib/dashboard/insights';
import {
  formatRangeLabel,
  resolveRange,
  FLEXIBLE_PRESETS,
  type DashboardSearchParams,
} from '@/lib/dashboard/range';
import { getDashboardWindows } from '@/lib/dashboard/windows';
import {
  getClassAssignmentReadiness,
  getDocumentValidationBacklog,
  getEnrollmentVelocityRange,
  getExpiringDocuments,
  getLevelDistribution,
  getRecentSisActivity,
  getRecordsKpisRange,
  getWithdrawalVelocityRange,
} from '@/lib/sis/dashboard';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';
import { getSisDashboardSummary } from '@/lib/sis/queries';
import { countUnsyncedEnrolledStudents } from '@/lib/sis/unsynced-students';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const EXPIRY_WINDOW_DAYS = 60;

// Records dashboard — enrolled students only. Pre-enrolment funnel
// analytics live on /admissions. This page surfaces the permanent
// record view: who's enrolled, doc validation backlog, document
// expiry, level distribution, recent edits.
export default async function RecordsDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }
  // Registrar = operational user (writes admissions data per KD #37); the
  // other allowed roles (school_admin/admin/superadmin) are oversight. The
  // analytics + KPIs are shared, but the operational top-of-fold pieces
  // (chase queue strip, "Documents to collect" action list, class-assignment
  // readiness) only matter to the registrar; oversight users see the
  // dashboard framed as a school-wide overview.
  const isOperational = sessionUser.role === 'registrar';

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
  const ayCodes = await listAcademicAyCodes(service);
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  const windows = await getDashboardWindows(selectedAy);
  const rangeInput = resolveRange(
    resolvedSearch,
    windows,
    selectedAy,
    undefined,
    {
      defaultPreset: 'thisMonth',
    }
  );

  // Auto-flip expired/revived doc statuses runs in parallel with the
  // dashboard data fetches instead of serially before them. Cached 60s
  // and tag-invalidated by `sis:${ayCode}`, so this is mostly a no-op
  // anyway. We still await it (after the data Promise.all) so audit-log
  // entries are guaranteed before render returns; by then the parallel
  // pass is usually complete.
  const freshenPromise = freshenAyDocuments(selectedAy);

  const [
    summary,
    docBacklog,
    levels,
    expiring,
    activity,
    kpisResult,
    enrolVelocity,
    withdrawVelocity,
    classAssignment,
    unsyncedCount,
  ] = await Promise.all([
    getSisDashboardSummary(selectedAy),
    getDocumentValidationBacklog(selectedAy),
    getLevelDistribution(selectedAy),
    getExpiringDocuments(selectedAy, EXPIRY_WINDOW_DAYS, 8),
    getRecentSisActivity(8),
    getRecordsKpisRange(rangeInput),
    getEnrollmentVelocityRange(rangeInput),
    getWithdrawalVelocityRange(rangeInput),
    getClassAssignmentReadiness(selectedAy),
    countUnsyncedEnrolledStudents(selectedAy),
  ]);

  await freshenPromise;

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

  return (
    <PageShell>
      <DashboardHero
        eyebrow={
          isOperational
            ? 'Records · Enrolled students'
            : 'Records · School-wide overview'
        }
        title={
          isOperational ? 'Student records' : 'Student records — oversight'
        }
        description={
          isOperational
            ? 'Permanent cross-year record of every enrolled student. Document backlog, expiring documents, level distribution, recent edits. Pre-enrolment applications live on Admissions.'
            : 'Read-only oversight of enrolled students across every academic year. Day-to-day record management is owned by the registrar.'
        }
        badges={[
          { label: selectedAy },
          {
            label: isCurrentAy ? 'Current' : 'Historical',
            tone: isCurrentAy ? 'mint' : 'muted',
          },
        ]}
      />

      {/* Unsynced-students banner — single Alert for every role when the
          current AY has gaps. Routes to /records/unsynced where the
          registrar assigns a class section. Happy path renders nothing. */}
      {unsyncedCount > 0 && isCurrentAy && (
        <Alert variant="warning">
          <AlertIcon variant="warning">
            <AlertTriangle className="size-4" />
          </AlertIcon>
          <AlertTitle>
            {unsyncedCount.toLocaleString('en-SG')} enrolled student
            {unsyncedCount === 1 ? '' : 's'} without a class section
          </AlertTitle>
          <AlertDescription>
            Grading and attendance can&rsquo;t reach them until a section is
            assigned.
          </AlertDescription>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="col-start-2 mt-2 w-fit"
          >
            <Link href="/records/unsynced">Students needing setup</Link>
          </Button>
        </Alert>
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
        presets={FLEXIBLE_PRESETS}
      />

      {/* Document chase queue — registrar-only operational top-of-fold.
          Oversight roles see the same data via the analytical cards below
          but skip this top strip because they don't act on the buckets. */}
      {isOperational && (
        <DocumentChaseQueueStrip ayCode={selectedAy} lens="p-files" />
      )}

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
                  kpisResult.current.lateEnroleesInRange === 1 ? '' : 's'
                }`
              : undefined
          }
          drillSheet={() => (
            <RecordsDrillSheet
              target="enrollments-range"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Withdrawals"
          value={kpisResult.current.withdrawalsInRange}
          icon={UserMinus}
          intent={
            kpisResult.current.withdrawalsInRange > 0 ? 'warning' : 'good'
          }
          deltaGoodWhen="down"
          subtext={
            kpisResult.comparison
              ? `${kpisResult.comparison.withdrawalsInRange} prior · ${summary.withdrawn.toLocaleString(
                  'en-SG'
                )} all-time`
              : `${summary.withdrawn.toLocaleString('en-SG')} all-time`
          }
          drillSheet={() => (
            <RecordsDrillSheet
              target="withdrawals-range"
              ayCode={selectedAy}
              initialFrom={rangeInput.from}
              initialTo={rangeInput.to}
            />
          )}
        />
        <MetricCard
          label="Active enrolled"
          value={kpisResult.current.activeEnrolled}
          icon={GraduationCap}
          intent="good"
          subtext={`${summary.enrolled.toLocaleString('en-SG')} all-time (active + conditional)`}
          drillSheet={() => (
            <RecordsDrillSheet target="active-enrolled" ayCode={selectedAy} />
          )}
        />
        <MetricCard
          label="Docs expiring ≤60d"
          value={kpisResult.current.expiringSoon}
          icon={AlertTriangle}
          intent={kpisResult.current.expiringSoon > 0 ? 'warning' : 'good'}
          subtext="From today"
          drillSheet={() => (
            <RecordsDrillSheet target="expiring-docs" ayCode={selectedAy} />
          )}
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
              <TrendChart
                label="Enrollments"
                current={enrolVelocity.current}
                comparison={enrolVelocity.comparison}
              />
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

      {/* Expiring documents panel — full-width on Records (the previous
          PipelineStageDrillCard was dropped per KD #51; pre-enrolment funnel
          state belongs on /admissions, not on the enrolled-only dashboard). */}
      <section className="grid gap-4">
        <ExpiringDocsDrillCard rows={expiring} ayCode={selectedAy} />
      </section>

      {/* Class-assignment readiness — registrar-only. Oversight roles see the
          underlying counts in the KPI grid + drill sheets, but this card frames
          the data as work to do, which doesn't fit the oversight role. */}
      {isOperational && (
        <ClassAssignmentReadinessCard
          data={classAssignment}
          ayCode={selectedAy}
        />
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
      className="group flex items-start gap-4 rounded-xl border border-hairline bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-sm"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-base font-semibold text-foreground">
            {title}
          </h3>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </Link>
  );
}
