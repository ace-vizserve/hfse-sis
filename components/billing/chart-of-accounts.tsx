'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  BookOpen,
  ChevronDown,
  CornerDownRight,
  ExternalLink,
  Landmark,
  Pencil,
  Receipt,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { PrintIcon } from '@/components/billing/toolbar-icons';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACCOUNT_TYPES, type AccountRow } from '@/lib/billing/accounts';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// Billing → Chart of accounts. WHAT is here is QuickBooks' page: Run report
// and New account ▾; filter by name or number and by account type; Edit mode,
// export, print and the column settings; Name · Account type (BAL / P&L) ·
// Detail type · QuickBooks balance · Action (View register or Run report, ▾
// Edit, Run report, Reconcile, Create subaccount, Make inactive), in
// QuickBooks' order with sub-accounts under their parent. HOW it looks is the
// SIS's: hero, stat tiles, the shared DataTable. Accounts are QuickBooks' to
// set up, so Edit, New account and the rest open QuickBooks.

const NS = 'billing-accounts';

// Accounts QuickBooks reconciles against a statement.
const RECONCILABLE = new Set([
  'Bank',
  'Credit Card',
  'Other Current Asset',
  'Fixed Asset',
  'Other Asset',
  'Other Current Liability',
  'Long Term Liability',
  'Equity',
]);

function QbMenuLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
      </a>
    </DropdownMenuItem>
  );
}

const reportHref = (id: string) =>
  `/billing/reports/general-ledger?period=this-year&account=${encodeURIComponent(id)}`;

/** Total of the top-level accounts of one type (a parent's balance already
 *  includes its sub-accounts). */
function totalOf(rows: AccountRow[], type: string): number {
  return rows
    .filter((r) => r.type === type && r.depth === 0)
    .reduce((s, r) => s + (r.balance ?? 0), 0);
}

export function ChartOfAccounts({
  rows,
  qbBase,
}: {
  rows: AccountRow[];
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
}) {
  const qbCoa = `${qbBase}/app/chartofaccounts`;
  const typeOptions = ACCOUNT_TYPES.filter((t) =>
    rows.some((r) => r.type === t.type)
  ).map((t) => t.label);
  const bankLabel = ACCOUNT_TYPES[0].label;
  const arLabel = ACCOUNT_TYPES[1].label;
  const banks = rows.filter((r) => r.type === 'Bank');
  const hasAr = rows.some((r) => r.type === 'Accounts Receivable');

  const columns = React.useMemo<ColumnDef<AccountRow, unknown>[]>(
    () =>
      (
        [
          {
            id: 'name',
            accessorFn: (r) => r.fullName,
            header: 'Name',
            meta: { label: 'Name' },
            enableHiding: false,
            cell: ({ row }) => {
              const r = row.original;
              return (
                <span
                  className="inline-flex min-w-48 items-center gap-1.5"
                  style={{ paddingLeft: `${r.depth * 20}px` }}
                  title={r.fullName}
                >
                  {r.depth > 0 && (
                    <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {r.number && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.number}
                    </span>
                  )}
                  <span className="font-medium text-foreground">{r.name}</span>
                </span>
              );
            },
          },
          {
            id: 'type',
            accessorFn: (r) => r.typeLabel,
            header: 'Account type',
            meta: { label: 'Account type' },
            cell: ({ row }) => {
              const r = row.original;
              return (
                <span className="flex items-center justify-between gap-3 text-muted-foreground">
                  {r.typeLabel}
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                      r.statement === 'BAL'
                        ? 'bg-brand-mint/30 text-ink'
                        : 'bg-accent text-accent-foreground'
                    )}
                    title={
                      r.statement === 'BAL'
                        ? 'Balance sheet account'
                        : 'Profit and loss account'
                    }
                  >
                    {r.statement}
                  </span>
                </span>
              );
            },
          },
          {
            id: 'detail',
            accessorFn: (r) => r.detailType,
            header: 'Detail type',
            meta: { label: 'Detail type' },
            cell: ({ row }) => (
              <span className="text-muted-foreground">
                {row.original.detailType}
              </span>
            ),
          },
          {
            id: 'balance',
            accessorFn: (r) => r.balance,
            header: () => <div className="text-right">QuickBooks balance</div>,
            meta: { label: 'QuickBooks balance' },
            cell: ({ row }) => (
              <div className="whitespace-nowrap text-right tabular-nums">
                {row.original.balance === null
                  ? ''
                  : formatSgd(row.original.balance)}
              </div>
            ),
          },
          {
            id: 'actions',
            header: () => <div className="text-right">Action</div>,
            meta: { label: 'Action', excludeFromExport: true },
            enableHiding: false,
            cell: ({ row }) => (
              <div className="flex justify-end">
                <AccountAction row={row.original} qbBase={qbBase} />
              </div>
            ),
          },
        ] as ColumnDef<AccountRow, unknown>[]
      ).map((c) => ({ ...c, enableSorting: false })),
    // No sorting: the rows keep QuickBooks' order, sub-accounts under parents.
    [qbBase]
  );

  return (
    <>
      <BillingPageHeader
        crumbs={[{ label: 'Accounting' }, { label: 'Chart of accounts' }]}
        title="Chart of accounts"
        description="QuickBooks' accounts and their balances, read live. Accounts are set up in QuickBooks; a bank account's register opens here."
        actions={
          <>
            <PrintIcon />
            <Button asChild variant="outline">
              <Link href="/billing/reports/general-ledger?period=this-year">
                Run report
              </Link>
            </Button>
            <div className="flex">
              <Button asChild className="rounded-r-none">
                <a href={qbCoa} target="_blank" rel="noreferrer">
                  New account
                </a>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    className="rounded-l-none border-l border-primary-foreground/20"
                    aria-label="More ways to add accounts"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <QbMenuLink href={qbCoa}>Import</QbMenuLink>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        }
      />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
          <MetricCard
            label="Bank accounts"
            value={formatSgd(totalOf(rows, 'Bank'))}
            icon={Landmark}
            subtext={`${banks.length} ${banks.length === 1 ? 'account' : 'accounts'}, QuickBooks balance`}
            href={`?${NS}.type=${encodeURIComponent(bankLabel)}`}
          />
          {hasAr && (
            <MetricCard
              label="Accounts receivable"
              value={formatSgd(totalOf(rows, 'Accounts Receivable'))}
              icon={Receipt}
              subtext="What customers still owe"
              href={`?${NS}.type=${encodeURIComponent(arLabel)}`}
            />
          )}
          <MetricCard
            label="Accounts"
            value={rows.length}
            icon={BookOpen}
            subtext={`${typeOptions.length} account types in use`}
          />
        </div>
      </div>

      <DataTable<AccountRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={[(r) => r.fullName, (r) => r.number ?? '']}
        searchPlaceholder="Filter by name or number"
        facets={[
          {
            columnId: 'type',
            label: 'Account type',
            valueOptions: typeOptions,
          },
        ]}
        toolbarTrailing={
          <Button asChild variant="outline" size="sm">
            <a href={qbCoa} target="_blank" rel="noreferrer">
              <Pencil className="size-3.5" />
              Edit mode
            </a>
          </Button>
        }
        url={{ enabled: true, namespace: NS }}
        pageSize={100}
        csv={{
          filename: 'chart-of-accounts.csv',
          extraColumns: [
            {
              id: 'number',
              header: 'Number',
              accessor: (r) => r.number,
              defaultChecked: true,
            },
          ],
        }}
        emptyState={{
          icon: BookOpen,
          title: 'No accounts yet.',
          body: 'Accounts are set up in QuickBooks. Add one with New account.',
        }}
        emptyFilteredState={{
          title: 'No account matches.',
          body: 'Clear the filter or the account type.',
        }}
      />
    </>
  );
}

/** QuickBooks' Action cell: View register (or Run report) and its ▾. */
function AccountAction({
  row: r,
  qbBase,
}: {
  row: AccountRow;
  qbBase: string;
}) {
  const qbCoa = `${qbBase}/app/chartofaccounts`;
  const linkClass =
    'text-sm font-medium text-primary underline-offset-4 hover:underline';
  const main =
    r.action === 'report' ? (
      <Link href={reportHref(r.id)} className={linkClass}>
        Run report
      </Link>
    ) : r.type === 'Bank' ? (
      <Link
        href={`/billing/banks?account=${encodeURIComponent(r.id)}`}
        className={linkClass}
      >
        View register
      </Link>
    ) : (
      <a
        href={`${qbBase}/app/register?accountId=${encodeURIComponent(r.id)}`}
        target="_blank"
        rel="noreferrer"
        className={cn(linkClass, 'inline-flex items-center gap-1')}
      >
        View register
        <ExternalLink className="size-3" />
      </a>
    );
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`More for ${r.fullName}`}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <QbMenuLink href={qbCoa}>Edit</QbMenuLink>
          {r.action === 'register' && (
            <DropdownMenuItem asChild>
              <Link href={reportHref(r.id)}>Run report</Link>
            </DropdownMenuItem>
          )}
          {r.action === 'register' && RECONCILABLE.has(r.type) && (
            <QbMenuLink
              href={`${qbBase}/app/reconcile?accountId=${encodeURIComponent(r.id)}`}
            >
              Reconcile
            </QbMenuLink>
          )}
          <QbMenuLink href={qbCoa}>Create subaccount</QbMenuLink>
          <QbMenuLink href={qbCoa}>Make inactive (reduces usage)</QbMenuLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
