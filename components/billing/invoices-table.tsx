'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { BellRing, Download, FileText, Send } from 'lucide-react';
import Link from 'next/link';

import {
  DATE_OPTIONS,
  FilterSelect,
  StatusCell,
  dateRange,
  invoiceRow,
  type DateFilter,
} from '@/components/billing/customer-transactions';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Label } from '@/components/ui/label';
import type {
  InvoiceListRow,
  InvoicesList,
} from '@/lib/billing/invoices-list.server';
import { useSendInvoices } from '@/components/billing/use-send-invoices';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

// Billing → Invoices, as QuickBooks' Invoices list: the money bar, Status and
// Date filters, Date · No. · Customer · Amount · Status · Action (Receive
// payment or View, with Send and Open customer under ▾), and Send on ticked
// invoices — QuickBooks' Batch actions.

// QuickBooks' Status list: All, Needs attention, Unpaid (Overdue, Not due),
// Paid — plus Voided, which QuickBooks keeps under All.
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'overdue', label: 'Unpaid · Overdue' },
  { value: 'not-due', label: 'Unpaid · Not due' },
  { value: 'paid', label: 'Paid' },
  { value: 'voided', label: 'Voided' },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

function matchesStatus(r: InvoiceListRow, s: StatusFilter): boolean {
  switch (s) {
    case 'unpaid':
      return (
        r.status === 'open' || r.status === 'part' || r.status === 'overdue'
      );
    case 'overdue':
      return r.status === 'overdue';
    case 'not-due':
      return r.status === 'open' || r.status === 'part';
    case 'attention':
      return r.status === 'overdue';
    case 'paid':
      return r.status === 'paid';
    case 'voided':
      return r.status === 'voided';
    default:
      return true;
  }
}

const invoiceHref = (r: InvoiceListRow) =>
  `/billing/${encodeURIComponent(r.studentNumber)}/invoices/${encodeURIComponent(r.id)}`;
const customerHref = (r: InvoiceListRow) =>
  `/billing/${encodeURIComponent(r.studentNumber)}`;

/** QuickBooks' Invoices money bar: Unpaid (last 365 days) split overdue /
 *  not due yet, and Paid (last 30 days). */
function MoneyBar({ bar }: { bar: InvoicesList['bar'] }) {
  const unpaid = bar.overdue + bar.notDueYet;
  const pct = unpaid > 0 ? (bar.overdue / unpaid) * 100 : 0;
  return (
    <div className="grid grid-cols-1 gap-6 rounded-xl border border-border bg-muted/60 p-5 md:grid-cols-2">
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {formatSgd(unpaid)} unpaid
          </span>{' '}
          · last 365 days
        </p>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-serif text-[22px] font-semibold leading-none tabular-nums text-foreground">
              {formatSgd(bar.overdue)}
            </p>
            <p className="text-[13px] text-muted-foreground">Overdue</p>
          </div>
          <div className="text-right">
            <p className="font-serif text-[22px] font-semibold leading-none tabular-nums text-foreground">
              {formatSgd(bar.notDueYet)}
            </p>
            <p className="text-[13px] text-muted-foreground">Not due yet</p>
          </div>
        </div>
        <div className="flex h-3 overflow-hidden rounded-sm bg-hairline-strong">
          <span className="bg-brand-amber" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">
            {formatSgd(bar.paidLast30)} paid
          </span>{' '}
          · last 30 days
        </p>
        <div>
          <p className="font-serif text-[22px] font-semibold leading-none tabular-nums text-foreground">
            {bar.paymentsLast30.toLocaleString('en-SG')}
          </p>
          <p className="text-[13px] text-muted-foreground">Payments received</p>
        </div>
        <div className="h-3 rounded-sm bg-brand-mint" />
      </div>
    </div>
  );
}

export function InvoicesTable({
  rows,
  bar,
  qbBase,
  createAction,
}: {
  rows: InvoiceListRow[];
  bar: InvoicesList['bar'];
  /** QuickBooks' Create invoice button, at the end of the filter row. */
  createAction?: React.ReactNode;
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
}) {
  const today = React.useMemo(() => todaySg(), []);
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [date, setDate] = React.useState<DateFilter>('last-3-months');
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [confirm, setConfirm] = React.useState<InvoiceListRow[] | null>(null);
  const [reset, setReset] = React.useState(0);
  const sendInvoices = useSendInvoices();

  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    return rows.filter((r) => {
      if (!matchesStatus(r, status)) return false;
      const d = r.txnDate?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, status, date, custom, today]);

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
      <MoneyBar bar={bar} />
      <Tabs defaultValue="all">
        <TabsList variant="line">
          <TabsTrigger value="all">All invoices</TabsTrigger>
        </TabsList>
      </Tabs>
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
              <>
                <FilterSelect
                  id="inv-status"
                  label="Status"
                  value={status}
                  options={STATUS_OPTIONS}
                  onChange={setStatus}
                />
                <FilterSelect
                  id="inv-date"
                  label="Date"
                  value={date}
                  options={DATE_OPTIONS}
                  onChange={setDate}
                />
                {date === 'custom' && (
                  <>
                    <div className="space-y-1">
                      <Label
                        htmlFor="inv-from"
                        className="text-[12px] text-muted-foreground"
                      >
                        From
                      </Label>
                      <DatePicker
                        id="inv-from"
                        value={custom.from}
                        onChange={(from) => setCustom((c) => ({ ...c, from }))}
                        placeholder="Any date"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="inv-to"
                        className="text-[12px] text-muted-foreground"
                      >
                        To
                      </Label>
                      <DatePicker
                        id="inv-to"
                        value={custom.to}
                        onChange={(to) => setCustom((c) => ({ ...c, to }))}
                        placeholder="Any date"
                      />
                    </div>
                  </>
                )}
              </>
            }
            toolbarTrailing={createAction}
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
              placement: 'menu',
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
            url={{ enabled: true, namespace: 'billing-invoices' }}
            pageSize={50}
            csv={{ filename: 'billing-invoices.csv' }}
            emptyFilteredState={{
              title: 'No invoices match.',
              body: 'Set Status or Date back to All, or clear the search.',
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
