'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ChevronDown, Download, FileText, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import {
  StatusCell,
  dateRange,
  invoiceRow,
  type TxnRow,
} from '@/components/billing/customer-transactions';
import {
  DateRangeFilter,
  useDateFilterParam,
} from '@/components/billing/date-range-filter';
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
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
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

// Billing → Sales transactions: QuickBooks' page (its Type list, Date and
// Customer filters, Date · Type · No. · Customer · Memo · Amount · Status ·
// Action with the row ▾, Send / Print on ticked invoices, the Total line) in
// the SIS's table — Type as status tabs, Date and Customer as toolbar chips,
// the bulk bar in the footer, Total as a card under the list.
//
// URL namespace "billing-sales": the page's stat tiles deep-link into the
// tabs with `?billing-sales.status=overdue`.

export type SalesRow = TxnRow & {
  studentNumber: string;
  customerName: string;
  /** Payment rows: the unused credit QuickBooks prints under "Paid". */
  credit: number;
};

// QuickBooks' Type list, in its order.
const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'payments', label: 'Money received' },
  { value: 'unapplied', label: 'Unapplied' },
] as const;
type TypeFilter = (typeof TYPE_OPTIONS)[number]['value'];

const TYPE_TABS: Array<StatusTabConfig<SalesRow>> = TYPE_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
  predicate: (r: SalesRow) => matches(r, o.value),
  isDefault: o.value === 'all',
}));

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

/** What the search box looks in — the table's search and the Total. */
const searchText = (r: SalesRow) =>
  [r.no ?? '', r.customerName, r.memo ?? '', r.studentNumber].join(' ');

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

/** QuickBooks' Customer filter as the SIS's dashed toolbar chip: one
 *  customer at a time, searchable, cleared from inside the list. */
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={picked ? `Customer: ${picked.name}` : 'Customer'}
          className="h-8 max-w-72 border-dashed"
        >
          Customer
          {picked && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Badge
                variant="secondary"
                className="block min-w-0 truncate rounded-sm px-1.5 font-sans text-xs font-normal normal-case tracking-normal"
              >
                {picked.name}
              </Badge>
            </>
          )}
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search customers" />
          <CommandList>
            <CommandEmpty>No customer by that name.</CommandEmpty>
            <CommandGroup>
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
                      'mr-2 size-4',
                      value === c.studentNumber ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex-1 truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {value && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                    className="justify-center text-xs"
                  >
                    <X className="mr-1 h-3 w-3" /> All customers
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SalesTable({
  list,
  qbBase,
  initialDate,
  initialFrom,
  initialTo,
}: {
  list: SalesList;
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
  /** The Date filter in the URL (`?date=`; a stat tile widens it), and a
   *  Custom range's `?from=` / `?to=`. Picking a date writes them back. */
  initialDate?: string;
  initialFrom?: string;
  initialTo?: string;
}) {
  const today = React.useMemo(() => todaySg(), []);
  const { date, setDate, custom, setCustom } = useDateFilterParam({
    date: initialDate,
    from: initialFrom,
    to: initialTo,
  });
  const [customer, setCustomer] = React.useState<string | null>(null);
  // The table keeps its Type tab and search in the URL (`billing-sales.*`);
  // the Total under the list reads them from there so it adds up what is
  // listed, as QuickBooks' Total line does.
  const params = useSearchParams();
  const typeParam = params.get('billing-sales.status');
  const type: TypeFilter =
    TYPE_OPTIONS.find((o) => o.value === typeParam)?.value ?? 'all';
  const query = (params.get('billing-sales.q') ?? '').toLowerCase();
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
  // Date and Customer are filtered here; Type and search inside the table.
  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    return rows.filter((r) => {
      if (customer && r.studentNumber !== customer) return false;
      const d = r.date?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, date, custom, customer, today]);
  // QuickBooks' Total line: invoices less payments, of what's listed.
  const total = React.useMemo(
    () =>
      Math.round(
        shown
          .filter(
            (r) =>
              matches(r, type) &&
              (!query || searchText(r).toLowerCase().includes(query))
          )
          .reduce(
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
    [shown, type, query]
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
          <span
            title={row.original.memo ?? undefined}
            className="block max-w-40 truncate text-sm text-muted-foreground"
          >
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
                    View
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

  // QuickBooks' Date and Customer filters, as the SIS's toolbar chips.
  const filters = (
    <>
      <DateRangeFilter
        value={date}
        onChange={setDate}
        custom={custom}
        onCustomChange={setCustom}
      />
      <CustomerFilter
        customers={list.customers}
        value={customer}
        onChange={setCustomer}
      />
    </>
  );

  return (
    <>
      {rows.length === 0 ? (
        <Card className="py-0">
          <DataTableEmptyState
            icon={FileText}
            title="No sales yet"
            body="Invoices and payments of linked students' QuickBooks customers appear here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <DataTable<SalesRow>
            data={shown}
            toolbarFilters={filters}
            statusTabs={TYPE_TABS}
            columns={columns}
            getRowId={(r) => r.key}
            searchKeys={[searchText]}
            // The Total below reads the tab and search back from the URL.
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
              // Empty on most rows; Columns brings it back.
              memo: false,
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
              body: 'Pick All, set Date to Any date, clear Customer, or clear the search.',
            }}
          />
          <Card className="bg-gradient-to-t from-primary/5 to-card shadow-xs">
            <CardHeader>
              <CardTitle className="font-serif text-lg font-semibold tracking-tight">
                Total
              </CardTitle>
              <CardDescription>
                The invoices listed less the payments listed.
              </CardDescription>
              <CardAction className="self-center font-serif text-2xl font-semibold tabular-nums text-foreground">
                {formatSgd(total)}
              </CardAction>
            </CardHeader>
          </Card>
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
