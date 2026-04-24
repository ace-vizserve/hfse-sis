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
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * DrillDownSheet — generic Sheet body rendered inside the `drillSheet` slot of
 * `MetricCard`. The parent provides the `<Sheet>` + `<SheetTrigger>`; this
 * component renders the `<SheetContent>` with a header / filters / table
 * layout. Columns + rows are supplied per drill-down target.
 */
export type DrillDownSheetProps<T> = {
  title: string;
  eyebrow: string;
  count: number;
  csvHref: string;
  csvFilename?: string;
  columns: ColumnDef<T, unknown>[];
  rows: T[];
  filters?: React.ReactNode;
  searchable?: boolean;
  emptyMessage?: string;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultCsvFilename(title: string): string {
  const slug = slugify(title) || 'drill';
  const yyyyMmDd = new Date().toISOString().slice(0, 10);
  return `drill-${slug}-${yyyyMmDd}.csv`;
}

export function DrillDownSheet<T>({
  title,
  eyebrow,
  count,
  csvHref,
  csvFilename,
  columns,
  rows,
  filters,
  searchable = true,
  emptyMessage = 'No rows to show for this filter.',
}: DrillDownSheetProps<T>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');

  const table = useReactTable<T>({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filename = csvFilename ?? defaultCsvFilename(title);
  const showFilters = searchable || Boolean(filters);
  const visibleRows = table.getRowModel().rows;

  return (
    <SheetContent
      side="right"
      className="sm:max-w-3xl w-full flex flex-col gap-0 p-0"
    >
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <Badge variant="outline">
            {count.toLocaleString('en-SG')} rows
          </Badge>
        </div>
        <div className="mt-3 flex justify-end">
          <Button asChild size="sm" variant="outline">
            <a href={csvHref} download={filename}>
              <Download className="size-3.5" />
              Download CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          {searchable && (
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search rows"
              className="h-9 max-w-xs"
            />
          )}
          {filters && (
            <div className="ml-auto flex items-center gap-2">{filters}</div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {visibleRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <Table noWrapper>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    const sorted = h.column.getIsSorted();
                    const label = h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext());
                    if (!canSort || h.isPlaceholder) {
                      return <TableHead key={h.id}>{label}</TableHead>;
                    }
                    const SortIcon =
                      sorted === 'asc'
                        ? ArrowUp
                        : sorted === 'desc'
                          ? ArrowDown
                          : ArrowUpDown;
                    return (
                      <TableHead
                        key={h.id}
                        aria-sort={
                          sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                        }
                      >
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4 transition-colors hover:bg-muted"
                        >
                          {label}
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
              {visibleRows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SheetContent>
  );
}
