import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileStack,
  HandHeart,
  Mail,
  MessageSquare,
  Search,
  Table2,
} from 'lucide-react';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { CrossAySearch } from '@/components/sis/cross-ay-search';
import { StudentDataTable } from '@/components/sis/student-data-table';
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
import { listStudents } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Applications = pre-enrolment rows. Anything with stage `Enrolled`,
// `Enrolled (Conditional)` or `Withdrawn` belongs on Records, not here.
// This is the admissions team's operational list.
const ENROLLED_STAGES = new Set(['Enrolled', 'Enrolled (Conditional)']);

// Ordered funnel stages. Anything not in this list falls into "Other".
const STAGES: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (s: string) => boolean;
}> = [
  { key: 'inquiry', label: 'Inquiry', icon: Mail, match: (s) => /inquiry/i.test(s) },
  { key: 'applied', label: 'Applied', icon: ClipboardList, match: (s) => /^applied/i.test(s) },
  { key: 'interviewed', label: 'Interviewed', icon: MessageSquare, match: (s) => /interview/i.test(s) },
  { key: 'offered', label: 'Offered', icon: HandHeart, match: (s) => /^offer/i.test(s) },
  { key: 'accepted', label: 'Accepted', icon: CheckCircle2, match: (s) => /accept/i.test(s) },
];

export default async function AdmissionsApplicationsPage({
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

  const allStudents = await listStudents(selectedAy, 'created_at_desc');
  const applications = allStudents.filter(
    (s) => !ENROLLED_STAGES.has((s.applicationStatus ?? '').trim()),
  );

  // Stage breakdown. Counts match case-insensitively; rows with a status that
  // doesn't match any known funnel stage (including null) go to "unstaged".
  const stageCounts: Record<string, number> = {
    inquiry: 0,
    applied: 0,
    interviewed: 0,
    offered: 0,
    accepted: 0,
    unstaged: 0,
  };
  for (const row of applications) {
    const s = (row.applicationStatus ?? '').trim();
    const stage = STAGES.find((x) => s && x.match(s))?.key ?? 'unstaged';
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
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
            Admissions · Applications
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Applications in flight.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every application that is not yet enrolled — inquiry, applied, interviewed,
            offered, accepted. Once a student is classified as <strong>Enrolled</strong>,
            their permanent cross-year record moves to Records.
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

      {/* Funnel stage breakdown */}
      <section className="@container/main">
        <div className="grid grid-cols-2 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3 @5xl/main:grid-cols-5">
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
        {stageCounts.unstaged > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-3">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-brand-amber" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">
                {stageCounts.unstaged.toLocaleString('en-SG')} application
                {stageCounts.unstaged === 1 ? '' : 's'}
              </span>{' '}
              have no funnel stage set. They&apos;ll appear in the table below and should
              be advanced to Inquiry or beyond.
            </p>
          </div>
        )}
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
