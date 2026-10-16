import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  Layers,
  UserSearch,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CreditPanel } from '@/components/billing/credit-panel';
import { CustomerActions } from '@/components/billing/customer-actions';
import { CustomerTabs } from '@/components/billing/customer-tabs';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { loadCustomerPage } from '@/lib/billing/customer-page.server';
import { formatDay } from '@/lib/billing/view';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { formatSgd } from '@/lib/qbo/format';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Billing → one student. Everything billed to their QuickBooks customer,
// newest first, no year filter (Mr Ace: "historical not focused on AY …
// just like an audit log"). Reads the customer from QuickBooks every time it
// opens.
export default async function BillingCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const [{ studentNumber }, { tab }] = await Promise.all([
    params,
    searchParams,
  ]);
  const initialTab = tab === 'payments' || tab === 'details' ? tab : 'invoices';
  const page = await loadCustomerPage(
    createServiceClient(),
    decodeURIComponent(studentNumber)
  );
  if (!page) notFound();

  const name =
    page.student?.name ?? page.link?.displayName ?? page.studentNumber;
  const b = page.balances;
  const openCount = page.openInvoices.length;

  return (
    <PageShell>
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>

      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · {page.studentNumber}
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {name}.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {page.link ? (
              <>
                QuickBooks customer{' '}
                <span className="font-mono text-[13px] text-foreground">
                  {page.link.displayName}
                </span>
                {page.profile?.companyName
                  ? ` · Parents: ${page.profile.companyName}`
                  : ''}
                {page.student?.level
                  ? ` · ${page.student.level}, ${page.student.ayCode}`
                  : ''}
              </>
            ) : (
              'Not linked to a QuickBooks customer yet.'
            )}
          </p>
        </div>
        {page.link && page.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton label="Refresh" />
            <CustomerActions
              studentNumber={page.studentNumber}
              studentName={name}
              customerEmail={page.profile?.email ?? null}
              maps={page.maps}
              existing={page.invoices.map((i) => ({
                docNumber: i.docNumber,
                ayCode: i.ayCode,
                stageKeys: i.stageKeys,
                state: i.state,
              }))}
              openInvoices={page.openInvoices}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          </div>
        )}
      </header>

      {!page.connected ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : !page.link ? (
        <div className="flex items-start gap-4 rounded-xl border border-primary/30 bg-accent p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <UserSearch className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              Find their QuickBooks customer
            </p>
            <p className="text-sm text-muted-foreground">
              The SIS couldn&rsquo;t match this student to a QuickBooks customer
              by itself. Pick the right one, or add them to QuickBooks.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link
                href={`/billing/review?student=${encodeURIComponent(page.studentNumber)}`}
              >
                Open in To review
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {page.refreshError && (
            <div className="flex items-start gap-4 rounded-xl border border-brand-amber/40 bg-brand-amber/10 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-amber/80 text-ink shadow-brand-tile">
                <AlertTriangle className="size-4" />
              </div>
              <div className="flex-1 space-y-1.5">
                <p className="font-serif text-base font-semibold text-foreground">
                  Showing what the SIS last read
                </p>
                <p className="text-sm text-muted-foreground">
                  {page.refreshError} Refresh to try QuickBooks again.
                </p>
              </div>
            </div>
          )}

          {page.stageWarning && (
            <p className="flex items-start gap-2 rounded-lg border border-brand-amber/40 bg-brand-amber/10 px-3 py-2 text-sm text-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {page.stageWarning}
            </p>
          )}

          <div className="@container/main">
            <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
              <MetricCard
                label="Owed on invoices"
                value={formatSgd(b.owedOnInvoices)}
                icon={Wallet}
                subtext={
                  b.credit > 0
                    ? `${openCount} open invoices · ${formatSgd(b.openBalance)} after credit, as QuickBooks shows it`
                    : `${openCount} open invoices`
                }
              />
              <MetricCard
                label="Overdue"
                value={formatSgd(b.overdue)}
                icon={AlertTriangle}
                intent={b.overdue > 0 ? 'bad' : 'default'}
                subtext={
                  page.overdueOldest
                    ? `${page.overdueOldest.docNumber ?? 'An invoice'}, due ${formatDay(page.overdueOldest.dueDate)}`
                    : 'Nothing past its due date'
                }
              />
              <MetricCard
                label="Credit"
                value={formatSgd(b.credit)}
                icon={Coins}
                intent={b.credit > 0 ? 'warning' : 'default'}
                subtext={
                  b.credit > 0 ? 'Unused — see below' : 'No unused credit'
                }
              />
              <MetricCard
                label="Registration · Fees"
                value={
                  page.stages
                    ? `${page.stages.registration ?? '—'} · ${page.stages.fees ?? '—'}`
                    : '—'
                }
                icon={Layers}
                subtext={
                  page.stages
                    ? `${page.stages.ayCode} stages, filled from these invoices`
                    : 'No application on record'
                }
              />
            </div>
          </div>

          {b.credit > 0 && (
            <CreditPanel
              studentNumber={page.studentNumber}
              studentName={name}
              credit={b.credit}
              openInvoices={page.openInvoices}
              credits={page.credits}
              depositAccounts={page.depositAccounts}
            />
          )}

          <CustomerTabs
            studentNumber={page.studentNumber}
            studentName={name}
            level={page.student?.level ?? null}
            linkedName={page.link.displayName}
            invoices={page.invoices}
            payments={page.payments}
            profile={page.profile}
            initialTab={initialTab}
          />

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {b.source === 'quickbooks'
              ? 'Read from QuickBooks just now'
              : 'Balances added up from the last QuickBooks read'}{' '}
            · QuickBooks is the record for money · Every action is in the audit
            log
          </p>
        </>
      )}
    </PageShell>
  );
}
