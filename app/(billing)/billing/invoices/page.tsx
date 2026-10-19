import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { CreateInvoicePicker } from '@/components/billing/create-invoice-picker';
import { InvoicesTable } from '@/components/billing/invoices-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import { loadInvoicesList } from '@/lib/billing/invoices-list.server';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Invoices, laid out as QuickBooks' Sales → Invoices: title, the
// money bar, the "All invoices" tab, one filter row (Batch actions · search ·
// Status · Date … Create invoice ▾), then the list.
export default async function BillingInvoicesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadInvoicesList(createServiceClient());
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Sales' }, { label: 'Invoices' }]}
        title="Invoices"
        actions={list.connected ? <RefreshButton label="Refresh" /> : null}
      />
      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <InvoicesTable
          rows={list.rows}
          bar={list.bar}
          qbBase={qbBase}
          createAction={
            <CreateInvoicePicker
              customers={list.customers}
              importHref={`${qbBase}/app/invoices`}
            />
          }
        />
      )}
    </PageShell>
  );
}
