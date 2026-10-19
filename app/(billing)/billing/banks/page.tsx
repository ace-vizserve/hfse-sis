import { redirect } from 'next/navigation';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { BankAccountSelect } from '@/components/billing/bank-period-picker';
import { BankTransactionsTable } from '@/components/billing/bank-transactions-table';
import { NotConnectedPanel } from '@/components/billing/not-connected-panel';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import type { BankLedger } from '@/lib/billing/bank-ledger';
import {
  loadBankAccounts,
  readBankLedger,
  type BankAccount,
} from '@/lib/billing/banks.server';
import { isRealDate } from '@/lib/billing/settings-helpers';
import { todaySg } from '@/lib/billing/view';
import { connectedRealmId } from '@/lib/qbo/client';
import { qboAppUrl, qboEnv } from '@/lib/qbo/env';
import { formatSgd } from '@/lib/qbo/format';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cn } from '@/lib/utils';

// Billing → Bank accounts, as QuickBooks' Bank Register: the account
// dropdown, Reconcile and the Ending balance at the top, then the account's
// transactions for a period — its General Ledger, read when the page loads.
// The figures are QuickBooks' own.

const CRUMBS = [
  { label: 'Accounting' },
  { label: 'Chart of accounts', href: '/billing/accounts' },
  { label: 'Bank Register' },
];

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

  return (
    <PageShell>
      <BillingPageHeader
        crumbs={CRUMBS}
        title="Bank Register"
        actions={
          realmId && selected ? (
            <Button asChild>
              <a
                href={`${qbBase}/app/reconcile?accountId=${encodeURIComponent(selected.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                Reconcile
              </a>
            </Button>
          ) : undefined
        }
      >
        {realmId && !error && selected && ledger && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BankAccountSelect accounts={accounts} value={selected.id} />
            <div className="text-right">
              <p className="text-[12px] text-muted-foreground">
                Ending balance
              </p>
              <p
                className={cn(
                  'font-serif text-[26px] font-semibold leading-none tabular-nums',
                  selected.balance < 0 ? 'text-destructive' : 'text-foreground'
                )}
              >
                {formatSgd(selected.balance)}
              </p>
            </div>
          </div>
        )}
      </BillingPageHeader>

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
        <BankTransactionsTable
          key={selected.id}
          rows={ledger.rows}
          from={from}
          to={to}
          accountName={selected.name}
        />
      )}
    </PageShell>
  );
}
