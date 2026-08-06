import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';

// Shared guard for Subject Setup and its per-level routes.
//
// Gated on the capability rather than a role list, so granting a role
// `subjects.read` in /sis/admin/roles is enough to open it. The capability
// alone is NOT sufficient: ROUTE_ACCESS still has to admit the role to this
// prefix, because the proxy runs before this file does.
export default async function SubjectSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!can(await getCapabilitiesForRole(sessionUser.role), 'subjects.read')) {
    redirect('/sis');
  }

  return <PageShell>{children}</PageShell>;
}
