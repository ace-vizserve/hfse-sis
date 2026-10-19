import { redirect } from 'next/navigation';

import { ChartOfAccounts } from '@/components/billing/chart-of-accounts';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import type { AccountRow } from '@/lib/billing/accounts';
import { loadChartOfAccounts } from '@/lib/billing/accounts.server';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Chart of accounts: QuickBooks' active accounts with the balance
// QuickBooks shows, read live. Read-only — accounts are set up in QuickBooks.
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

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Chart of accounts.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every account in QuickBooks with its balance. Accounts are added and
            changed in QuickBooks.
          </p>
        </div>
        {realmId && !error && <RefreshButton />}
      </header>

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-serif text-base font-semibold text-foreground">
            QuickBooks could not be read
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error} Refresh the page to try again.
          </p>
        </div>
      ) : (
        <ChartOfAccounts rows={rows} />
      )}
    </PageShell>
  );
}
