import { ArrowLeft, FileText, MailWarning, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { DisciplineTable } from '@/components/sis/discipline-table';
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
import { listDisciplineForAy } from '@/lib/discipline/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// The school-wide disciplinary register (#7).
//
// Mr Ace, 2026-08-21, on why this exists at all: "every data … needs a page
// where to see all … then since you see users you must see a user … then also
// update it as well." Nobody at the school asked for it — but until now a
// record was reachable class by class only, and "which letters are still
// waiting on a signed slip" could not be asked of the whole school.
//
// READ AND FILTER, not a second place to file. There is no Create here (a
// record is always about one student in one class, and filing starts from the
// class or the student) and no Delete anywhere in this feature — the API has
// no DELETE by design, because a child's behavioural record that can vanish is
// worth less than one that cannot. Corrections are edits, and they are audited.

export default async function RecordsDisciplinePage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const service = createServiceClient();
  const { ay: ayParam } = await searchParams;
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);

  const selectedAy = ayParam ?? currentAy?.ay_code ?? ayCodes[0] ?? '';
  const isCurrentAy = selectedAy === currentAy?.ay_code;

  // The switcher speaks in AY codes; the records are keyed by the year's id.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', selectedAy)
    .maybeSingle();
  const academicYearId = (ayRow as { id: string } | null)?.id ?? null;

  const records = academicYearId
    ? await listDisciplineForAy(academicYearId)
    : [];

  const lettersWaiting = records.filter(
    (r) => r.recordType === 'letter' && !r.acknowledgedOn
  ).length;
  const studentsInvolved = new Set(records.map((r) => r.studentId)).size;

  return (
    <PageShell>
      <Link
        href="/records"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · Discipline
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Disciplinary records.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every incident and letter filed this year, newest first. Open a
            student to read their full record or correct a filing. Staff file
            these from the class list, on the student panel.
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
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <SummaryStat
            label="Records"
            value={records.length}
            icon={FileText}
            footnote="Filed this academic year"
          />
          {/* The one figure here anyone can act on. The school's letter gives
              the parent two days to return the slip; nothing in this app
              chases it, so seeing the count is the whole mechanism. */}
          <SummaryStat
            label="Slips outstanding"
            value={lettersWaiting}
            icon={MailWarning}
            footnote="Letters with no signed slip back"
          />
          <SummaryStat
            label="Students"
            value={studentsInvolved}
            icon={Users}
            footnote="With at least one record"
          />
        </div>
      </section>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-border px-6 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {isCurrentAy ? 'Current AY' : 'Historical'} · {selectedAy}
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            All records ({records.length.toLocaleString('en-SG')})
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <FileText className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <DisciplineTable records={records} ayCode={selectedAy} />
        </CardContent>
      </Card>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {selectedAy} · Every filing and every correction is recorded on the
        audit log
      </p>
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
      <CardFooter className="text-xs text-muted-foreground">
        {footnote}
      </CardFooter>
    </Card>
  );
}
