import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardList,
  FileStack,
  Hourglass,
  Mail,
} from 'lucide-react';

import { EarlyBirdAyControl } from '@/components/admissions/early-bird-ay-control';
import {
  StudentDataTable,
  type StatusBucketDef,
} from '@/components/sis/student-data-table';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import {
  getUpcomingAcademicYear,
  listSelectableAcademicYears,
} from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';

// /admissions/upcoming/applications — early-bird pipeline + selection (KD #77).
//
// The open/switch/close control lives here (Admissions), not in SIS Admin.
// SIS Admin only CREATES academic years; choosing which upcoming AY accepts
// early-bird applications happens on this page. At most one upcoming AY is open
// (enforced by the PATCH route). When one is open, its application pipeline is
// listed below the control.

const ACTIVE_FUNNEL_STAGES = new Set([
  'Submitted',
  'Ongoing Verification',
  'Processing',
]);

const STAGES: Array<{
  key: string;
  status: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'submitted', status: 'Submitted', label: 'Submitted', icon: Mail },
  {
    key: 'ongoing-verification',
    status: 'Ongoing Verification',
    label: 'Ongoing Verification',
    icon: ClipboardList,
  },
  {
    key: 'processing',
    status: 'Processing',
    label: 'Processing',
    icon: Hourglass,
  },
];

const APPLICATIONS_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted', statuses: ['Submitted'] },
  {
    key: 'ongoing-verification',
    label: 'Ongoing Verification',
    statuses: ['Ongoing Verification'],
  },
  { key: 'processing', label: 'Processing', statuses: ['Processing'] },
];

export default async function UpcomingAdmissionsApplicationsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const canManage =
    sessionUser.role === 'school_admin' || sessionUser.role === 'superadmin';

  const [upcomingAy, allAys] = await Promise.all([
    getUpcomingAcademicYear(),
    listSelectableAcademicYears(),
  ]);
  const candidates = allAys
    .filter((a) => !a.is_current)
    .map((a) => ({ ayCode: a.ay_code, label: a.label }));

  const header = (
    <>
      <Link
        href="/admissions"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Admissions dashboard
      </Link>
      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Upcoming AY
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Early-bird applications.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Open one upcoming academic year for early applications. The parent
          portal accepts submissions for the open year, and they appear here
          until that year becomes the operational AY at rollover.
        </p>
      </header>
    </>
  );

  // No upcoming AY open → the control card carries the picker / empty state.
  if (!upcomingAy) {
    return (
      <PageShell>
        {header}
        <EarlyBirdAyControl
          candidates={candidates}
          openAyCode={null}
          canManage={canManage}
        />
      </PageShell>
    );
  }

  const allStudents = await listStudents(upcomingAy.ay_code, 'created_at_desc');
  const applications = allStudents.filter((s) =>
    ACTIVE_FUNNEL_STAGES.has((s.applicationStatus ?? '').trim())
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
      {header}

      <EarlyBirdAyControl
        candidates={candidates}
        openAyCode={upcomingAy.ay_code}
        canManage={canManage}
      />

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
