import { redirect } from 'next/navigation';

import { CreateInvoicePicker } from '@/components/billing/create-invoice-picker';
import { InvoicesTable } from '@/components/billing/invoices-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import { loadInvoicesList } from '@/lib/billing/invoices-list.server';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Invoices, as QuickBooks' Sales → Invoices: every invoice of the
// linked students' customers, from the SIS's copy of QuickBooks.
export default async function BillingInvoicesPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadInvoicesList(createServiceClient());

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Invoices.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every invoice of the linked students&rsquo; QuickBooks customers.
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
        <>
          <InvoicesTable rows={list.rows} bar={list.bar} />
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Changes in QuickBooks arrive within the hour · Every action is in
            the audit log
          </p>
        </>
      )}
    </PageShell>
  );
}
