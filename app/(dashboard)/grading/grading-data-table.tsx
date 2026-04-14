'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Lock,
  Search,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type GradingSheetRow = {
  id: string;
  section: string;
  level: string;
  subject: string;
  term: string;
  teacher: string | null;
  is_locked: boolean;
};

export function GradingDataTable({ data }: { data: GradingSheetRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'level', desc: false },
    { id: 'section', desc: false },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [status, setStatus] = React.useState<'all' | 'open' | 'locked'>('all');

  const columns: ColumnDef<GradingSheetRow>[] = React.useMemo(
    () => [
      {
        accessorKey: 'level',
        header: ({ column }) => (
          <SortableHeader
            label="Level"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {row.original.level}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'section',
        header: ({ column }) => (
          <SortableHeader
            label="Section"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <Link
            href={`/grading/${row.original.id}`}
            className="font-medium text-foreground transition-colors hover:text-primary hover:underline"
          >
            {row.original.section}
          </Link>
        ),
      },
      {
        accessorKey: 'subject',
        header: ({ column }) => (
          <SortableHeader
            label="Subject"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => <span className="text-foreground">{row.original.subject}</span>,
      },
      {
        accessorKey: 'term',
        header: ({ column }) => (
          <SortableHeader
            label="Term"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.term}</span>,
      },
      {
        accessorKey: 'teacher',
        header: 'Teacher',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.teacher ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'is_locked',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_locked ? (
            <Badge
              variant="outline"
              className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
            >
              <Lock className="h-3 w-3" />
              Locked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
            >
              <CheckCircle2 className="h-3 w-3" />
              Open
            </Badge>
          ),
        filterFn: (row, id, value) => {
          if (value === 'all') return true;
          if (value === 'locked') return row.getValue(id) === true;
          if (value === 'open') return row.getValue(id) === false;
          return true;
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
    initialState: {
      pagination: { pageSize: 20 },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase().trim();
      if (!needle) return true;
      const haystack = [
        row.original.section,
        row.original.subject,
        row.original.term,
        row.original.teacher ?? '',
        row.original.level,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // Keep the is_locked column filter in sync with the status tab.
  React.useEffect(() => {
    const col = table.getColumn('is_locked');
    if (!col) return;
    if (status === 'all') col.setFilterValue(undefined);
    else col.setFilterValue(status);
  }, [status, table]);

  // Facets for the Level dropdown filter.
  const levelColumn = table.getColumn('level');
  const levelValues = React.useMemo(() => {
    if (!levelColumn) return [] as string[];
    return Array.from(levelColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === 'string')
      .sort();
  }, [levelColumn]);
  const selectedLevels = (levelColumn?.getFilterValue() as string[] | undefined) ?? [];

  const hasFilter =
    globalFilter.length > 0 || selectedLevels.length > 0 || status !== 'all';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative w-full sm:w-auto sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search section, subject, teacher…"
              className="pl-8"
            />
          </div>

          {/* Level filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Level
                {selectedLevels.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {selectedLevels.length}
                  </Badge>
                )}
                <ChevronsUpDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
                Filter by level
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {levelValues.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No levels</div>
              )}
              {levelValues.map((lvl) => {
                const checked = selectedLevels.includes(lvl);
                return (
                  <DropdownMenuCheckboxItem
                    key={lvl}
                    checked={checked}
                    onCheckedChange={(next) => {
                      const current = new Set(selectedLevels);
                      if (next) current.add(lvl);
                      else current.delete(lvl);
                      levelColumn?.setFilterValue(
                        current.size === 0 ? undefined : Array.from(current),
                      );
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {lvl}
                  </DropdownMenuCheckboxItem>
                );
              })}
              {selectedLevels.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center"
                      onClick={() => levelColumn?.setFilterValue(undefined)}
                    >
                      Clear
                    </Button>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Column visibility */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto lg:ml-0">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
                Toggle columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                    className="capitalize"
                  >
                    {col.id === 'is_locked' ? 'Status' : col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGlobalFilter('');
                setStatus('all');
                setColumnFilters([]);
              }}
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        {/* Status tabs */}
        <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <TabsList>
            <TabsTrigger value="all">
              All <span className="ml-1 font-mono text-[10px] text-muted-foreground">{data.length}</span>
            </TabsTrigger>
            <TabsTrigger value="open">
              Open{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {data.filter((r) => !r.is_locked).length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="locked">
              Locked{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {data.filter((r) => r.is_locked).length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  No sheets match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {data.length} sheets
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Rows per page
            </span>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(v) => table.setPageSize(Number(v))}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={`${n}`}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{' '}
            {Math.max(table.getPageCount(), 1)}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SortableHeader({
  label,
  sorted,
  onToggle,
}: {
  label: string;
  sorted: false | 'asc' | 'desc';
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group -ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left font-medium transition-colors hover:bg-muted"
    >
      {label}
      <ArrowUpDown
        className={
          'h-3 w-3 transition-opacity ' +
          (sorted ? 'opacity-100 text-foreground' : 'opacity-40 group-hover:opacity-70')
        }
      />
    </button>
  );
}
