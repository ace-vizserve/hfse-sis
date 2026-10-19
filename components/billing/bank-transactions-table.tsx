'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Landmark } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { BankLedgerRow } from '@/lib/billing/bank-ledger';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// One bank account's transactions, laid out as QuickBooks' Bank Register:
// Date · Ref no. over Type · Payee over Account · Memo · Payment · Deposit ·
// Balance, newest first.

type Row = BankLedgerRow & { seq: number };

const money = (n: number) => (n > 0 ? formatSgd(n) : '');

const columns: ColumnDef<Row, unknown>[] = [
  {
    id: 'date',
    // Ties on a date keep QuickBooks' order, so the running balance reads.
    accessorFn: (r) => `${r.date}|${String(r.seq).padStart(6, '0')}`,
    header: ({ column }) => (
      <SortableHeader column={column}>Date</SortableHeader>
    ),
    meta: { label: 'Date' },
    cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatDay(row.original.date)}
      </span>
    ),
  },
  {
    id: 'refType',
    accessorFn: (r) => `${r.number ?? ''} ${r.type}`.trim(),
    header: () => (
      <div className="leading-tight">
        Ref no.
        <br />
        Type
      </div>
    ),
    meta: { label: 'Ref no. / Type' },
    filterFn: (row, _id, value) =>
      !Array.isArray(value) ||
      value.length === 0 ||
      value.includes(row.original.type),
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <div className="font-mono text-xs tabular-nums text-foreground">
          {row.original.number ?? ''}
        </div>
        <div className="text-sm text-muted-foreground">{row.original.type}</div>
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'payee',
    accessorFn: (r) => r.name ?? '',
    header: () => (
      <div className="leading-tight">
        Payee
        <br />
        Account
      </div>
    ),
    meta: { label: 'Payee / Account' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <div className="text-sm text-foreground">{row.original.name ?? ''}</div>
        <div className="text-sm text-muted-foreground">
          {row.original.split ?? ''}
        </div>
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'memo',
    accessorFn: (r) => r.memo ?? '',
    header: 'Memo',
    meta: { label: 'Memo' },
    cell: ({ row }) => (
      <span className="line-clamp-2 max-w-72 text-sm text-muted-foreground">
        {row.original.memo ?? ''}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'payment',
    accessorFn: (r) => (r.amount < 0 ? -r.amount : 0),
    header: () => <div className="text-right">Payment</div>,
    meta: { label: 'Payment' },
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-right tabular-nums text-foreground">
        {money(-row.original.amount)}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'deposit',
    accessorFn: (r) => (r.amount > 0 ? r.amount : 0),
    header: () => <div className="text-right">Deposit</div>,
    meta: { label: 'Deposit' },
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-right tabular-nums text-foreground">
        {money(row.original.amount)}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: 'balance',
    accessorFn: (r) => r.balance ?? 0,
    header: () => <div className="text-right">Balance</div>,
    meta: { label: 'Balance' },
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-right tabular-nums text-foreground">
        {row.original.balance === null ? '—' : formatSgd(row.original.balance)}
      </div>
    ),
    enableSorting: false,
  },
];

export function BankTransactionsTable({ rows }: { rows: BankLedgerRow[] }) {
  const data = React.useMemo(
    () => rows.map((r, seq) => ({ ...r, seq })),
    [rows]
  );
  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Landmark}
          title="No transactions in this period"
          body="Pick an earlier From date to see more of this account's transactions in QuickBooks."
        />
      </Card>
    );
  return (
    <DataTable<Row>
      data={data}
      columns={columns}
      getRowId={(r) => r.key}
      searchKeys={[
        (r) => r.name ?? '',
        (r) => r.memo ?? '',
        (r) => r.type,
        (r) => r.number ?? '',
      ]}
      searchPlaceholder="Search payee, memo or ref no."
      facets={[
        {
          columnId: 'refType',
          label: 'Type',
          valueOptions: [...new Set(rows.map((r) => r.type))].sort(),
        },
      ]}
      initialSort={[{ id: 'date', desc: true }]}
      pageSize={50}
      csv={{ filename: 'bank-register.csv' }}
    />
  );
}
