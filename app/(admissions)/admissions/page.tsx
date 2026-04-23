import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, ChartBar, FileStack, Hourglass, Inbox, Users } from 'lucide-react';

import { AssessmentOutcomesChart } from '@/components/admissions/assessment-outcomes-chart';
import { AySwitcher } from '@/components/admissions/ay-switcher';
import { ConversionFunnelChart } from '@/components/admissions/conversion-funnel-chart';
import { OutdatedApplicationsTable } from '@/components/admissions/outdated-applications-table';
import { ReferralSourceChart } from '@/components/admissions/referral-source-chart';
import { TimeToEnrollmentCard } from '@/components/admissions/time-to-enrollment-card';
import { PipelineStageChart } from '@/components/sis/pipeline-stage-chart';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import {
  getAssessmentOutcomes,
  getAverageTimeToEnrollment,
  getConversionFunnel,
  getOutdatedApplications,
  getReferralSourceBreakdown,
} from '@/lib/admissions/dashboard';
import { getPipelineStageBreakdown } from '@/lib/sis/dashboard';
import { getSisDashboardSummary } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Admissions-module dashboard: pre-enrolment funnel metrics only. Enrolled
// student analytics live on /records. This is the admissions team's home
// surface — they track conversion, time-to-enroll, outdated apps here.
export default async function AdmissionsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
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

  const [summary, pipelineStages, timeToEnroll, funnel, outdated, assessment, referral] =
    await Promise.all([
      getSisDashboardSummary(selectedAy),
      getPipelineStageBreakdown(selectedAy),
      getAverageTimeToEnrollment(selectedAy),
      getConversionFunnel(selectedAy),
      getOutdatedApplications(selectedAy),
      getAssessmentOutcomes(selectedAy),
      getReferralSourceBreakdown(selectedAy),
    ]);

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · Pre-enrolment funnel
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Admissions dashboard.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Inquiry tracking, application pipeline, conversion funnel, and time-to-enroll —
            everything up to the point a student is classified as Enrolled. Once enrolled,
            the permanent cross-year record lives in Records.
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

      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <SummaryStat label="Total applications" value={summary.totalStudents} icon={Users} footnote="In this AY" />
          <SummaryStat label="In pipeline" value={summary.pending} icon={Hourglass} footnote="Pre-enrolment stages" />
          <SummaryStat label="Enrolled (final stage)" value={summary.enrolled} icon={FileStack} footnote="Active + conditional" />
          <SummaryStat label="Avg time to enroll" value={Math.round(timeToEnroll.avgDays ?? 0)} icon={Hourglass} footnote={`days (n=${timeToEnroll.sampleSize ?? 0})`} />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <QuickLink
          href={`/admissions/applications?ay=${selectedAy}`}
          icon={FileStack}
          title="Applications"
          description="Browse every application in flight — inquiry, applied, interviewed, offered, accepted. Profile + family + documents edit here."
        />
        <QuickLink
          href="/admissions/inquiries"
          icon={Inbox}
          title="Inquiries"
          description="SharePoint-sourced inquiry list (pending HFSE IT credential provisioning). Goal: close the gap from inquiry to application."
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ConversionFunnelChart data={funnel} />
        </div>
        <div className="lg:col-span-1">
          <TimeToEnrollmentCard data={timeToEnroll} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineStageChart data={pipelineStages} />
        </div>
        <div className="lg:col-span-1">
          <AssessmentOutcomesChart data={assessment} />
        </div>
      </section>

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

      <ReferralSourceChart data={referral} />

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ChartBar className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>Pre-enrolment only</span>
        <span className="text-border">·</span>
        <span>Cache 10m</span>
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
    <div
      data-slot="card"
      className="@container/card flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm"
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-6">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</p>
          <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
            {value.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="px-6 text-xs text-muted-foreground">{footnote}</p>
    </div>
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
