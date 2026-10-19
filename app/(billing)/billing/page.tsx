import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CustomersTable } from '@/components/billing/customers-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomersList } from '@/lib/billing/customers.server';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Customers, as QuickBooks' Customers list. Every linked student's
// customer with what they owe; Open balance is QuickBooks' own A/R aging,
// read when the page loads.
export default async function BillingCustomersPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadCustomersList(createServiceClient());

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Customers.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Every student linked to their QuickBooks customer.
            {list.currentAy
              ? ` ${list.currentAyLinked.toLocaleString('en-SG')} of ${list.currentAyStudents.toLocaleString('en-SG')} ${list.currentAy} students are linked.`
              : ''}
          </p>
        </div>
        {list.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Button asChild variant="outline">
              <Link href="/billing/review">
                To review
                {list.reviewCount > 0 && (
                  <Badge variant="secondary" className="h-5 tabular-nums">
                    {list.reviewCount}
                  </Badge>
                )}
              </Link>
            </Button>
          </div>
        )}
      </header>

      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <>
          {list.balanceError && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  Balances as last read
                </p>
                <p className="text-sm text-muted-foreground">
                  {list.balanceError} The open balances and overdue amounts
                  below are added up from the invoices the SIS last read.
                </p>
              </div>
            </div>
          )}

          <CustomersTable rows={list.rows} totals={list.totals} />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {list.balancesFrom === 'quickbooks'
              ? 'Balances read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · Changes in QuickBooks arrive within the hour · Every action is in
            the audit log
          </p>
        </>
      )}
    </PageShell>
  );
}
