'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, ExternalLink, Mail, Printer, Wallet } from 'lucide-react';
import Link from 'next/link';

import { useSendInvoices } from '@/components/billing/use-send-invoices';
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
import { ButtonGroup } from '@/components/ui/button-group';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { CustomerListRow } from '@/lib/billing/customers.server';
import { formatDay, todaySg } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// Billing → Customers. What it holds is QuickBooks' Customers list — Name ·
// Company name · Phone · Open balance · Action. Action is QuickBooks' split
// link (Receive payment when they owe, Create invoice when they don't) and
// its ▾ carries QuickBooks' menu in QuickBooks' order; Send reminder and
// Create invoice happen here, the rest open that action in QuickBooks. How
// it looks is the SIS's: status tabs (the page's stat tiles deep-link to
// them), a Level facet, and Email reminders in the selection footer.

const customerHref = (r: CustomerListRow, next?: 'payment' | 'invoice') =>
  `/billing/${encodeURIComponent(r.studentNumber)}${next ? `?new=${next}` : ''}`;

/** A menu item that opens the action in QuickBooks. */
function QbItem({ href, label }: { href: string; label: string }) {
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noreferrer">
        <span className="flex-1">{label}</span>
        <ExternalLink className="size-3.5 text-muted-foreground" />
      </a>
    </DropdownMenuItem>
  );
}

/** The ▾ beside a customer's action — QuickBooks' customer row menu. */
function CustomerRowMenu({
  row,
  qbBase,
  onRemind,
}: {
  row: CustomerListRow;
  qbBase: string;
  onRemind: () => void;
}) {
  const id = encodeURIComponent(row.customerId);
  const qb = (path: string) => `${qbBase}${path}`;
  const detail = qb(`/app/customerdetail?nameId=${id}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={`More for ${row.customerName}`}
        >
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={row.openInvoiceList.length === 0}
          onSelect={onRemind}
        >
          Send reminder
        </DropdownMenuItem>
        <QbItem href={detail} label="Create statement" />
        <DropdownMenuItem asChild>
          <Link href={customerHref(row, 'invoice')}>Create invoice</Link>
        </DropdownMenuItem>
        <QbItem
          href={qb(`/app/salesreceipt?nameId=${id}`)}
          label="Create sales receipt"
        />
        <QbItem
          href={qb(`/app/estimate?nameId=${id}`)}
          label="Create estimate"
        />
        <QbItem
          href={qb(`/app/salesorder?nameId=${id}`)}
          label="Create sales order"
        />
        <QbItem href={detail} label="Send payment link" />
        <QbItem href={detail} label="Create task" />
        <QbItem href={detail} label="Make inactive" />
        <QbItem href={detail} label="Request feedback" />
        <QbItem href={detail} label="Schedule appointment" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildColumns(
  qbBase: string,
  onRemind: (r: CustomerListRow) => void
): ColumnDef<CustomerListRow, unknown>[] {
  return [
    {
      id: 'name',
      accessorFn: (r) => r.customerName,
      header: ({ column }) => (
        <SortableHeader column={column}>Name</SortableHeader>
      ),
      meta: { label: 'Name' },
      cell: ({ row }) => (
        <IdentifierLink
          href={customerHref(row.original)}
          className="font-medium"
        >
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
        <ButtonGroup className="ml-auto" aria-label="Customer actions">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
          >
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
          <CustomerRowMenu
            row={row.original}
            qbBase={qbBase}
            onRemind={() => onRemind(row.original)}
          />
        </ButtonGroup>
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
}

export function CustomersTable({
  rows,
  qbBase,
  withEstimates = false,
}: {
  rows: CustomerListRow[];
  qbBase: string;
  /** QuickBooks' estimates could be read — offer the Estimates tab. */
  withEstimates?: boolean;
}) {
  // Customers whose open invoices Send reminder is about to email.
  const [remind, setRemind] = React.useState<CustomerListRow[] | null>(null);
  const [reset, setReset] = React.useState(0);
  const sendInvoices = useSendInvoices();
  const columns = React.useMemo(
    () => buildColumns(qbBase, (r) => setRemind([r])),
    [qbBase]
  );
  const since30 = React.useMemo(() => {
    const t = Date.parse(`${todaySg()}T00:00:00Z`) - 30 * 86_400_000;
    return new Date(t).toISOString().slice(0, 10);
  }, []);
  // QuickBooks' money figures as the SIS's status tabs; the stat tiles above
  // deep-link to them.
  const statusTabs = React.useMemo(
    () => [
      {
        value: 'all',
        label: 'All',
        predicate: () => true,
        isDefault: true,
      },
      {
        value: 'owing',
        label: 'Owing',
        predicate: (r: CustomerListRow) => r.openBalance > 0,
      },
      {
        value: 'overdue',
        label: 'Overdue',
        predicate: (r: CustomerListRow) => r.overdue > 0,
      },
      {
        value: 'paid',
        label: 'Paid recently',
        predicate: (r: CustomerListRow) =>
          !!r.lastPayment && r.lastPayment >= since30,
      },
      ...(withEstimates
        ? [
            {
              value: 'estimates',
              label: 'Estimates',
              predicate: (r: CustomerListRow) => r.estimates > 0,
            },
          ]
        : []),
    ],
    [since30, withEstimates]
  );
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
  // One customer can be linked to more than one student; each invoice once.
  const remindInvoices = React.useMemo(() => {
    const byId = new Map<string, { id: string; docNumber: string | null }>();
    for (const r of remind ?? [])
      for (const i of r.openInvoiceList) byId.set(i.id, i);
    return [...byId.values()];
  }, [remind]);

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
  const remindCustomers = new Set((remind ?? []).map((r) => r.customerId)).size;
  return (
    <>
      <DataTable<CustomerListRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r.studentNumber}
        searchKeys={[
          (r) => r.customerName,
          (r) => r.name,
          (r) => r.studentNumber,
          (r) => r.companyName ?? '',
          (r) => r.phone ?? '',
        ]}
        searchPlaceholder="Search name, parents, phone or student no.…"
        statusTabs={statusTabs}
        facets={facets}
        toolbarTrailing={
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => window.print()}
          >
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>
        }
        selection={{
          enabled: true,
          bulkActions: [
            {
              key: 'email',
              label: 'Email reminders',
              icon: Mail,
              onTrigger: (picked) => setRemind(picked),
            },
          ],
        }}
        selectionResetSignal={reset}
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
          body: 'Clear the search or a filter, or pick another tab.',
        }}
      />
      <AlertDialog open={!!remind} onOpenChange={(o) => !o && setRemind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {remindInvoices.length === 0
                ? 'Nothing to remind'
                : remindInvoices.length === 1
                  ? `Email ${remindInvoices[0].docNumber ?? 'the open invoice'} again?`
                  : `Email ${remindInvoices.length} open invoices again?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {remindInvoices.length === 0
                ? remindCustomers === 1
                  ? 'This customer has no open invoices.'
                  : 'None of these customers has an open invoice.'
                : `QuickBooks emails each open invoice of ${
                    remindCustomers === 1
                      ? (remind?.[0]?.customerName ?? 'this customer')
                      : `these ${remindCustomers} customers`
                  } to its billing address, as a reminder.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {remindInvoices.length === 0 ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            {remindInvoices.length > 0 && (
              <AlertDialogAction
                onClick={async () => {
                  const picked = remindInvoices;
                  setRemind(null);
                  await sendInvoices(picked);
                  setReset((n) => n + 1);
                }}
              >
                Send reminder
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
