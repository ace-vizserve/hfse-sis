import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { ChartOfAccounts } from '@/components/billing/chart-of-accounts';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { PageShell } from '@/components/ui/page-shell';
import type { AccountRow } from '@/lib/billing/accounts';
import { loadChartOfAccounts } from '@/lib/billing/accounts.server';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Chart of accounts: QuickBooks' active accounts with the balance
// QuickBooks shows, read live and laid out as QuickBooks' page
// (components/billing/chart-of-accounts). Accounts are set up in QuickBooks.
export default async function BillingAccountsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const service = createServiceClient();
  const realmId = await connectedRealmId(service).catch(() => null);
  let rows: AccountRow[] = [];
  let error: string | null = null;
  if (realmId) {
    try {
      rows = await loadChartOfAccounts(service);
    } catch (e) {
      error = qboErrorMessage(e);
    }
  }

  if (realmId && !error)
    return (
      <PageShell>
        <ChartOfAccounts
          rows={rows}
          qbBase={qboAppUrl(qboEnv()?.environment ?? 'sandbox', '')}
        />
      </PageShell>
    );

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Accounting' }, { label: 'Chart of accounts' }]}
        title="Chart of accounts"
      />
      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-serif text-base font-semibold text-foreground">
            QuickBooks could not be read
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error} Refresh the page to try again.
          </p>
        </div>
      )}
    </PageShell>
  );
}
