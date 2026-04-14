import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PageShell } from '@/components/ui/page-shell';
import { createClient } from '@/lib/supabase/server';
import { getUserRole } from '@/lib/auth/roles';
import { requireCurrentAyCode } from '@/lib/academic-year';
import {
  getApplicationsByLevel,
  getAssessmentOutcomes,
  getAverageTimeToEnrollment,
  getConversionFunnel,
  getDocumentCompletion,
  getOutdatedApplications,
  getPipelineCounts,
  getReferralSourceBreakdown,
} from '@/lib/admissions/dashboard';
import { CalendarRange } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PipelineCards } from '@/components/admissions/pipeline-cards';
import { TimeToEnrollmentCard } from '@/components/admissions/time-to-enrollment-card';
import { ConversionFunnelChart } from '@/components/admissions/conversion-funnel-chart';
import { ApplicationsByLevelChart } from '@/components/admissions/applications-by-level-chart';
import { OutdatedApplicationsTable } from '@/components/admissions/outdated-applications-table';
import { DocumentCompletionCard } from '@/components/admissions/document-completion-card';
import { AssessmentOutcomesChart } from '@/components/admissions/assessment-outcomes-chart';
import { ReferralSourceChart } from '@/components/admissions/referral-source-chart';
import { AySwitcher } from '@/components/admissions/ay-switcher';
import { Button } from '@/components/ui/button';

type PageProps = {
  searchParams: Promise<{ ay?: string }>;
};

export default async function AdmissionsDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const role = getUserRole(userData.user);

  const currentAy = await requireCurrentAyCode(supabase);
  const selectedAy = sp.ay && /^AY\d{4}$/.test(sp.ay) ? sp.ay : currentAy;

  const { data: ayList } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .order('ay_code', { ascending: false });

  const [
    pipeline,
    timeToEnroll,
    byLevel,
    funnel,
    outdated,
    docCompletion,
    assessment,
    referral,
  ] = await Promise.all([
    getPipelineCounts(selectedAy),
    getAverageTimeToEnrollment(selectedAy),
    getApplicationsByLevel(selectedAy),
    getConversionFunnel(selectedAy),
    getOutdatedApplications(selectedAy),
    getDocumentCompletion(selectedAy),
    getAssessmentOutcomes(selectedAy),
    getReferralSourceBreakdown(selectedAy),
  ]);

  const canExport = role === 'superadmin';

  return (
    <PageShell>
      <Link
        href="/admin"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to admin tools
      </Link>

      <header className="grid gap-6 md:grid-cols-3 md:items-start">
        <div className="space-y-4 md:col-span-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · Phase 2
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Admissions dashboard.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Real-time pipeline visibility for the applications team. All counts
            cached for 10 minutes —{' '}
            <span className="font-medium text-foreground">read-only</span>, never
            writes to the admissions DB.
          </p>
        </div>
        <Card className="@container/card md:col-span-1">
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Viewing
            </CardDescription>
            <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
              Academic year
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <CalendarRange className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            <AySwitcher
              current={selectedAy}
              options={(ayList ?? []).map((a) => ({ code: a.ay_code, label: a.label }))}
            />
            {canExport && (
              <Button asChild variant="outline" className="w-full">
                <a href={`/api/admissions/export?ay=${selectedAy}`}>
                  Export CSV
                </a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Switching year reloads every widget. Data is cached per AY for 10
              minutes.
            </p>
          </CardContent>
        </Card>
      </header>

      <section className="space-y-4">
        <SectionHeading
          eyebrow="Pipeline · current counts"
          title="Where applications stand today"
        />
        <PipelineCards counts={pipeline} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <TimeToEnrollmentCard data={timeToEnroll} />
        <div className="lg:col-span-2">
          <ConversionFunnelChart data={funnel} />
        </div>
      </section>

      <section>
        <ApplicationsByLevelChart data={byLevel} />
      </section>

      <section className="space-y-4">
        <SectionHeading eyebrow="Needs attention" title="Outdated applications" />
        <OutdatedApplicationsTable rows={outdated} />
      </section>

      <section className="space-y-4">
        <SectionHeading
          eyebrow="Supporting views"
          title="Documents, assessments, and referrals"
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <DocumentCompletionCard data={docCompletion} />
          <AssessmentOutcomesChart data={assessment} />
          <ReferralSourceChart data={referral} />
        </div>
      </section>
    </PageShell>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
    </div>
  );
}
