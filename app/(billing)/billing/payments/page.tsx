import { redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { PaymentsTable } from '@/components/billing/payments-table';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import { loadPaymentsList } from '@/lib/billing/payments-list.server';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Payments: every payment from the linked students' customers, from
// the SIS's copy of QuickBooks.
export default async function BillingPaymentsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadPaymentsList(createServiceClient());

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Payments.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every payment received from the linked students&rsquo; QuickBooks
            customers, and the invoices each one paid.
          </p>
        </div>
        {list.connected && <RefreshButton />}
      </header>
      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <PaymentsTable rows={list.rows} />
      )}
    </PageShell>
  );
}
