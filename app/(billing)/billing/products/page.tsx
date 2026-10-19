import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { ProductsTable } from '@/components/billing/products-table';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import { readProducts, type ProductRow } from '@/lib/billing/live.server';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Products & services: QuickBooks' own list, read live.
export default async function BillingProductsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const service = createServiceClient();
  const connected = !!(await connectedRealmId(service));
  let rows: ProductRow[] = [];
  let error: string | null = null;
  if (connected) {
    try {
      rows = await readProducts(service);
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
            Products &amp; services.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            What can go on an invoice, with its price and the income account it
            posts to, read from QuickBooks.
          </p>
        </div>
        {connected && <RefreshButton />}
      </header>
      {!connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : error ? (
        <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : (
        <ProductsTable rows={rows} />
      )}
    </PageShell>
  );
}
