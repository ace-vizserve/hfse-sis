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
import type { CohortStudentRow, CohortScope } from '@/lib/sis/cohorts';

// ─── Types ──────────────────────────────────────────────────────────────────

export type StpFilter = 'all' | 'incomplete' | 'complete';

const FILTER_TABS: Array<{ value: StpFilter; label: string }> = [
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'complete', label: 'Complete' },
  { value: 'all', label: 'All' },
];

// ─── Slot status pill ───────────────────────────────────────────────────────

function slotChipColor(status: string | null | undefined) {
  const s = (status ?? '').trim();
  if (s === 'Valid') return 'fresh' as const;
  if (s === 'Uploaded') return 'primary' as const;
  if (s === 'Rejected' || s === 'Expired') return 'very-stale' as const;
  if (s === 'Pending') return 'stale' as const;
  return 'neutral' as const;
}

function SlotPill({ status, label }: { status: string | null | undefined; label: string }) {
  const display = (status ?? '').trim() || '—';
  return <ChartLegendChip color={slotChipColor(status)} label={`${label} · ${display}`} />;
}

function YesNoBadge({ value, yesLabel = 'Yes', noLabel = 'No' }: { value: boolean | null | undefined; yesLabel?: string; noLabel?: string }) {
  if (value === true) return <Badge variant="success">{yesLabel}</Badge>;
  if (value === false) return <Badge variant="muted">{noLabel}</Badge>;
  return <Badge variant="outline">—</Badge>;
}

// ─── Detail link resolver ──────────────────────────────────────────────────
//
// Records scope routes to /records/students/{studentNumber}; Admissions scope
// routes to /admissions/applications/{enroleeNumber}?tab=lifecycle&ay=...
// Rows missing a studentNumber on the records side fall back to the enrolee
// link (rare edge case for unsynced enrolees).

function detailHref(row: CohortStudentRow, scope: CohortScope, ayCode: string): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  const params = new URLSearchParams({ ay: ayCode, tab: 'lifecycle' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

// ─── Columns ────────────────────────────────────────────────────────────────

type StpColumnKey =
  | 'student'
  | 'levelApplied'
  | 'stpType'
  | 'icaPhoto'
  | 'financialSupport'
  | 'vaccination'
  | 'residence'
  | 'stpComplete'
  | 'applicationStatus';

const ALL_COLUMNS: StpColumnKey[] = [
  'student',
  'levelApplied',
  'stpType',
  'icaPhoto',
  'financialSupport',
  'vaccination',
  'residence',
  'stpComplete',
  'applicationStatus',
];

const COLUMN_LABELS: Record<StpColumnKey, string> = {
  student: 'Student',
  levelApplied: 'Level',
  stpType: 'STP type',
  icaPhoto: 'ICA Photo',
  financialSupport: 'Financial support',
  vaccination: 'Vaccination',
  residence: 'Residence',
  stpComplete: 'STP complete',
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
      case 'stpType':
        return {
          id: 'stpType',
          accessorKey: 'stpApplicationType',
          header,
          cell: ({ row }) => (
            <span className="text-sm text-foreground">{row.original.stpApplicationType ?? '—'}</span>
          ),
          enableSorting: true,
        };
      case 'icaPhoto':
        return {
          id: 'icaPhoto',
          accessorKey: 'icaPhotoStatus',
          header,
          cell: ({ row }) => <SlotPill status={row.original.icaPhotoStatus} label="ICA" />,
          enableSorting: true,
        };
      case 'financialSupport':
        return {
          id: 'financialSupport',
          accessorKey: 'financialSupportDocsStatus',
          header,
          cell: ({ row }) => (
            <SlotPill status={row.original.financialSupportDocsStatus} label="Fin." />
          ),
          enableSorting: true,
        };
      case 'vaccination':
        return {
          id: 'vaccination',
          accessorKey: 'vaccinationInformationStatus',
          header,
          cell: ({ row }) => (
            <SlotPill status={row.original.vaccinationInformationStatus} label="Vac." />
          ),
          enableSorting: true,
        };
      case 'residence':
        return {
          id: 'residence',
          accessorFn: (r) => (r.residenceHistoryFilled ? 1 : 0),
          header,
          cell: ({ row }) =>
            row.original.residenceHistoryFilled ? (
              <Badge variant="success">Filled</Badge>
            ) : (
              <Badge variant="warning">Missing</Badge>
            ),
          enableSorting: true,
        };
      case 'stpComplete':
        return {
          id: 'stpComplete',
          accessorFn: (r) => (r.stpComplete ? 1 : 0),
          header,
          cell: ({ row }) =>
            row.original.stpComplete ? (
              <Badge variant="success">Yes</Badge>
            ) : (
              <Badge variant="blocked">No</Badge>
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
    }
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export type StpCohortTableProps = {
  rows: CohortStudentRow[];
  scope: CohortScope;
  ayCode: string;
};

export function StpCohortTable({ rows, scope, ayCode }: StpCohortTableProps) {
  const [filter, setFilter] = React.useState<StpFilter>('incomplete');
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [visibility, setVisibility] = React.useState<VisibilityState>({});

  const filteredRows = React.useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'complete') return rows.filter((r) => r.stpComplete === true);
    return rows.filter((r) => r.stpComplete !== true);
  }, [rows, filter]);

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
      {/* Toolkit */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StpFilter)}>
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

      {/* Table */}
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
