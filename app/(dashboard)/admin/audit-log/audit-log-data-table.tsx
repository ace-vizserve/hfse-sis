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
} from '@tanstack/react-table';
import {
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  History,
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

export type MergedRow = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  context: Record<string, unknown>;
  sheet_id: string | null;
  source: 'audit_log' | 'grade_audit_log';
};

type Props = {
  rows: MergedRow[];
  initialSheetIdFilter?: string | null;
  initialActionFilter?: string | null;
};

export function AuditLogDataTable({
  rows,
  initialSheetIdFilter,
  initialActionFilter,
}: Props) {
  const [sheetIdFilter, setSheetIdFilter] = React.useState<string | null>(
    initialSheetIdFilter ?? null,
  );
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'at', desc: true }]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    initialActionFilter ? [{ id: 'action', value: [initialActionFilter] }] : [],
  );
  const [globalFilter, setGlobalFilter] = React.useState('');

  // Apply the URL-derived sheet_id filter as a pre-filter step. Once cleared
  // it stays cleared — the user can drive the rest of the table from the
  // toolbar without touching the URL.
  const filteredData = React.useMemo(
    () => (sheetIdFilter ? rows.filter((r) => r.sheet_id === sheetIdFilter) : rows),
    [rows, sheetIdFilter],
  );

  const columns: ColumnDef<MergedRow>[] = React.useMemo(
    () => [
      {
        accessorKey: 'at',
        header: ({ column }) => (
          <SortableHeader
            label="When"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            {new Date(row.original.at).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: 'actor',
        header: ({ column }) => (
          <SortableHeader
            label="Who"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => <span className="text-xs">{row.original.actor}</span>,
      },
      {
        accessorKey: 'action',
        header: ({ column }) => (
          <SortableHeader
            label="Action"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          />
        ),
        cell: ({ row }) => (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {row.original.action}
          </Badge>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        id: 'details',
        header: 'Details',
        cell: ({ row }) => (
          <div className="text-xs">
            <ActionDetails row={row.original} />
          </div>
        ),
        enableSorting: false,
      },
      {
        id: 'open',
        header: () => <span className="text-right">Open</span>,
        cell: ({ row }) =>
          row.original.sheet_id ? (
            <div className="text-right">
              <Link
                href={`/grading/${row.original.sheet_id}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                sheet
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : (
            <div className="text-right text-xs text-muted-foreground">—</div>
          ),
        enableSorting: false,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    initialState: {
      pagination: { pageSize: 25 },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase().trim();
      if (!needle) return true;
      const r = row.original;
      const haystack = [
        r.actor,
        r.action,
        r.entity_type,
        r.entity_id ?? '',
        r.sheet_id ?? '',
        new Date(r.at).toLocaleString(),
        JSON.stringify(r.context),
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

  const actionColumn = table.getColumn('action');
  const actionValues = React.useMemo(() => {
    if (!actionColumn) return [] as string[];
    return Array.from(actionColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === 'string')
      .sort();
  }, [actionColumn]);
  const selectedActions = (actionColumn?.getFilterValue() as string[] | undefined) ?? [];

  const hasFilter =
    globalFilter.length > 0 || selectedActions.length > 0 || !!sheetIdFilter;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative w-full sm:w-auto sm:min-w-[280px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search actor, action, details…"
              className="pl-8"
            />
          </div>

          {/* Action filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Action
                {selectedActions.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                    {selectedActions.length}
                  </Badge>
                )}
                <ChevronsUpDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
                Filter by action
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {actionValues.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No actions</div>
              )}
              {actionValues.map((act) => {
                const checked = selectedActions.includes(act);
                return (
                  <DropdownMenuCheckboxItem
                    key={act}
                    checked={checked}
                    onCheckedChange={(next) => {
                      const current = new Set(selectedActions);
                      if (next) current.add(act);
                      else current.delete(act);
                      actionColumn?.setFilterValue(
                        current.size === 0 ? undefined : Array.from(current),
                      );
                    }}
                    onSelect={(e) => e.preventDefault()}
                    className="font-mono text-xs"
                  >
                    {act}
                  </DropdownMenuCheckboxItem>
                );
              })}
              {selectedActions.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="p-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center"
                      onClick={() => actionColumn?.setFilterValue(undefined)}
                    >
                      Clear
                    </Button>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sheet ID chip (from deep-link) */}
          {sheetIdFilter && (
            <Badge
              variant="outline"
              className="h-9 gap-1.5 border-brand-indigo-soft/60 bg-accent px-2.5 font-mono text-[11px] text-brand-indigo-deep"
            >
              sheet {sheetIdFilter.slice(0, 8)}…
              <button
                type="button"
                onClick={() => setSheetIdFilter(null)}
                aria-label="Clear sheet filter"
                className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-white"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGlobalFilter('');
                setColumnFilters([]);
                setSheetIdFilter(null);
              }}
            >
              <X className="h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
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
                  <div className="flex flex-col items-center gap-2">
                    <History className="h-6 w-6 opacity-50" />
                    No audit entries match the current filters.
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {filteredData.length} entries
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
                {[10, 25, 50, 100].map((n) => (
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

function ActionDetails({ row }: { row: MergedRow }) {
  const ctx = row.context;
  const str = (k: string): string | null => {
    const v = ctx[k];
    return v == null ? null : String(v);
  };

  switch (row.action) {
    case 'entry.update':
    case 'totals.update': {
      const field = str('field') ?? '—';
      const oldV = str('old') ?? '∅';
      const newV = str('new') ?? '∅';
      const locked = ctx['was_locked'] === true;
      const approval = str('approval_reference');
      return (
        <div className="space-y-0.5">
          <div className="inline-flex flex-wrap items-center gap-1.5 font-mono">
            <span className="text-muted-foreground">{field}:</span>
            <span className="text-muted-foreground line-through">{oldV}</span>
            <ArrowRight className="size-3 text-muted-foreground" />
            <span className="font-semibold">{newV}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {locked ? 'post-lock' : 'pre-lock'}
            {approval ? ` · approval: ${approval}` : ''}
          </div>
        </div>
      );
    }
    case 'sheet.create':
      return (
        <span>
          Created grading sheet{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            subject {str('subject_id')?.slice(0, 8)}…
          </code>{' '}
          for section{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('section_id')?.slice(0, 8)}…
          </code>
          {' · seeded '}
          <span className="tabular-nums">{String(ctx['entries_seeded'] ?? 0)}</span>
          {' entries'}
        </span>
      );
    case 'sheet.lock':
      return <span>Locked grading sheet {row.sheet_id?.slice(0, 8)}…</span>;
    case 'sheet.unlock':
      return <span>Unlocked grading sheet {row.sheet_id?.slice(0, 8)}…</span>;
    case 'student.sync': {
      const added = ctx['added'] ?? 0;
      const updated = ctx['updated'] ?? 0;
      const withdrawn = ctx['withdrawn'] ?? 0;
      const reactivated = ctx['reactivated'] ?? 0;
      const errs = ctx['errors'] ?? 0;
      return (
        <span className="tabular-nums">
          Synced admissions — added <b>{String(added)}</b>, updated <b>{String(updated)}</b>,
          withdrew <b>{String(withdrawn)}</b>, reactivated <b>{String(reactivated)}</b>
          {Number(errs) > 0 && <span className="text-destructive"> · {String(errs)} errors</span>}
        </span>
      );
    }
    case 'student.add':
      return (
        <span>
          Manually added student{' '}
          <code className="rounded bg-muted px-1 text-[10px]">{str('student_number')}</code>
          {' ('}
          {str('first_name')} {str('last_name')}
          {') as #'}
          <span className="tabular-nums">{String(ctx['index_number'] ?? '')}</span>
        </span>
      );
    case 'assignment.create':
      return (
        <span>
          Created <b>{str('role')}</b> assignment for teacher{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('teacher_user_id')?.slice(0, 8)}…
          </code>{' '}
          on section{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('section_id')?.slice(0, 8)}…
          </code>
          {ctx['subject_id'] ? (
            <>
              {' / subject '}
              <code className="rounded bg-muted px-1 text-[10px]">
                {String(ctx['subject_id']).slice(0, 8)}…
              </code>
            </>
          ) : null}
        </span>
      );
    case 'assignment.delete':
      return (
        <span>
          Removed <b>{str('role')}</b> assignment (teacher{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('teacher_user_id')?.slice(0, 8)}…
          </code>
          )
        </span>
      );
    case 'attendance.update': {
      const after = ctx['after'] as Record<string, unknown> | undefined;
      return (
        <span className="tabular-nums">
          Attendance updated for enrolment{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('section_student_id')?.slice(0, 8)}…
          </code>
          {after && (
            <>
              {' · school '}
              <b>{String(after['school_days'] ?? '—')}</b>
              {' · present '}
              <b>{String(after['days_present'] ?? '—')}</b>
              {' · late '}
              <b>{String(after['days_late'] ?? '—')}</b>
            </>
          )}
        </span>
      );
    }
    case 'comment.update':
      return (
        <span>
          Updated adviser comment for student{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('student_id')?.slice(0, 8)}…
          </code>
        </span>
      );
    case 'publication.create':
      return (
        <span>
          Published report cards for section{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('section_id')?.slice(0, 8)}…
          </code>
          {' · term '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('term_id')?.slice(0, 8)}…
          </code>
          {' · window '}
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {str('publish_from')?.slice(0, 10)}
            <ArrowRight className="size-3 text-muted-foreground" />
            {str('publish_until')?.slice(0, 10)}
          </span>
        </span>
      );
    case 'publication.delete':
      return (
        <span>
          Revoked report card publication for section{' '}
          <code className="rounded bg-muted px-1 text-[10px]">
            {str('section_id')?.slice(0, 8)}…
          </code>
        </span>
      );
    default:
      return <span className="text-muted-foreground">{JSON.stringify(ctx)}</span>;
  }
}
