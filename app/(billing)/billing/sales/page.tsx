import { AlarmClock, CircleCheck, FileClock } from 'lucide-react';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { NewTransactionMenu } from '@/components/billing/new-transaction-menu';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { SalesTable } from '@/components/billing/sales-table';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PageShell } from '@/components/ui/page-shell';
import { loadSalesList } from '@/lib/billing/sales-list.server';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-SG')} ${n === 1 ? one : many}`;

// Billing → Sales transactions. QuickBooks decides what is here (its Overdue
// / Open / Recently paid figures, Type list, Date and Customer filters, row
// and batch actions, New transaction ▾); the SIS decides how it looks.
export default async function BillingSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; date?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const [{ type, date }, list] = await Promise.all([
    searchParams,
    loadSalesList(createServiceClient()),
  ]);
  // The old Payments page sends `?type=payments`: open the Money received tab.
  if (type === 'payments')
    redirect('/billing/sales?billing-sales.status=payments');
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');
  // "billing-sales" is the table's URL namespace; its Type tabs read
  // `billing-sales.status`. Overdue and Open count every date, so those
  // tiles open the tab with Date set to Any date.
  const tab = (status: string, anyDate: boolean) =>
    `?billing-sales.status=${status}${anyDate ? '&date=all' : ''}`;

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Sales' }, { label: 'Sales transactions' }]}
        title="Sales transactions"
        description="Every invoice and payment of the linked students' QuickBooks customers, read live from QuickBooks."
        actions={
          list.connected ? (
            <>
              <RefreshButton label="Refresh" />
              <NewTransactionMenu customers={list.customers} qbBase={qbBase} />
            </>
          ) : null
        }
      />
      {!list.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        <>
          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-3">
              <MetricCard
                label="Overdue invoices"
                value={formatSgd(list.bar.overdue)}
                icon={AlarmClock}
                subtext={count(
                  list.bar.overdueCount,
                  'invoice past its due date',
                  'invoices past their due date'
                )}
                href={tab('overdue', true)}
              />
              <MetricCard
                label="Open invoices and credits"
                value={formatSgd(list.bar.open)}
                icon={FileClock}
                subtext={`${count(list.bar.openCount, 'open item', 'open items')}, less unused credit`}
                href={tab('open', true)}
              />
              <MetricCard
                label="Recently paid"
                value={formatSgd(list.bar.paid)}
                icon={CircleCheck}
                subtext={`${count(list.bar.paidCount, 'payment', 'payments')} in the last 30 days`}
                href={tab('payments', false)}
              />
            </div>
          </div>
          <SalesTable list={list} qbBase={qbBase} initialDate={date} />
        </>
      )}
    </PageShell>
  );
}
