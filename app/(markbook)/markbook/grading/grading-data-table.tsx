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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Columns3,
  Lock,
  Search,
  UserCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

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

export type GradingSheetRow = {
  id: string;
  section: string;
  level: string;
  subject: string;
  term: string;
  teacher: string | null;
  /** auth user_id of the (section, subject) subject_teacher — drives the
   *  "My sheets" toggle alongside form_adviser_id. */
  subject_teacher_id?: string | null;
  /** Display name of the section's form_adviser — populates the hidden-by-
   *  default Form adviser column + faceted filter cell value. */
  form_adviser?: string | null;
  /** auth user_id of the section's form_adviser — drives "My sheets". */
  form_adviser_id?: string | null;
  is_locked: boolean;
  blanks_remaining: number;
  total_students: number;
};

type StatusValue = "all" | "open" | "locked" | "blanks";

const STATUS_VALUES: readonly StatusValue[] = ["all", "open", "locked", "blanks"];

function isStatusValue(v: string | null): v is StatusValue {
  return v != null && (STATUS_VALUES as readonly string[]).includes(v);
}

function parseList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function GradingDataTable({
  data,
  initialSearch,
  teacherOptions,
  formAdviserOptions,
  currentUserId,
}: {
  data: GradingSheetRow[];
  /** Seed value for the global search input — used to deep-link from
   *  `/markbook/sections/[id]` "Grading sheets →" CTA, which passes the
   *  section name so the table opens pre-filtered to that section. The
   *  URL `?q=` param wins over this seed when present. */
  initialSearch?: string;
  /** Curated list of subject-teacher display names in the current AY.
   *  When provided, replaces the faceted unique values in the Teacher
   *  dropdown — so the dropdown lists every assigned teacher regardless
   *  of which other filters are active. Faceted "(unassigned)" pseudo
   *  is still appended when any visible row has `teacher = null`. */
  teacherOptions?: string[];
  /** Curated list of form-adviser display names in the current AY. */
  formAdviserOptions?: string[];
  /** Logged-in auth user_id — drives the "My sheets" toggle. When null
   *  the toggle hides (no teacher session, e.g. anonymous render). */
  currentUserId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Seed initial state from URL params on mount. The URL is the source
  // of truth for filter state — we read once, then sync writes back via
  // `router.replace` whenever state changes.
  const initialFromUrl = React.useMemo(() => {
    const q = searchParams.get("q");
    return {
      q: q ?? initialSearch ?? "",
      status: (() => {
        const s = searchParams.get("status");
        return isStatusValue(s) ? s : ("all" as StatusValue);
      })(),
      level: parseList(searchParams.get("level")),
      subject: parseList(searchParams.get("subject")),
      term: parseList(searchParams.get("term")),
      teacher: parseList(searchParams.get("teacher")),
      adviser: parseList(searchParams.get("adviser")),
      mine: searchParams.get("mine") === "1",
    };
    // Read once on mount — subsequent URL changes from this component's
    // own writes shouldn't re-seed state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "level", desc: false },
    { id: "section", desc: false },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(() => {
    const seeds: ColumnFiltersState = [];
    if (initialFromUrl.level.length > 0) seeds.push({ id: "level", value: initialFromUrl.level });
    if (initialFromUrl.subject.length > 0) seeds.push({ id: "subject", value: initialFromUrl.subject });
    if (initialFromUrl.term.length > 0) seeds.push({ id: "term", value: initialFromUrl.term });
    if (initialFromUrl.teacher.length > 0) seeds.push({ id: "teacher", value: initialFromUrl.teacher });
    if (initialFromUrl.adviser.length > 0) seeds.push({ id: "form_adviser", value: initialFromUrl.adviser });
    return seeds;
  });
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    // Form adviser hidden by default — registrars filter on it without
    // needing the column to bloat the table.
    form_adviser: false,
  });
  const [globalFilter, setGlobalFilter] = React.useState(initialFromUrl.q);
  const [status, setStatus] = React.useState<StatusValue>(initialFromUrl.status);
  const [mine, setMine] = React.useState<boolean>(initialFromUrl.mine);

  // URL writeback — whenever a filter dimension changes, push a new
  // querystring (preserving any caller-supplied params like `?section=`).
  // Search text is debounced 300ms so we don't trigger a `replace` per
  // keystroke. `router.replace` (not `push`) avoids history bloat.
  const debouncedSearchRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (debouncedSearchRef.current) clearTimeout(debouncedSearchRef.current);
    debouncedSearchRef.current = setTimeout(() => {
      writeUrl();
    }, 300);
    return () => {
      if (debouncedSearchRef.current) clearTimeout(debouncedSearchRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilter]);

  // Non-text filter writes are immediate.
  React.useEffect(() => {
    writeUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, columnFilters, mine]);

  function writeUrl() {
    const next = new URLSearchParams(searchParams.toString());
    const setOrDelete = (key: string, value: string | null) => {
      if (value && value.length > 0) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete("q", globalFilter.length > 0 ? globalFilter : null);
    setOrDelete("status", status === "all" ? null : status);
    const findFilter = (id: string) => {
      const f = columnFilters.find((cf) => cf.id === id);
      const arr = (f?.value as string[] | undefined) ?? [];
      return arr.length > 0 ? arr.join(",") : null;
    };
    setOrDelete("level", findFilter("level"));
    setOrDelete("subject", findFilter("subject"));
    setOrDelete("term", findFilter("term"));
    setOrDelete("teacher", findFilter("teacher"));
    setOrDelete("adviser", findFilter("form_adviser"));
    setOrDelete("mine", mine ? "1" : null);
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  const columns: ColumnDef<GradingSheetRow>[] = React.useMemo(
    () => [
      {
        accessorKey: "level",
        header: ({ column }) => (
          <SortableHeader
            label="Level"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {row.original.level}
          </span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value) ? value.includes(row.getValue(id)) : row.getValue(id) === value;
        },
      },
      {
        accessorKey: "section",
        header: ({ column }) => (
          <SortableHeader
            label="Section"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => (
          <Link
            href={`/markbook/grading/${row.original.id}`}
            className="font-medium text-foreground transition-colors hover:text-primary underline">
            {row.original.section}
          </Link>
        ),
      },
      {
        accessorKey: "subject",
        header: ({ column }) => (
          <SortableHeader
            label="Subject"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <span className="text-foreground">{row.original.subject}</span>,
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value) ? value.includes(row.getValue(id)) : row.getValue(id) === value;
        },
      },
      {
        accessorKey: "term",
        header: ({ column }) => (
          <SortableHeader
            label="Term"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.term}</span>,
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          return Array.isArray(value) ? value.includes(row.getValue(id)) : row.getValue(id) === value;
        },
      },
      {
        accessorKey: "teacher",
        header: "Teacher",
        cell: ({ row }) => <span className="text-muted-foreground">{row.original.teacher ?? "—"}</span>,
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          // Map null teacher → "(unassigned)" pseudo-value so registrars
          // can filter to sheets that haven't been assigned yet.
          const raw = row.getValue(id);
          const cell = raw == null || raw === "" ? "(unassigned)" : raw;
          return Array.isArray(value) ? value.includes(cell) : cell === value;
        },
      },
      {
        accessorKey: "form_adviser",
        header: "Form adviser",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.form_adviser ?? "—"}</span>
        ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0)) return true;
          const raw = row.getValue(id);
          const cell = raw == null || raw === "" ? "(unassigned)" : raw;
          return Array.isArray(value) ? value.includes(cell) : cell === value;
        },
      },
      {
        accessorKey: "blanks_remaining",
        header: ({ column }) => (
          <SortableHeader
            label="Blanks"
            sorted={column.getIsSorted()}
            onToggle={() => column.toggleSorting(column.getIsSorted() === "asc")}
          />
        ),
        cell: ({ row }) => {
          const { blanks_remaining, total_students } = row.original;
          if (blanks_remaining === 0) {
            return (
              <Badge
                variant="success"
                className="h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                <CheckCircle2 className="h-3 w-3" />
                Complete
              </Badge>
            );
          }
          return (
            <Badge
              variant="blocked"
              className="h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
              {blanks_remaining} of {total_students} blank
            </Badge>
          );
        },
        sortingFn: (a, b) => a.original.blanks_remaining - b.original.blanks_remaining,
        filterFn: (row, _id, value) => {
          if (value === "blanks") return row.original.blanks_remaining > 0;
          return true;
        },
      },
      {
        accessorKey: "is_locked",
        header: "Status",
        cell: ({ row }) =>
          row.original.is_locked ? (
            <Badge
              variant="blocked"
              className="h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
              <Lock className="h-3 w-3" />
              Locked
            </Badge>
          ) : (
            <Badge
              variant="success"
              className="h-6 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
              <CheckCircle2 className="h-3 w-3" />
              Open
            </Badge>
          ),
        filterFn: (row, id, value) => {
          if (value === "all") return true;
          if (value === "locked") return row.getValue(id) === true;
          if (value === "open") return row.getValue(id) === false;
          return true;
        },
      },
    ],
    [],
  );

  // "My sheets" pre-filter — applied before the table sees the data so
  // the faceted unique values + counts on every other column reflect the
  // narrowed set. Toggle hides when there's no logged-in user (no
  // session or anonymous render).
  const visibleData = React.useMemo(() => {
    if (!mine || !currentUserId) return data;
    return data.filter(
      (r) =>
        r.subject_teacher_id === currentUserId || r.form_adviser_id === currentUserId,
    );
  }, [data, mine, currentUserId]);

  const mineCount = React.useMemo(() => {
    if (!currentUserId) return 0;
    return data.filter(
      (r) =>
        r.subject_teacher_id === currentUserId || r.form_adviser_id === currentUserId,
    ).length;
  }, [data, currentUserId]);

  const table = useReactTable({
    data: visibleData,
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
        row.original.teacher ?? "",
        row.original.form_adviser ?? "",
        row.original.level,
      ]
        .join(" ")
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

  // Keep the is_locked + blanks_remaining column filters in sync with the status tab.
  React.useEffect(() => {
    const lockCol = table.getColumn("is_locked");
    const blanksCol = table.getColumn("blanks_remaining");
    if (!lockCol || !blanksCol) return;
    if (status === "blanks") {
      lockCol.setFilterValue(undefined);
      blanksCol.setFilterValue("blanks");
    } else if (status === "all") {
      lockCol.setFilterValue(undefined);
      blanksCol.setFilterValue(undefined);
    } else {
      lockCol.setFilterValue(status);
      blanksCol.setFilterValue(undefined);
    }
  }, [status, table]);

  // Facets for each dropdown filter. Level / Subject / Term still derive
  // from the table's faceted unique values. Teacher + Form adviser
  // prefer caller-supplied curated options (server-built from
  // teacher_assignments) so the dropdowns list every assigned teacher
  // regardless of other filters' state. The faceted "(unassigned)"
  // pseudo-value still appends when any visible row has a null cell.
  const levelColumn = table.getColumn("level");
  const subjectColumn = table.getColumn("subject");
  const termColumn = table.getColumn("term");
  const teacherColumn = table.getColumn("teacher");
  const adviserColumn = table.getColumn("form_adviser");

  const levelValues = React.useMemo(() => {
    if (!levelColumn) return [] as string[];
    return Array.from(levelColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === "string")
      .sort();
  }, [levelColumn]);
  const subjectValues = React.useMemo(() => {
    if (!subjectColumn) return [] as string[];
    return Array.from(subjectColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === "string")
      .sort();
  }, [subjectColumn]);
  const termValues = React.useMemo(() => {
    if (!termColumn) return [] as string[];
    return Array.from(termColumn.getFacetedUniqueValues().keys())
      .filter((v): v is string => typeof v === "string")
      .sort();
  }, [termColumn]);
  const teacherValues = React.useMemo(() => {
    if (!teacherColumn) return [] as string[];
    const facetedRaw = Array.from(teacherColumn.getFacetedUniqueValues().keys());
    const hasUnassigned = facetedRaw.some((v) => v == null || v === "");
    const named =
      teacherOptions && teacherOptions.length > 0
        ? [...teacherOptions]
        : facetedRaw
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .sort();
    return hasUnassigned ? [...named, "(unassigned)"] : named;
  }, [teacherColumn, teacherOptions]);
  const adviserValues = React.useMemo(() => {
    if (!adviserColumn) return [] as string[];
    const facetedRaw = Array.from(adviserColumn.getFacetedUniqueValues().keys());
    const hasUnassigned = facetedRaw.some((v) => v == null || v === "");
    const named =
      formAdviserOptions && formAdviserOptions.length > 0
        ? [...formAdviserOptions]
        : facetedRaw
            .filter((v): v is string => typeof v === "string" && v.length > 0)
            .sort();
    return hasUnassigned ? [...named, "(unassigned)"] : named;
  }, [adviserColumn, formAdviserOptions]);

  const selectedLevels = (levelColumn?.getFilterValue() as string[] | undefined) ?? [];
  const selectedSubjects = (subjectColumn?.getFilterValue() as string[] | undefined) ?? [];
  const selectedTerms = (termColumn?.getFilterValue() as string[] | undefined) ?? [];
  const selectedTeachers = (teacherColumn?.getFilterValue() as string[] | undefined) ?? [];
  const selectedAdvisers = (adviserColumn?.getFilterValue() as string[] | undefined) ?? [];

  const hasFilter =
    globalFilter.length > 0 ||
    selectedLevels.length > 0 ||
    selectedSubjects.length > 0 ||
    selectedTerms.length > 0 ||
    selectedTeachers.length > 0 ||
    selectedAdvisers.length > 0 ||
    status !== "all" ||
    mine;

  // Helper — remove one value from a multi-select column filter and keep
  // the other values intact. Used by the active-filter chip dismiss `×`.
  function removeFilterValue(
    col: ReturnType<typeof table.getColumn>,
    selected: string[],
    value: string,
  ) {
    if (!col) return;
    const next = selected.filter((v) => v !== value);
    col.setFilterValue(next.length === 0 ? undefined : next);
  }

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

          {/* My sheets toggle — narrows to sheets where the current user
              is either the subject_teacher or the form_adviser. Hides
              when no userId is present (anonymous render). */}
          {currentUserId && (
            <Button
              variant={mine ? "default" : "outline"}
              size="sm"
              onClick={() => setMine((v) => !v)}
              aria-pressed={mine}>
              <UserCheck className="h-3.5 w-3.5" />
              My sheets
              <Badge
                variant={mine ? "secondary" : "outline"}
                className="ml-1 h-5 px-1.5 text-[10px]">
                {mineCount}
              </Badge>
            </Button>
          )}

          {/* Level filter */}
          <FacetDropdown
            label="Level"
            values={levelValues}
            selected={selectedLevels}
            onChange={(next) => levelColumn?.setFilterValue(next)}
          />

          {/* Subject filter */}
          <FacetDropdown
            label="Subject"
            values={subjectValues}
            selected={selectedSubjects}
            onChange={(next) => subjectColumn?.setFilterValue(next)}
          />

          {/* Term filter */}
          <FacetDropdown
            label="Term"
            values={termValues}
            selected={selectedTerms}
            onChange={(next) => termColumn?.setFilterValue(next)}
          />

          {/* Teacher filter */}
          <FacetDropdown
            label="Teacher"
            values={teacherValues}
            selected={selectedTeachers}
            onChange={(next) => teacherColumn?.setFilterValue(next)}
          />

          {/* Form adviser filter */}
          <FacetDropdown
            label="Form adviser"
            values={adviserValues}
            selected={selectedAdvisers}
            onChange={(next) => adviserColumn?.setFilterValue(next)}
          />

          {/* Column visibility */}
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
                    {col.id === "is_locked"
                      ? "Status"
                      : col.id === "blanks_remaining"
                        ? "Blanks"
                        : col.id === "form_adviser"
                          ? "Form adviser"
                          : col.id}
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
                setStatus("all");
                setColumnFilters([]);
                setMine(false);
              }}>
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        {/* Status tabs */}
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusValue)}>
          <TabsList>
            <TabsTrigger value="all">
              All <span className="ml-1 font-mono text-[10px] text-muted-foreground">{visibleData.length}</span>
            </TabsTrigger>
            <TabsTrigger value="open">
              Open{" "}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {visibleData.filter((r) => !r.is_locked).length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="locked">
              Locked{" "}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {visibleData.filter((r) => r.is_locked).length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="blanks">
              With blanks{" "}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {visibleData.filter((r) => r.blanks_remaining > 0).length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Active-filter chip strip — visible only when ≥1 filter is on.
          Each chip dismisses one specific filter value (preserves the
          others). Lets the registrar see exactly what's narrowing the
          table without nuking the whole stack via "Clear". */}
      {hasFilter && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Active filters
          </span>
          {globalFilter.length > 0 && (
            <FilterChip
              label="Search"
              value={globalFilter}
              onClear={() => setGlobalFilter("")}
            />
          )}
          {mine && (
            <FilterChip
              label="Scope"
              value="My sheets"
              onClear={() => setMine(false)}
            />
          )}
          {status !== "all" && (
            <FilterChip
              label="Status"
              value={status === "open" ? "Open" : status === "locked" ? "Locked" : "With blanks"}
              onClear={() => setStatus("all")}
            />
          )}
          {selectedLevels.map((v) => (
            <FilterChip
              key={`lvl-${v}`}
              label="Level"
              value={v}
              onClear={() => removeFilterValue(levelColumn, selectedLevels, v)}
            />
          ))}
          {selectedSubjects.map((v) => (
            <FilterChip
              key={`subj-${v}`}
              label="Subject"
              value={v}
              onClear={() => removeFilterValue(subjectColumn, selectedSubjects, v)}
            />
          ))}
          {selectedTerms.map((v) => (
            <FilterChip
              key={`term-${v}`}
              label="Term"
              value={v}
              onClear={() => removeFilterValue(termColumn, selectedTerms, v)}
            />
          ))}
          {selectedTeachers.map((v) => (
            <FilterChip
              key={`tch-${v}`}
              label="Teacher"
              value={v}
              onClear={() => removeFilterValue(teacherColumn, selectedTeachers, v)}
            />
          ))}
          {selectedAdvisers.map((v) => (
            <FilterChip
              key={`adv-${v}`}
              label="Form adviser"
              value={v}
              onClear={() => removeFilterValue(adviserColumn, selectedAdvisers, v)}
            />
          ))}
        </div>
      )}

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
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">
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
          {table.getFilteredRowModel().rows.length} of {visibleData.length} sheets
          {mine && currentUserId && (
            <span className="ml-2 opacity-70">· filtered to mine ({mineCount})</span>
          )}
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
                {[10, 20, 50, 100].map((n) => (
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

// Multi-select dropdown with checkbox items + count badge on the trigger
// + Clear footer. Used by Level / Subject / Term / Teacher / Form
// adviser filters — same shape, different facet sets.
function FacetDropdown({
  label,
  values,
  selected,
  onChange,
}: {
  label: string;
  values: string[];
  selected: string[];
  /** Pass `undefined` to clear the column filter, otherwise an array. */
  onChange: (next: string[] | undefined) => void;
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
      <DropdownMenuContent align="start" className="max-h-[60vh] w-56 overflow-y-auto">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider">
          Filter by {label.toLowerCase()}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {values.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No {label.toLowerCase()} values
          </div>
        )}
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
                onChange(current.size === 0 ? undefined : Array.from(current));
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
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={() => onChange(undefined)}>
                Clear
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Individual active-filter chip — renders `<Label>: <value>` with a
// dismiss `×`. Click removes only that one value; other filters stay
// applied.
function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <Badge
      variant="outline"
      className="h-7 gap-1.5 pl-2.5 pr-1 font-mono text-[11px] tracking-tight">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${label} filter ${value}`}
        className="ml-0.5 inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        <X className="size-3" />
      </button>
    </Badge>
  );
}
