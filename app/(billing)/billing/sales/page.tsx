import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NewTransactionMenu } from '@/components/billing/new-transaction-menu';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SalesTable } from '@/components/billing/sales-table';
import { PageShell } from '@/components/ui/page-shell';
import { loadSalesList } from '@/lib/billing/sales-list.server';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Sales transactions, as QuickBooks' Sales → Sales transactions:
// every invoice and payment of the linked students' customers.
export default async function BillingSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const [{ type }, list] = await Promise.all([
    searchParams,
    loadSalesList(createServiceClient()),
  ]);
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Sales' }, { label: 'Sales transactions' }]}
        title="Sales transactions"
        actions={list.connected ? <RefreshButton label="Refresh" /> : null}
      />
      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <SalesTable
          list={list}
          qbBase={qbBase}
          newTransaction={
            <NewTransactionMenu customers={list.customers} qbBase={qbBase} />
          }
          initialType={type === 'payments' ? 'payments' : 'all'}
        />
      )}
    </PageShell>
  );
}
