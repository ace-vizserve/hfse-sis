import { redirect } from 'next/navigation';

import { PageTabNav } from '@/components/sis/page-tab-nav';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import { PageShell } from '@/components/ui/page-shell';
import { can } from '@/lib/auth/capabilities';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import { getStaffCount, getTeacherList } from '@/lib/auth/staff-list';
import { getSessionUser } from '@/lib/supabase/server';

// The merged staff directory (KD #154). Its two cuts used to be `?view=`
// tabs on one page; they are now child routes, so each is reachable from the
// sidebar and gated on its own.
//
// THIS LAYOUT IS THE SHARED GUARD. It runs for `/sis/admin/staff` and
// everything beneath it, so the role check here covers both cuts. The
// capability that separates them (`staff.view_accounts`) is checked in the
// Accounts page itself — a route needs its own guard, because the URL can be
// typed.
//
// It is ONLY the guard and the shell. The "Staff." header and the two-cut tab
// switcher live in the list pages themselves, not here, because the teacher
// detail page at `[teacherId]` is also a child: rendering them here would have
// stacked a second header above its own, and left the switcher showing two
// tabs with neither selected on a URL that is neither.
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/sis');
  }

  return <PageShell>{children}</PageShell>;
}
