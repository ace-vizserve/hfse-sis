'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Landmark, Rows2, Rows3 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { BankLedgerRow } from '@/lib/billing/bank-ledger';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// One bank account's transactions as QuickBooks' Bank Register lists them —
// Date · Ref no. over Type · Payee over Account · Memo · Payment · Deposit ·
// ✓ · Balance, newest first, two lines a transaction (or one, from the
// toolbar) — with QuickBooks' filter (Find, Reconcile status, Transaction
// type) as the SIS table's search and facets. The period is chosen above the
// table; paging, Export CSV and Columns are the shared table's own.

const STATUS_LABEL = { R: 'Reconciled', C: 'Cleared' } as const;
const statusOf = (r: BankLedgerRow) =>
  r.cleared ? STATUS_LABEL[r.cleared] : 'No status';

const money = (n: number) => (n > 0 ? formatSgd(n) : '');

function right(label: string) {
  return function RightHeader() {
    return <div className="text-right">{label}</div>;
  };
}

export function BankTransactionsTable({
  rows,
  from,
  to,
  accountName,
}: {
  rows: BankLedgerRow[];
  from: string;
  to: string;
  accountName: string;
}) {
  const [oneLine, setOneLine] = React.useState(false);

  // QuickBooks lists the register newest first; the report reads oldest
  // first, so it is turned round whole (ties keep their running balance).
  const data = React.useMemo(() => [...rows].reverse(), [rows]);
  const types = React.useMemo(
    () => [...new Set(rows.map((r) => r.type))].sort(),
    [rows]
  );

  const columns = React.useMemo<ColumnDef<BankLedgerRow, unknown>[]>(() => {
    const twoLine = (top: React.ReactNode, bottom: React.ReactNode) => (
      <div className="leading-snug">
        <div>{top}</div>
        <div className="text-muted-foreground">{bottom}</div>
      </div>
    );
    const cols: ColumnDef<BankLedgerRow, unknown>[] = [
      {
        id: 'date',
        accessorFn: (r) => r.date,
        header: 'Date',
        meta: { label: 'Date' },
        enableHiding: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDay(row.original.date)}
          </span>
        ),
      },
      ...(oneLine
        ? ([
            {
              id: 'number',
              accessorFn: (r) => r.number ?? '',
              header: 'Ref no.',
              meta: { label: 'Ref no.' },
              cell: ({ row }) => (
                <span className="font-mono text-xs">
                  {row.original.number ?? ''}
                </span>
              ),
            },
            {
              id: 'type',
              accessorFn: (r) => r.type,
              header: 'Type',
              meta: { label: 'Type' },
              cell: ({ row }) => (
                <span className="text-muted-foreground">
                  {row.original.type}
                </span>
              ),
            },
            {
              id: 'payee',
              accessorFn: (r) => r.name ?? '',
              header: 'Payee',
              meta: { label: 'Payee' },
            },
            {
              id: 'account',
              accessorFn: (r) => r.split ?? '',
              header: 'Account',
              meta: { label: 'Account' },
              cell: ({ row }) => (
                <span className="text-muted-foreground">
                  {row.original.split ?? ''}
                </span>
              ),
            },
          ] as ColumnDef<BankLedgerRow, unknown>[])
        : ([
            {
              id: 'type',
              accessorFn: (r) => r.type,
              header: () => twoLine('Ref no.', 'Type'),
              meta: { label: 'Ref no. / Type', excludeFromExport: true },
              cell: ({ row }) =>
                twoLine(
                  <span className="font-mono text-xs">
                    {row.original.number ?? ''}
                  </span>,
                  row.original.type
                ),
            },
            {
              id: 'payee',
              accessorFn: (r) => r.name ?? '',
              header: () => twoLine('Payee', 'Account'),
              meta: { label: 'Payee / Account', excludeFromExport: true },
              cell: ({ row }) =>
                twoLine(row.original.name ?? '', row.original.split ?? ''),
            },
          ] as ColumnDef<BankLedgerRow, unknown>[])),
      {
        id: 'memo',
        accessorFn: (r) => r.memo ?? '',
        header: 'Memo',
        meta: { label: 'Memo' },
        cell: ({ row }) => (
          <span
            className="block max-w-64 truncate text-muted-foreground"
            title={row.original.memo ?? undefined}
          >
            {row.original.memo ?? ''}
          </span>
        ),
      },
      {
        id: 'payment',
        accessorFn: (r) => (r.amount < 0 ? -r.amount : null),
        header: right('Payment'),
        meta: { label: 'Payment' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {money(-row.original.amount)}
          </div>
        ),
      },
      {
        id: 'deposit',
        accessorFn: (r) => (r.amount > 0 ? r.amount : null),
        header: right('Deposit'),
        meta: { label: 'Deposit' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {money(row.original.amount)}
          </div>
        ),
      },
      {
        id: 'status',
        accessorFn: (r) => statusOf(r),
        header: () => (
          <div className="text-center" title="Reconcile status">
            ✓
          </div>
        ),
        meta: { label: 'Reconcile status' },
        cell: ({ row }) => (
          <div
            className="text-center font-mono text-xs"
            title={statusOf(row.original)}
          >
            {row.original.cleared ?? ''}
          </div>
        ),
      },
      {
        id: 'balance',
        accessorFn: (r) => r.balance,
        header: right('Balance'),
        meta: { label: 'Balance' },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {row.original.balance === null
              ? '—'
              : formatSgd(row.original.balance)}
          </div>
        ),
      },
    ];
    // No sorting: the running balance only reads in QuickBooks' order.
    return cols.map((c) => ({ ...c, enableSorting: false }));
  }, [oneLine]);

  return (
    <DataTable<BankLedgerRow>
      // A new layout is a new set of columns.
      key={oneLine ? 'one' : 'two'}
      data={data}
      columns={columns}
      getRowId={(r) => r.key}
      searchKeys={[
        (r) => r.memo ?? '',
        (r) => r.number ?? '',
        (r) => r.name ?? '',
        (r) => String(Math.abs(r.amount)),
      ]}
      searchPlaceholder="Find memo, Ref no., payee or amount"
      facets={[
        {
          columnId: 'status',
          label: 'Reconcile status',
          valueOptions: ['Reconciled', 'Cleared', 'No status'],
        },
        { columnId: 'type', label: 'Transaction type', valueOptions: types },
      ]}
      toolbarTrailing={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOneLine((v) => !v)}
          aria-pressed={oneLine}
        >
          {oneLine ? (
            <Rows2 className="size-3.5" />
          ) : (
            <Rows3 className="size-3.5" />
          )}
          {oneLine ? 'Two lines' : 'One line'}
        </Button>
      }
      pageSize={50}
      csv={{
        filename: `bank-register-${accountName.replace(/[^\w-]+/g, '-')}-${from}-to-${to}.csv`,
        extraColumns: oneLine
          ? undefined
          : [
              {
                id: 'x-number',
                header: 'Ref no.',
                accessor: (r) => r.number,
                defaultChecked: true,
              },
              {
                id: 'x-type',
                header: 'Type',
                accessor: (r) => r.type,
                defaultChecked: true,
              },
              {
                id: 'x-payee',
                header: 'Payee',
                accessor: (r) => r.name,
                defaultChecked: true,
              },
              {
                id: 'x-account',
                header: 'Account',
                accessor: (r) => r.split,
                defaultChecked: true,
              },
            ],
      }}
      emptyState={{
        icon: Landmark,
        title: 'No transactions in this period.',
        body: 'Pick an earlier From date to see more of this account.',
      }}
      emptyFilteredState={{
        title: 'No transactions match.',
        body: 'Clear the search, Reconcile status or Transaction type.',
      }}
    />
  );
}
