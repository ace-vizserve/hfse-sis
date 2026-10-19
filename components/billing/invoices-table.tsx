'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { BellRing, Download, FileText, Send } from 'lucide-react';
import Link from 'next/link';

import {
  StatusCell,
  dateRange,
  invoiceRow,
  type DateFilter,
} from '@/components/billing/customer-transactions';
import {
  DateRangeFilter,
  isDateFilter,
} from '@/components/billing/date-range-filter';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  InvoiceRowMenu,
  downloadInvoicePdfs,
  receivePaymentHref,
} from '@/components/billing/invoice-row-menu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import type { InvoiceListRow } from '@/lib/billing/invoices-list.server';
import { useSendInvoices } from '@/components/billing/use-send-invoices';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// Billing → Invoices: QuickBooks' Invoices list (its statuses, Date filter,
// Date · No. · Customer · Amount · Status · Action with the row ▾, and Send /
// Send reminder / Print on ticked invoices) in the SIS's table — status tabs,
// a Date chip, and the bulk bar in the footer.

/** The table's URL namespace — the page's stat tiles deep-link into it
 *  (`?billing-invoices.status=overdue`). */
const INVOICES_NS = 'billing-invoices';

// QuickBooks' Status list. Needs attention is QuickBooks' word for overdue.
const STATUS_TABS: Array<StatusTabConfig<InvoiceListRow>> = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  {
    value: 'overdue',
    label: 'Overdue',
    predicate: (r) => r.status === 'overdue',
  },
  {
    value: 'not-due',
    label: 'Not due',
    predicate: (r) => r.status === 'open' || r.status === 'part',
  },
  { value: 'paid', label: 'Paid', predicate: (r) => r.status === 'paid' },
  {
    value: 'voided',
    label: 'Voided',
    predicate: (r) => r.status === 'voided',
  },
];

const invoiceHref = (r: InvoiceListRow) =>
  `/billing/${encodeURIComponent(r.studentNumber)}/invoices/${encodeURIComponent(r.id)}`;
const customerHref = (r: InvoiceListRow) =>
  `/billing/${encodeURIComponent(r.studentNumber)}`;

export function InvoicesTable({
  rows,
  qbBase,
  initialDate,
}: {
  rows: InvoiceListRow[];
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
  /** The Date filter to open on (`?date=`; a stat tile widens it). */
  initialDate?: string;
}) {
  const today = React.useMemo(() => todaySg(), []);
  const [date, setDate] = React.useState<DateFilter>(
    isDateFilter(initialDate) ? initialDate : 'last-3-months'
  );
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [confirm, setConfirm] = React.useState<InvoiceListRow[] | null>(null);
  const [reset, setReset] = React.useState(0);
  const sendInvoices = useSendInvoices();

  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    return rows.filter((r) => {
      const d = r.txnDate?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, date, custom, today]);

  const columns = React.useMemo<ColumnDef<InvoiceListRow, unknown>[]>(
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
        accessorFn: (r) => r.docNumber ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>No.</SortableHeader>
        ),
        meta: { label: 'No.' },
        cell: ({ row }) => (
          <IdentifierLink
            href={invoiceHref(row.original)}
            className="font-mono text-[13px] tabular-nums"
          >
            {row.original.docNumber ?? 'No number'}
          </IdentifierLink>
        ),
        enableHiding: false,
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
            href={customerHref(row.original)}
            className="whitespace-nowrap text-foreground hover:underline"
          >
            {row.original.customerName}
          </Link>
        ),
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
        accessorFn: (r) => r.status,
        header: ({ column }) => (
          <SortableHeader column={column}>Status</SortableHeader>
        ),
        meta: { label: 'Status' },
        cell: ({ row }) => <StatusCell row={invoiceRow(row.original, today)} />,
      },
      {
        id: 'action',
        header: () => <div className="text-right">Action</div>,
        meta: { label: 'Action', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const owing = r.state !== 'voided' && r.balance > 0;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={invoiceHref(r)}>View</Link>
              </Button>
              <span className="h-4 w-px bg-border" aria-hidden />
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                {owing ? (
                  <Link href={receivePaymentHref(r)}>Receive payment</Link>
                ) : (
                  <a
                    href={`/api/billing/invoices/${encodeURIComponent(r.id)}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print
                  </a>
                )}
              </Button>
              <InvoiceRowMenu
                invoice={r}
                qbUrl={`${qbBase}/app/invoice?txnId=${encodeURIComponent(r.id)}`}
                onSend={() => setConfirm([r])}
              />
            </div>
          );
        },
      },
      // Off by default.
      {
        id: 'dueDate',
        accessorFn: (r) => r.dueDate ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Due date</SortableHeader>
        ),
        meta: { label: 'Due date' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDay(row.original.dueDate)}
          </span>
        ),
      },
      {
        id: 'balance',
        accessorFn: (r) => r.balance,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Balance
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Balance' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {formatSgd(row.original.balance)}
          </div>
        ),
      },
      {
        id: 'studentNumber',
        accessorFn: (r) => r.studentNumber,
        header: 'Student no.',
        meta: { label: 'Student no.' },
        cell: ({ row }) => (
          <span className="font-mono text-[13px] tabular-nums">
            {row.original.studentNumber}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'memo',
        accessorFn: (r) => r.memo ?? '',
        header: 'Memo',
        meta: { label: 'Memo' },
        enableSorting: false,
      },
      {
        id: 'items',
        accessorFn: (r) => r.items,
        header: 'Items',
        meta: { label: 'Items' },
        enableSorting: false,
      },
      {
        id: 'tile',
        accessorFn: (r) => r.tile ?? '',
        header: 'Tile',
        meta: { label: 'Tile' },
        enableSorting: false,
      },
    ],
    [today, qbBase]
  );

  return (
    <>
      {rows.length === 0 ? (
        <Card className="py-0">
          <DataTableEmptyState
            icon={FileText}
            title="No invoices yet"
            body="Invoices of linked students' QuickBooks customers appear here."
          />
        </Card>
      ) : (
        <>
          <DataTable<InvoiceListRow>
            toolbarFilters={
              <DateRangeFilter
                value={date}
                onChange={setDate}
                custom={custom}
                onCustomChange={setCustom}
              />
            }
            statusTabs={STATUS_TABS}
            data={shown}
            columns={columns}
            getRowId={(r) => r.id}
            searchKeys={[
              (r) => r.docNumber ?? '',
              (r) => r.customerName,
              (r) => r.studentNumber,
              (r) => r.memo ?? '',
            ]}
            searchPlaceholder="Search number or customer"
            selection={{
              enabled: true,
              enableRowSelection: (r) => r.state !== 'voided',
              bulkActions: [
                {
                  key: 'send',
                  label: 'Send',
                  icon: Send,
                  onTrigger: (selected) => setConfirm(selected),
                },
                {
                  key: 'reminder',
                  label: 'Send reminder',
                  icon: BellRing,
                  onTrigger: (selected) =>
                    setConfirm(
                      selected.filter(
                        (r) => r.state !== 'voided' && r.balance > 0
                      )
                    ),
                },
                {
                  key: 'print',
                  label: 'Print',
                  icon: Download,
                  onTrigger: async (selected) => {
                    await downloadInvoicePdfs(selected);
                    setReset((n) => n + 1);
                  },
                },
              ],
            }}
            selectionResetSignal={reset}
            initialColumnVisibility={{
              dueDate: false,
              balance: false,
              studentNumber: false,
              memo: false,
              items: false,
              tile: false,
            }}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: INVOICES_NS }}
            pageSize={50}
            csv={{ filename: 'billing-invoices.csv' }}
            emptyFilteredState={{
              title: 'No invoices match.',
              body: 'Pick All, set Date to Any date, or clear the search.',
            }}
          />
        </>
      )}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.length === 1
                ? `Email ${confirm[0].docNumber ?? 'this invoice'}?`
                : `Email ${confirm?.length ?? 0} invoices?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              QuickBooks emails each invoice to its customer&rsquo;s billing
              address, as Send does in QuickBooks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const picked = confirm ?? [];
                setConfirm(null);
                await sendInvoices(picked);
                setReset((n) => n + 1);
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
