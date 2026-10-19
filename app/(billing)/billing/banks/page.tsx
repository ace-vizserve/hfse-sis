import { ExternalLink, Landmark } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { BankPeriodPicker } from '@/components/billing/bank-period-picker';
import { BankTransactionsTable } from '@/components/billing/bank-transactions-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { RefreshButton } from '@/components/billing/refresh-button';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// Billing → Bank accounts. WHAT is here is QuickBooks' Bank Register: the
// account choice, Reconcile, the Ending balance, then the account's
// transactions for a period — its General Ledger, read when the page loads.
// HOW it looks is the SIS's: hero, one tile per bank account (the chosen one
// highlighted), and the register in a card. The figures are QuickBooks' own.

/** The same day a year earlier (29 Feb → 28 Feb). */
function yearBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const back = new Date(Date.UTC(y - 1, m - 1, d));
  if (back.getUTCMonth() !== m - 1) back.setUTCDate(0);
  return back.toISOString().slice(0, 10);
}

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
      : yearBefore(to);

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
  const qbBase = qboAppUrl(qboEnv()?.environment ?? 'sandbox', '');
  const href = (id: string) =>
    `/billing/banks?${new URLSearchParams({ account: id, from, to }).toString()}`;

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={[{ label: 'Accounting' }, { label: 'Bank accounts' }]}
        title="Bank accounts"
        description="The balance of each bank account in QuickBooks, and every transaction in and out of it."
        actions={realmId && !error ? <RefreshButton /> : undefined}
      />

      {!realmId ? (
        <NotConnectedPanel canConnect={sessionUser.role === 'superadmin'} />
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="font-serif text-base">
              QuickBooks could not be read
            </CardTitle>
            <CardDescription>
              {error} Refresh the page to try again.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : accounts.length === 0 || !selected || !ledger ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-base">
              No bank accounts in QuickBooks
            </CardTitle>
            <CardDescription>
              Accounts of type Bank in QuickBooks&rsquo; Chart of accounts show
              here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <nav
            aria-label="Bank accounts"
            className="@container/main grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            {accounts.map((a) => {
              const on = a.id === selected.id;
              return (
                <Link
                  key={a.id}
                  href={href(a.id)}
                  aria-current={on ? 'page' : undefined}
                  className="group block"
                >
                  <Card
                    className={cn(
                      'h-full gap-3 bg-gradient-to-t from-primary/5 to-card py-4 shadow-xs transition-all duration-200',
                      on
                        ? 'border-primary ring-1 ring-primary'
                        : 'group-hover:-translate-y-0.5 group-hover:shadow-md'
                    )}
                  >
                    <CardHeader className="px-4">
                      <CardDescription className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                        {a.name}
                      </CardDescription>
                      <CardTitle
                        className={cn(
                          'font-serif text-[24px] font-semibold leading-none tabular-nums',
                          a.balance < 0 ? 'text-destructive' : 'text-foreground'
                        )}
                      >
                        {formatSgd(a.balance)}
                      </CardTitle>
                      <CardAction>
                        <div
                          className={cn(
                            'flex size-9 items-center justify-center rounded-xl',
                            on
                              ? 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <Landmark className="size-4" />
                        </div>
                      </CardAction>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </nav>

          <Card className="min-w-0">
            <CardHeader>
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Bank register
              </CardDescription>
              <CardTitle className="font-serif text-2xl font-semibold tracking-tight">
                {selected.name}
              </CardTitle>
              <CardDescription>
                {formatDay(from)} to {formatDay(to)}
              </CardDescription>
              <CardAction className="flex items-center gap-5">
                <div className="text-right">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Ending balance
                  </p>
                  <p
                    className={cn(
                      'font-serif text-[28px] font-semibold leading-tight tabular-nums',
                      selected.balance < 0
                        ? 'text-destructive'
                        : 'text-foreground'
                    )}
                  >
                    {formatSgd(selected.balance)}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <a
                    href={`${qbBase}/app/reconcile?accountId=${encodeURIComponent(selected.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Reconcile
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              <BankPeriodPicker from={from} to={to} />
              <BankTransactionsTable
                key={selected.id}
                rows={ledger.rows}
                from={from}
                to={to}
                accountName={selected.name}
              />
            </CardContent>
          </Card>
        </>
      )}
    </PageShell>
  );
}
