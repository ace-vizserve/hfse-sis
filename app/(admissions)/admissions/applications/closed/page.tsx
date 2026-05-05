import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Archive, XCircle } from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { StudentDataTable, type StatusBucketDef } from '@/components/sis/student-data-table';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Closed applications = applicants who exited the funnel without ever being
// classified as Enrolled. Two terminal `applicationStatus` values per KD #59.
// Pre-enrolment-only by definition (the column lives on the admissions
// `_status` table); enrolled students never reach these statuses.
const TERMINAL_STAGES = new Set(['Cancelled', 'Withdrawn']);

// Bucket tabs scoped to the terminal subset. Mirrors the funnel-stage pattern
// on the active applications page so the user gets a consistent tab interaction.
const APPLICATIONS_CLOSED_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  { key: 'cancelled', label: 'Cancelled', statuses: ['Cancelled'] },
  { key: 'withdrawn', label: 'Withdrawn', statuses: ['Withdrawn'] },
];

export default async function AdmissionsApplicationsClosedPage({
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

  const allStudents = await listStudents(selectedAy, 'created_at_desc');
  const closed = allStudents.filter((s) =>
    TERMINAL_STAGES.has((s.applicationStatus ?? '').trim()),
  );

  const cancelledCount = closed.filter(
    (s) => (s.applicationStatus ?? '').trim() === 'Cancelled',
  ).length;
  const withdrawnCount = closed.filter(
    (s) => (s.applicationStatus ?? '').trim() === 'Withdrawn',
  ).length;

  return (
    <PageShell>
      <Link
        href="/admissions/applications"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Applications in flight
      </Link>

      {/* Hero */}
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · History
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Closed applications.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Applicants who exited the funnel without ever being classified as{' '}
            <strong>Enrolled</strong> — terminal <strong>Cancelled</strong> and{' '}
            <strong>Withdrawn</strong> rows. Read-only archive. The Submitted column
            shows when each application was originally filed; subtract from today to
            gauge how long the application was alive before closing.
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

      {/* Breakdown — 2 terminal buckets. Same gradient-icon-tile pattern as
          the active-funnel StageStat cards but without the progress bar
          (a closed list isn't a pipeline; the % isn't meaningful). */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2">
          <ClosedStat label="Cancelled" value={cancelledCount} icon={XCircle} />
          <ClosedStat label="Withdrawn" value={withdrawnCount} icon={Archive} />
        </div>
      </section>

      {/* List */}
      <StudentDataTable
        data={closed}
        statusBuckets={APPLICATIONS_CLOSED_STATUS_BUCKETS}
        showSubmittedColumn
        defaultSorting={[{ id: 'submitted', desc: true }]}
        linkBase="/admissions/applications"
        linkQuery={{ ay: selectedAy }}
      />
    </PageShell>
  );
}

function ClosedStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground @[200px]/card:text-[32px]">
          {value.toLocaleString('en-SG')}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
