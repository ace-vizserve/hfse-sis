import { redirect } from 'next/navigation';

import { CreateInvoicePicker } from '@/components/billing/create-invoice-picker';
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
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Sales transactions.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every invoice and payment of the linked students&rsquo; QuickBooks
            customers.
          </p>
        </div>
        {list.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <CreateInvoicePicker customers={list.customers} />
          </div>
        )}
      </header>
      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <SalesTable
          list={list}
          qbBase={qbBase}
          initialType={type === 'payments' ? 'payments' : 'all'}
        />
      )}
    </PageShell>
  );
}
