import { redirect } from 'next/navigation';

import { AySwitcher } from '@/components/admissions/ay-switcher';
import { EnrolledOpenStepsQueue } from '@/components/admissions/enrolled-open-steps-queue';
import { PageShell } from '@/components/ui/page-shell';
import type { Role } from '@/lib/auth/roles';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { loadEnrolledOpenSteps } from '@/lib/admissions/enrolled-open-steps-loader';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// /admissions/enrolled-open-steps — children set to Enrolled while some of
// their steps were still open ("Enrol anyway" in the stage dialog), so the
// admissions team can chase what is outstanding. Records' "Students needing
// setup" is the model; this is its applicant-side twin. The rule is
// lib/admissions/enrolled-open-steps.ts.
//
// Year: the Admissions `?ay=` switcher convention, defaulting to the current
// year exactly as /admissions/applications does.
//
// Same audience as the sibling Admissions chase pages (the cohorts, closed
// applications).
const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export default async function EnrolledOpenStepsPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.includes(sessionUser.role))
    redirect('/');

  const service = createServiceClient();
  const [currentAy, ayCodes, { ay: ayParam }] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
    searchParams,
  ]);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">
          No current academic year configured.
        </div>
      </PageShell>
    );
  }
  const selectedAy =
    ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  const rows = await loadEnrolledOpenSteps(selectedAy);

  const countLabel =
    rows.length === 0
      ? 'Nobody to chase right now.'
      : `${rows.length.toLocaleString('en-SG')} ${rows.length === 1 ? 'child' : 'children'} to chase.`;

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Admissions · {selectedAy}
          </p>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            Enrolled, steps still open
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Children who were enrolled before every step was finished, usually
            to hold their place in a class. Each one leaves this list once the
            steps shown are done. {countLabel}
          </p>
        </div>
        <div className="w-full md:w-48">
          <AySwitcher current={selectedAy} options={ayCodes} />
        </div>
      </header>

      <EnrolledOpenStepsQueue rows={rows} />
    </PageShell>
  );
}
