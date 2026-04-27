import { redirect } from 'next/navigation';

import { CohortPageShell } from '@/components/sis/cohorts/cohort-page-shell';
import { PassExpiryCohortTable } from '@/components/sis/cohorts/pass-expiry-cohort-table';
import type { Role } from '@/lib/auth/roles';
import {
  COHORT_DESCRIPTIONS,
  COHORT_TITLES,
  getPassExpiryCohort,
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

export default async function AdmissionsCohortsPassExpiryPage({
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

  const rows = ayCode ? await getPassExpiryCohort(ayCode, 'funnel') : [];

  return (
    <CohortPageShell
      cohort="pass-expiry"
      title={COHORT_TITLES['pass-expiry']}
      description={COHORT_DESCRIPTIONS['pass-expiry']}
      count={rows.length}
      scope="funnel"
      ayCode={ayCode}
    >
      <PassExpiryCohortTable rows={rows} scope="funnel" ayCode={ayCode} />
    </CohortPageShell>
  );
}
