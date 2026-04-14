'use client';

import * as React from 'react';
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
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Asterisk,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ClipboardList,
  Cog,
  FileText,
  GraduationCap,
  HelpCircle,
  Search,
  UserMinus,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import type { OutdatedRow } from '@/lib/admissions/dashboard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

type StaleTier = 'unknown' | 'green' | 'amber' | 'red';

function tierFor(days: number | null): StaleTier {
  if (days === null) return 'unknown';
  if (days >= 14) return 'red';
  if (days >= 7) return 'amber';
  return 'green';
}

// Lightweight RAG indicator for the "In pipeline" column. Full badges live in
// the Staleness column — here we just need a glanceable urgency cue that
// doesn't fight the staleness column's visual weight. Dot + tinted count.
function PipelineAgeCell({ days }: { days: number }) {
  const tier = tierFor(days);
  const dotClass =
    tier === 'red'
      ? 'bg-destructive'
      : tier === 'amber'
        ? 'bg-chart-4'
        : 'bg-brand-mint';
  const textClass =
    tier === 'red'
      ? 'text-destructive'
      : tier === 'amber'
        ? 'text-ink'
        : 'text-ink-3';
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`size-1.5 rounded-full ${dotClass}`}
        aria-hidden
      />
      <span className={`text-sm font-medium tabular-nums ${textClass}`}>
        {days}d
      </span>
    </span>
  );
}

// Follows the canonical badge pattern from grading-data-table:
// h-6 mono-caps, tracking-[0.12em], h-3 icons. Every table-cell badge in the
// app uses this shape so they read as one visual family.
const BADGE_BASE =
  'h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]';

function StalenessBadge({ days }: { days: number | null }) {
  const tier = tierFor(days);
  if (tier === 'unknown') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-hairline bg-muted text-ink-3`}
      >
        <HelpCircle className="h-3 w-3" aria-hidden />
        Never updated
      </Badge>
    );
  }
  if (tier === 'red') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-destructive/40 bg-destructive/10 text-destructive`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  if (tier === 'amber') {
    return (
      <Badge
        variant="outline"
        className={`${BADGE_BASE} border-chart-4/50 bg-chart-4/15 text-ink`}
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        {days}d stale
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={`${BADGE_BASE} border-brand-mint bg-brand-mint/30 text-ink`}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Fresh · {days}d
    </Badge>
  );
}

// Per-status visual treatment. Kept subtle so it doesn't compete with the
// staleness (RAG) badge in the neighboring column — the status badge is the
// *what*, the staleness badge is the *urgency*. All colors resolve through
// semantic CSS tokens (Hard Rule #7); no raw hex or slate/gray utilities.
type StatusStyle = {
  icon: LucideIcon;
  label: string;
  className: string;
};

const STATUS_STYLES: Record<string, StatusStyle> = {
  Submitted: {
    icon: FileText,
    label: 'Submitted',
    className: 'border-brand-indigo/40 bg-brand-indigo/10 text-brand-indigo',
  },
  'Ongoing Verification': {
    icon: ClipboardList,
    label: 'Verification',
    className: 'border-chart-4/50 bg-chart-4/15 text-ink',
  },
  Processing: {
    icon: Cog,
    label: 'Processing',
    className: 'border-brand-indigo-soft/60 bg-brand-indigo-soft/15 text-ink',
  },
  Enrolled: {
    icon: GraduationCap,
    label: 'Enrolled',
    className: 'border-brand-mint bg-brand-mint/30 text-ink',
  },
  'Enrolled (Conditional)': {
    icon: Asterisk,
    label: 'Conditional',
    className: 'border-brand-mint/60 bg-brand-mint/15 text-ink',
  },
  Withdrawn: {
    icon: UserMinus,
    label: 'Withdrawn',
    className: 'border-destructive/30 bg-destructive/5 text-ink-4',
  },
  Cancelled: {
    icon: XCircle,
    label: 'Cancelled',
    className: 'border-destructive/30 bg-destructive/5 text-ink-4',
  },
};

const UNKNOWN_STATUS: StatusStyle = {
  icon: HelpCircle,
  label: 'No status',
  className: 'border-hairline bg-muted text-ink-3',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? UNKNOWN_STATUS;
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={`${BADGE_BASE} ${style.className}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {style.label}
    </Badge>
  );
}

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

type StatusFilter = 'all' | 'red' | 'amber' | 'unknown';

const columns: ColumnDef<OutdatedRow>[] = [
  {
    accessorKey: 'fullName',
    header: ({ column }) => (
      <SortableHeader
        label="Applicant"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <div className="font-medium text-foreground">{row.original.fullName}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.original.enroleeNumber}
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'levelApplied',
    header: 'Level',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.levelApplied ?? '—'}
      </span>
    ),
    filterFn: (row, id, value) => {
      const v = row.getValue<string | null>(id) ?? '—';
      if (Array.isArray(value)) {
        return value.length === 0 || value.includes(v);
      }
      return !value || value === v;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: 'tier',
    accessorFn: (row) => tierFor(row.daysSinceUpdate),
    header: ({ column }) => (
      <SortableHeader
        label="Staleness"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    cell: ({ row }) => <StalenessBadge days={row.original.daysSinceUpdate} />,
    sortingFn: (a, b) => {
      // Sort by daysSinceUpdate; null (never updated) sorts first as desc.
      const av = a.original.daysSinceUpdate;
      const bv = b.original.daysSinceUpdate;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av - bv;
    },
    filterFn: (row, _id, value: StaleTier | undefined) => {
      if (!value) return true;
      return tierFor(row.original.daysSinceUpdate) === value;
    },
  },
  {
    accessorKey: 'lastUpdated',
    header: 'Last updated',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        {formatDate(row.original.lastUpdated)}
      </span>
    ),
  },
  {
    accessorKey: 'daysInPipeline',
    header: ({ column }) => (
      <SortableHeader
        label="In pipeline"
        sorted={column.getIsSorted()}
        onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      />
    ),
    cell: ({ row }) => <PipelineAgeCell days={row.original.daysInPipeline} />,
  },
];

export function OutdatedApplicationsTable({ rows }: { rows: OutdatedRow[] }) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'tier', desc: true },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('all');

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _id, value) => {
      const v = String(value ?? '').toLowerCase();
      if (!v) return true;
      return (
        row.original.fullName.toLowerCase().includes(v) ||
        row.original.enroleeNumber.toLowerCase().includes(v) ||
        (row.original.levelApplied ?? '').toLowerCase().includes(v) ||
        row.original.status.toLowerCase().includes(v)
      );
    },
    initialState: { pagination: { pageSize: 10 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // Keep the `tier` column filter in sync with the status tab.
  React.useEffect(() => {
    const tierCol = table.getColumn('tier');
    if (!tierCol) return;
    tierCol.setFilterValue(status === 'all' ? undefined : status);
  }, [status, table]);

  // Level dropdown facets.
  const levelColumn = table.getColumn('levelApplied');
  const levelValues = React.useMemo(() => {
    if (!levelColumn) return [] as string[];
    return Array.from(levelColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort();
  }, [levelColumn]);
  const selectedLevels = (levelColumn?.getFilterValue() as string[] | undefined) ?? [];

  // Tab counts — computed off the raw rows so badges stay stable regardless of
  // the current filter.
  const counts = React.useMemo(() => {
    let red = 0;
    let amber = 0;
    let unknown = 0;
    for (const r of rows) {
      const t = tierFor(r.daysSinceUpdate);
      if (t === 'red') red += 1;
      else if (t === 'amber') amber += 1;
      else if (t === 'unknown') unknown += 1;
    }
    return { red, amber, unknown };
  }, [rows]);

  const hasFilter =
    globalFilter.length > 0 || selectedLevels.length > 0 || status !== 'all';

  if (rows.length === 0) {
    return (
      <Card className="items-center py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle2 className="size-6 text-chart-5" />
          <p className="font-serif text-lg font-semibold text-foreground">
            Nothing stale.
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Every active application has been touched recently. Keep the
            momentum going.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search applicant, enrolee #, level, status…"
              className="pl-8"
            />
          </div>

          <LevelCombobox
            values={levelValues}
            selected={selectedLevels}
            onChange={(next) =>
              levelColumn?.setFilterValue(next.length === 0 ? undefined : next)
            }
          />

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

        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">
              All{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {rows.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="red">
              Critical{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {counts.red}
              </span>
            </TabsTrigger>
            <TabsTrigger value="amber">
              Warning{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {counts.amber}
              </span>
            </TabsTrigger>
            <TabsTrigger value="unknown">
              Never{' '}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {counts.unknown}
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
                  No applications match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {rows.length} application
          {rows.length === 1 ? '' : 's'}
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
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Lightweight searchable combobox. Built on Popover + Input rather than cmdk
// because we don't yet depend on cmdk in this project — the Level filter is
// currently the only multi-select with >10 options that benefits from type-
// to-filter. Capped height + overflow keeps the popover compact regardless of
// how many levels exist.
function LevelCombobox({
  values,
  selected,
  onChange,
}: {
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Focus the search input when the popover opens. Radix focus management
  // lands on the first focusable child by default, which is the input —
  // but we explicitly re-focus after open so re-opens feel snappy.
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => v.toLowerCase().includes(q));
  }, [values, query]);

  const toggle = (lvl: string) => {
    const set = new Set(selected);
    if (set.has(lvl)) set.delete(lvl);
    else set.add(lvl);
    onChange(Array.from(set));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          Level
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {selected.length}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-3.5 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search level…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search levels"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="max-h-[220px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No levels match &ldquo;{query}&rdquo;
            </div>
          ) : (
            filtered.map((lvl) => {
              const isSelected = selected.includes(lvl);
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => toggle(lvl)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  aria-pressed={isSelected}
                >
                  <span className="truncate">{lvl}</span>
                  {isSelected && (
                    <Check
                      className="size-3.5 text-primary shrink-0"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
        {selected.length > 0 && (
          <div className="border-t border-border p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => {
                onChange([]);
                setQuery('');
              }}
            >
              Clear {selected.length} selected
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
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
