import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { redirect } from 'next/navigation';

import { SubjectSetupView } from './subject-setup-view';

// Primary — Subject Setup's default level. Guarded here as well as by the
// layout and the middleware.
export default async function SubjectSetupPrimaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string }>;
}) {
  // Matches this path's ROUTE_ACCESS row. The middleware and the module layout
  // both check too; this is the page saying so in its own file rather than
  // inheriting it silently (see lib/auth/require-page-roles.ts).
  await requirePageRoles([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);

  const sp = await searchParams;

  // Level used to be `?level=`. That URL was linkable and may be bookmarked,
  // so it keeps working — carrying the chosen AY across with it.
  if (sp.level === 'secondary') {
    redirect(
      `/sis/admin/subjects/secondary${sp.ay ? `?ay=${encodeURIComponent(sp.ay)}` : ''}`
    );
  }

  return <SubjectSetupView levelType="primary" ay={sp.ay} />;
}
