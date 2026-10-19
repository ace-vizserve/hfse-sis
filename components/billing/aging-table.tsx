'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Wallet } from 'lucide-react';
import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { AgingReport } from '@/lib/billing/aging';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// QuickBooks' A/R Aging Summary: one row per customer, one column per bucket
// QuickBooks prints, then Total; the report's TOTAL line sits under the table.

export type AgingTableRow = AgingReport['rows'][number] & {
  studentNumber: string | null;
};

const money = (n: number) => (n === 0 ? '' : formatSgd(n));

export function AgingTable({
  buckets,
  rows,
  totals,
}: {
  buckets: string[];
  rows: AgingTableRow[];
  totals: AgingReport['totals'];
}) {
  const columns = React.useMemo<ColumnDef<AgingTableRow, unknown>[]>(
    () => [
      {
        id: 'customer',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Customer</SortableHeader>
        ),
        meta: { label: 'Customer' },
        cell: ({ row }) =>
          row.original.studentNumber ? (
            <Link
              href={`/billing/${encodeURIComponent(row.original.studentNumber)}`}
              className="whitespace-nowrap text-foreground hover:underline"
            >
              {row.original.name}
            </Link>
          ) : (
            <span className="whitespace-nowrap">{row.original.name}</span>
          ),
        enableHiding: false,
      },
      ...buckets.map(
        (title, k): ColumnDef<AgingTableRow, unknown> => ({
          id: `b${k}`,
          accessorFn: (r) => r.amounts[k] ?? 0,
          header: ({ column }) => (
            <div className="flex justify-end">
              <SortableHeader column={column} align="right">
                {title}
              </SortableHeader>
            </div>
          ),
          meta: { label: title },
          cell: ({ row }) => (
            <div
              className={cn(
                'whitespace-nowrap text-right tabular-nums',
                k > 0 &&
                  (row.original.amounts[k] ?? 0) > 0 &&
                  'text-destructive'
              )}
            >
              {money(row.original.amounts[k] ?? 0)}
            </div>
          ),
        })
      ),
      {
        id: 'total',
        accessorFn: (r) => r.total,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Total
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Total' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right font-semibold tabular-nums">
            {formatSgd(row.original.total)}
          </div>
        ),
      },
    ],
    [buckets]
  );

  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Wallet}
          title="Nothing owed on this date"
          body="QuickBooks shows no open balances as of this date."
        />
      </Card>
    );

  return (
    <div className="space-y-3">
      <DataTable<AgingTableRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r.customerId ?? r.name}
        searchKeys={[(r) => r.name, (r) => r.studentNumber ?? '']}
        searchPlaceholder="Search customer"
        statusTabs={[
          {
            value: 'all',
            label: 'All',
            predicate: () => true,
            isDefault: true,
          },
          {
            value: 'overdue',
            label: 'Overdue',
            predicate: (r) => r.amounts.slice(1).some((a) => a > 0),
          },
        ]}
        initialSort={[{ id: 'total', desc: true }]}
        url={{ enabled: true, namespace: 'billing-aging' }}
        pageSize={50}
        csv={{ filename: 'billing-ar-aging.csv' }}
        emptyFilteredState={{
          title: 'No customers match.',
          body: 'Clear the search.',
        }}
      />
      {totals && (
        <Card className="py-0">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {buckets.map((b, k) => (
              <div key={b} className="space-y-0.5">
                <dt className="text-[12px] text-muted-foreground">{b}</dt>
                <dd className="tabular-nums text-foreground">
                  {formatSgd(totals.amounts[k] ?? 0)}
                </dd>
              </div>
            ))}
            <div className="space-y-0.5">
              <dt className="text-[12px] text-muted-foreground">Total</dt>
              <dd className="font-serif text-lg font-semibold leading-none tabular-nums text-foreground">
                {formatSgd(totals.total)}
              </dd>
            </div>
          </dl>
        </Card>
      )}
    </div>
  );
}
