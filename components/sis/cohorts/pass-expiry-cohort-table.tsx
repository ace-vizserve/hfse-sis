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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';
import type { CohortStudentRow, CohortScope, ParentPassExpiry } from '@/lib/sis/cohorts';

// ─── Filter ─────────────────────────────────────────────────────────────────

export type PassExpiryFilter = 'expired' | 'd30' | 'd60' | 'd90' | 'all';

const FILTER_TABS: Array<{ value: PassExpiryFilter; label: string }> = [
  { value: 'expired', label: 'Already expired' },
  { value: 'd30', label: 'Within 30 days' },
  { value: 'd60', label: 'Within 60 days' },
  { value: 'd90', label: 'Within 90 days' },
  { value: 'all', label: 'All future' },
];

function rowMatchesFilter(row: CohortStudentRow, filter: PassExpiryFilter): boolean {
  const days = row.daysUntilEarliestExpiry;
  if (days === null || days === undefined) return false;
  switch (filter) {
    case 'expired':
      return days < 0;
    case 'd30':
      return days <= 30;
    case 'd60':
      return days <= 60;
    case 'd90':
      return days <= 90;
    case 'all':
      return true;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function detailHref(row: CohortStudentRow, scope: CohortScope, ayCode: string): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  const params = new URLSearchParams({ ay: ayCode, tab: 'lifecycle' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
}

// Color-coded days-until pill: red ≤7, amber ≤30, mint ≤90, muted >90.
function DaysPill({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined) return <Badge variant="outline">—</Badge>;
  if (days < 0) return <Badge variant="blocked">{Math.abs(days)}d expired</Badge>;
  if (days <= 7) return <Badge variant="blocked">{days}d</Badge>;
  if (days <= 30) return <Badge variant="warning">{days}d</Badge>;
  if (days <= 90) return <Badge variant="success">{days}d</Badge>;
  return <Badge variant="muted">{days}d</Badge>;
}

// Chip strip of all parent expiries, sorted ascending.
function ParentExpiryChips({ list }: { list: ParentPassExpiry[] | undefined }) {
  if (!list || list.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((p) => (
        <ChartLegendChip
          key={`${p.kind}-${p.date}`}
          color="neutral"
          label={`${p.kind} · ${formatDate(p.date)}`}
        />
      ))}
    </div>
  );
}

function StudentKindChip({ kind }: { kind: 'passport' | 'pass' | null | undefined }) {
  if (!kind) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <ChartLegendChip
      color="primary"
      label={kind === 'passport' ? 'Student passport' : 'Student pass'}
    />
  );
}

// ─── Columns ────────────────────────────────────────────────────────────────

type PassColumnKey =
  | 'student'
  | 'levelApplied'
  | 'earliestKind'
  | 'earliestDate'
  | 'daysUntil'
  | 'parentExpiries'
  | 'applicationStatus';

const ALL_COLUMNS: PassColumnKey[] = [
  'student',
  'levelApplied',
  'earliestKind',
  'earliestDate',
  'daysUntil',
  'parentExpiries',
  'applicationStatus',
];

const COLUMN_LABELS: Record<PassColumnKey, string> = {
  student: 'Student',
  levelApplied: 'Level',
  earliestKind: 'Earliest kind',
  earliestDate: 'Earliest expiry',
  daysUntil: 'Days until',
  parentExpiries: 'Parent expiries',
  applicationStatus: 'App status',
};

function buildColumns(
  scope: CohortScope,
  ayCode: string,
): ColumnDef<CohortStudentRow, unknown>[] {
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
              href={detailHref(row.original, scope, ayCode)}
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
      case 'earliestKind':
        return {
          id: 'earliestKind',
          accessorFn: (r) => r.studentPassExpiryKind ?? '',
          header,
          cell: ({ row }) => <StudentKindChip kind={row.original.studentPassExpiryKind} />,
          enableSorting: true,
        };
      case 'earliestDate':
        return {
          id: 'earliestDate',
          accessorFn: (r) => r.earliestExpiry ?? '',
          header,
          cell: ({ row }) => (
            <span className="text-sm tabular-nums text-foreground">
              {formatDate(row.original.earliestExpiry)}
            </span>
          ),
          enableSorting: true,
        };
      case 'daysUntil':
        return {
          id: 'daysUntil',
          accessorFn: (r) => r.daysUntilEarliestExpiry ?? Number.POSITIVE_INFINITY,
          header,
          cell: ({ row }) => <DaysPill days={row.original.daysUntilEarliestExpiry} />,
          enableSorting: true,
        };
      case 'parentExpiries':
        return {
          id: 'parentExpiries',
          accessorFn: (r) => r.parentPassExpiries?.length ?? 0,
          header,
          cell: ({ row }) => <ParentExpiryChips list={row.original.parentPassExpiries} />,
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
    }
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export type PassExpiryCohortTableProps = {
  rows: CohortStudentRow[];
  scope: CohortScope;
  ayCode: string;
};

export function PassExpiryCohortTable({ rows, scope, ayCode }: PassExpiryCohortTableProps) {
  const [filter, setFilter] = React.useState<PassExpiryFilter>('d30');
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [visibility, setVisibility] = React.useState<VisibilityState>({});

  const filteredRows = React.useMemo(
    () => rows.filter((r) => rowMatchesFilter(r, filter)),
    [rows, filter],
  );

  const columns = React.useMemo(() => buildColumns(scope, ayCode), [scope, ayCode]);

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as PassExpiryFilter)}>
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
            {ALL_COLUMNS.map((k) => (
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
                  colSpan={table.getVisibleLeafColumns().length}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No students match this filter.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
