'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Package } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { ProductRow } from '@/lib/billing/live.server';
import { formatSgd } from '@/lib/qbo/format';

// Billing → Products & services, as QuickBooks' list: Name · Type · Sales
// description · Sales price · Income account, Active by default.

const columns: ColumnDef<ProductRow, unknown>[] = [
  {
    id: 'name',
    accessorFn: (r) => r.name,
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    meta: { label: 'Name' },
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        {row.original.name}
        {!row.original.active && (
          <Badge variant="secondary" className="ml-2 h-5">
            Inactive
          </Badge>
        )}
      </span>
    ),
    enableHiding: false,
  },
  {
    id: 'type',
    accessorFn: (r) => r.type,
    header: ({ column }) => (
      <SortableHeader column={column}>Type</SortableHeader>
    ),
    meta: { label: 'Type' },
  },
  {
    id: 'description',
    accessorFn: (r) => r.description ?? '',
    header: 'Sales description',
    meta: { label: 'Sales description' },
    cell: ({ row }) => (
      <span className="line-clamp-2 max-w-md text-sm text-muted-foreground">
        {row.original.description ?? ''}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'price',
    accessorFn: (r) => r.price ?? -1,
    header: ({ column }) => (
      <div className="flex justify-end">
        <SortableHeader column={column} align="right">
          Sales price
        </SortableHeader>
      </div>
    ),
    meta: { label: 'Sales price' },
    cell: ({ row }) => (
      <div className="whitespace-nowrap text-right tabular-nums">
        {row.original.price === null ? '' : formatSgd(row.original.price)}
      </div>
    ),
  },
  {
    id: 'incomeAccount',
    accessorFn: (r) => r.incomeAccount ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Income account</SortableHeader>
    ),
    meta: { label: 'Income account' },
  },
];

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Package}
          title="No products or services"
          body="QuickBooks has no products or services yet. Add them in QuickBooks; they show here when the page opens."
        />
      </Card>
    );
  return (
    <DataTable<ProductRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={[(r) => r.name, (r) => r.description ?? '']}
      searchPlaceholder="Search name or description"
      facets={[
        {
          columnId: 'type',
          label: 'Type',
          valueOptions: [...new Set(rows.map((r) => r.type))].sort(),
        },
        {
          columnId: 'incomeAccount',
          label: 'Income account',
          valueOptions: [
            ...new Set(rows.map((r) => r.incomeAccount ?? '').filter(Boolean)),
          ].sort(),
        },
      ]}
      statusTabs={[
        {
          value: 'active',
          label: 'Active',
          predicate: (r) => r.active,
          isDefault: true,
        },
        { value: 'inactive', label: 'Inactive', predicate: (r) => !r.active },
        { value: 'all', label: 'All', predicate: () => true },
      ]}
      initialSort={[{ id: 'name', desc: false }]}
      url={{ enabled: true, namespace: 'billing-products' }}
      pageSize={50}
      csv={{ filename: 'billing-products.csv' }}
      emptyFilteredState={{
        title: 'Nothing matches.',
        body: 'Clear the search or a filter.',
      }}
    />
  );
}
