import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  ChartBar,
  GraduationCap,
  History,
  Hourglass,
  Tag,
  UserMinus,
  Users,
} from 'lucide-react';

import { AssessmentOutcomesChart } from '@/components/admissions/assessment-outcomes-chart';
import { AySwitcher } from '@/components/admissions/ay-switcher';
import { ConversionFunnelChart } from '@/components/admissions/conversion-funnel-chart';
import { OutdatedApplicationsTable } from '@/components/admissions/outdated-applications-table';
import { ReferralSourceChart } from '@/components/admissions/referral-source-chart';
import { TimeToEnrollmentCard } from '@/components/admissions/time-to-enrollment-card';
import { DocumentBacklogChart } from '@/components/sis/document-backlog-chart';
import { ExpiringDocumentsPanel } from '@/components/sis/expiring-documents-panel';
import { LevelDistributionChart } from '@/components/sis/level-distribution-chart';
import { PipelineStageChart } from '@/components/sis/pipeline-stage-chart';
import { RecentActivityFeed } from '@/components/sis/recent-activity-feed';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  getAssessmentOutcomes,
  getAverageTimeToEnrollment,
  getConversionFunnel,
  getOutdatedApplications,
  getReferralSourceBreakdown,
} from '@/lib/admissions/dashboard';
import {
  getDocumentValidationBacklog,
  getExpiringDocuments,
  getLevelDistribution,
  getPipelineStageBreakdown,
  getRecentSisActivity,
} from '@/lib/sis/dashboard';
import { getSisDashboardSummary } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const EXPIRY_WINDOW_DAYS = 60;

export default async function RecordsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const { ay: ayParam } = await searchParams;
  const ayCodes = await listAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;

  // Records dashboard is the single consolidated Records + Admissions view.
  // Records-side aggregators live in `lib/sis/dashboard.ts` (internal 9-stage
  // pipeline, doc backlog, level distribution, expiring, activity feed).
  // Admissions-side aggregators live in `lib/admissions/dashboard.ts` (avg
  // time-to-enroll, conversion funnel, outdated applications, assessment
  // outcomes, referral sources). Both fire in one Promise.all.
  const [
    summary,
    pipelineStages,
    docBacklog,
    levels,
    expiring,
    activity,
    timeToEnroll,
    funnel,
    outdated,
    assessment,
    referral,
  ] = await Promise.all([
    getSisDashboardSummary(selectedAy),
    getPipelineStageBreakdown(selectedAy),
    getDocumentValidationBacklog(selectedAy),
    getLevelDistribution(selectedAy),
    getExpiringDocuments(selectedAy, EXPIRY_WINDOW_DAYS, 8),
    getRecentSisActivity(8),
    getAverageTimeToEnrollment(selectedAy),
    getConversionFunnel(selectedAy),
    getOutdatedApplications(selectedAy),
    getAssessmentOutcomes(selectedAy),
    getReferralSourceBreakdown(selectedAy),
  ]);

  return (
    <PageShell>
      {/* Hero — title + AY chip + AY switcher (right-aligned) */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · Students & Admissions
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Records dashboard.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Unified view of the student record — internal pipeline stages, document
            backlog, admissions funnel + time-to-enroll, assessment outcomes, referral
            sources, and recent edits. Operational + analytical in one surface.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {selectedAy}
            </Badge>
            {isCurrentAy ? (
              <Badge className="h-7 border-brand-mint bg-brand-mint/30 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
                Current
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Historical
              </Badge>
            )}
          </div>
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      {/* Summary stats row */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <SummaryStat
            label="Total students"
            value={summary.totalStudents}
            icon={Users}
            footnote="In this academic year"
          />
          <SummaryStat
            label="Enrolled"
            value={summary.enrolled}
            icon={GraduationCap}
            footnote="Active + conditional"
          />
          <SummaryStat
            label="In pipeline"
            value={summary.pending}
            icon={Hourglass}
            footnote="Pre-enrollment stages"
          />
          <SummaryStat
            label="Withdrawn"
            value={summary.withdrawn}
            icon={UserMinus}
            footnote="Left during the year"
          />
        </div>
      </section>

      {/* Quick actions */}
      <section className="grid gap-4 md:grid-cols-3">
        <QuickLink
          href={`/records/students?ay=${selectedAy}`}
          icon={Users}
          title="Students"
          description="Browse, search, and edit every student's profile, family, pipeline, and documents."
        />
        <QuickLink
          href={`/records/discount-codes?ay=${selectedAy}`}
          icon={Tag}
          title="Discount Codes"
          description="Manage the enrolment portal's promotion codes for this AY."
        />
        <QuickLink
          href="/records/audit-log"
          icon={History}
          title="Audit Log"
          description="Full append-only log of every Records edit — profile, family, stage, discount, document."
        />
      </section>

      {/* Main grid — pipeline chart (2/3) + level distribution (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineStageChart data={pipelineStages} />
        </div>
        <div className="lg:col-span-1">
          <LevelDistributionChart data={levels} />
        </div>
      </section>

      {/* Admissions analytics — conversion funnel (2/3) + avg time-to-enroll (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConversionFunnelChart data={funnel} />
        </div>
        <div className="lg:col-span-1">
          <TimeToEnrollmentCard data={timeToEnroll} />
        </div>
      </section>

      {/* Document section — backlog chart (2/3) + expiring panel (1/3) */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DocumentBacklogChart data={docBacklog} />
        </div>
        <div className="lg:col-span-1">
          <ExpiringDocumentsPanel
            rows={expiring}
            ayCode={selectedAy}
            windowDays={EXPIRY_WINDOW_DAYS}
          />
        </div>
      </section>

      {/* Needs attention — outdated applications table (full width) */}
      <section className="space-y-3">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Needs attention
          </p>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Outdated applications
          </h2>
        </div>
        <OutdatedApplicationsTable rows={outdated} />
      </section>

      {/* Deep analytics — assessment outcomes + referral sources (2-col) */}
      <section className="grid gap-4 lg:grid-cols-2">
        <AssessmentOutcomesChart data={assessment} />
        <ReferralSourceChart data={referral} />
      </section>

      {/* Activity feed — full width */}
      <RecentActivityFeed rows={activity} />

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ChartBar className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Live data</span>
        <span className="text-border">·</span>
        <span>Cache 10m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
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
          {value.toLocaleString('en-SG')}
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
      className="group flex items-start gap-4 rounded-xl border border-hairline bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-brand-indigo/40 hover:shadow-sm"
    >
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
