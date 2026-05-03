"use client";

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
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Search,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { SisEmptyState } from "@/components/sis/empty-state";

import { ApplicationStatusBadge } from "@/components/sis/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StudentListRow } from "@/lib/sis/queries";

// Each bucket defines its own match list. The first bucket is always treated
// as the "show everything" default — by convention it has no `statuses` array
// (matches all). Pages pass module-specific buckets via the `statusBuckets`
// prop; the default list below is records-shaped (KD #51 — enrolled-first).
export type StatusBucketDef = {
  key: string;
  label: string;
  // undefined = match all rows; explicit array = exact-match against trimmed
  // applicationStatus. Empty status falls into the "All" bucket only.
  statuses?: string[];
};

const DEFAULT_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: "all", label: "All" },
  { key: "enrolled", label: "Enrolled", statuses: ["Enrolled", "Enrolled (Conditional)"] },
  { key: "pipeline", label: "Pipeline", statuses: ["Submitted", "Ongoing Verification", "Processing"] },
  { key: "withdrawn", label: "Withdrawn", statuses: ["Withdrawn", "Cancelled"] },
];

function bucketMatchesStatus(def: StatusBucketDef, status: string | null): boolean {
  if (!def.statuses) return true;
  return def.statuses.includes((status ?? "").trim());
}

function studentDisplayName(row: StudentListRow): string {
  if (row.enroleeFullName) return row.enroleeFullName;
  const parts = [row.lastName, row.firstName, row.middleName].filter(Boolean);
  return parts.length ? parts.join(" ") : "(no name on file)";
}

function formatSubmittedDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });
}

// `linkBase` controls where the name link points — defaults to Admissions
// (enroleeNumber-indexed) since that's the more common case. Records
// (enrolled-only) overrides with `linkBase="/records/students"` +
// `linkAttribute="studentNumber"` to point at the cross-year permanent URL.
// Rows without a studentNumber fall back to the enroleeNumber URL so unsynced
// enrolled applicants (rare edge case) still have a working link.
// `linkQuery` appends `?key=value` pairs — the Admissions detail page is
// enroleeNumber+AY-scoped, so historical-AY browsing must thread `ay` through
// or the detail page falls back to the current AY and 404s.
export function StudentDataTable({
  data,
  linkBase = "/admissions/applications",
  linkAttribute = "enroleeNumber",
  linkQuery,
  defaultSorting,
  showSubmittedColumn = false,
  statusBuckets = DEFAULT_STATUS_BUCKETS,
}: {
  data: StudentListRow[];
  linkBase?: string;
  linkAttribute?: "enroleeNumber" | "studentNumber";
  linkQuery?: Record<string, string>;
  defaultSorting?: SortingState;
  showSubmittedColumn?: boolean;
  statusBuckets?: StatusBucketDef[];
}) {
  const firstBucketKey = statusBuckets[0]?.key ?? "all";
  const querySuffix = React.useMemo(() => {
    if (!linkQuery) return "";
    const entries = Object.entries(linkQuery).filter(([, v]) => v);
    if (entries.length === 0) return "";
    const params = new URLSearchParams(entries);
    return `?${params.toString()}`;
  }, [linkQuery]);
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSorting ?? [
      { id: "level", desc: false },
      { id: "section", desc: false },
    ],
  );
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [bucket, setBucket] = React.useState<string>(firstBucketKey);

  const columns: ColumnDef<StudentListRow>[] = React.useMemo(
    () => [
      {
        accessorFn: (row) => studentDisplayName(row),
        id: "name",
        header: ({ column }) => (
          <SortableHeader
            label="Name"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          // studentNumber may be null for unsynced enrolled rows; fall back
          // to enroleeNumber so the row still links somewhere useful.
          const linkId =
            linkAttribute === "studentNumber"
              ? (row.original.studentNumber ?? row.original.enroleeNumber)
              : row.original.enroleeNumber;
          return (
            <Link
              href={`${linkBase}/${linkId}${querySuffix}`}
              className="font-medium text-foreground underline transition-colors hover:text-primary">
              {studentDisplayName(row.original)}
            </Link>
          );
        },
      },
      {
        accessorKey: "studentNumber",
        header: ({ column }) => (
          <SortableHeader
            label="Student #"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {row.original.studentNumber ?? <span className="text-muted-foreground">—</span>}
          </span>
        ),
      },
      {
        accessorKey: "enroleeNumber",
        header: ({ column }) => (
          <SortableHeader
            label="Enrolee #"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.original.enroleeNumber}</span>
        ),
      },
      {
        accessorFn: (row) => row.classLevel ?? row.levelApplied ?? "",
        id: "level",
        header: ({ column }) => (
          <SortableHeader
            label="Level"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const lvl = row.original.classLevel ?? row.original.levelApplied;
          return lvl ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{lvl}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value) ? value.includes(row.getValue(id)) : row.getValue(id) === value;
        },
      },
      {
        accessorKey: "classSection",
        id: "section",
        header: ({ column }) => (
          <SortableHeader
            label="Section"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) =>
          row.original.classSection ? (
            <span className="text-foreground">{row.original.classSection}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value) ? value.includes(row.getValue(id)) : row.getValue(id) === value;
        },
      },
      {
        accessorKey: "applicationStatus",
        id: "status",
        header: ({ column }) => (
          <SortableHeader
            label="Status"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <ApplicationStatusBadge status={row.original.applicationStatus} />,
        filterFn: (row, _id, value) => {
          // Filtered via the bucket tabs, not column filter — handled in useEffect below.
          if (typeof value !== "string") return true;
          const def = statusBuckets.find((b) => b.key === value);
          if (!def) return true;
          return bucketMatchesStatus(def, row.original.applicationStatus);
        },
      },
      ...(showSubmittedColumn
        ? [
            {
              accessorKey: "created_at",
              id: "submitted",
              sortingFn: "datetime",
              header: ({ column }) => (
                <SortableHeader
                  label="Submitted"
                  sorted={column.getIsSorted()}
                  onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
                />
              ),
              cell: ({ row }) => {
                const formatted = formatSubmittedDate(row.original.created_at);
                return formatted ? (
                  <span className="font-mono text-[11px] tabular-nums text-foreground">{formatted}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
              },
            } satisfies ColumnDef<StudentListRow>,
          ]
        : []),
    ],
    [linkBase, linkAttribute, querySuffix, showSubmittedColumn, statusBuckets],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter, pagination: { pageIndex: 0, pageSize: 25 } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      if (!filterValue) return true;
      const q = String(filterValue).toLowerCase();
      const r = row.original;
      const haystack = [
        studentDisplayName(r),
        r.studentNumber,
        r.enroleeNumber,
        r.classSection,
        r.classLevel,
        r.levelApplied,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: false,
  });

  // Bucket tab → status column filter. The first bucket is the "match all"
  // default, so clear the column filter when it's selected.
  React.useEffect(() => {
    const col = table.getColumn("status");
    if (!col) return;
    if (bucket === firstBucketKey) col.setFilterValue(undefined);
    else col.setFilterValue(bucket);
  }, [bucket, firstBucketKey, table]);

  const levelColumn = table.getColumn("level");
  const sectionColumn = table.getColumn("section");

  const levelValues = React.useMemo(() => {
    if (!levelColumn) return [] as string[];
    return Array.from(levelColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort();
  }, [levelColumn]);
  const sectionValues = React.useMemo(() => {
    if (!sectionColumn) return [] as string[];
    return Array.from(sectionColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort();
  }, [sectionColumn]);

  const selectedLevels = (levelColumn?.getFilterValue() as string[] | undefined) ?? [];
  const selectedSections = (sectionColumn?.getFilterValue() as string[] | undefined) ?? [];

  const hasFilter =
    globalFilter.length > 0 || selectedLevels.length > 0 || selectedSections.length > 0 || bucket !== firstBucketKey;

  // Per-bucket counts — every bucket gets one pass. "All"-style buckets
  // (no statuses) trivially match every row, so the first bucket always
  // reports the full row count.
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const def of statusBuckets) c[def.key] = 0;
    for (const r of data) {
      for (const def of statusBuckets) {
        if (bucketMatchesStatus(def, r.applicationStatus)) c[def.key] += 1;
      }
    }
    return c;
  }, [data, statusBuckets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:min-w-[280px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search name, student #, enrolee #, section…"
              className="pl-8"
            />
          </div>

          <FacetFilter
            label="Level"
            values={levelValues}
            selected={selectedLevels}
            onChange={(next) => levelColumn?.setFilterValue(next.length === 0 ? undefined : next)}
          />
          <FacetFilter
            label="Section"
            values={sectionValues}
            selected={selectedSections}
            onChange={(next) => sectionColumn?.setFilterValue(next.length === 0 ? undefined : next)}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto lg:ml-0">
                <Columns3 className="h-3.5 w-3.5" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
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
                    className="capitalize">
                    {col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGlobalFilter("");
                setBucket(firstBucketKey);
                setColumnFilters([]);
              }}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <Tabs value={bucket} onValueChange={setBucket}>
          <TabsList>
            {statusBuckets.map((def) => (
              <TabsTrigger key={def.key} value={def.key}>
                {def.label} <span className="ml-1 font-mono text-[10px] ">{counts[def.key] ?? 0}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

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
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-6">
                  <SisEmptyState
                    icon={Users}
                    title="No students in view."
                    body="Adjust the filters above or search across academic years for a returning student."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {data.length} students
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Rows per page</span>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(v) => table.setPageSize(Number(v))}>
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
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacetFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {selected.length}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[320px] w-56 overflow-y-auto">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
          Filter by {label.toLowerCase()}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {values.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No options</div>}
        {values.map((v) => {
          const checked = selected.includes(v);
          return (
            <DropdownMenuCheckboxItem
              key={v}
              checked={checked}
              onCheckedChange={(next) => {
                const current = new Set(selected);
                if (next) current.add(v);
                else current.delete(v);
                onChange(Array.from(current));
              }}
              onSelect={(e) => e.preventDefault()}>
              {v}
            </DropdownMenuCheckboxItem>
          );
        })}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-1">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => onChange([])}>
                Clear
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortableHeader({
  label,
  sorted,
  onToggle,
}: {
  label: string;
  sorted: false | "asc" | "desc";
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group -ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left font-medium transition-colors hover:bg-muted">
      {label}
      <ArrowUpDown
        className={
          "h-3 w-3 transition-opacity " + (sorted ? "opacity-100 text-foreground" : "opacity-40 group-hover:opacity-70")
        }
      />
    </button>
  );
}
