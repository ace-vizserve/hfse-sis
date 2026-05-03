'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronDown, Mail } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartLegendChip, type ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';
import { BulkNotifyDialog, type BulkNotifyItem } from '@/components/p-files/bulk-notify-dialog';
import type { CohortStudentRow, PromisedSlot } from '@/lib/sis/cohorts';

// ─── Filter ─────────────────────────────────────────────────────────────────

export type PromisedFilter = 'past-due' | 'today' | 'd7' | 'd14' | 'd30' | 'all';

const FILTER_TABS: Array<{ value: PromisedFilter; label: string }> = [
  { value: 'past-due', label: 'Past-due' },
  { value: 'today', label: 'Due today' },
  { value: 'd7', label: 'Within 7 days' },
  { value: 'd14', label: 'Within 14 days' },
  { value: 'd30', label: 'Within 30 days' },
  { value: 'all', label: 'All' },
];

function rowMatchesFilter(row: CohortStudentRow, filter: PromisedFilter): boolean {
  if (filter === 'all') return true;
  const days = row.daysUntilEarliestPromise;
  if (days === null || days === undefined) return false;
  switch (filter) {
    case 'past-due':
      return days < 0;
    case 'today':
      return days === 0;
    case 'd7':
      return days <= 7;
    case 'd14':
      return days <= 14;
    case 'd30':
      return days <= 30;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function detailHref(enroleeNumber: string, ayCode: string): string {
  const params = new URLSearchParams({ ay: ayCode, tab: 'documents' });
  return `/admissions/applications/${encodeURIComponent(enroleeNumber)}?${params.toString()}`;
}

// Color-coded days-until pill: red past-due, red ≤today, amber ≤7, primary
// ≤30, mint >30, muted when no date captured.
function DaysPill({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined) return <Badge variant="muted">—</Badge>;
  if (days < 0) return <Badge variant="blocked">{Math.abs(days)}d past-due</Badge>;
  if (days === 0) return <Badge variant="blocked">Due today</Badge>;
  if (days <= 7) return <Badge variant="warning">{days}d</Badge>;
  if (days <= 30) return <Badge variant="default">{days}d</Badge>;
  return <Badge variant="success">{days}d</Badge>;
}

function chipColorForSlot(slot: PromisedSlot): ChartLegendChipColor {
  if (slot.promisedUntil === null) return 'neutral';
  if (slot.pastDue) return 'very-stale';
  if (slot.daysUntil !== null && slot.daysUntil <= 7) return 'stale';
  if (slot.daysUntil !== null && slot.daysUntil <= 30) return 'primary';
  return 'fresh';
}

function PromisedSlotChips({ slots }: { slots: PromisedSlot[] | undefined }) {
  if (!slots || slots.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((s) => {
        const dateLabel =
          s.promisedUntil === null ? 'date not captured' : formatDate(s.promisedUntil);
        return (
          <ChartLegendChip
            key={s.key}
            color={chipColorForSlot(s)}
            label={`${s.label} · ${dateLabel}`}
          />
        );
      })}
    </div>
  );
}

// ─── Columns ────────────────────────────────────────────────────────────────

type PromisedColumnKey =
  | 'student'
  | 'levelApplied'
  | 'applicationStatus'
  | 'toFollowCount'
  | 'promisedSlots'
  | 'earliestDate'
  | 'daysUntil'
  | 'action';

const ALL_COLUMNS: PromisedColumnKey[] = [
  'student',
  'levelApplied',
  'applicationStatus',
  'toFollowCount',
  'promisedSlots',
  'earliestDate',
  'daysUntil',
  'action',
];

const COLUMN_LABELS: Record<PromisedColumnKey, string> = {
  student: 'Student',
  levelApplied: 'Level',
  applicationStatus: 'App status',
  toFollowCount: 'To follow',
  promisedSlots: 'Promised slots',
  earliestDate: 'Earliest promised',
  daysUntil: 'Days until',
  action: '',
};

function buildColumns(ayCode: string): ColumnDef<CohortStudentRow, unknown>[] {
  return ALL_COLUMNS.map((key): ColumnDef<CohortStudentRow, unknown> => {
    const header = COLUMN_LABELS[key];
    switch (key) {
      case 'student':
        return {
          id: 'student',
          accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
          header,
          cell: ({ row }) => (
            <Link
              href={detailHref(row.original.enroleeNumber, ayCode)}
              className="block space-y-0.5 hover:underline"
            >
              <div className="font-medium text-foreground">
                {row.original.enroleeFullName ?? '—'}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.enroleeNumber}
                {row.original.studentNumber ? ` · ${row.original.studentNumber}` : ''}
              </div>
            </Link>
          ),
          enableSorting: true,
        };
      case 'levelApplied':
        return {
          id: 'levelApplied',
          accessorKey: 'levelApplied',
          header,
          cell: ({ row }) => (
            <span className="text-sm text-muted-foreground">{row.original.levelApplied ?? '—'}</span>
          ),
          enableSorting: true,
        };
      case 'applicationStatus':
        return {
          id: 'applicationStatus',
          accessorKey: 'applicationStatus',
          header,
          cell: ({ row }) => (
            <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
          ),
          enableSorting: true,
        };
      case 'toFollowCount':
        return {
          id: 'toFollowCount',
          accessorFn: (r) => r.toFollowCount ?? 0,
          header,
          cell: ({ row }) => (
            <Badge variant="muted" className="font-mono tabular-nums">
              {row.original.toFollowCount ?? 0}
            </Badge>
          ),
          enableSorting: true,
        };
      case 'promisedSlots':
        return {
          id: 'promisedSlots',
          accessorFn: (r) => r.toFollowSlots?.length ?? 0,
          header,
          cell: ({ row }) => <PromisedSlotChips slots={row.original.toFollowSlots} />,
          enableSorting: false,
        };
      case 'earliestDate':
        return {
          id: 'earliestDate',
          accessorFn: (r) => r.earliestPromisedUntil ?? '',
          header,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-foreground">
              {formatDate(row.original.earliestPromisedUntil)}
            </span>
          ),
          enableSorting: true,
        };
      case 'daysUntil':
        return {
          id: 'daysUntil',
          accessorFn: (r) =>
            r.daysUntilEarliestPromise === null || r.daysUntilEarliestPromise === undefined
              ? Number.POSITIVE_INFINITY
              : r.daysUntilEarliestPromise,
          header,
          cell: ({ row }) => <DaysPill days={row.original.daysUntilEarliestPromise} />,
          enableSorting: true,
        };
      case 'action':
        return {
          id: 'action',
          header,
          cell: ({ row }) => (
            <Link
              href={detailHref(row.original.enroleeNumber, ayCode)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Open
              <ArrowUpRight className="size-3" />
            </Link>
          ),
          enableSorting: false,
        };
    }
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export type PromisedCohortTableProps = {
  rows: CohortStudentRow[];
  ayCode: string;
};

export function PromisedCohortTable({ rows, ayCode }: PromisedCohortTableProps) {
  const [filter, setFilter] = React.useState<PromisedFilter>('d7');
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [visibility, setVisibility] = React.useState<VisibilityState>({});
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const filteredRows = React.useMemo(
    () => rows.filter((r) => rowMatchesFilter(r, filter)),
    [rows, filter],
  );

  // Drop selections that fall outside the visible filtered set.
  React.useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(filteredRows.map((r) => r.enroleeNumber));
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next;
    });
  }, [filteredRows]);

  const columns = React.useMemo(() => buildColumns(ayCode), [ayCode]);

  const table = useReactTable<CohortStudentRow>({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleIds = React.useMemo(
    () => filteredRows.map((r) => r.enroleeNumber),
    [filteredRows],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected =
    !allVisibleSelected && visibleIds.some((id) => selected.has(id));

  function toggleAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Build BulkNotifyItem[] from selected rows × their `'to-follow'` slots.
  const bulkItems = React.useMemo<BulkNotifyItem[]>(() => {
    if (selected.size === 0) return [];
    const out: BulkNotifyItem[] = [];
    for (const r of filteredRows) {
      if (!selected.has(r.enroleeNumber)) continue;
      for (const slot of r.toFollowSlots ?? []) {
        out.push({
          enroleeNumber: r.enroleeNumber,
          studentName: r.enroleeFullName ?? r.enroleeNumber,
          slotKey: slot.key,
          slotLabel: slot.label,
        });
      }
    }
    return out;
  }, [filteredRows, selected]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as PromisedFilter)}>
          <TabsList variant="segmented">
            {FILTER_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search students"
          className="h-9 max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto">
              Columns
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_COLUMNS.filter((k) => k !== 'action').map((k) => (
              <DropdownMenuCheckboxItem
                key={k}
                checked={visibility[k] !== false}
                onCheckedChange={(v) =>
                  setVisibility((prev) => ({ ...prev, [k]: v === true }))
                }
                onSelect={(e) => e.preventDefault()}
              >
                {COLUMN_LABELS[k]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 px-2">
                  <Checkbox
                    aria-label="Select all visible rows"
                    checked={
                      allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false
                    }
                    onCheckedChange={(v) => toggleAllVisible(v === true)}
                  />
                </TableHead>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const SortIcon =
                    sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                  if (!canSort || h.isPlaceholder) {
                    return (
                      <TableHead key={h.id}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    );
                  }
                  return (
                    <TableHead key={h.id}>
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4 transition-colors hover:bg-muted"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <SortIcon
                          className={
                            'size-3 ml-1 ' +
                            (sorted ? 'opacity-100 text-foreground' : 'opacity-50')
                          }
                        />
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length + 1}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No applicants match this filter.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const id = row.original.enroleeNumber;
                const isSelected = selected.has(id);
                return (
                  <TableRow key={row.id} data-selected={isSelected || undefined}>
                    <TableCell className="px-2">
                      <Checkbox
                        aria-label={`Select ${row.original.enroleeFullName ?? id}`}
                        checked={isSelected}
                        onCheckedChange={(v) => toggleRow(id, v === true)}
                      />
                    </TableCell>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-4 py-3 shadow-[0_-4px_6px_-2px_oklch(0_0_0/0.04)]">
          <div className="flex items-center gap-3">
            <Mail className="size-4 text-brand-amber" />
            <span className="text-sm">
              {selected.size} applicant{selected.size === 1 ? '' : 's'} selected
              {' · '}
              <span className="font-mono text-[11px] text-muted-foreground">
                {bulkItems.length} reminder{bulkItems.length === 1 ? '' : 's'} queued
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setBulkOpen(true)}
              disabled={bulkItems.length === 0}
            >
              <Mail className="size-3.5" />
              Send reminders
            </Button>
          </div>
        </div>
      )}

      <BulkNotifyDialog
        items={bulkItems}
        module="admissions"
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSuccess={() => setSelected(new Set())}
      />
    </div>
  );
}
