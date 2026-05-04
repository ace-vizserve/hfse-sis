import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  CalendarPlus,
  ClipboardList,
  FileStack,
  Hourglass,
  Mail,
  Sparkles,
} from 'lucide-react';

import { StudentDataTable, type StatusBucketDef } from '@/components/sis/student-data-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getUpcomingAcademicYear } from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';

// /admissions/upcoming/applications — early-bird pipeline (KD #77).
//
// Surfaces applications for the AY where `accepting_applications=true AND
// is_current=false`. When no such AY exists, renders an empty state with a
// deep-link to /sis/ay-setup so the registrar knows how to open one.
//
// The page reuses the same stage-card + applications-table pattern as
// /admissions/applications — same component, scope flipped to the upcoming
// AY's `ay{YYYY}_*` tables. Cross-AY search is intentionally omitted (early
// bird is a forward-only flow). Chase-status focused views are also omitted
// here — those live on /admissions/applications for the current AY's
// document chase, not the upcoming AY where the registrar is just opening
// the funnel.

const ACTIVE_FUNNEL_STAGES = new Set(['Submitted', 'Ongoing Verification', 'Processing']);

const STAGES: Array<{
  key: string;
  status: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'submitted', status: 'Submitted', label: 'Submitted', icon: Mail },
  { key: 'ongoing-verification', status: 'Ongoing Verification', label: 'Ongoing Verification', icon: ClipboardList },
  { key: 'processing', status: 'Processing', label: 'Processing', icon: Hourglass },
];

const APPLICATIONS_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted', statuses: ['Submitted'] },
  { key: 'ongoing-verification', label: 'Ongoing Verification', statuses: ['Ongoing Verification'] },
  { key: 'processing', label: 'Processing', statuses: ['Processing'] },
];

export default async function UpcomingAdmissionsApplicationsPage() {
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

  const upcomingAy = await getUpcomingAcademicYear();

  // Empty state — no upcoming AY currently accepting early-bird applications.
  if (!upcomingAy) {
    return (
      <PageShell>
        <Link
          href="/admissions"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Admissions dashboard
        </Link>
        <header className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · Early-bird
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            No upcoming AY open.
          </h1>
        </header>
        <Card className="items-center py-12 text-center">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <CalendarPlus className="size-5" />
            </div>
            <div className="space-y-1">
              <div className="font-serif text-lg font-semibold text-foreground">No early-bird AY currently accepting applications</div>
              <p className="text-[13px] text-muted-foreground">
                When you&apos;re ready to open early-bird for the upcoming AY, create it (or open the existing
                row) from <Link href="/sis/ay-setup" className="font-medium underline underline-offset-2">AY Setup</Link>{' '}
                and toggle <strong>Open for apps</strong>. The parent portal will then accept submissions for that
                AY and this page will list them.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const allStudents = await listStudents(upcomingAy.ay_code, 'created_at_desc');
  const applications = allStudents.filter((s) =>
    ACTIVE_FUNNEL_STAGES.has((s.applicationStatus ?? '').trim()),
  );

  const stageCounts: Record<string, number> = {
    submitted: 0,
    'ongoing-verification': 0,
    processing: 0,
  };
  for (const row of applications) {
    const s = (row.applicationStatus ?? '').trim();
    const stage = STAGES.find((x) => x.status === s)?.key;
    if (stage) stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }

  return (
    <PageShell>
      <Link
        href="/admissions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admissions dashboard
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · Upcoming AY
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Early-bird applications.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Pre-enrolment pipeline for <strong>{upcomingAy.label}</strong>. Same workflow as the current AY —{' '}
            <strong>Submitted</strong>, <strong>Ongoing Verification</strong>, or <strong>Processing</strong> —{' '}
            running in parallel until <strong>{upcomingAy.ay_code}</strong> becomes the operational AY at rollover.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
            >
              {upcomingAy.ay_code}
            </Badge>
            <Badge variant="success" className="h-7 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              <Sparkles className="mr-1 size-3" />
              Early-bird open
            </Badge>
          </div>
        </div>
      </header>

      {/* Stage breakdown */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          {STAGES.map((stage) => (
            <StageStat
              key={stage.key}
              label={stage.label}
              value={stageCounts[stage.key] ?? 0}
              icon={stage.icon}
              total={applications.length}
            />
          ))}
        </div>
      </section>

      {/* Applications table */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Pre-enrolment · {upcomingAy.ay_code} (early-bird)
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Applications ({applications.length.toLocaleString('en-SG')})
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileStack className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <StudentDataTable
            data={applications}
            linkBase="/admissions/applications"
            linkQuery={{ ay: upcomingAy.ay_code }}
            showSubmittedColumn
            defaultSorting={[{ id: 'submitted', desc: true }]}
            statusBuckets={APPLICATIONS_STATUS_BUCKETS}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}

function StageStat({
  label,
  value,
  icon: Icon,
  total,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {pct}% of in-flight applications
        </p>
      </CardContent>
    </Card>
  );
}
