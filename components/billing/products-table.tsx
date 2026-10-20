'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  Ban,
  ChevronDown,
  CircleOff,
  ExternalLink,
  Package,
  PackageCheck,
  Wrench,
} from 'lucide-react';
import * as React from 'react';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { ProductSheet } from '@/components/billing/product-sheet';
import { RefreshButton } from '@/components/billing/refresh-button';
import { PrintIcon } from '@/components/billing/toolbar-icons';
import { MetricCard } from '@/components/dashboard/metric-card';
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
import { ButtonGroup } from '@/components/ui/button-group';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ProductRow } from '@/lib/billing/live.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { formatSgd } from '@/lib/qbo/format';

// Billing → Products & services. WHAT is here is QuickBooks' page: More ▾ and
// New product/service ▾; Active / Inactive / All, Type and Stock status;
// Name · Sales description · Qty on hand · Category · SKU · Type · Price ·
// Cost · Actions (Edit ▾: Run report, Duplicate, Make inactive); Make
// inactive on the ticked rows. HOW it looks is the SIS's: hero, stat tiles
// that open the matching tab, the shared DataTable with its footer bar.
// Billing builds what a school bills with — New service, Edit and Make
// inactive on a service; everything else opens the same place in QuickBooks.

const TYPE_OPTIONS = ['Bundle', 'Inventory', 'Non-inventory', 'Service'];
const STOCK_OPTIONS = ['Low stock', 'Out of stock'];

/** QuickBooks' stock status of an item ('' when it keeps no stock). */
function stockStatus(r: ProductRow): string {
  if (r.qtyOnHand === null) return '';
  if (r.qtyOnHand <= 0) return 'Out of stock';
  if (r.reorderPoint !== null && r.qtyOnHand <= r.reorderPoint)
    return 'Low stock';
  return 'In stock';
}

const NS = 'billing-products';

const money = (n: number | null) => (n ? formatSgd(n) : '');

/** QuickBooks' link for anything Billing leaves to QuickBooks. */
function QbItem({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
      </a>
    </DropdownMenuItem>
  );
}

export function ProductsView({
  rows,
  qbBase,
}: {
  rows: ProductRow[];
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
}) {
  const run = useWriteAction();
  const qbItems = `${qbBase}/app/items`;
  const [sheet, setSheet] = React.useState<{
    itemId: string | null;
    key: number;
  } | null>(null);
  const [confirm, setConfirm] = React.useState<ProductRow[] | null>(null);
  const [reset, setReset] = React.useState(0);

  const openSheet = (itemId: string | null) =>
    setSheet((s) => ({ itemId, key: (s?.key ?? 0) + 1 }));

  const counts = React.useMemo(
    () => ({
      active: rows.filter((r) => r.active).length,
      services: rows.filter((r) => r.active && r.type === 'Service').length,
      inactive: rows.filter((r) => !r.active).length,
    }),
    [rows]
  );

  async function makeInactive(list: ProductRow[]) {
    const targets = list.filter((r) => r.active);
    if (targets.length === 0) return;
    await run(
      async () => {
        const failed: string[] = [];
        for (const r of targets) {
          try {
            await apiFetch(
              `/api/billing/products/${encodeURIComponent(r.id)}/inactive`,
              jsonInit('POST', { requestId: crypto.randomUUID() })
            );
          } catch (e) {
            failed.push(
              `${r.name}: ${e instanceof Error ? e.message : 'not saved'}`
            );
          }
        }
        if (failed.length === targets.length)
          throw new Error(failed.join(' · '));
        return { done: targets.length - failed.length, failed };
      },
      {
        pending:
          targets.length === 1
            ? `Making ${targets[0].name} inactive…`
            : `Making ${targets.length} items inactive…`,
        success: (d) =>
          d.failed.length
            ? {
                title: `${d.done} made inactive, ${d.failed.length} not`,
                description: d.failed.join(' · '),
              }
            : d.done === 1
              ? `${targets[0].name} is inactive`
              : `${d.done} items are inactive`,
        onResolved: () => setReset((n) => n + 1),
      }
    );
  }

  const columns = React.useMemo<ColumnDef<ProductRow, unknown>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Name</SortableHeader>
        ),
        meta: { label: 'Name' },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="inline-flex min-w-48 flex-wrap items-center gap-2">
              {r.type === 'Service' ? (
                <button
                  type="button"
                  onClick={() => openSheet(r.id)}
                  className="text-left font-medium text-primary underline-offset-4 hover:underline"
                >
                  {r.name}
                </button>
              ) : (
                <span className="font-medium text-foreground">{r.name}</span>
              )}
              {!r.active && (
                <Badge variant="secondary" className="h-5">
                  Inactive
                </Badge>
              )}
            </span>
          );
        },
        enableHiding: false,
      },
      {
        id: 'description',
        accessorFn: (r) => r.description ?? '',
        header: 'Sales description',
        meta: { label: 'Sales description' },
        cell: ({ row }) => (
          <span className="line-clamp-2 max-w-64 text-sm text-muted-foreground">
            {row.original.description ?? ''}
          </span>
        ),
        enableSorting: false,
      },
      {
        id: 'qty',
        accessorFn: (r) => r.qtyOnHand ?? -Infinity,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Qty on hand
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Qty on hand' },
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            {row.original.qtyOnHand ?? ''}
          </div>
        ),
      },
      {
        id: 'category',
        accessorFn: (r) => r.category ?? 'Uncategorized',
        header: ({ column }) => (
          <SortableHeader column={column}>Category</SortableHeader>
        ),
        meta: { label: 'Category' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.category ?? 'Uncategorized'}
          </span>
        ),
      },
      {
        id: 'sku',
        accessorFn: (r) => r.sku ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>SKU</SortableHeader>
        ),
        meta: { label: 'SKU' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[13px]">
            {row.original.sku ?? ''}
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
        // QuickBooks' Stock status filter; hidden until shown from Columns.
        id: 'stock',
        accessorFn: (r) => stockStatus(r),
        header: 'Stock status',
        meta: { label: 'Stock status' },
        enableSorting: false,
      },
      {
        id: 'price',
        accessorFn: (r) => r.price ?? 0,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Price
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Price' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {money(row.original.price)}
          </div>
        ),
      },
      {
        id: 'cost',
        accessorFn: (r) => r.cost ?? 0,
        header: ({ column }) => (
          <div className="flex justify-end">
            <SortableHeader column={column} align="right">
              Cost
            </SortableHeader>
          </div>
        ),
        meta: { label: 'Cost' },
        cell: ({ row }) => (
          <div className="whitespace-nowrap text-right tabular-nums">
            {money(row.original.cost)}
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Actions</div>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const r = row.original;
          const service = r.type === 'Service';
          return (
            <ButtonGroup
              className="ml-auto"
              aria-label={`Actions for ${r.name}`}
            >
              {service ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => openSheet(r.id)}
                >
                  Edit
                </Button>
              ) : (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                >
                  <a href={qbItems} target="_blank" rel="noreferrer">
                    Edit
                  </a>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-label={`More for ${r.name}`}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <QbItem href={qbItems}>Run report</QbItem>
                  <QbItem href={qbItems}>Duplicate</QbItem>
                  {r.active ? (
                    <DropdownMenuItem onSelect={() => setConfirm([r])}>
                      Make inactive
                    </DropdownMenuItem>
                  ) : (
                    <QbItem href={qbItems}>Make active</QbItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          );
        },
      },
    ],
    [qbItems]
  );

  const header = (
    <BillingPageHeader
      crumbs={[{ label: 'Sales' }, { label: 'Products & services' }]}
      title="Products & services"
      description="Everything the school bills for, as QuickBooks keeps it. Add or edit a service here; other kinds of item open in QuickBooks."
      actions={
        <>
          <RefreshButton />
          <PrintIcon />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                More
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <QbItem href={qbItems}>Manage categories</QbItem>
              <QbItem href={qbItems}>Run report</QbItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                New product/service
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => openSheet(null)}>
                Service
              </DropdownMenuItem>
              <QbItem href={qbItems}>Inventory item</QbItem>
              <QbItem href={qbItems}>Non-inventory item</QbItem>
              <QbItem href={qbItems}>Bundle</QbItem>
              <DropdownMenuSeparator />
              <QbItem href={qbItems}>Batch import</QbItem>
              <QbItem href={qbItems}>Import from sales channel</QbItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );

  return (
    <>
      {header}
      {rows.length > 0 && (
        <div className="@container/main">
          <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-3">
            <MetricCard
              label="Active items"
              value={counts.active}
              icon={PackageCheck}
              subtext="Offered on new invoices"
              href={`?${NS}.status=active`}
            />
            <MetricCard
              label="Services"
              value={counts.services}
              icon={Wrench}
              subtext="Active services, the fees a school bills"
              href={`?${NS}.status=active&${NS}.type=Service`}
            />
            <MetricCard
              label="Inactive"
              value={counts.inactive}
              icon={CircleOff}
              subtext="Kept for history, not offered"
              href={`?${NS}.status=inactive`}
            />
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <Card className="py-0">
          <DataTableEmptyState
            icon={Package}
            title="No products or services"
            body="Add a service with New product/service. It shows here and in QuickBooks."
          />
        </Card>
      ) : (
        <DataTable<ProductRow>
          data={rows}
          columns={columns}
          // Columns no item uses start hidden, so the row fits (Columns brings
          // them back).
          initialColumnVisibility={{
            qty: rows.some((r) => r.qtyOnHand != null),
            cost: false,
            stock: false,
            sku: rows.some((r) => !!r.sku),
            description: rows.some((r) => !!r.description),
          }}
          getRowId={(r) => r.id}
          searchKeys={[
            (r) => r.name,
            (r) => r.sku ?? '',
            (r) => r.category ?? 'Uncategorized',
          ]}
          searchPlaceholder="Search by name, SKU or category"
          statusTabs={[
            {
              value: 'active',
              label: 'Active',
              predicate: (r) => r.active,
              isDefault: true,
            },
            {
              value: 'inactive',
              label: 'Inactive',
              predicate: (r) => !r.active,
            },
            { value: 'all', label: 'All', predicate: () => true },
          ]}
          facets={[
            { columnId: 'type', label: 'Type', valueOptions: TYPE_OPTIONS },
            {
              columnId: 'stock',
              label: 'Stock status',
              valueOptions: STOCK_OPTIONS,
            },
          ]}
          selection={{
            enabled: true,
            enableRowSelection: (r) => r.active,
            bulkActions: [
              {
                key: 'inactive',
                label: 'Make inactive',
                icon: Ban,
                onTrigger: (selected) => setConfirm(selected),
              },
            ],
          }}
          selectionResetSignal={reset}
          initialSort={[{ id: 'name', desc: false }]}
          url={{ enabled: true, namespace: NS }}
          pageSize={50}
          csv={{ filename: 'billing-products.csv' }}
          emptyFilteredState={{
            title: 'Nothing matches.',
            body: 'Clear Type or Stock status, pick another tab, or clear the search.',
          }}
        />
      )}
      {sheet && (
        <ProductSheet
          key={sheet.key}
          open
          onOpenChange={(o) => !o && setSheet(null)}
          itemId={sheet.itemId}
        />
      )}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.length === 1
                ? `Make ${confirm[0].name} inactive?`
                : `Make ${confirm?.length ?? 0} items inactive?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              QuickBooks keeps the history, but stops offering{' '}
              {confirm?.length === 1 ? 'it' : 'them'} on new invoices. It can be
              made active again in QuickBooks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const picked = confirm ?? [];
                setConfirm(null);
                void makeInactive(picked);
              }}
            >
              Make inactive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
