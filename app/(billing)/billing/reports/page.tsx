import { FileChartColumn } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { REPORT_GROUPS, REPORTS } from '@/lib/billing/report-catalog';
import { connectedRealmId } from '@/lib/qbo/client';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → Reports: QuickBooks' Standard reports the SIS can open, grouped
// and named as QuickBooks' own list ("Who owes you"). Each opens the report
// read live from QuickBooks.
export default async function BillingReportsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const realmId = await connectedRealmId(createServiceClient()).catch(
    () => null
  );

  return (
    <PageShell>
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Billing · QuickBooks
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Reports.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          QuickBooks&rsquo; standard reports, read from QuickBooks when you open
          one.
        </p>
      </header>

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : (
        REPORT_GROUPS.map((group) => (
          <Card key={group} className="gap-4 px-6 py-5">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
              {group}
            </h2>
            <ul className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
              {REPORTS.filter((r) => r.group === group).map((r) => (
                <li key={r.key} className="border-b border-border">
                  <Link
                    href={`/billing/reports/${r.key}`}
                    className="group flex items-start gap-3 py-3"
                  >
                    <FileChartColumn className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground group-hover:text-primary">
                        {r.title}
                      </span>
                      <span className="block text-[13px] text-muted-foreground">
                        {r.blurb}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </PageShell>
  );
}
