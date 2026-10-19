'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Check,
  ChevronsUpDown,
  Download,
  FileText,
  Send,
  X,
} from 'lucide-react';
import Link from 'next/link';

import {
  DATE_OPTIONS,
  FilterSelect,
  StatusCell,
  dateRange,
  invoiceRow,
  type DateFilter,
  type TxnRow,
} from '@/components/billing/customer-transactions';
import {
  InvoiceRowMenu,
  downloadInvoicePdfs,
  invoicePageHref,
  receivePaymentHref,
} from '@/components/billing/invoice-row-menu';
import {
  useSendInvoices,
  type SendableInvoice,
} from '@/components/billing/use-send-invoices';
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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { InvoiceListRow } from '@/lib/billing/invoices-list.server';
import type { PaymentListRow } from '@/lib/billing/payments-list.server';
import type { SalesList } from '@/lib/billing/sales-list.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// Billing → Sales transactions, laid out as QuickBooks' page: the money bar
// (each segment filters the list), Type / Date / Customer filters, Date ·
// Type · No. · Customer · Memo · Amount · Status · Action with QuickBooks'
// row ▾ and Batch actions (Send, Print), and the Total line under the list.

export type SalesRow = TxnRow & {
  studentNumber: string;
  customerName: string;
  /** Payment rows: the unused credit QuickBooks prints under "Paid". */
  credit: number;
};

const TYPE_OPTIONS = [
  { value: 'all', label: 'All transactions' },
  { value: 'invoices', label: 'All invoices' },
  { value: 'open', label: 'Open invoices' },
  { value: 'overdue', label: 'Overdue invoices' },
  { value: 'paid', label: 'Paid invoices' },
  { value: 'payments', label: 'Money received' },
  { value: 'unapplied', label: 'Unapplied payments' },
] as const;
type TypeFilter = (typeof TYPE_OPTIONS)[number]['value'];

function matches(r: SalesRow, t: TypeFilter): boolean {
  switch (t) {
    case 'invoices':
      return r.kind === 'invoice';
    case 'open':
      return (
        r.kind === 'invoice' &&
        (r.statusKey === 'open' || r.statusKey === 'overdue')
      );
    case 'overdue':
      return r.kind === 'invoice' && r.statusKey === 'overdue';
    case 'paid':
      return r.kind === 'invoice' && r.statusKey === 'paid';
    case 'payments':
      return r.kind === 'payment';
    case 'unapplied':
      return r.kind === 'payment' && r.credit > 0;
    default:
      return true;
  }
}

function paymentRow(p: PaymentListRow): SalesRow {
  const unapplied = p.appliedTo.length === 0;
  return {
    key: `p${p.id}`,
    kind: 'payment',
    id: p.id,
    date: p.txnDate,
    type: 'Payment',
    no: p.reference,
    memo: p.appliedTo.length
      ? `Paid towards ${p.appliedTo.map((a) => a.docNumber ?? a.invoiceId).join(', ')}`
      : null,
    amount: p.total,
    status: unapplied ? 'Unapplied' : p.unapplied > 0 ? 'Paid' : 'Closed',
    statusKey: unapplied || p.unapplied > 0 ? 'unapplied' : 'closed',
    tone: unapplied ? 'warn' : 'good',
    studentNumber: p.studentNumber,
    customerName: p.customerName,
    credit: p.unapplied,
  };
}

/** QuickBooks' money bar on Sales transactions. */
function MoneyBar({
  bar,
  active,
  onPick,
}: {
  bar: SalesList['bar'];
  active: TypeFilter;
  onPick: (t: TypeFilter) => void;
}) {
  const segs: Array<{
    type: TypeFilter;
    value: number;
    label: string;
    tone: string;
  }> = [
    {
      type: 'overdue',
      value: bar.overdue,
      label: `${bar.overdueCount.toLocaleString('en-SG')} overdue invoices`,
      tone: 'bg-brand-amber',
    },
    {
      type: 'open',
      value: bar.open,
      label: `${bar.openCount.toLocaleString('en-SG')} open invoices and credits`,
      tone: 'bg-hairline-strong',
    },
    {
      type: 'payments',
      value: bar.paid,
      label: `${bar.paidCount.toLocaleString('en-SG')} recently paid`,
      tone: 'bg-brand-mint',
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
      {segs.map((s) => (
        <Button
          key={s.type}
          variant="ghost"
          aria-pressed={active === s.type}
          onClick={() => onPick(active === s.type ? 'all' : s.type)}
          className={cn(
            'group block h-auto space-y-2 whitespace-normal rounded-md p-2 text-left font-normal hover:bg-muted/60',
            active !== 'all' && active !== s.type && 'opacity-50'
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
              s.tone,
              active === s.type && 'h-4'
            )}
          />
        </Button>
      ))}
    </div>
  );
}

function CustomerFilter({
  customers,
  value,
  onChange,
}: {
  customers: SalesList['customers'];
  value: string | null;
  onChange: (sn: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const picked = customers.find((c) => c.studentNumber === value);
  return (
    <div className="space-y-1">
      <Label className="text-[12px] text-muted-foreground">Customer</Label>
      <div className="flex items-center gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 w-64 justify-between font-normal"
            >
              <span className="truncate">
                {picked ? picked.name : 'All customers'}
              </span>
              <ChevronsUpDown className="size-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder="Search customers" />
              <CommandList>
                <CommandEmpty>No customer by that name.</CommandEmpty>
                {customers.map((c) => (
                  <CommandItem
                    key={c.studentNumber}
                    value={`${c.name} ${c.studentNumber}`}
                    onSelect={() => {
                      onChange(c.studentNumber);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'size-4',
                        value === c.studentNumber ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {value && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="All customers"
            onClick={() => onChange(null)}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SalesTable({
  list,
  qbBase,
  initialType = 'all',
}: {
  list: SalesList;
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
  initialType?: TypeFilter;
}) {
  const today = React.useMemo(() => todaySg(), []);
  const [type, setType] = React.useState<TypeFilter>(initialType);
  const [date, setDate] = React.useState<DateFilter>('last-3-months');
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [customer, setCustomer] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<SendableInvoice[] | null>(null);
  const [reset, setReset] = React.useState(0);
  const sendInvoices = useSendInvoices();

  const invoiceById = React.useMemo(
    () => new Map(list.invoices.map((i) => [i.id, i])),
    [list.invoices]
  );
  const rows = React.useMemo<SalesRow[]>(
    () => [
      ...list.invoices.map((i: InvoiceListRow) => ({
        ...invoiceRow(i, today),
        studentNumber: i.studentNumber,
        customerName: i.customerName,
        credit: 0,
      })),
      ...list.payments.map(paymentRow),
    ],
    [list, today]
  );
  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    return rows.filter((r) => {
      if (!matches(r, type)) return false;
      if (customer && r.studentNumber !== customer) return false;
      const d = r.date?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, type, date, custom, customer, today]);
  // QuickBooks' Total line: invoices less payments, of what's listed.
  const total = React.useMemo(
    () =>
      Math.round(
        shown.reduce(
          (s, r) =>
            s +
            (r.kind === 'invoice' && r.statusKey !== 'voided'
              ? r.amount
              : r.kind === 'payment'
                ? -r.amount
                : 0),
          0
        ) * 100
      ) / 100,
    [shown]
  );

  const columns = React.useMemo<ColumnDef<SalesRow, unknown>[]>(
    () => [
      {
        id: 'date',
        accessorFn: (r) => r.date ?? '',
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
          <SortableHeader column={column}>Type</SortableHeader>
        ),
        meta: { label: 'Type' },
      },
      {
        id: 'no',
        accessorFn: (r) => r.no ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>No.</SortableHeader>
        ),
        meta: { label: 'No.' },
        cell: ({ row }) => {
          const r = row.original;
          const inv = r.kind === 'invoice' ? invoiceById.get(r.id) : null;
          return inv ? (
            <IdentifierLink
              href={invoicePageHref(inv)}
              className="font-mono text-[13px] tabular-nums"
            >
              {r.no ?? 'No number'}
            </IdentifierLink>
          ) : (
            <span className="font-mono text-[13px] tabular-nums">
              {r.no ?? ''}
            </span>
          );
        },
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
          <div className="whitespace-nowrap text-right tabular-nums">
            {formatSgd(row.original.amount)}
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
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusCell row={row.original} />
            {row.original.credit > 0 && row.original.status === 'Paid' && (
              <div className="text-[12px] tabular-nums text-muted-foreground">
                {formatSgd(row.original.credit)} credit
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'action',
        header: () => <div className="text-right">Action</div>,
        meta: { label: 'Action', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === 'payment')
            return (
              <div className="flex justify-end">
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <a
                    href={`${qbBase}/app/recvpayment?txnId=${encodeURIComponent(r.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View in QuickBooks
                  </a>
                </Button>
              </div>
            );
          const inv = invoiceById.get(r.id);
          if (!inv) return null;
          const owing = inv.state !== 'voided' && inv.balance > 0;
          return (
            <div className="flex items-center justify-end gap-2">
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={invoicePageHref(inv)}>View</Link>
              </Button>
              <span className="h-4 w-px bg-border" aria-hidden />
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                {owing ? (
                  <Link href={receivePaymentHref(inv)}>Receive payment</Link>
                ) : (
                  <a
                    href={`/api/billing/invoices/${encodeURIComponent(inv.id)}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print
                  </a>
                )}
              </Button>
              <InvoiceRowMenu
                invoice={inv}
                qbUrl={`${qbBase}/app/invoice?txnId=${encodeURIComponent(inv.id)}`}
                onSend={() => setConfirm([inv])}
              />
            </div>
          );
        },
      },
      // Off by default.
      {
        id: 'dueDate',
        accessorFn: (r) => r.invoice?.dueDate ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Due date</SortableHeader>
        ),
        meta: { label: 'Due date' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.invoice
              ? formatDay(row.original.invoice.dueDate)
              : ''}
          </span>
        ),
      },
      {
        id: 'balance',
        accessorFn: (r) => (r.invoice ? r.invoice.balance : r.credit),
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
            {formatSgd(
              row.original.invoice
                ? row.original.invoice.balance
                : row.original.credit
            )}
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
    ],
    [invoiceById, qbBase]
  );

  return (
    <>
      <MoneyBar bar={list.bar} active={type} onPick={setType} />
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="sales-type"
          label="Type"
          value={type}
          options={TYPE_OPTIONS}
          onChange={setType}
          className="w-48"
        />
        <FilterSelect
          id="sales-date"
          label="Date"
          value={date}
          options={DATE_OPTIONS}
          onChange={setDate}
          className="w-40"
        />
        {date === 'custom' && (
          <>
            <div className="space-y-1">
              <Label
                htmlFor="sales-from"
                className="text-[12px] text-muted-foreground"
              >
                From
              </Label>
              <DatePicker
                id="sales-from"
                value={custom.from}
                onChange={(from) => setCustom((c) => ({ ...c, from }))}
                placeholder="Any date"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="sales-to"
                className="text-[12px] text-muted-foreground"
              >
                To
              </Label>
              <DatePicker
                id="sales-to"
                value={custom.to}
                onChange={(to) => setCustom((c) => ({ ...c, to }))}
                placeholder="Any date"
              />
            </div>
          </>
        )}
        <CustomerFilter
          customers={list.customers}
          value={customer}
          onChange={setCustomer}
        />
      </div>
      {rows.length === 0 ? (
        <Card className="py-0">
          <DataTableEmptyState
            icon={FileText}
            title="No sales yet"
            body="Invoices and payments of linked students' QuickBooks customers appear here."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          <DataTable<SalesRow>
            data={shown}
            columns={columns}
            getRowId={(r) => r.key}
            searchKeys={[
              (r) => r.no ?? '',
              (r) => r.customerName,
              (r) => r.memo ?? '',
              (r) => r.studentNumber,
            ]}
            searchPlaceholder="Search no., customer or memo"
            selection={{
              enabled: true,
              enableRowSelection: (r) =>
                r.kind === 'invoice' && r.statusKey !== 'voided',
              bulkActions: [
                {
                  key: 'send',
                  label: 'Send',
                  icon: Send,
                  onTrigger: (picked) =>
                    setConfirm(
                      picked
                        .map((r) => invoiceById.get(r.id))
                        .filter((i): i is InvoiceListRow => !!i)
                    ),
                },
                {
                  key: 'print',
                  label: 'Print',
                  icon: Download,
                  onTrigger: async (picked) => {
                    await downloadInvoicePdfs(
                      picked.map((r) => ({ id: r.id, docNumber: r.no }))
                    );
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
            }}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: 'billing-sales' }}
            pageSize={50}
            csv={{ filename: 'billing-sales-transactions.csv' }}
            emptyFilteredState={{
              title: 'No transactions match.',
              body: 'Set Type or Date back, pick All customers, or clear the search.',
            }}
          />
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
            <span className="font-semibold text-foreground">Total</span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatSgd(total)}
            </span>
          </div>
        </div>
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
