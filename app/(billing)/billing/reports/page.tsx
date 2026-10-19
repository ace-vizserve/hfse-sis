import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import {
  ReportList,
  type ListedReport,
} from '@/components/billing/report-list';
import { PageShell } from '@/components/ui/page-shell';
import {
  QB_LIST_ORDER,
  QB_ONLY_REPORTS,
  REPORT_GROUPS,
  REPORTS,
} from '@/lib/billing/report-catalog';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Reports, as QuickBooks' Standard reports page: the reports the
// SIS reads live from QuickBooks, grouped and named as QuickBooks lists them,
// with the rest of each list opening in QuickBooks.
const rank = (title: string) => {
  const i = QB_LIST_ORDER.indexOf(title);
  return i < 0 ? QB_LIST_ORDER.length : i;
};

export default async function BillingReportsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const realmId = await connectedRealmId(createServiceClient()).catch(
    () => null
  );

  const reports: ListedReport[] = [
    ...REPORTS.map((r) => ({
      id: r.key,
      title: r.title,
      group: r.group,
      blurb: r.blurb,
      href: `/billing/reports/${r.key}`,
    })),
    ...QB_ONLY_REPORTS.map((r) => ({
      id: `qb:${r.title}`,
      title: r.title,
      group: r.group,
      href: null,
    })),
  ].sort((a, b) => rank(a.title) - rank(b.title));

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Reports' }]}
        title="Reports"
        description="QuickBooks' standard reports, read live: who owes the school, and the books for the accountant. Star the ones you use most."
      />
      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <ReportList
          reports={reports}
          groups={REPORT_GROUPS}
          qbReportsUrl={qboAppUrl(
            qboEnv()?.environment ?? 'sandbox',
            '/app/standardreports'
          )}
        />
      )}
    </PageShell>
  );
}
