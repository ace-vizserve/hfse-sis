import { redirect } from 'next/navigation';

import { CohortPageShell } from '@/components/sis/cohorts/cohort-page-shell';
import { PromisedCohortTable } from '@/components/sis/cohorts/promised-cohort-table';
import type { Role } from '@/lib/auth/roles';
import {
  COHORT_DESCRIPTIONS,
  COHORT_TITLES,
  getPromisedCohort,
} from '@/lib/sis/cohorts';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'registrar',
  'school_admin',
  'superadmin',
];

export default async function AdmissionsCohortsPromisedPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.includes(sessionUser.role)) redirect('/');

  const resolved = await searchParams;
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayCode = resolved.ay ?? currentAy?.ay_code ?? '';

  const rows = ayCode ? await getPromisedCohort(ayCode, 'funnel') : [];

  return (
    <CohortPageShell
      cohort="promised"
      title={COHORT_TITLES['promised']}
      description={COHORT_DESCRIPTIONS['promised']}
      count={rows.length}
      scope="funnel"
      ayCode={ayCode}
    >
      <PromisedCohortTable rows={rows} ayCode={ayCode} />
    </CohortPageShell>
  );
}
