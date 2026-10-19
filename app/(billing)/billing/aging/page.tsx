import { AlertTriangle } from 'lucide-react';
import { redirect } from 'next/navigation';

import {
  AgingTable,
  type AgingTableRow,
} from '@/components/billing/aging-table';
import { AsOfPicker } from '@/components/billing/as-of-picker';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PageShell } from '@/components/ui/page-shell';
import type { AgingReport } from '@/lib/billing/aging';
import { readAgingReport } from '@/lib/billing/live.server';
import { todaySg } from '@/lib/billing/view';
import { connectedRealmId, qboErrorMessage } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Billing → A/R aging: QuickBooks' Accounts receivable aging summary as of a
// date, read live. Customers linked to a student open their Billing page.
export default async function BillingAgingPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const { asOf: raw } = await searchParams;
  const asOf = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todaySg();
  const service = createServiceClient();
  const realmId = await connectedRealmId(service);
  let report: AgingReport = { buckets: [], rows: [], totals: null };
  let rows: AgingTableRow[] = [];
  let error: string | null = null;
  if (realmId) {
    try {
      const [r, links] = await Promise.all([
        readAgingReport(service, asOf),
        fetchAllPages<{ student_number: string; qbo_customer_id: string }>(
          (from, to) =>
            service
              .from('qbo_customers')
              .select('student_number, qbo_customer_id')
              .eq('realm_id', realmId)
              .range(from, to) as unknown as PromiseLike<{
              data: Array<{
                student_number: string;
                qbo_customer_id: string;
              }> | null;
              error: { message: string } | null;
            }>,
          1000,
          { tieBreak: 'student_number' }
        ),
      ]);
      report = r;
      const snOf = new Map<string, string>();
      for (const l of links)
        if (!snOf.has(l.qbo_customer_id))
          snOf.set(l.qbo_customer_id, l.student_number);
      rows = r.rows.map((x) => ({
        ...x,
        studentNumber: x.customerId ? (snOf.get(x.customerId) ?? null) : null,
      }));
    } catch (e) {
      error = qboErrorMessage(e);
    }
  }

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks report
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            A/R aging.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            QuickBooks&rsquo; Accounts receivable aging summary: what each
            customer owes, by how long past due.
          </p>
        </div>
        {realmId && (
          <div className="flex flex-wrap items-end gap-3">
            <AsOfPicker asOf={asOf} />
            <RefreshButton />
          </div>
        )}
      </header>
      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : error ? (
        <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : (
        <AgingTable
          buckets={report.buckets}
          rows={rows}
          totals={report.totals}
        />
      )}
    </PageShell>
  );
}
