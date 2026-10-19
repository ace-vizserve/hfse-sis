import { redirect } from 'next/navigation';

import { CohortPageShell } from '@/components/sis/cohorts/cohort-page-shell';
import { CohortTable } from '@/components/sis/cohorts/cohort-table';
import type { Role } from '@/lib/auth/roles';
import {
  COHORT_DESCRIPTIONS,
  COHORT_TITLES,
  getMedicalCohort,
} from '@/lib/sis/cohorts';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
];

export default async function RecordsCohortsMedicalPage({
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
  const [currentAy, ayCodes] = await Promise.all([
    getCurrentAcademicYear(service),
    listAyCodes(service),
  ]);
  const ayCode =
    resolved.ay && ayCodes.includes(resolved.ay)
      ? resolved.ay
      : (currentAy?.ay_code ?? '');

  const rows = ayCode ? await getMedicalCohort(ayCode, 'enrolled') : [];

  return (
    <CohortPageShell
      cohort="medical"
      title={COHORT_TITLES.medical}
      description={COHORT_DESCRIPTIONS.medical}
      count={rows.length}
      scope="enrolled"
      ayCode={ayCode}
      ayCodes={ayCodes}
    >
      <CohortTable
        kind="medical"
        scope="enrolled"
        ayCode={ayCode}
        rows={rows}
      />
    </CohortPageShell>
  );
}
