import { redirect } from 'next/navigation';

import { ClassChosenTable } from '@/components/sis/cohorts/class-chosen-table';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { loadClassChosenInScope } from '@/lib/admissions/class-chosen-not-enrolled';
import type { Role } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/supabase/server';

// Children whose class has been chosen but whose application is not Enrolled
// yet — they join the class list only on enrolment, so until then this is the
// one place that shows who is waiting. Spans the current AY and the upcoming
// AY taking applications, so there is no `?ay` switch: each row names its
// year. Header chrome mirrors `components/sis/cohorts/cohort-page-shell.tsx`;
// that shell is not reused because its CSV button calls
// /api/sis/cohorts/[cohort], which serves one AY per call — the table's own
// export covers both years here.

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export default async function AdmissionsCohortsClassChosenPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.includes(sessionUser.role))
    redirect('/');

  const { ayCodes, rows } = await loadClassChosenInScope();
  const readyCount = rows.filter((r) => r.ready).length;

  return (
    <PageShell>
      <header className="space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Cohort
          {ayCodes.length > 0 ? ` · ${ayCodes.join(' + ')}` : ''}
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
            Class chosen, not enrolled
          </h1>
          <Badge variant="outline">
            {rows.length.toLocaleString('en-SG')}{' '}
            {rows.length === 1 ? 'student' : 'students'}
          </Badge>
          {readyCount > 0 ? (
            <Badge
              variant="outline"
              className="border-brand-mint bg-brand-mint/30 text-ink"
            >
              {readyCount.toLocaleString('en-SG')} ready to enrol
            </Badge>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          These children have a class chosen, but they join it only once their
          application is Enrolled. Ready to enrol means every step before
          enrolment is done — open the application and set it to Enrolled.
          Otherwise the list names the steps still open.
        </p>
      </header>

      <ClassChosenTable rows={rows} />
    </PageShell>
  );
}
