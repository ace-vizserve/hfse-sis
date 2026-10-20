'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Download,
  FileText,
  HandCoins,
  Send,
} from 'lucide-react';

import {
  InvoiceRowMenu,
  downloadInvoicePdfs,
  invoicePdfHref,
} from '@/components/billing/invoice-row-menu';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Label } from '@/components/ui/label';
import type {
  InvoiceRowView,
  PaymentRowView,
} from '@/lib/billing/customer-page.server';
import type { CreditSource, PayableInvoice } from '@/lib/billing/payment-plan';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// The customer page's Transaction List. What it holds is QuickBooks' (one
// list of invoices and payments, Type / Status / Date filters, Date · Type ·
// No. · Customer · Memo · Amount · Status · Action, batch Send / Print /
// Receive payment, the Total line — sandbox capture 2026-10-19). How it
// looks is the SIS's: Type as status tabs, Status as a facet, Date as a
// toolbar filter, batch actions in the selection footer, Total in a card.

type Tone = 'bad' | 'good' | 'warn' | 'plain';

export type TxnRow = {
  key: string;
  kind: 'invoice' | 'payment';
  id: string;
  date: string | null;
  type: 'Invoice' | 'Payment';
  no: string | null;
  memo: string | null;
  amount: number;
  status: string;
  /** The filter bucket behind `status`. */
  statusKey: 'open' | 'overdue' | 'paid' | 'voided' | 'closed' | 'unapplied';
  tone: Tone;
  invoice?: InvoiceRowView;
  payment?: PaymentRowView;
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  );

export function invoiceRow(i: InvoiceRowView, today: string): TxnRow {
  const base = {
    key: `i${i.id}`,
    kind: 'invoice' as const,
    id: i.id,
    date: i.txnDate,
    type: 'Invoice' as const,
    no: i.docNumber,
    memo: i.memo,
    amount: i.total,
    invoice: i,
  };
  switch (i.status) {
    case 'paid':
      return { ...base, status: 'Paid', statusKey: 'paid', tone: 'good' };
    case 'voided':
      return { ...base, status: 'Voided', statusKey: 'voided', tone: 'plain' };
    case 'overdue': {
      const n = i.dueDate ? daysBetween(i.dueDate, today) : 0;
      return {
        ...base,
        status: `Overdue ${n} ${n === 1 ? 'day' : 'days'}`,
        statusKey: 'overdue',
        tone: 'bad',
      };
    }
    case 'part':
      return {
        ...base,
        status: 'Partially paid',
        statusKey: 'open',
        tone: 'warn',
      };
    default: {
      const n = i.dueDate ? daysBetween(today, i.dueDate) : null;
      return {
        ...base,
        status:
          n === null
            ? 'Open'
            : n === 0
              ? 'Due today'
              : `Due in ${n} ${n === 1 ? 'day' : 'days'}`,
        statusKey: 'open',
        tone: 'plain',
      };
    }
  }
}

function paymentRow(p: PaymentRowView): TxnRow {
  const towards = p.appliedTo.map((a) => a.docNumber ?? a.invoiceId);
  const unapplied = p.appliedTo.length === 0;
  return {
    key: `p${p.id}`,
    kind: 'payment',
    id: p.id,
    date: p.txnDate,
    type: 'Payment',
    no: p.reference,
    memo: towards.length ? `Paid towards ${towards.join(', ')}` : null,
    amount: p.total,
    status: unapplied
      ? 'Unapplied'
      : p.unapplied > 0
        ? 'Partially applied'
        : 'Closed',
    statusKey: unapplied || p.unapplied > 0 ? 'unapplied' : 'closed',
    tone: unapplied || p.unapplied > 0 ? 'warn' : 'good',
    payment: p,
  };
}

// QuickBooks' Type filter, as the SIS's status tabs.
const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'payments', label: 'Payments' },
] as const;
type TypeFilter = (typeof TYPE_OPTIONS)[number]['value'];

// QuickBooks' Status filter, as the SIS's Status facet.
const STATE_LABEL: Record<TxnRow['statusKey'], string> = {
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  closed: 'Closed',
  unapplied: 'Unapplied',
  voided: 'Voided',
};
const STATE_ORDER = Object.values(STATE_LABEL);

export const DATE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-3-months', label: 'Last 3 months' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'last-365', label: 'Last 365 days' },
  { value: 'custom', label: 'Custom' },
] as const;
export type DateFilter = (typeof DATE_OPTIONS)[number]['value'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** The [from, to] a date preset covers, inclusive; null = no limit. */
export function dateRange(
  preset: DateFilter,
  today: string,
  custom: { from: string; to: string }
): [string | null, string | null] {
  const [y, m, d] = today.split('-').map(Number);
  const mi = m - 1;
  switch (preset) {
    case 'this-month':
      return [ymd(y, mi, 1), today];
    case 'last-month':
      return [ymd(y, mi - 1, 1), ymd(y, mi, 0)];
    case 'last-3-months':
      // Same day three months back, clamped to that month's last day.
      return [
        ymd(
          y,
          mi - 3,
          Math.min(d, new Date(Date.UTC(y, mi - 2, 0)).getUTCDate())
        ),
        today,
      ];
    case 'this-year':
      return [`${y}-01-01`, today];
    case 'last-year':
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'last-365':
      return [ymd(y, mi, d - 365), today];
    case 'custom':
      return [custom.from || null, custom.to || null];
    default:
      return [null, null];
  }
}

function matchesType(r: TxnRow, t: TypeFilter): boolean {
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
    default:
      return true;
  }
}

const TONE_CLASS: Record<Tone, string> = {
  bad: 'text-destructive',
  good: 'text-foreground',
  warn: 'text-foreground',
  plain: 'text-foreground',
};

export function StatusCell({ row }: { row: TxnRow }) {
  const Icon =
    row.tone === 'bad'
      ? AlertCircle
      : row.tone === 'good'
        ? CheckCircle2
        : row.tone === 'warn'
          ? CircleDashed
          : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-sm',
        TONE_CLASS[row.tone],
        row.statusKey === 'voided' && 'text-muted-foreground line-through'
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'size-4 shrink-0',
            row.tone === 'good' && 'fill-brand-mint text-ink',
            row.tone === 'warn' && 'text-brand-amber'
          )}
        />
      )}
      {row.status}
    </span>
  );
}

export function FilterSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  // A single-choice toolbar filter in the SIS's facet look: a dashed outline
  // chip named by the filter ("Date ▾"); once set off its first option the
  // chosen value shows beside the name, as a facet shows its count.
  const current = options.find((o) => o.value === value);
  const isSet = value !== options[0]?.value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          className={cn('h-8 border-dashed', className)}
        >
          {label}
          {isSet && current && (
            <>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Badge
                variant="secondary"
                className="rounded-sm px-1.5 font-normal"
              >
                {current.label}
              </Badge>
            </>
          )}
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as T)}
        >
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CustomerTransactions({
  studentNumber,
  studentName,
  customerName,
  invoices,
  payments,
  openInvoices,
  credits,
  depositAccounts,
  paymentMethods,
  canRecord,
  customerBalance,
  qbBase = null,
  initialType = 'all',
}: {
  studentNumber: string;
  studentName: string;
  customerName: string;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  openInvoices: PayableInvoice[];
  credits: Array<CreditSource & { reference: string | null }>;
  depositAccounts: Array<{ id: string; label: string }>;
  paymentMethods?: Array<{ id: string; label: string }>;
  /** False when QuickBooks isn't connected — Receive payment is hidden. */
  canRecord: boolean;
  customerBalance?: number | null;
  /** The QuickBooks web app's address, for Open in QuickBooks. */
  qbBase?: string | null;
  initialType?: TypeFilter;
}) {
  const today = React.useMemo(() => todaySg(), []);
  const [date, setDate] = React.useState<DateFilter>('all');
  const [custom, setCustom] = React.useState({ from: '', to: '' });
  const [reset, setReset] = React.useState(0);
  const [confirm, setConfirm] = React.useState<SendableInvoice[] | null>(null);
  const sendInvoices = useSendInvoices();
  const [paying, setPaying] = React.useState<{
    key: number;
    invoices: PayableInvoice[];
  } | null>(null);

  const rows = React.useMemo(
    () => [
      ...invoices.map((i) => invoiceRow(i, today)),
      ...payments.map(paymentRow),
    ],
    [invoices, payments, today]
  );
  // The Date filter narrows what the table gets; Type (status tabs) and
  // Status (facet) are the table's own, kept in its URL params.
  const shown = React.useMemo(() => {
    const [from, to] = dateRange(date, today, custom);
    if (!from && !to) return rows;
    return rows.filter((r) => {
      const d = r.date?.slice(0, 10) ?? '';
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [rows, date, custom, today]);

  const statusTabs = React.useMemo(
    () =>
      TYPE_OPTIONS.map((o) => ({
        value: o.value,
        label: o.label,
        predicate: (r: TxnRow) => matchesType(r, o.value),
        isDefault: o.value === initialType,
      })),
    [initialType]
  );

  const openById = React.useMemo(
    () => new Map(openInvoices.map((o) => [o.id, o])),
    [openInvoices]
  );

  const columns = React.useMemo<ColumnDef<TxnRow, unknown>[]>(() => {
    const invoiceHref = (id: string) =>
      `/billing/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(id)}`;
    return [
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
        cell: ({ row }) =>
          row.original.kind === 'invoice' ? (
            <IdentifierLink
              href={invoiceHref(row.original.id)}
              className="font-mono text-[13px] tabular-nums"
            >
              {row.original.no ?? 'No number'}
            </IdentifierLink>
          ) : (
            <span className="font-mono text-[13px] tabular-nums">
              {row.original.no ?? ''}
            </span>
          ),
        enableHiding: false,
      },
      {
        id: 'customer',
        accessorFn: () => customerName,
        header: 'Customer',
        meta: { label: 'Customer' },
        cell: () => <span className="whitespace-nowrap">{customerName}</span>,
        enableSorting: false,
      },
      {
        id: 'memo',
        accessorFn: (r) => r.memo ?? '',
        header: 'Memo',
        meta: { label: 'Memo' },
        cell: ({ row }) => {
          const p = row.original.payment;
          if (p && p.appliedTo.length > 0)
            return (
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                Paid towards{' '}
                {p.appliedTo.map((a, n) => (
                  <React.Fragment key={a.invoiceId}>
                    {n > 0 && ', '}
                    <IdentifierLink
                      href={invoiceHref(a.invoiceId)}
                      className="font-mono text-[13px] tabular-nums"
                    >
                      {a.docNumber ?? a.invoiceId}
                    </IdentifierLink>
                  </React.Fragment>
                ))}
              </span>
            );
          return (
            <span
              title={row.original.memo ?? undefined}
              className="block max-w-40 truncate text-sm text-muted-foreground"
            >
              {row.original.memo ?? ''}
            </span>
          );
        },
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
            {row.original.amount < 0
              ? `-${formatSgd(-row.original.amount)}`
              : formatSgd(row.original.amount)}
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
        cell: ({ row }) => <StatusCell row={row.original} />,
      },
      {
        id: 'action',
        header: () => <div className="text-right">Action</div>,
        meta: { label: 'Action', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        // QuickBooks: View | Receive payment ▾ on an open invoice, View |
        // Print ▾ on a paid one, View on a payment.
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === 'payment')
            return (
              <div className="flex justify-end">
                {qbBase && (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                  >
                    <a
                      href={`${qbBase}/app/recvpayment?txnId=${encodeURIComponent(r.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  </Button>
                )}
              </div>
            );
          const open = openById.get(r.id);
          const inv = r.invoice!;
          return (
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={invoiceHref(r.id)}>View</Link>
              </Button>
              <span className="h-4 w-px bg-border" aria-hidden />
              {open && canRecord ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() =>
                    setPaying((p) => ({
                      key: (p?.key ?? 0) + 1,
                      invoices: [open],
                    }))
                  }
                >
                  Receive payment
                </Button>
              ) : (
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <a
                    href={invoicePdfHref(r.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print
                  </a>
                </Button>
              )}
              <InvoiceRowMenu
                invoice={{
                  id: inv.id,
                  docNumber: inv.docNumber,
                  studentNumber,
                  state: inv.state,
                  balance: inv.balance,
                }}
                qbUrl={
                  qbBase
                    ? `${qbBase}/app/invoice?txnId=${encodeURIComponent(inv.id)}`
                    : null
                }
                onSend={() =>
                  setConfirm([{ id: inv.id, docNumber: inv.docNumber }])
                }
                showCustomer={false}
              />
            </div>
          );
        },
      },
      // Off by default; switch on from Columns, as QuickBooks' gear does.
      {
        // The Status facet's column: the plain state, without the days.
        id: 'state',
        accessorFn: (r) => STATE_LABEL[r.statusKey],
        header: 'State',
        meta: { label: 'State' },
        enableSorting: false,
      },
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
        accessorFn: (r) =>
          r.invoice ? r.invoice.balance : (r.payment?.unapplied ?? 0),
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Balance
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Balance' },
        cell: ({ row }) => {
          const r = row.original;
          const v = r.invoice
            ? r.invoice.balance
            : r.payment && r.payment.unapplied > 0
              ? -r.payment.unapplied
              : 0;
          return (
            <div className="whitespace-nowrap text-right tabular-nums">
              {v < 0 ? `-${formatSgd(-v)}` : formatSgd(v)}
            </div>
          );
        },
      },
      {
        id: 'depositTo',
        accessorFn: (r) => r.payment?.account ?? '',
        header: 'Deposit to',
        meta: { label: 'Deposit to' },
        enableSorting: false,
      },
      {
        id: 'items',
        accessorFn: (r) => r.invoice?.items ?? '',
        header: 'Items',
        meta: { label: 'Items' },
        enableSorting: false,
      },
      {
        id: 'tile',
        accessorFn: (r) => r.invoice?.tile ?? '',
        header: 'Tile',
        meta: { label: 'Tile' },
        enableSorting: false,
      },
      {
        id: 'createdBy',
        accessorFn: (r) => r.invoice?.createdBy ?? r.payment?.recordedBy ?? '',
        header: 'Created by',
        meta: { label: 'Created by' },
        enableSorting: false,
      },
    ];
  }, [studentNumber, customerName, openById, canRecord, qbBase]);

  if (rows.length === 0)
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={FileText}
          title="No transactions yet"
          body="Invoices and payments made here or in QuickBooks for this customer appear here, newest first."
        />
      </Card>
    );

  // QuickBooks' Date filter; Type is the status tabs, Status a facet.
  const filters = (
    <>
      <FilterSelect
        id="txn-date"
        label="Date"
        value={date}
        options={DATE_OPTIONS}
        onChange={setDate}
      />
      {date === 'custom' && (
        <>
          <Label htmlFor="txn-from" className="sr-only">
            From
          </Label>
          <DatePicker
            id="txn-from"
            value={custom.from}
            onChange={(from) => setCustom((c) => ({ ...c, from }))}
            placeholder="From"
            className="h-8 w-36 text-[13px]"
          />
          <Label htmlFor="txn-to" className="sr-only">
            To
          </Label>
          <DatePicker
            id="txn-to"
            value={custom.to}
            onChange={(to) => setCustom((c) => ({ ...c, to }))}
            placeholder="To"
            className="h-8 w-36 text-[13px]"
          />
        </>
      )}
    </>
  );

  return (
    <>
      <DataTable<TxnRow>
        data={shown}
        toolbarFilters={filters}
        columns={columns}
        getRowId={(r) => r.key}
        statusTabs={statusTabs}
        facets={[
          {
            columnId: 'state',
            label: 'Status',
            valueOptions: STATE_ORDER.filter((s) =>
              rows.some((r) => STATE_LABEL[r.statusKey] === s)
            ),
          },
        ]}
        selectionResetSignal={reset}
        selection={
          canRecord
            ? {
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
                        picked.map((r) => ({ id: r.id, docNumber: r.no }))
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
                  {
                    key: 'receive',
                    label: 'Receive payment',
                    icon: HandCoins,
                    onTrigger: (picked) =>
                      setPaying((p) => ({
                        key: (p?.key ?? 0) + 1,
                        invoices: picked
                          .map((r) => openById.get(r.id))
                          .filter((o): o is PayableInvoice => !!o),
                      })),
                  },
                ],
              }
            : undefined
        }
        searchKeys={[
          (r) => r.no ?? '',
          (r) => r.memo ?? '',
          (r) => r.invoice?.items ?? '',
        ]}
        searchPlaceholder="Find by number or memo"
        initialColumnVisibility={{
          // Every row is this customer; the page's title already names them.
          customer: false,
          state: false,
          dueDate: false,
          balance: false,
          depositTo: false,
          items: false,
          tile: false,
          createdBy: false,
        }}
        initialSort={[{ id: 'date', desc: true }]}
        url={{ enabled: true, namespace: 'billing-txns' }}
        pageSize={25}
        csv={{ filename: `billing-${studentNumber}-transactions.csv` }}
        emptyFilteredState={{
          title: 'No transactions match.',
          body: 'Pick the All tab, clear Status or Date, or clear the search.',
        }}
      />
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
              QuickBooks emails each invoice to the customer&rsquo;s billing
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
      {paying && (
        <RecordPaymentSheet
          key={paying.key}
          open
          onOpenChange={(o) => {
            if (o) return;
            setPaying(null);
            setReset((n) => n + 1);
          }}
          studentNumber={studentNumber}
          studentName={studentName}
          openInvoices={paying.invoices}
          credits={credits}
          depositAccounts={depositAccounts}
          paymentMethods={paymentMethods}
          mode="pay"
          customerBalance={customerBalance}
        />
      )}
    </>
  );
}
