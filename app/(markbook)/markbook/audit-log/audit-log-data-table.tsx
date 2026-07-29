'use client';

import { CalendarIcon, Download, ExternalLink, History, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { DateRange } from 'react-day-picker';
import { type ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  auditActionLabel,
  auditActionTone,
  auditContextSummary,
} from '@/lib/audit/humanize';
import { cn } from '@/lib/utils';

// Map the humanizer's tone bucket → an existing Badge variant.
function actionBadgeVariant(
  action: string
): 'default' | 'secondary' | 'destructive' | 'warning' {
  switch (auditActionTone(action)) {
    case 'destructive':
      return 'destructive';
    case 'warning':
      return 'warning';
    case 'info':
      return 'default';
    default:
      return 'secondary';
  }
}

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

type PaginationInfo = {
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
};

type Props = {
  rows: MergedRow[];
  initialSheetIdFilter?: string | null;
  /** Server-side filter state (driven via URL params, not client facets — the
   *  log is server-paginated so client facets would only filter one page). */
  currentAction?: string | null;
  currentActor?: string | null;
  actionOptions?: string[];
  actorOptions?: string[];
  canExport?: boolean;
  pagination?: PaginationInfo;
};

function toIsoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function endOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(23, 59, 59, 999);
  return n;
}

const COLUMNS: ColumnDef<MergedRow>[] = [
  {
    accessorKey: 'at',
    header: ({ column }) => (
      <SortableHeader column={column}>When</SortableHeader>
    ),
    meta: { label: 'When' },
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {new Date(row.original.at).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: 'actor',
    header: ({ column }) => (
      <SortableHeader column={column}>Who</SortableHeader>
    ),
    meta: { label: 'Who' },
    cell: ({ row }) => <span className="text-xs">{row.original.actor}</span>,
    filterFn: (row, id, value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return true;
      return Array.isArray(value)
        ? value.includes(row.getValue(id))
        : row.getValue(id) === value;
    },
  },
  {
    accessorKey: 'action',
    header: ({ column }) => (
      <SortableHeader column={column}>Action</SortableHeader>
    ),
    meta: { label: 'Action' },
    cell: ({ row }) => (
      <Badge variant={actionBadgeVariant(row.original.action)}>
        {auditActionLabel(row.original.action)}
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
      <span className="text-muted-foreground text-xs">
        {auditContextSummary(row.original.action, row.original.context)}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: 'open',
    header: () => <span className="sr-only">Open sheet</span>,
    cell: ({ row }) => {
      if (!row.original.sheet_id) return null;
      return (
        <RowActionsMenu>
          <DropdownMenuItem asChild>
            <Link href={`/markbook/grading/${row.original.sheet_id}`}>
              <ExternalLink className="size-3.5" />
              Open sheet
            </Link>
          </DropdownMenuItem>
        </RowActionsMenu>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];

export function AuditLogDataTable({
  rows,
  initialSheetIdFilter,
  currentAction = null,
  currentActor = null,
  actionOptions = [],
  actorOptions = [],
  canExport = false,
  pagination,
}: Props) {
  const router = useRouter();

  // Action + Actor are filtered SERVER-side (the log is server-paginated, so a
  // client facet would only filter the loaded page). Each Select writes a URL
  // param and resets to page 1; the page RSC re-queries.
  const setServerParam = React.useCallback(
    (key: 'action' | 'actor', value: string) => {
      const params = new URLSearchParams(window.location.search);
      if (value && value !== 'all') params.set(key, value);
      else params.delete(key);
      params.delete('page');
      router.push(`?${params.toString()}`);
    },
    [router]
  );

  const [exportRange, setExportRange] = React.useState<DateRange | undefined>(
    undefined
  );
  const [exportOpen, setExportOpen] = React.useState(false);
  const exportHref = React.useMemo(() => {
    if (!exportRange?.from || !exportRange.to) return null;
    return `/api/audit-log/export?from=${toIsoDay(exportRange.from)}&to=${toIsoDay(exportRange.to)}`;
  }, [exportRange]);

  const [sheetIdFilter, setSheetIdFilter] = React.useState<string | null>(
    initialSheetIdFilter ?? null
  );
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(
    undefined
  );
  const [dateRangeOpen, setDateRangeOpen] = React.useState(false);

  // Apply date + sheet-id pre-filters before passing to DataTable
  const filteredRows = React.useMemo(() => {
    let data = rows;
    if (sheetIdFilter) data = data.filter((r) => r.sheet_id === sheetIdFilter);
    if (dateRange?.from) {
      const from = startOfDay(dateRange.from).getTime();
      const to = dateRange.to ? endOfDay(dateRange.to).getTime() : Infinity;
      data = data.filter((r) => {
        const ts = new Date(r.at).getTime();
        return ts >= from && ts <= to;
      });
    }
    return data;
  }, [rows, sheetIdFilter, dateRange]);

  // Toolbar leading: server-side Action + Actor filters, date-range, sheet chip
  const toolbarLeading = (
    <>
      {/* Action filter (server-side) */}
      <Select
        value={currentAction ?? 'all'}
        onValueChange={(v) => setServerParam('action', v)}
      >
        <SelectTrigger className="h-8 w-[180px]">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actions</SelectItem>
          {actionOptions.map((a) => (
            <SelectItem key={a} value={a}>
              {auditActionLabel(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Actor filter (server-side) */}
      <Select
        value={currentActor ?? 'all'}
        onValueChange={(v) => setServerParam('actor', v)}
      >
        <SelectTrigger className="h-8 w-[180px]">
          <SelectValue placeholder="All actors" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All actors</SelectItem>
          {actorOptions.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date range filter */}
      <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 gap-2 font-normal',
              !dateRange?.from && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateRange?.from ? (
              <span className="font-mono text-[11px] tabular-nums">
                {formatDay(dateRange.from)}
                {dateRange.to ? ` – ${formatDay(dateRange.to)}` : ''}
              </span>
            ) : (
              <span className="text-sm">Any date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={setDateRange}
            numberOfMonths={2}
            captionLayout="dropdown"
          />
          <div className="flex items-center justify-between border-t border-hairline p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDateRange(undefined)}
              disabled={!dateRange?.from}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDateRangeOpen(false)}
            >
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Sheet ID chip (from deep-link) */}
      {sheetIdFilter && (
        <Badge
          variant="outline"
          className="h-8 gap-1.5 border-border bg-accent px-2.5 font-mono text-[11px] text-accent-foreground"
        >
          Sheet {sheetIdFilter.slice(0, 8)}…
          <button
            type="button"
            onClick={() => setSheetIdFilter(null)}
            aria-label="Clear sheet filter"
            className="ml-0.5 inline-flex size-4 items-center justify-center rounded hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
    </>
  );

  // Toolbar trailing: CSV export dialog (server-side date-range export)
  const toolbarTrailing = canExport ? (
    <Dialog
      open={exportOpen}
      onOpenChange={(v) => {
        setExportOpen(v);
        if (!v) setExportRange(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2">
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg!">
        <DialogHeader>
          <DialogTitle className="font-serif tracking-tight">
            Export date range
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">
            All audit data within the selected date range will be exported as
            CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-end gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'h-9 flex-1 justify-start gap-2 font-normal',
                    !exportRange?.from && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="size-3.5" />
                  {exportRange?.from ? (
                    <span className="font-mono text-[11px] tabular-nums">
                      {formatDay(exportRange.from)}
                      {exportRange.to ? ` – ${formatDay(exportRange.to)}` : ''}
                    </span>
                  ) : (
                    <span className="text-sm">Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={exportRange}
                  onSelect={setExportRange}
                  numberOfMonths={2}
                  captionLayout="dropdown"
                />
                {exportRange?.from && (
                  <div className="flex justify-end border-t border-border p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setExportRange(undefined)}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            <Button
              asChild={!!exportHref}
              disabled={!exportHref}
              className="h-9 shrink-0 gap-2"
              onClick={() => {
                if (exportHref) setExportOpen(false);
              }}
            >
              {exportHref ? (
                <a href={exportHref} download>
                  <Download className="size-3.5" />
                  Download
                </a>
              ) : (
                <span className="flex gap-2">
                  <Download className="size-3.5" />
                  Download
                </span>
              )}
            </Button>
          </div>

          {!exportRange?.from && (
            <p className="text-[12px] text-destructive">
              Please select a start and end date to export.
            </p>
          )}
          {exportRange?.from && !exportRange.to && (
            <p className="text-[12px] text-destructive">
              Please select an end date to complete the range.
            </p>
          )}

          <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber-light/30 p-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-amber/15 text-brand-amber">
              <History className="size-4" />
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-[13px] font-medium leading-tight text-foreground">
                Large exports may take a moment
              </p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                The CSV includes every audit entry within the selected window.
                For wide ranges with heavy activity, the file can be several
                thousand rows.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <_AuditLogTable
      filteredRows={filteredRows}
      toolbarLeading={toolbarLeading}
      toolbarTrailing={toolbarTrailing}
      pagination={pagination}
    />
  );
}

// Inner component that receives stable props so DataTable URL-state works
// correctly even when the outer wrapper's state changes.
function _AuditLogTable({
  filteredRows,
  toolbarLeading,
  toolbarTrailing,
  pagination,
}: {
  filteredRows: MergedRow[];
  toolbarLeading: React.ReactNode;
  toolbarTrailing: React.ReactNode;
  pagination?: PaginationInfo;
}) {
  const router = useRouter();

  const handlePageChange = React.useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(window.location.search);
      params.set('page', String(newPage));
      router.push(`?${params.toString()}`);
    },
    [router]
  );

  return (
    <>
      <DataTable<MergedRow>
        data={filteredRows}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        searchKeys={['actor', 'action', 'entity_type']}
        searchPlaceholder="Search actor, action, details…"
        toolbarLeading={toolbarLeading}
        toolbarTrailing={toolbarTrailing}
        initialSort={[{ id: 'at', desc: true }]}
        pageSize={pagination ? Math.max(filteredRows.length, 1) : 25}
        // Namespaced so the page's own ?sheet_id / ?action params aren't
        // treated as phantom facet filters (KD #84 footgun).
        url={{ enabled: true, namespace: 'al' }}
        emptyState={{
          title: 'No audit entries yet.',
          body: 'Activity — sheet creation, score edits, locks, and more — will appear here.',
        }}
        emptyFilteredState={{
          title: 'No audit entries match the current filters.',
          body: 'Try clearing the date range or filters.',
        }}
      />
      {pagination && (
        <div className="flex items-center justify-between rounded-b-xl border border-t-0 border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="text-muted-foreground tabular-nums">
            {pagination.total === 0
              ? 'No entries'
              : `Showing ${((pagination.page - 1) * pagination.pageSize + 1).toLocaleString('en-SG')}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                ).toLocaleString(
                  'en-SG'
                )} of ${pagination.total.toLocaleString('en-SG')}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              ← Prev
            </Button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {pagination.page.toLocaleString('en-SG')} /{' '}
              {pagination.totalPages.toLocaleString('en-SG')}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
