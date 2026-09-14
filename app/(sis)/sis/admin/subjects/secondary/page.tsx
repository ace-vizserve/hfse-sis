import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { SubjectSetupView } from '../subject-setup-view';

// Secondary. Session and capability are guarded by the parent layout, which
// runs for this route too.
export default async function SubjectSetupSecondaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  // Matches this path's ROUTE_ACCESS row. The middleware and the module
  // layout check too; this is the page stating it in its own file rather
  // than inheriting it silently (lib/auth/require-page-roles.ts).
  await requirePageRoles([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);

  const sp = await searchParams;
  return <SubjectSetupView levelType="secondary" ay={sp.ay} />;
}
