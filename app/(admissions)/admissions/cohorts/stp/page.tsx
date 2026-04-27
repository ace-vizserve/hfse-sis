import { redirect } from 'next/navigation';

import { CohortPageShell } from '@/components/sis/cohorts/cohort-page-shell';
import { StpCohortTable } from '@/components/sis/cohorts/stp-cohort-table';
import type { Role } from '@/lib/auth/roles';
import {
  COHORT_DESCRIPTIONS,
  COHORT_TITLES,
  getStpCohort,
} from '@/lib/sis/cohorts';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const ALLOWED_ROLES: Role[] = [
  'admissions',
  'registrar',
  'school_admin',
  'admin',
  'superadmin',
];

export default async function AdmissionsCohortsStpPage({
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

  const rows = ayCode ? await getStpCohort(ayCode, 'funnel') : [];

  return (
    <CohortPageShell
      cohort="stp"
      title={COHORT_TITLES.stp}
      description={COHORT_DESCRIPTIONS.stp}
      count={rows.length}
      scope="funnel"
      ayCode={ayCode}
    >
      <StpCohortTable rows={rows} scope="funnel" ayCode={ayCode} />
    </CohortPageShell>
  );
}
