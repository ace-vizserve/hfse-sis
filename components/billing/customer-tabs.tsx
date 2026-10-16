'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CalendarRange,
  FileText,
  HandCoins,
  SlidersHorizontal,
} from 'lucide-react';

import { InvoiceStatusBadge } from '@/components/billing/invoice-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { DatePicker } from '@/components/ui/date-picker';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  InvoiceRowView,
  PaymentRowView,
} from '@/lib/billing/customer-page.server';
import type { CustomerProfile } from '@/lib/billing/live.server';
import { INVOICE_STATUS_LABEL, formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';

const NO_TILE = 'No tile';

function invoiceColumns(
  studentNumber: string
): ColumnDef<InvoiceRowView, unknown>[] {
  return [
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
      id: 'number',
      accessorFn: (r) => r.docNumber ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Number</SortableHeader>
      ),
      meta: { label: 'Number' },
      cell: ({ row }) => (
        <IdentifierLink
          href={`/billing/${encodeURIComponent(studentNumber)}/invoices/${encodeURIComponent(row.original.id)}`}
          className="font-mono text-[13px] tabular-nums"
        >
          {row.original.docNumber ?? 'No number'}
        </IdentifierLink>
      ),
      enableHiding: false,
    },
    {
      id: 'for',
      accessorFn: (r) => r.items,
      header: "What it's for",
      meta: { label: "What it's for" },
      cell: ({ row }) => (
        <div className="min-w-60 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-foreground">{row.original.items}</span>
            {row.original.tile && (
              <Badge
                variant="secondary"
                className="h-5 font-mono text-[10px] uppercase tracking-wider"
              >
                {row.original.tile}
              </Badge>
            )}
          </div>
          {row.original.memo && (
            <div className="text-[12px] text-muted-foreground">
              {row.original.memo}
            </div>
          )}
        </div>
      ),
      enableSorting: false,
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
        <div className="text-right tabular-nums">
          {formatSgd(row.original.total)}
        </div>
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
        <div className="text-right tabular-nums">
          {formatSgd(row.original.balance)}
        </div>
      ),
    },
    {
      id: 'due',
      accessorFn: (r) => r.dueDate ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Due</SortableHeader>
      ),
      meta: { label: 'Due' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDay(row.original.dueDate)}
        </span>
      ),
    },
    {
      id: 'status',
      accessorFn: (r) => INVOICE_STATUS_LABEL[r.status],
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      meta: { label: 'Status' },
      cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />,
    },
    // Filter-only helpers, hidden until switched on from Columns.
    {
      id: 'item',
      accessorFn: (r) => r.itemNames.join(', '),
      header: 'Items',
      meta: { label: 'Items' },
      enableSorting: false,
      filterFn: (row, _id, value) =>
        !Array.isArray(value) ||
        value.length === 0 ||
        row.original.itemNames.some((n) => value.includes(n)),
    },
    {
      id: 'tile',
      accessorFn: (r) => r.tile ?? NO_TILE,
      header: 'Tile',
      meta: { label: 'Tile' },
      enableSorting: false,
    },
    {
      id: 'createdBy',
      accessorFn: (r) => r.createdBy,
      header: 'Created by',
      meta: { label: 'Created by' },
      enableSorting: false,
    },
  ];
}

const paymentColumns: ColumnDef<PaymentRowView, unknown>[] = [
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
    id: 'account',
    accessorFn: (r) => r.account,
    header: ({ column }) => (
      <SortableHeader column={column}>Account</SortableHeader>
    ),
    meta: { label: 'Account' },
  },
  {
    id: 'reference',
    accessorFn: (r) => r.reference ?? '',
    header: 'Reference',
    meta: { label: 'Reference' },
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">
        {row.original.reference ?? '—'}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'paidTowards',
    accessorFn: (r) =>
      r.appliedTo.map((a) => a.docNumber ?? a.invoiceId).join(', '),
    header: 'Paid towards',
    meta: { label: 'Paid towards' },
    cell: ({ row }) =>
      row.original.appliedTo.length === 0 ? (
        <Badge
          variant="outline"
          className="h-6 border-brand-amber/40 bg-brand-amber/10 text-ink"
        >
          Credit, no invoice
        </Badge>
      ) : (
        <span className="font-mono text-[13px] tabular-nums">
          {row.original.appliedTo
            .map((a) => a.docNumber ?? a.invoiceId)
            .join(', ')}
        </span>
      ),
    enableSorting: false,
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
      <div className="text-right tabular-nums">
        {formatSgd(row.original.total)}
      </div>
    ),
  },
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
        {row.original.unapplied > 0 ? formatSgd(row.original.unapplied) : '—'}
      </div>
    ),
  },
  {
    id: 'recordedBy',
    accessorFn: (r) => r.recordedBy,
    header: 'Recorded by',
    meta: { label: 'Recorded by' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.recordedBy}
      </span>
    ),
    enableSorting: false,
  },
];

/** Date and amount ranges — the two filters a value list can't express. */
function RangeFilters({
  value,
  onChange,
}: {
  value: { from: string; to: string; min: string; max: string };
  onChange: (v: { from: string; to: string; min: string; max: string }) => void;
}) {
  const dateOn = !!(value.from || value.to);
  const amountOn = !!(value.min || value.max);
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <CalendarRange className="size-3.5" />
            Date
            {dateOn
              ? `: ${formatDay(value.from) === '—' ? '…' : formatDay(value.from)} – ${formatDay(value.to) === '—' ? '…' : formatDay(value.to)}`
              : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-from">From</Label>
            <DatePicker
              id="inv-from"
              value={value.from}
              onChange={(from) => onChange({ ...value, from })}
              placeholder="Any date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-to">To</Label>
            <DatePicker
              id="inv-to"
              value={value.to}
              onChange={(to) => onChange({ ...value, to })}
              placeholder="Any date"
            />
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 border-dashed">
            <SlidersHorizontal className="size-3.5" />
            Amount
            {amountOn ? `: ${value.min || '0'} – ${value.max || 'any'}` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-min">At least</Label>
              <Input
                id="inv-min"
                inputMode="decimal"
                value={value.min}
                onChange={(e) => onChange({ ...value, min: e.target.value })}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-max">At most</Label>
              <Input
                id="inv-max"
                inputMode="decimal"
                value={value.max}
                onChange={(e) => onChange({ ...value, max: e.target.value })}
                className="tabular-nums"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {(dateOn || amountOn) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => onChange({ from: '', to: '', min: '', max: '' })}
        >
          Clear dates and amounts
        </Button>
      )}
    </>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children ?? '—'}</dd>
    </>
  );
}

function CustomerDetails({
  profile,
  studentNumber,
  studentName,
  level,
  linkedName,
}: {
  profile: CustomerProfile | null;
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            From QuickBooks
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Customer details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!profile ? (
            <p className="text-sm text-muted-foreground">
              QuickBooks couldn&rsquo;t be reached, so the customer&rsquo;s
              details can&rsquo;t be shown. Refresh to try again.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm md:grid-cols-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Customer">
                  <span className="font-mono text-[13px]">
                    {profile.displayName}
                  </span>
                </Detail>
                <Detail label="First name">{profile.givenName}</Detail>
                <Detail label="Middle name">{profile.middleName}</Detail>
                <Detail label="Last name">{profile.familyName}</Detail>
                <Detail label="Company">{profile.companyName}</Detail>
                <Detail label="Status">
                  {profile.active ? (
                    <Badge
                      variant="outline"
                      className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
                    >
                      Active
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
                    >
                      Inactive
                    </Badge>
                  )}
                </Detail>
                <Detail label="Customer since">
                  {profile.createdAt ? formatDay(profile.createdAt) : null}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Email">{profile.email}</Detail>
                <Detail label="Phone">
                  {profile.phone && (
                    <span className="font-mono text-[13px]">
                      {profile.phone}
                    </span>
                  )}
                </Detail>
                <Detail label="Mobile">
                  {profile.mobile && (
                    <span className="font-mono text-[13px]">
                      {profile.mobile}
                    </span>
                  )}
                </Detail>
                <Detail label="Other">
                  {profile.otherPhone && (
                    <span className="font-mono text-[13px]">
                      {profile.otherPhone}
                    </span>
                  )}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Billing address">
                  {profile.billAddress.length
                    ? profile.billAddress.map((l) => <div key={l}>{l}</div>)
                    : null}
                </Detail>
                <Detail label="Shipping address">
                  {profile.shipAddress
                    ? profile.shipAddress.map((l) => <div key={l}>{l}</div>)
                    : 'Same as billing'}
                </Detail>
              </dl>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <Detail label="Terms">{profile.terms}</Detail>
                <Detail label="Payment method">{profile.paymentMethod}</Detail>
                <Detail label="Send invoices by">
                  {profile.deliveryMethod}
                </Detail>
                <Detail label="Currency">{profile.currency}</Detail>
                <Detail label="Notes">{profile.notes}</Detail>
              </dl>
            </div>
          )}
          <p className="mt-6 text-[12px] text-muted-foreground">
            Change these in QuickBooks; they show here the next time the page
            opens.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight">
            Linked student
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <Detail label="Student">{studentName}</Detail>
            <Detail label="Student no.">
              <span className="font-mono text-[13px]">{studentNumber}</span>
            </Detail>
            <Detail label="Level">{level}</Detail>
            <Detail label="QuickBooks customer">{linkedName}</Detail>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export function CustomerTabs({
  studentNumber,
  studentName,
  level,
  linkedName,
  invoices,
  payments,
  profile,
  initialTab,
}: {
  studentNumber: string;
  studentName: string;
  level: string | null;
  linkedName: string;
  invoices: InvoiceRowView[];
  payments: PaymentRowView[];
  profile: CustomerProfile | null;
  /** `?tab=payments` / `?tab=details` — the invoice page's "View payment" opens Payments. */
  initialTab: 'invoices' | 'payments' | 'details';
}) {
  const [range, setRange] = React.useState({
    from: '',
    to: '',
    min: '',
    max: '',
  });
  const columns = React.useMemo(
    () => invoiceColumns(studentNumber),
    [studentNumber]
  );
  const shown = React.useMemo(() => {
    const min = range.min.trim() === '' ? null : Number(range.min);
    const max = range.max.trim() === '' ? null : Number(range.max);
    return invoices.filter((i) => {
      const d = i.txnDate?.slice(0, 10) ?? '';
      if (range.from && d < range.from) return false;
      if (range.to && d > range.to) return false;
      if (min !== null && Number.isFinite(min) && i.total < min) return false;
      if (max !== null && Number.isFinite(max) && i.total > max) return false;
      return true;
    });
  }, [invoices, range]);
  const facets = React.useMemo(
    () => [
      {
        columnId: 'status',
        label: 'Status',
        valueOptions: [
          ...new Set(invoices.map((i) => INVOICE_STATUS_LABEL[i.status])),
        ],
      },
      {
        columnId: 'item',
        label: 'Item',
        valueOptions: [...new Set(invoices.flatMap((i) => i.itemNames))].sort(),
      },
      {
        columnId: 'tile',
        label: 'Tile',
        valueOptions: [
          ...new Set(invoices.map((i) => i.tile ?? NO_TILE)),
        ].sort(),
      },
      {
        columnId: 'createdBy',
        label: 'Created by',
        valueOptions: [...new Set(invoices.map((i) => i.createdBy))].sort(),
      },
    ],
    [invoices]
  );

  return (
    <Tabs defaultValue={initialTab} className="gap-4">
      <TabsList>
        <TabsTrigger value="invoices">
          Invoices{' '}
          <span className="ml-1.5 tabular-nums text-muted-foreground">
            {invoices.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="payments">
          Payments{' '}
          <span className="ml-1.5 tabular-nums text-muted-foreground">
            {payments.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="details">Customer details</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">
        {invoices.length === 0 ? (
          <Card className="py-0">
            <DataTableEmptyState
              icon={FileText}
              title="No invoices yet"
              body="Invoices made here or in QuickBooks for this customer appear here, newest first."
            />
          </Card>
        ) : (
          <DataTable<InvoiceRowView>
            data={shown}
            columns={columns}
            getRowId={(r) => r.id}
            searchKeys={[
              (r) => r.docNumber ?? '',
              (r) => r.items,
              (r) => r.memo ?? '',
            ]}
            searchPlaceholder="Search number, item or memo"
            facets={facets}
            toolbarFilters={<RangeFilters value={range} onChange={setRange} />}
            initialColumnVisibility={{
              item: false,
              tile: false,
              createdBy: false,
            }}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: 'billing-invoices' }}
            pageSize={25}
            csv={{ filename: `billing-${studentNumber}-invoices.csv` }}
            emptyFilteredState={{
              title: 'No invoices match.',
              body: 'Clear the search, a filter, or the date and amount ranges.',
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="payments">
        {payments.length === 0 ? (
          <Card className="py-0">
            <DataTableEmptyState
              icon={HandCoins}
              title="No payments yet"
              body="Payments recorded here or in QuickBooks for this customer appear here, newest first."
            />
          </Card>
        ) : (
          <DataTable<PaymentRowView>
            data={payments}
            columns={paymentColumns}
            getRowId={(r) => r.id}
            searchKeys={[(r) => r.reference ?? '', (r) => r.account]}
            searchPlaceholder="Search reference or account"
            facets={[
              {
                columnId: 'account',
                label: 'Account',
                valueOptions: [...new Set(payments.map((p) => p.account))],
              },
            ]}
            initialSort={[{ id: 'date', desc: true }]}
            url={{ enabled: true, namespace: 'billing-payments' }}
            pageSize={25}
            csv={{ filename: `billing-${studentNumber}-payments.csv` }}
            emptyFilteredState={{
              title: 'No payments match.',
              body: 'Clear the search or a filter.',
            }}
          />
        )}
      </TabsContent>
      <TabsContent value="details">
        <CustomerDetails
          profile={profile}
          studentNumber={studentNumber}
          studentName={studentName}
          level={level}
          linkedName={linkedName}
        />
      </TabsContent>
    </Tabs>
  );
}
