'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Landmark } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { BankLedgerRow } from '@/lib/billing/bank-ledger';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

const muted = (v: string | null) => (
  <span className="text-sm text-muted-foreground">{v ?? '—'}</span>
);

const columns: ColumnDef<BankLedgerRow, unknown>[] = [
  {
    id: 'date',
    accessorFn: (r) => r.date,
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
    id: 'type',
    accessorFn: (r) => r.type,
    header: ({ column }) => (
      <SortableHeader column={column}>Transaction type</SortableHeader>
    ),
    meta: { label: 'Transaction type' },
  },
  {
    id: 'number',
    accessorFn: (r) => r.number ?? '',
    header: 'No.',
    meta: { label: 'No.' },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.number ?? '—'}
      </span>
    ),
  },
  {
    id: 'name',
    accessorFn: (r) => r.name ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    meta: { label: 'Name' },
    cell: ({ row }) => (
      <span className="text-sm text-foreground">
        {row.original.name ?? '—'}
      </span>
    ),
  },
  {
    id: 'memo',
    accessorFn: (r) => r.memo ?? '',
    header: 'Memo',
    meta: { label: 'Memo' },
    cell: ({ row }) => muted(row.original.memo),
  },
  {
    id: 'split',
    accessorFn: (r) => r.split ?? '',
    header: 'Split',
    meta: { label: 'Split' },
    cell: ({ row }) => muted(row.original.split),
  },
  {
    id: 'amount',
    accessorFn: (r) => r.amount,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Amount
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Amount' },
    cell: ({ row }) => (
      <div
        className={cn(
          'text-right tabular-nums',
          row.original.amount < 0 ? 'text-destructive' : 'text-foreground'
        )}
      >
        {row.original.amount < 0 ? '−' : ''}
        {formatSgd(Math.abs(row.original.amount))}
      </div>
    ),
  },
  {
    id: 'balance',
    accessorFn: (r) => r.balance ?? 0,
    header: () => <div className="text-right">Balance</div>,
    meta: { label: 'Balance' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {row.original.balance === null ? '—' : formatSgd(row.original.balance)}
      </div>
    ),
  },
];

export function BankTransactionsTable({ rows }: { rows: BankLedgerRow[] }) {
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
    <DataTable<BankLedgerRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.key}
      searchKeys={[(r) => r.name ?? '', (r) => r.memo ?? '', (r) => r.type]}
    />
  );
}
