import { AlarmClock, CalendarClock, CircleCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { CreateInvoicePicker } from '@/components/billing/create-invoice-picker';
import { InvoicesTable } from '@/components/billing/invoices-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PageShell } from '@/components/ui/page-shell';
import { loadInvoicesList } from '@/lib/billing/invoices-list.server';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Invoices. QuickBooks decides what is here (its Overdue / Not due
// yet / Paid figures, statuses, Date filter, row and batch actions, Create
// invoice ▾); the SIS decides how it looks — hero, stat tiles that open the
// matching status tab, and the shared table.
export default async function BillingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const [{ date }, list] = await Promise.all([
    searchParams,
    loadInvoicesList(createServiceClient()),
  ]);
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');
  // The tiles count the last 365 days (QuickBooks' own window), so the tab
  // they open widens Date to match. "billing-invoices" is the table's own
  // URL namespace (its status tabs read `billing-invoices.status`).
  const tab = (status: string) =>
    `?billing-invoices.status=${status}&date=last-365`;

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Sales' }, { label: 'Invoices' }]}
        title="Invoices"
        description="Every invoice of the linked students' QuickBooks customers, read live from QuickBooks."
        actions={
          list.connected ? (
            <>
              <RefreshButton label="Refresh" />
              <CreateInvoicePicker
                customers={list.customers}
                importHref={`${qbBase}/app/invoices`}
              />
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
                label="Overdue"
                value={formatSgd(list.bar.overdue)}
                icon={AlarmClock}
                subtext="Unpaid past the due date · last 365 days"
                href={tab('overdue')}
              />
              <MetricCard
                label="Not due yet"
                value={formatSgd(list.bar.notDueYet)}
                icon={CalendarClock}
                subtext="Unpaid, still within terms · last 365 days"
                href={tab('not-due')}
              />
              <MetricCard
                label="Paid in the last 30 days"
                value={formatSgd(list.bar.paidLast30)}
                icon={CircleCheck}
                subtext={`${list.bar.paymentsLast30.toLocaleString('en-SG')} ${
                  list.bar.paymentsLast30 === 1 ? 'payment' : 'payments'
                } received`}
                href={tab('paid')}
              />
            </div>
          </div>
          <InvoicesTable rows={list.rows} qbBase={qbBase} initialDate={date} />
        </>
      )}
    </PageShell>
  );
}
