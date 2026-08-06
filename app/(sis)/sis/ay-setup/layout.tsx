import { redirect } from 'next/navigation';

import { PageShell } from '@/components/ui/page-shell';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getSessionUser } from '@/lib/supabase/server';

// Shared guard for Year setup and Manage years.
//
// Gated on the capability rather than a role list, so a grant made in
// /sis/admin/roles is enough to open it — same shape as /sis/admin/subjects.
// The capability alone is NOT sufficient: ROUTE_ACCESS still has to admit the
// role, because the proxy runs first.
export default async function AySetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    !can(await getCapabilitiesForRole(sessionUser.role), 'academic_year.read')
  ) {
    redirect('/');
  }

  return <PageShell>{children}</PageShell>;
}
