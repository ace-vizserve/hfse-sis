import { AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { CustomersTable } from '@/components/billing/customers-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomersList } from '@/lib/billing/customers.server';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Customers, as QuickBooks' Customers list: breadcrumb and title,
// "Last updated" + refresh, Customer types and the New customer ▾ split
// button, the money bar, then the list. Open balance is QuickBooks' own A/R
// aging, read when the page loads. New customers come into the SIS from
// To review ("Add to QuickBooks"), so New customer opens it.
export default async function BillingCustomersPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadCustomersList(createServiceClient());
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Billing' }, { label: 'Customers' }]}
        title="Customers"
        actions={
          list.connected && (
            <>
              <span className="text-[13px] text-muted-foreground">
                {list.balancesFrom === 'quickbooks'
                  ? 'Last updated just now'
                  : 'Balances from the last QuickBooks read'}
              </span>
              <RefreshButton label="Refresh" />
              <Button asChild variant="outline">
                <a
                  href={`${qbBase}/app/customers`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Customer types
                </a>
              </Button>
              <div className="flex">
                <Button asChild className="rounded-r-none">
                  <Link href="/billing/review">New customer</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      className="rounded-l-none border-l border-primary-foreground/30"
                      aria-label="More ways to add customers"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem asChild>
                      <a
                        href={`${qbBase}/app/customers`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        Import customers
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          )
        }
      />

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

          <CustomersTable
            rows={list.rows}
            totals={list.totals}
            qbBase={qbBase}
          />
        </>
      )}
    </PageShell>
  );
}
