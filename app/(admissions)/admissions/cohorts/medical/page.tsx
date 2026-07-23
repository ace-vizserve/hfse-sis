import { redirect } from 'next/navigation';

import { CohortPageShell } from '@/components/sis/cohorts/cohort-page-shell';
import { CohortTable } from '@/components/sis/cohorts/cohort-table';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import type { Role } from '@/lib/auth/roles';
import {
  COHORT_DESCRIPTIONS,
  COHORT_TITLES,
  getMedicalCohort,
} from '@/lib/sis/cohorts';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export default async function AdmissionsCohortsMedicalPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.includes(sessionUser.role))
    redirect('/');

  const resolved = await searchParams;
  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  const ayCode = resolved.ay ?? currentAy?.ay_code ?? '';

  const rows = ayCode ? await getMedicalCohort(ayCode, 'funnel') : [];

  return (
    <CohortPageShell
      cohort="medical"
      title={COHORT_TITLES.medical}
      description={COHORT_DESCRIPTIONS.medical}
      count={rows.length}
      scope="funnel"
      ayCode={ayCode}
    >
      <CohortTable kind="medical" scope="funnel" ayCode={ayCode} rows={rows} />
    </CohortPageShell>
  );
}
