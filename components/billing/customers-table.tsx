'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Wallet } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { CustomerListRow } from '@/lib/billing/customers.server';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

const columns: ColumnDef<CustomerListRow, unknown>[] = [
  {
    id: 'student',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <IdentifierLink
          href={`/billing/${encodeURIComponent(row.original.studentNumber)}`}
        >
          {row.original.name}
        </IdentifierLink>
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {row.original.studentNumber}
        </div>
      </div>
    ),
    enableHiding: false,
  },
  {
    id: 'customer',
    accessorFn: (r) => r.customerName,
    header: ({ column }) => (
      <SortableHeader column={column}>QuickBooks customer</SortableHeader>
    ),
    meta: { label: 'QuickBooks customer' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.customerName}
      </span>
    ),
  },
  {
    id: 'level',
    accessorFn: (r) => r.level ?? 'No level',
    header: ({ column }) => (
      <SortableHeader column={column}>Level</SortableHeader>
    ),
    meta: { label: 'Level' },
  },
  {
    id: 'openBalance',
    accessorFn: (r) => r.openBalance,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Open balance
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Open balance' },
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-foreground">
        {formatSgd(row.original.openBalance)}
      </div>
    ),
  },
  {
    id: 'overdue',
    accessorFn: (r) => r.overdue,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Overdue
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Overdue' },
    cell: ({ row }) => (
      <div
        className={cn(
          'text-right tabular-nums',
          row.original.overdue > 0
            ? 'font-semibold text-destructive'
            : 'text-muted-foreground'
        )}
      >
        {formatSgd(row.original.overdue)}
      </div>
    ),
  },
  {
    id: 'lastPayment',
    accessorFn: (r) => r.lastPayment ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Last payment</SortableHeader>
    ),
    meta: { label: 'Last payment' },
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {formatDay(row.original.lastPayment)}
      </span>
    ),
  },
  {
    id: 'lastInvoice',
    accessorFn: (r) => r.lastInvoice ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Last invoice</SortableHeader>
    ),
    meta: { label: 'Last invoice' },
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {formatDay(row.original.lastInvoice)}
      </span>
    ),
  },
  // Filter-only helpers, hidden until switched on from Columns.
  {
    id: 'hasBalance',
    accessorFn: (r) => yesNo(r.openBalance > 0),
    header: 'Has a balance',
    meta: { label: 'Has a balance' },
    enableSorting: false,
  },
  {
    id: 'isOverdue',
    accessorFn: (r) => yesNo(r.overdue > 0),
    header: 'Overdue now',
    meta: { label: 'Overdue now' },
    enableSorting: false,
  },
];

export function CustomersTable({ rows }: { rows: CustomerListRow[] }) {
  const facets = React.useMemo(
    () => [
      {
        columnId: 'level',
        label: 'Level',
        valueOptions: [
          ...new Set(rows.map((r) => r.level ?? 'No level')),
        ].sort(),
      },
      {
        columnId: 'hasBalance',
        label: 'Has a balance',
        valueOptions: ['Yes', 'No'],
      },
      { columnId: 'isOverdue', label: 'Overdue', valueOptions: ['Yes', 'No'] },
    ],
    [rows]
  );
  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Wallet}
          title="No students linked yet"
          body="Students appear here once they are linked to their QuickBooks customer. A superadmin runs Link students from Billing settings; anyone the SIS can't match goes to To review."
        />
      </Card>
    );
  return (
    <DataTable<CustomerListRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.studentNumber}
      searchKeys={[
        (r) => r.name,
        (r) => r.studentNumber,
        (r) => r.customerName,
      ]}
      searchPlaceholder="Search name or student number"
      facets={facets}
      statusTabs={[
        { value: 'all', label: 'All', predicate: () => true, isDefault: true },
        { value: 'owing', label: 'Owing', predicate: (r) => r.openBalance > 0 },
        { value: 'overdue', label: 'Overdue', predicate: (r) => r.overdue > 0 },
      ]}
      initialColumnVisibility={{ hasBalance: false, isOverdue: false }}
      initialSort={[{ id: 'overdue', desc: true }]}
      url={{ enabled: true, namespace: 'billing-customers' }}
      pageSize={25}
      csv={{ filename: 'billing-customers.csv' }}
      emptyFilteredState={{
        title: 'No students match.',
        body: 'Clear the search or a filter to see more students.',
      }}
    />
  );
}
