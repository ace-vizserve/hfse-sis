import { AccountsTab } from '@/components/sis/parent-portal/accounts-tab';
import { ApplicationsTab } from '@/components/sis/parent-portal/applications-tab';
import { ParentPortalTabs } from '@/components/sis/parent-portal/parent-portal-tabs';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { PageShell } from '@/components/ui/page-shell';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { requirePageRoles } from '@/lib/auth/require-page-roles';
import { listParentAccounts } from '@/lib/parent-portal/accounts';
import { listApplicationRows } from '@/lib/parent-portal/recovery';
import { createServiceClient } from '@/lib/supabase/service';

async function loadApplicationsTab(canAct: boolean) {
  const service = createServiceClient();
  const [ayCodes, currentAy] = await Promise.all([
    listAyCodes(service),
    getCurrentAcademicYear(service),
  ]);
  const initialAy =
    currentAy && ayCodes.includes(currentAy.ay_code)
      ? currentAy.ay_code
      : (ayCodes[0] ?? '');
  // ⚠ A link opens a family's form with no login, and this list goes to the
  // browser. Viewers' rows are fetched without it.
  const applications = initialAy
    ? await listApplicationRows(service, initialAy, { includeLink: canAct })
    : [];

  return (
    <ApplicationsTab
      ayCodes={ayCodes}
      initialAy={initialAy}
      initialApplications={applications}
      canAct={canAct}
    />
  );
}

async function loadAccountsTab(canAct: boolean) {
  const accounts = await listParentAccounts(createServiceClient());
  return <AccountsTab accounts={accounts} canAct={canAct} />;
}

// /sis/admin/parent-portal?tab=applications|accounts
//
// PURPOSE: a superadmin looks after families' records and logins on the enrolment
// portal; the other SIS Admin roles can read the same two tables.
// PATTERN: data tables under URL-driven tabs (09-design-system §6). Only the open
// tab's table is read.
export default async function ParentPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const sessionUser = await requirePageRoles([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  const canAct = sessionUser.role === 'superadmin';
  const { tab } = await searchParams;
  const active = tab === 'accounts' ? 'accounts' : 'applications';

  const content =
    active === 'accounts'
      ? await loadAccountsTab(canAct)
      : await loadApplicationsTab(canAct);

  return (
    <PageShell>
      <SisPageHeader
        group="Organisation"
        title="Parent Portal."
        description="Families' applications and logins on the enrolment portal. Only a superadmin can make changes here."
      />
      <ParentPortalTabs active={active} />
      {content}
    </PageShell>
  );
}
