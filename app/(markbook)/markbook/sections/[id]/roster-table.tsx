"use client";

import * as React from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnrolmentEditSheet } from "@/components/markbook/enrolment-edit-sheet";

export type RosterRow = {
  id: string;
  /** UUID from `public.students.id` — drives the per-student report-card
   *  link (the markbook surface for this student's grades). Null when
   *  the enrolment row references a student record that's been deleted
   *  or was never synced from admissions. */
  student_id: string | null;
  index_number: number;
  student_number: string;
  student_name: string;
  enrollment_status: "active" | "late_enrollee" | "withdrawn";
  bus_no: string | null;
  classroom_officer_role: string | null;
};

type StatusFilter = "all" | "active" | "late_enrollee" | "withdrawn";

export function RosterTable({ data, sectionId }: { data: RosterRow[]; sectionId: string }) {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "index_number", desc: false }]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const columns: ColumnDef<RosterRow>[] = React.useMemo(
    () => [
      {
        accessorKey: "index_number",
        header: ({ column }) => (
          <SortableHeader
            label="#"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums text-muted-foreground">{row.original.index_number}</span>
        ),
      },
      {
        accessorKey: "student_number",
        header: "Student number",
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.student_number || "—"}</span>,
      },
      {
        accessorKey: "student_name",
        header: ({ column }) => (
          <SortableHeader
            label="Name"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const withdrawn = row.original.enrollment_status === "withdrawn";
          return (
            <span
              className={
                "font-medium " + (withdrawn ? "line-through text-muted-foreground" : "text-foreground")
              }
            >
              {row.original.student_name}
            </span>
          );
        },
      },
      {
        accessorKey: "enrollment_status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.enrollment_status;
          if (s === "withdrawn") {
            return (
              <Badge
                variant="outline"
                className="h-6 border-destructive/40 bg-destructive/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-destructive"
              >
                Withdrawn
              </Badge>
            );
          }
          if (s === "late_enrollee") {
            return (
              <Badge
                variant="outline"
                className="h-6 border-brand-indigo-soft/60 bg-accent px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-indigo-deep"
              >
                Late enrollee
              </Badge>
            );
          }
          return (
            <Badge
              variant="outline"
              className="h-6 border-brand-mint bg-brand-mint/30 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink"
            >
              Active
            </Badge>
          );
        },
        filterFn: (row, _id, value) => {
          if (value === "all" || !value) return true;
          return row.original.enrollment_status === value;
        },
      },
      {
        id: "metadata",
        header: "Bus · Officer",
        cell: ({ row }) => {
          const { bus_no, classroom_officer_role } = row.original;
          if (!bus_no && !classroom_officer_role) {
            return <span className="font-mono text-[11px] text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
              {bus_no && (
                <span title="Bus number" className="rounded bg-muted/60 px-1.5 py-0.5">
                  🚌 {bus_no}
                </span>
              )}
              {classroom_officer_role && (
                <span title="Classroom officer" className="rounded bg-muted/60 px-1.5 py-0.5">
                  ⭐ {classroom_officer_role}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {row.original.student_id && (
              <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                <Link
                  href={`/markbook/report-cards/${row.original.student_id}`}
                  title={`Open ${row.original.student_name}'s report card`}
                >
                  <BookOpen className="size-3" />
                  <span>Grades</span>
                </Link>
              </Button>
            )}
            <EnrolmentEditSheet
              sectionId={sectionId}
              enrolmentId={row.original.id}
              studentName={row.original.student_name}
              indexNumber={row.original.index_number}
              initial={{
                bus_no: row.original.bus_no,
                classroom_officer_role: row.original.classroom_officer_role,
                enrollment_status: row.original.enrollment_status,
              }}
            >
              <Button variant="ghost" size="sm" className="h-7 px-2" title="Edit enrolment metadata">
                <Pencil className="size-3" />
                <span className="sr-only">Edit enrolment</span>
              </Button>
            </EnrolmentEditSheet>
          </div>
        ),
      },
    ],
    [sectionId],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter },
    initialState: { pagination: { pageSize: 25 } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const needle = String(filterValue).toLowerCase().trim();
      if (!needle) return true;
      const hay = `${row.original.index_number} ${row.original.student_name} ${row.original.student_number}`.toLowerCase();
      return hay.includes(needle);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  React.useEffect(() => {
    const col = table.getColumn("enrollment_status");
    if (!col) return;
    col.setFilterValue(status === "all" ? undefined : status);
  }, [status, table]);

  const counts = React.useMemo(() => {
    let active = 0;
    let late = 0;
    let withdrawn = 0;
    for (const r of data) {
      if (r.enrollment_status === "active") active += 1;
      else if (r.enrollment_status === "late_enrollee") late += 1;
      else withdrawn += 1;
    }
    return { all: data.length, active, late, withdrawn };
  }, [data]);

  const hasFilter = globalFilter.length > 0 || status !== "all";

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
              placeholder="Search name, student number, index…"
              className="pl-8"
            />
          </div>
          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setGlobalFilter("");
                setStatus("all");
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
              All <span className="ml-1 font-mono text-[10px] text-muted-foreground">{counts.all}</span>
            </TabsTrigger>
            <TabsTrigger value="active">
              Active <span className="ml-1 font-mono text-[10px] text-muted-foreground">{counts.active}</span>
            </TabsTrigger>
            <TabsTrigger value="late_enrollee">
              Late <span className="ml-1 font-mono text-[10px] text-muted-foreground">{counts.late}</span>
            </TabsTrigger>
            <TabsTrigger value="withdrawn">
              Withdrawn{" "}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{counts.withdrawn}</span>
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
                  <TableHead key={h.id} className={h.column.id === "index_number" ? "w-14 text-right" : undefined}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={row.original.enrollment_status === "withdrawn" ? "text-muted-foreground" : ""}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cell.column.id === "index_number" ? "text-right" : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
                  {data.length === 0 ? "No students enrolled yet." : "No students match the current filter."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      <div className="flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {data.length} students
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
                {[10, 25, 50].map((n) => (
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
  sorted: false | "asc" | "desc";
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
          "h-3 w-3 transition-opacity " +
          (sorted ? "opacity-100 text-foreground" : "opacity-40 group-hover:opacity-70")
        }
      />
    </button>
  );
}
