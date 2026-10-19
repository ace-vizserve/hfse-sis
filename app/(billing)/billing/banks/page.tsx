import { ArrowDownLeft, ArrowUpRight, Landmark, Scale } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BankPeriodPicker } from '@/components/billing/bank-period-picker';
import { BankTransactionsTable } from '@/components/billing/bank-transactions-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PageShell } from '@/components/ui/page-shell';
import type { BankLedger } from '@/lib/billing/bank-ledger';
import {
  loadBankAccounts,
  readBankLedger,
  type BankAccount,
} from '@/lib/billing/banks.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { formatDay, todaySg } from '@/lib/billing/view';
import { connectedRealmId } from '@/lib/qbo/client';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// Billing → Bank accounts. QuickBooks' Bank accounts with the balance
// QuickBooks shows, and one account's transactions for a period — its
// General Ledger, read when the page loads. Nothing is added up by the SIS
// beyond the period's money in and out.
export default async function BillingBanksPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');
  const service = createServiceClient();
  const [params, realmId] = await Promise.all([
    searchParams,
    connectedRealmId(service).catch(() => null),
  ]);

  const today = todaySg();
  const to = params.to && isRealDate(params.to) ? params.to : today;
  const from =
    params.from && isRealDate(params.from) && params.from <= to
      ? params.from
      : `${to.slice(0, 8)}01`;

  let accounts: BankAccount[] = [];
  let ledger: BankLedger | null = null;
  let error: string | null = null;
  let selected: BankAccount | null = null;
  if (realmId) {
    try {
      accounts = await loadBankAccounts(service);
      selected =
        accounts.find((a) => a.id === params.account) ?? accounts[0] ?? null;
      if (selected)
        ledger = await readBankLedger(service, selected.id, from, to);
    } catch (e) {
      error = e instanceof Error ? e.message : 'QuickBooks could not be read.';
    }
  }

  const href = (id: string) =>
    `/billing/banks?${new URLSearchParams({ account: id, from, to }).toString()}`;

  return (
    <PageShell>
      <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="space-y-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Billing · QuickBooks
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Bank accounts.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            The balance of each bank account in QuickBooks, and every
            transaction in and out of it.
          </p>
        </div>
        {realmId && !error && <RefreshButton />}
      </header>

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-serif text-base font-semibold text-foreground">
            QuickBooks could not be read
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {error} Refresh the page to try again.
          </p>
        </div>
      ) : accounts.length === 0 || !selected || !ledger ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="font-serif text-base font-semibold text-foreground">
            No bank accounts in QuickBooks
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Accounts of type Bank in QuickBooks&rsquo; Chart of Accounts show
            here.
          </p>
        </div>
      ) : (
        <>
          <nav
            aria-label="Bank accounts"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {accounts.map((a) => {
              const on = a.id === selected.id;
              return (
                <Link
                  key={a.id}
                  href={href(a.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors',
                    on
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:border-primary/40'
                  )}
                >
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      on
                        ? 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Landmark className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.name}
                    </p>
                    <p
                      className={cn(
                        'font-serif text-lg font-semibold tabular-nums',
                        a.balance < 0 ? 'text-destructive' : 'text-foreground'
                      )}
                    >
                      {formatSgd(a.balance)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </nav>

          <section className="space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="space-y-1">
                <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                  {selected.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {formatDay(from)} to {formatDay(to)}
                </p>
              </div>
              <BankPeriodPicker from={from} to={to} />
            </div>

            <div className="@container/main">
              <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @3xl/main:grid-cols-4">
                <MetricCard
                  label="Balance at start"
                  value={
                    ledger.opening === null ? '—' : formatSgd(ledger.opening)
                  }
                  icon={Scale}
                  subtext={formatDay(from)}
                />
                <MetricCard
                  label="Money in"
                  value={formatSgd(ledger.moneyIn)}
                  icon={ArrowDownLeft}
                  subtext={`${ledger.rows.filter((r) => r.amount > 0).length.toLocaleString('en-SG')} transactions`}
                />
                <MetricCard
                  label="Money out"
                  value={formatSgd(ledger.moneyOut)}
                  icon={ArrowUpRight}
                  subtext={`${ledger.rows.filter((r) => r.amount < 0).length.toLocaleString('en-SG')} transactions`}
                />
                <MetricCard
                  label="Balance at end"
                  value={
                    ledger.closing === null ? '—' : formatSgd(ledger.closing)
                  }
                  icon={Landmark}
                  subtext={formatDay(to)}
                />
              </div>
            </div>

            <BankTransactionsTable rows={ledger.rows} />
          </section>

          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Read from QuickBooks just now · Balances and transactions are
            QuickBooks&rsquo; own
          </p>
        </>
      )}
    </PageShell>
  );
}
