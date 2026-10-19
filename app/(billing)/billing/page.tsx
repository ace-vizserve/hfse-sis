import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  FileText,
  ListChecks,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { CustomersTable } from '@/components/billing/customers-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
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

// Billing → Customers. QuickBooks decides what is here (its Customers list:
// Name · Company name · Phone · Open balance · Action, the money figures on
// top, New customer ▾); the SIS decides how it looks — hero header, stat
// tiles that deep-link to the table's status tabs, the shared DataTable.
// Open balance is QuickBooks' own A/R aging, read when the page loads. New
// customers come into the SIS from To review ("Add to QuickBooks").

/** A stat tile's money, to the dollar: a tile is read at a glance, and S$
 *  with cents doesn't fit four across a laptop screen. */
const tileSgd = (v: number) => `S$${Math.round(v).toLocaleString('en-SG')}`;

export default async function BillingCustomersPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const list = await loadCustomersList(createServiceClient());
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');
  const n = (v: number) => v.toLocaleString('en-SG');
  // The table's own namespaced status param (KD #84) — a tile is a real
  // navigation onto the tab it names.
  const tab = (status: string) => `?billing-customers.status=${status}`;

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Customers' }]}
        title="Customers"
        description="Every student linked to their QuickBooks customer, with what they owe. Open a customer to see their invoices and payments."
        actions={
          list.connected && (
            <>
              <RefreshButton label="Refresh" />
              <Button asChild variant="outline">
                <Link href="/billing/review">
                  To review
                  {list.reviewCount > 0 && (
                    <Badge variant="secondary" className="h-5 tabular-nums">
                      {n(list.reviewCount)}
                    </Badge>
                  )}
                </Link>
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
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem asChild>
                      <Link href="/billing/review">
                        <ListChecks className="size-4" />
                        To review
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href={`${qbBase}/app/customers`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        Import customers in QuickBooks
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

          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
              <MetricCard
                label="Open balance"
                value={tileSgd(list.totals.openBalance)}
                icon={Wallet}
                subtext={`${n(list.totals.openInvoices)} open invoices · ${n(list.totals.owing)} customers`}
                href={tab('owing')}
              />
              <MetricCard
                label="Overdue"
                value={tileSgd(list.totals.overdue)}
                icon={AlertTriangle}
                tileClassName={
                  list.totals.overdue > 0
                    ? 'from-destructive to-destructive/80'
                    : undefined
                }
                subtext={`${n(list.totals.overdueInvoices)} overdue invoices · ${n(list.totals.overdueCount)} customers`}
                href={tab('overdue')}
              />
              <MetricCard
                label="Paid in the last 30 days"
                value={tileSgd(list.totals.paidLast30)}
                icon={CalendarClock}
                tileClassName="from-brand-mint to-brand-mint/70"
                subtext={`${n(list.totals.paymentsLast30)} payments`}
                href={tab('paid')}
              />
              {list.totals.estimates && (
                <MetricCard
                  label="Estimates"
                  value={tileSgd(list.totals.estimates.total)}
                  icon={FileText}
                  tileClassName="from-brand-sky to-brand-sky/70"
                  subtext={`${n(list.totals.estimates.count)} pending in QuickBooks`}
                  href={tab('estimates')}
                />
              )}
            </div>
          </div>

          <CustomersTable
            rows={list.rows}
            qbBase={qbBase}
            withEstimates={!!list.totals.estimates}
          />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {list.balancesFrom === 'quickbooks'
              ? 'Balances read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · Every action is in the audit log
          </p>
        </>
      )}
    </PageShell>
  );
}
