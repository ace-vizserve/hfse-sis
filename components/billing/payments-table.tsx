'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { HandCoins } from 'lucide-react';
import Link from 'next/link';

import {
  DATE_OPTIONS,
  FilterSelect,
  StatusCell,
  dateRange,
  type DateFilter,
  type TxnRow,
} from '@/components/billing/customer-transactions';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Label } from '@/components/ui/label';
import type { PaymentListRow } from '@/lib/billing/payments-list.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// Billing → Payments, as QuickBooks' Sales transactions shows its Payment
// rows: Date · No. · Customer · Memo · Deposit to · Amount · Status, with
// QuickBooks' Date filter and a Deposit to filter.

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'closed', label: 'Closed' },
  { value: 'unapplied', label: 'Unapplied' },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

const isClosed = (r: PaymentListRow) =>
  r.appliedTo.length > 0 && r.unapplied <= 0;

/** The status as the customer page words it. */
function statusRow(r: PaymentListRow): TxnRow {
  const unapplied = r.appliedTo.length === 0;
  return {
    key: r.id,
    kind: 'payment',
    id: r.id,
    date: r.txnDate,
    type: 'Payment',
    no: r.reference,
    memo: null,
    amount: r.total,
    status: unapplied
      ? 'Unapplied'
      : r.unapplied > 0
        ? 'Partially applied'
        : 'Closed',
    statusKey: isClosed(r) ? 'closed' : 'unapplied',
    tone: isClosed(r) ? 'good' : 'warn',
  };
}

export function PaymentsTable({ rows }: { rows: PaymentListRow[] }) {
  const today = React.useMemo(() => todaySg(), []);
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [date, setDate] = React.useState<DateFilter>('last-365');
  const [custom, setCustom] = React.useState({ from: '', to: '' });

  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    return rows.filter((r) => {
      if (status === 'closed' && !isClosed(r)) return false;
      if (status === 'unapplied' && isClosed(r)) return false;
      const d = r.txnDate?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, status, date, custom, today]);

  const columns = React.useMemo<ColumnDef<PaymentListRow, unknown>[]>(
    () => [
      {
        id: 'date',
        accessorFn: (r) => r.txnDate ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Date</SortableHeader>
        ),
        meta: { label: 'Date' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDay(row.original.txnDate)}
          </span>
        ),
      },
      {
        id: 'no',
        accessorFn: (r) => r.reference ?? '',
        header: 'No.',
        meta: { label: 'No.' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums">
            {row.original.reference ?? ''}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'customer',
        accessorFn: (r) => r.customerName,
        header: ({ column }) => (
          <SortableHeader column={column}>Customer</SortableHeader>
        ),
        meta: { label: 'Customer' },
        cell: ({ row }) => (
          <Link
            href={`/billing/${encodeURIComponent(row.original.studentNumber)}`}
            className="whitespace-nowrap text-foreground hover:underline"
          >
            {row.original.customerName}
          </Link>
        ),
      },
      {
        id: 'memo',
        accessorFn: (r) =>
          r.appliedTo.map((a) => a.docNumber ?? a.invoiceId).join(', '),
        header: 'Memo',
        meta: { label: 'Memo' },
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          if (r.appliedTo.length === 0) return null;
          return (
            <span className="text-sm text-muted-foreground">
              Paid towards{' '}
              {r.appliedTo.map((a, n) => (
                <React.Fragment key={a.invoiceId}>
                  {n > 0 && ', '}
                  <IdentifierLink
                    href={`/billing/${encodeURIComponent(r.studentNumber)}/invoices/${encodeURIComponent(a.invoiceId)}`}
                    className="font-mono text-[13px] tabular-nums"
                  >
                    {a.docNumber ?? a.invoiceId}
                  </IdentifierLink>
                </React.Fragment>
              ))}
            </span>
          );
        },
      },
      {
        id: 'account',
        accessorFn: (r) => r.account,
        header: ({ column }) => (
          <SortableHeader column={column}>Deposit to</SortableHeader>
        ),
        meta: { label: 'Deposit to' },
      },
      {
        id: 'amount',
        accessorFn: (r) => r.total,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Amount
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Amount' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {formatSgd(row.original.total)}
          </div>
        ),
      },
      {
        id: 'status',
        accessorFn: (r) => (isClosed(r) ? 'Closed' : 'Unapplied'),
        header: ({ column }) => (
          <SortableHeader column={column}>Status</SortableHeader>
        ),
        meta: { label: 'Status' },
        cell: ({ row }) => <StatusCell row={statusRow(row.original)} />,
      },
      // Off by default.
      {
        id: 'unused',
        accessorFn: (r) => r.unapplied,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Unused credit
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Unused credit' },
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground">
            {row.original.unapplied > 0
              ? formatSgd(row.original.unapplied)
              : '—'}
          </div>
        ),
      },
      {
        id: 'studentNumber',
        accessorFn: (r) => r.studentNumber,
        header: 'Student no.',
        meta: { label: 'Student no.' },
        enableSorting: false,
      },
      {
        id: 'recordedBy',
        accessorFn: (r) => r.recordedBy,
        header: 'Recorded by',
        meta: { label: 'Recorded by' },
        enableSorting: false,
      },
    ],
    []
  );

  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={HandCoins}
          title="No payments yet"
          body="Payments from linked students' QuickBooks customers appear here."
        />
      </Card>
    );

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="pay-status"
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
          className="w-36"
        />
        <FilterSelect
          id="pay-date"
          label="Date"
          value={date}
          options={DATE_OPTIONS}
          onChange={setDate}
        />
        {date === 'custom' && (
          <>
            <div className="space-y-1">
              <Label
                htmlFor="pay-from"
                className="text-[12px] text-muted-foreground"
              >
                From
              </Label>
              <DatePicker
                id="pay-from"
                value={custom.from}
                onChange={(from) => setCustom((c) => ({ ...c, from }))}
                placeholder="Any date"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="pay-to"
                className="text-[12px] text-muted-foreground"
              >
                To
              </Label>
              <DatePicker
                id="pay-to"
                value={custom.to}
                onChange={(to) => setCustom((c) => ({ ...c, to }))}
                placeholder="Any date"
              />
            </div>
          </>
        )}
      </div>
      <DataTable<PaymentListRow>
        data={shown}
        columns={columns}
        getRowId={(r) => r.id}
        searchKeys={[
          (r) => r.reference ?? '',
          (r) => r.customerName,
          (r) => r.studentNumber,
          (r) => r.appliedTo.map((a) => a.docNumber ?? '').join(' '),
        ]}
        searchPlaceholder="Search reference, customer or invoice no."
        facets={[
          {
            columnId: 'account',
            label: 'Deposit to',
            valueOptions: [...new Set(rows.map((r) => r.account))].sort(),
          },
        ]}
        initialColumnVisibility={{
          unused: false,
          studentNumber: false,
          recordedBy: false,
        }}
        initialSort={[{ id: 'date', desc: true }]}
        url={{ enabled: true, namespace: 'billing-payments' }}
        pageSize={50}
        csv={{ filename: 'billing-payments.csv' }}
        emptyFilteredState={{
          title: 'No payments match.',
          body: 'Set Status or Date back to All, or clear the search.',
        }}
      />
    </>
  );
}
