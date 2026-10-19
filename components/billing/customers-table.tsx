'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Wallet, X } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type {
  CustomerListRow,
  CustomersList,
} from '@/lib/billing/customers.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// Billing → Customers, laid out as QuickBooks' Customers list: the money bar
// on top (click a segment to list those customers), then Name · Company
// name · Phone · Open balance · Action (Receive payment when they owe,
// Create invoice when they don't). Student no., Level, Overdue, Last payment
// and Last invoice are off by default — switch them on from Columns.

type Segment = 'overdue' | 'open' | 'paid';

const customerHref = (r: CustomerListRow, next?: 'payment' | 'invoice') =>
  `/billing/${encodeURIComponent(r.studentNumber)}${next ? `?new=${next}` : ''}`;

const columns: ColumnDef<CustomerListRow, unknown>[] = [
  {
    id: 'name',
    accessorFn: (r) => r.customerName,
    header: ({ column }) => (
      <SortableHeader column={column}>Name</SortableHeader>
    ),
    meta: { label: 'Name' },
    cell: ({ row }) => (
      <IdentifierLink href={customerHref(row.original)} className="font-medium">
        {row.original.customerName}
      </IdentifierLink>
    ),
    enableHiding: false,
  },
  {
    id: 'company',
    accessorFn: (r) => r.companyName ?? '',
    header: ({ column }) => (
      <SortableHeader column={column}>Company name</SortableHeader>
    ),
    meta: { label: 'Company name' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.companyName ?? ''}
      </span>
    ),
  },
  {
    id: 'phone',
    accessorFn: (r) => r.phone ?? '',
    header: 'Phone',
    meta: { label: 'Phone' },
    cell: ({ row }) => (
      <span className="font-mono text-[13px] tabular-nums">
        {row.original.phone ?? ''}
      </span>
    ),
    enableSorting: false,
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
    id: 'action',
    header: () => <div className="text-right">Action</div>,
    meta: { label: 'Action', excludeFromExport: true },
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button asChild variant="link" size="sm" className="h-auto p-0">
          {row.original.openBalance > 0 ? (
            <Link href={customerHref(row.original, 'payment')}>
              Receive payment
            </Link>
          ) : (
            <Link href={customerHref(row.original, 'invoice')}>
              Create invoice
            </Link>
          )}
        </Button>
      </div>
    ),
  },
  // Off by default.
  {
    id: 'studentNumber',
    accessorFn: (r) => r.studentNumber,
    header: ({ column }) => (
      <SortableHeader column={column}>Student no.</SortableHeader>
    ),
    meta: { label: 'Student no.' },
    cell: ({ row }) => (
      <span className="font-mono text-[13px] tabular-nums">
        {row.original.studentNumber}
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
      <span className="text-sm tabular-nums">
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
      <span className="text-sm tabular-nums">
        {formatDay(row.original.lastInvoice)}
      </span>
    ),
  },
];

/** QuickBooks' money bar: each segment's figure over a coloured strip, sized
 *  by its amount; a click lists those customers. */
function MoneyBar({
  totals,
  active,
  onPick,
}: {
  totals: CustomersList['totals'];
  active: Segment | null;
  onPick: (s: Segment | null) => void;
}) {
  const notOverdue = Math.max(0, totals.openBalance - totals.overdue);
  const segments: Array<{
    key: Segment;
    value: number;
    label: string;
    bar: string;
  }> = [
    {
      key: 'overdue',
      value: totals.overdue,
      label: `${totals.overdueInvoices.toLocaleString('en-SG')} overdue invoices`,
      bar: 'bg-brand-amber',
    },
    {
      key: 'open',
      value: totals.openBalance,
      label: `${totals.openInvoices.toLocaleString('en-SG')} open invoices`,
      bar: 'bg-hairline-strong',
    },
    {
      key: 'paid',
      value: totals.paidLast30,
      label: `${totals.paymentsLast30.toLocaleString('en-SG')} paid in the last 30 days`,
      bar: 'bg-brand-mint',
    },
  ];
  // Overdue sits inside Open, as in QuickBooks: Open's strip is the rest.
  const weight = (s: Segment, v: number) =>
    Math.max(s === 'open' ? notOverdue : v, 1);
  return (
    <div className="rounded-xl border border-border bg-muted/60 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-1">
        {segments.map((s) => (
          <Button
            key={s.key}
            variant="ghost"
            onClick={() => onPick(active === s.key ? null : s.key)}
            aria-pressed={active === s.key}
            style={{ flexGrow: weight(s.key, s.value) }}
            className={cn(
              'group block h-auto min-w-0 basis-0 space-y-2 whitespace-normal rounded-md p-1 text-left font-normal transition-opacity hover:bg-transparent sm:min-w-44',
              active && active !== s.key && 'opacity-50'
            )}
          >
            <span className="block font-serif text-[22px] font-semibold leading-none tabular-nums text-foreground">
              {formatSgd(s.value)}
            </span>
            <span className="block text-[13px] text-muted-foreground">
              {s.label}
            </span>
            <span
              className={cn(
                'block h-3 rounded-sm transition-all group-hover:h-4',
                s.bar,
                active === s.key && 'h-4'
              )}
            />
          </Button>
        ))}
      </div>
    </div>
  );
}

export function CustomersTable({
  rows,
  totals,
}: {
  rows: CustomerListRow[];
  totals: CustomersList['totals'];
}) {
  const [segment, setSegment] = React.useState<Segment | null>(null);
  const since30 = React.useMemo(() => {
    const t = Date.parse(`${todaySg()}T00:00:00Z`) - 30 * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  }, []);
  const shown = React.useMemo(() => {
    if (!segment) return rows;
    return rows.filter((r) =>
      segment === 'overdue'
        ? r.overdue > 0
        : segment === 'open'
          ? r.openBalance > 0
          : !!r.lastPayment && r.lastPayment >= since30
    );
  }, [rows, segment, since30]);
  const facets = React.useMemo(
    () => [
      {
        columnId: 'level',
        label: 'Level',
        valueOptions: [
          ...new Set(rows.map((r) => r.level ?? 'No level')),
        ].sort(),
      },
    ],
    [rows]
  );
  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Wallet}
          title="No students linked yet"
          body="Students appear here once they are linked to their QuickBooks customer; anyone the SIS can't match goes to To review."
        />
      </Card>
    );
  const SEGMENT_LABEL: Record<Segment, string> = {
    overdue: 'Overdue',
    open: 'Open invoices',
    paid: 'Paid in the last 30 days',
  };
  return (
    <>
      <MoneyBar totals={totals} active={segment} onPick={setSegment} />
      <DataTable<CustomerListRow>
        data={shown}
        columns={columns}
        getRowId={(r) => r.studentNumber}
        searchKeys={[
          (r) => r.customerName,
          (r) => r.name,
          (r) => r.studentNumber,
          (r) => r.companyName ?? '',
          (r) => r.phone ?? '',
        ]}
        searchPlaceholder="Search"
        facets={facets}
        toolbarFilters={
          segment && (
            <Button
              variant="secondary"
              size="sm"
              className="h-8"
              onClick={() => setSegment(null)}
            >
              {SEGMENT_LABEL[segment]}
              <X className="size-3.5" />
            </Button>
          )
        }
        initialColumnVisibility={{
          studentNumber: false,
          level: false,
          overdue: false,
          lastPayment: false,
          lastInvoice: false,
        }}
        initialSort={[{ id: 'name', desc: false }]}
        url={{ enabled: true, namespace: 'billing-customers' }}
        pageSize={50}
        csv={{ filename: 'billing-customers.csv' }}
        emptyFilteredState={{
          title: 'No customers match.',
          body: 'Clear the search, a filter, or the money-bar selection.',
        }}
      />
    </>
  );
}
