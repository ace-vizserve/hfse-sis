'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import {
  ChangePreviewDialog,
  type PreviewResult,
} from '@/components/billing/settings/change-preview-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { StageChoice } from '@/lib/billing/classify';
import type { BillingSettings } from '@/lib/billing/settings.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

const FOLLOW = 'follow';

type ItemRow = BillingSettings['items'][number];

function StageSelect({
  value,
  onChange,
  allowFollow,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  allowFollow?: boolean;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-52" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowFollow && (
          <SelectItem value={FOLLOW}>Follow its account</SelectItem>
        )}
        <SelectItem value="registration">Registration</SelectItem>
        <SelectItem value="fees">Fees</SelectItem>
        <SelectItem value="none">Nothing</SelectItem>
      </SelectContent>
    </Select>
  );
}

// Which QuickBooks income accounts (and, for shared accounts, which items)
// fill the Registration and Fees tiles. Saving shows what would move first.
export function MappingCard({ settings }: { settings: BillingSettings }) {
  const run = useWriteAction();
  const [accounts, setAccounts] = React.useState<Record<string, StageChoice>>(
    () =>
      Object.fromEntries(
        settings.accounts.map((a) => [a.id, a.stage ?? 'none'])
      )
  );
  const [items, setItems] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(settings.items.map((i) => [i.id, i.stage ?? FOLLOW]))
  );
  const [preview, setPreview] = React.useState<PreviewResult | null>(null);

  const body = () => ({
    accounts: settings.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      stage: accounts[a.id] ?? 'none',
    })),
    items: settings.items
      .filter((i) => (items[i.id] ?? FOLLOW) !== FOLLOW)
      .map((i) => ({
        id: i.id,
        name: i.name,
        stage: items[i.id] as StageChoice,
      })),
  });
  const ask = useMutation({
    mutationFn: () =>
      apiFetch<PreviewResult>(
        '/api/billing/settings/preview',
        jsonInit('POST', body())
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ studentsAffected: number; tilesSkipped?: string }>(
        '/api/billing/settings/mapping',
        jsonInit('PUT', body())
      ),
  });
  const refresh = useMutation({
    mutationFn: () =>
      apiFetch<{ items: number }>(
        '/api/billing/settings/items/refresh',
        jsonInit('POST')
      ),
  });

  const itemColumns = React.useMemo<ColumnDef<ItemRow, unknown>[]>(
    () => [
      {
        id: 'item',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Item</SortableHeader>
        ),
        meta: { label: 'Item' },
      },
      {
        id: 'account',
        accessorFn: (r) => r.accountName ?? '—',
        header: ({ column }) => (
          <SortableHeader column={column}>Account</SortableHeader>
        ),
        meta: { label: 'Account' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.accountName ?? '—'}
          </span>
        ),
      },
      {
        id: 'fills',
        accessorFn: (r) => items[r.id] ?? FOLLOW,
        header: 'Fills',
        meta: { label: 'Fills' },
        cell: ({ row }) => (
          <StageSelect
            label={`Tile for ${row.original.name}`}
            allowFollow
            value={items[row.original.id] ?? FOLLOW}
            onChange={(v) => setItems((s) => ({ ...s, [row.original.id]: v }))}
          />
        ),
        enableSorting: false,
      },
    ],
    [items]
  );

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Tiles
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight">
          Income accounts
        </CardTitle>
        <CardAction className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            loading={refresh.isPending}
            loadingText="Reading items…"
            onClick={() =>
              run(() => refresh.mutateAsync(), {
                pending: 'Reading the items in QuickBooks…',
                success: (d) => `${d.items} items read from QuickBooks`,
              })
            }
          >
            <RefreshCw className="size-4" />
            Refresh items
          </Button>
          <Button
            variant="default"
            loading={ask.isPending || save.isPending}
            loadingText={save.isPending ? 'Saving…' : 'Checking…'}
            onClick={() =>
              run(() => ask.mutateAsync(), {
                pending: 'Checking what would change…',
                refresh: false,
                success: (p) => (setPreview(p), null),
              })
            }
          >
            Save mapping
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          An invoice fills a tile when one of its items is on an account mapped
          here. HFSE renames its items every year; the accounts stay, so map
          accounts and override an item only on a shared account.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead>Fills</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {settings.accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-foreground">{a.name}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {a.itemCount}
                </TableCell>
                <TableCell>
                  <StageSelect
                    label={`Tile for ${a.name}`}
                    value={accounts[a.id] ?? 'none'}
                    onChange={(v) =>
                      setAccounts((s) => ({ ...s, [a.id]: v as StageChoice }))
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
            {settings.accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No items read from QuickBooks yet. Press Refresh items.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="space-y-2">
          <p className="font-serif text-base font-semibold text-foreground">
            Item overrides
          </p>
          <p className="text-sm text-muted-foreground">
            Only for an item that should fill a different tile than its account
            — keep Student Devt Fees on Nothing: it is billed in separate
            instalments.
          </p>
          <DataTable<ItemRow>
            data={settings.items}
            columns={itemColumns}
            getRowId={(r) => r.id}
            searchKeys={[(r) => r.name, (r) => r.accountName ?? '']}
            searchPlaceholder="Search items"
            initialSort={[{ id: 'item', desc: false }]}
            pageSize={10}
          />
        </div>
      </CardContent>
      <ChangePreviewDialog
        preview={preview}
        onCancel={() => setPreview(null)}
        onConfirm={() => {
          setPreview(null);
          void run(() => save.mutateAsync(), {
            pending: 'Saving and re-checking every invoice…',
            success: (d) =>
              d.tilesSkipped
                ? `Saved. ${d.tilesSkipped}`
                : `Saved · ${d.studentsAffected} students re-checked`,
          });
        }}
      />
    </Card>
  );
}
