import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardList,
  FileStack,
  Hourglass,
  Mail,
  Search,
  Table2,
} from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { CrossAySearch } from '@/components/sis/cross-ay-search';
import { StudentDataTable, type StatusBucketDef } from '@/components/sis/student-data-table';
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
import { getAdmissionsCompletenessForChase } from '@/lib/admissions/dashboard';
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Mirrors the dashboard's chase Quicklink filters. When the URL contains
// one of these `?status=` values, the applicant list pre-filters to rows
// with at least one slot in that bucket so the admissions team can chase
// straight from this page.
const CHASE_STATUS_VALUES = ['to-follow', 'rejected', 'uploaded', 'expired'] as const;
type ChaseStatusFilter = (typeof CHASE_STATUS_VALUES)[number];

const CHASE_STATUS_LABEL: Record<ChaseStatusFilter, string> = {
  'to-follow': 'To follow',
  rejected: 'Rejected',
  uploaded: 'Pending review',
  expired: 'Expired',
};

function parseChaseStatus(raw: string | undefined): ChaseStatusFilter | undefined {
  if (!raw) return undefined;
  return (CHASE_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as ChaseStatusFilter)
    : undefined;
}

// Applications = pre-enrolment, actively-in-pipeline rows. The funnel here
// is the canonical SIS-side `applicationStatus` value space (KD #59) limited
// to the un-enrolled / non-terminal subset:
//   `Submitted` → `Ongoing Verification` → `Processing` → (Enrolled handled
//   by Records). `Cancelled` and `Withdrawn` are terminal failures and don't
//   belong on the in-flight list.
// This is the admissions team's operational list — drop-off% across the 3
// stages surfaces on the /admissions dashboard's InsightsPanel narrative.
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

// Bucket tabs on the applications table mirror the 3 funnel stages instead
// of the generic enrolled/pipeline/withdrawn split — `/admissions/applications`
// pre-filters to ACTIVE_FUNNEL_STAGES server-side, so every row here belongs
// to exactly one of these three buckets and the generic tabs (Enrolled,
// Withdrawn) would always read 0. KD #59 — exact-equality match against the
// canonical SIS-side `applicationStatus` value space.
const APPLICATIONS_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted', statuses: ['Submitted'] },
  { key: 'ongoing-verification', label: 'Ongoing Verification', statuses: ['Ongoing Verification'] },
  { key: 'processing', label: 'Processing', statuses: ['Processing'] },
];

export default async function AdmissionsApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; status?: string }>;
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

  const { ay: ayParam, status: statusParam } = await searchParams;
  const ayCodes = await listAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;
  const isCurrentAy = selectedAy === currentAy.ay_code;
  const chaseStatus = parseChaseStatus(statusParam);

  const allStudents = await listStudents(selectedAy, 'created_at_desc');
  let applications = allStudents.filter((s) =>
    ACTIVE_FUNNEL_STAGES.has((s.applicationStatus ?? '').trim()),
  );

  // Optional chase pre-filter — when ?status=to-follow|rejected|uploaded is
  // set, narrow the table to applicants whose docs row has at least one
  // slot in the matching state. Reuses the same helper that powers the
  // dashboard focused view so the row sets agree.
  if (chaseStatus) {
    const { students: chaseRows } = await getAdmissionsCompletenessForChase(selectedAy, chaseStatus);
    const allowed = new Set(chaseRows.map((r) => r.enroleeNumber));
    applications = applications.filter((s) => allowed.has(s.enroleeNumber));
  }

  // Current-state stage breakdown — direct equality match against the
  // canonical applicationStatus values (KD #59). The `applications` list is
  // already pre-filtered to ACTIVE_FUNNEL_STAGES so every row maps cleanly
  // to one of the 3 stage cards; no "unstaged" bucket needed.
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
            {chaseStatus ? `Admissions · ${CHASE_STATUS_LABEL[chaseStatus]}` : 'Admissions · Applications'}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {chaseStatus
              ? `Applicants with ${CHASE_STATUS_LABEL[chaseStatus]} docs.`
              : 'Applications in flight.'}
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {chaseStatus ? (
              <>
                Pre-enrolment scope only. Applicants below have at least one document slot in the{' '}
                <strong>{CHASE_STATUS_LABEL[chaseStatus]}</strong> state. Open the application to chase
                from the Documents tab, or clear the filter to see every application in flight.
              </>
            ) : (
              <>
                Every application currently in the un-enrolled pipeline —{' '}
                <strong>Submitted</strong>, <strong>Ongoing Verification</strong>, or{' '}
                <strong>Processing</strong>. Once a student is classified as{' '}
                <strong>Enrolled</strong>, their permanent cross-year record moves to Records.
                Cancelled and Withdrawn applications are excluded from this list.
              </>
            )}
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

      {/* Current-state pipeline breakdown — 3 canonical funnel stages
          (Submitted → Ongoing Verification → Processing). At-a-glance "where
          is our intake right now". Drop-off% across the 3 stages surfaces
          on the /admissions dashboard's InsightsPanel narrative. */}
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

      {/* Cross-AY search */}
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Cross-year · Spans every AY
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Find a returning applicant
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Search className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <CrossAySearch />
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Matches on studentNumber, name, or enroleeNumber across every AY. Useful when
          an applicant has applied before under a different AY or enrolee number.
        </CardFooter>
      </Card>

      {/* AY-scoped applications table */}
      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Pre-enrolment · {selectedAy}
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
            linkQuery={isCurrentAy ? undefined : { ay: selectedAy }}
            showSubmittedColumn
            defaultSorting={[{ id: 'submitted', desc: true }]}
            statusBuckets={APPLICATIONS_STATUS_BUCKETS}
          />
        </CardContent>
      </Card>

      {/* Trust strip */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Table2 className="size-3" strokeWidth={2.25} />
        <span>{selectedAy}</span>
        <span className="text-border">·</span>
        <span>{applications.length.toLocaleString('en-SG')} pre-enrolment</span>
        <span className="text-border">·</span>
        <span>Cache 10m</span>
        <span className="text-border">·</span>
        <span>Audit-logged</span>
      </div>
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
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
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
      <CardFooter className="flex-col items-start gap-1 text-xs text-muted-foreground">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-brand-indigo/70"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono tabular-nums">
          {total === 0 ? '—' : `${pct}% of ${total.toLocaleString('en-SG')}`}
        </span>
      </CardFooter>
    </Card>
  );
}
