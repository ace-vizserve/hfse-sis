import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { ProductsView } from '@/components/billing/products-table';
import { PageShell } from '@/components/ui/page-shell';
import { readProducts, type ProductRow } from '@/lib/billing/live.server';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Products & services: QuickBooks' own list, read live, laid out
// as QuickBooks' Products & services page (components/billing/products-table).
export default async function BillingProductsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const service = createServiceClient();
  const connected = !!(await connectedRealmId(service).catch(() => null));
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
      {!connected || error ? (
        <>
          <BillingPageHeader
            crumbs={[{ label: 'Sales' }, { label: 'Products & services' }]}
            title="Products & services"
          />
          {!connected ? (
            <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
          ) : (
            <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error} Refresh the page to try again.
            </p>
          )}
        </>
      ) : (
        <ProductsView
          rows={rows}
          qbBase={qboAppUrl(qboEnv()?.environment ?? 'sandbox', '')}
        />
      )}
    </PageShell>
  );
}
