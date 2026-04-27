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

// ─── Filter contract ───────────────────────────────────────────────────────
//
// Filter chips are tab-style (pick one). Each chip is a predicate over a row's
// flag set. "Multiple flags" matches any row with ≥ 2 flags; "Has paracetamol
// consent" matches `paracetamolConsent === true`; "No paracetamol consent"
// matches `=== false` (a parent who explicitly opted out — distinct from
// `null` "not answered"). The "Any flag" default is the no-op (cohort already
// requires ≥ 1 flag at the loader level).

export type MedicalFilter =
  | 'any'
  | 'allergies'
  | 'asthma'
  | 'multi'
  | 'paracetamolYes'
  | 'paracetamolNo';

const FILTER_TABS: Array<{ value: MedicalFilter; label: string }> = [
  { value: 'any', label: 'Any flag' },
  { value: 'allergies', label: 'Allergies' },
  { value: 'asthma', label: 'Asthma' },
  { value: 'multi', label: 'Multiple flags' },
  { value: 'paracetamolYes', label: 'Paracetamol: Yes' },
  { value: 'paracetamolNo', label: 'Paracetamol: No' },
];

function rowMatchesFilter(row: CohortStudentRow, filter: MedicalFilter): boolean {
  const flags = row.medicalFlags ?? [];
  switch (filter) {
    case 'any':
      return true;
    case 'allergies':
      return flags.includes('allergies') || flags.includes('foodAllergies');
    case 'asthma':
      return flags.includes('asthma');
    case 'multi':
      return flags.length >= 2;
    case 'paracetamolYes':
      return row.paracetamolConsent === true;
    case 'paracetamolNo':
      return row.paracetamolConsent === false;
  }
}

// ─── Detail link ───────────────────────────────────────────────────────────

function detailHref(row: CohortStudentRow, scope: CohortScope, ayCode: string): string {
  if (scope === 'enrolled' && row.studentNumber) {
    return `/records/students/${encodeURIComponent(row.studentNumber)}`;
  }
  const params = new URLSearchParams({ ay: ayCode, tab: 'lifecycle' });
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?${params.toString()}`;
}

// ─── Columns ────────────────────────────────────────────────────────────────

type MedicalColumnKey =
  | 'student'
  | 'levelApplied'
  | 'medicalFlags'
  | 'allergyDetails'
  | 'foodAllergyDetails'
  | 'otherMedicalConditions'
  | 'dietaryRestrictions'
  | 'paracetamolConsent'
  | 'applicationStatus';

const ALL_COLUMNS: MedicalColumnKey[] = [
  'student',
  'levelApplied',
  'medicalFlags',
  'allergyDetails',
  'foodAllergyDetails',
  'otherMedicalConditions',
  'dietaryRestrictions',
  'paracetamolConsent',
  'applicationStatus',
];

const COLUMN_LABELS: Record<MedicalColumnKey, string> = {
  student: 'Student',
  levelApplied: 'Level',
  medicalFlags: 'Flags',
  allergyDetails: 'Allergies',
  foodAllergyDetails: 'Food allergies',
  otherMedicalConditions: 'Other conditions',
  dietaryRestrictions: 'Dietary',
  paracetamolConsent: 'Paracetamol',
  applicationStatus: 'App status',
};

// Pretty-print the camelCase flag keys for the chip labels.
const FLAG_LABEL: Record<string, string> = {
  allergies: 'Allergies',
  asthma: 'Asthma',
  foodAllergies: 'Food allergies',
  heartConditions: 'Heart',
  epilepsy: 'Epilepsy',
  diabetes: 'Diabetes',
  eczema: 'Eczema',
  otherMedicalConditions: 'Other',
  dietaryRestrictions: 'Dietary',
};

function FlagChips({ flags }: { flags: string[] | undefined }) {
  if (!flags || flags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <ChartLegendChip key={f} color="very-stale" label={FLAG_LABEL[f] ?? f} />
      ))}
    </div>
  );
}

function TruncatedText({ value, max = 80 }: { value: string | null | undefined; max?: number }) {
  const s = (value ?? '').trim();
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const truncated = s.length > max ? `${s.slice(0, max)}…` : s;
  return (
    <span className="text-sm text-foreground" title={s}>
      {truncated}
    </span>
  );
}

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
      case 'medicalFlags':
        return {
          id: 'medicalFlags',
          accessorFn: (r) => r.medicalFlags?.length ?? 0,
          header,
          cell: ({ row }) => <FlagChips flags={row.original.medicalFlags} />,
          enableSorting: true,
        };
      case 'allergyDetails':
        return {
          id: 'allergyDetails',
          accessorKey: 'allergyDetails',
          header,
          cell: ({ row }) => <TruncatedText value={row.original.allergyDetails} />,
          enableSorting: false,
        };
      case 'foodAllergyDetails':
        return {
          id: 'foodAllergyDetails',
          accessorKey: 'foodAllergyDetails',
          header,
          cell: ({ row }) => <TruncatedText value={row.original.foodAllergyDetails} />,
          enableSorting: false,
        };
      case 'otherMedicalConditions':
        return {
          id: 'otherMedicalConditions',
          accessorKey: 'otherMedicalConditions',
          header,
          cell: ({ row }) => <TruncatedText value={row.original.otherMedicalConditions} />,
          enableSorting: false,
        };
      case 'dietaryRestrictions':
        return {
          id: 'dietaryRestrictions',
          accessorKey: 'dietaryRestrictions',
          header,
          cell: ({ row }) => <TruncatedText value={row.original.dietaryRestrictions} />,
          enableSorting: false,
        };
      case 'paracetamolConsent':
        return {
          id: 'paracetamolConsent',
          accessorFn: (r) =>
            r.paracetamolConsent === true ? 2 : r.paracetamolConsent === false ? 0 : 1,
          header,
          cell: ({ row }) => {
            if (row.original.paracetamolConsent === true) return <Badge variant="success">Yes</Badge>;
            if (row.original.paracetamolConsent === false) return <Badge variant="blocked">No</Badge>;
            return <Badge variant="outline">—</Badge>;
          },
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

export type MedicalCohortTableProps = {
  rows: CohortStudentRow[];
  scope: CohortScope;
  ayCode: string;
};

export function MedicalCohortTable({ rows, scope, ayCode }: MedicalCohortTableProps) {
  const [filter, setFilter] = React.useState<MedicalFilter>('any');
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
        <Tabs value={filter} onValueChange={(v) => setFilter(v as MedicalFilter)}>
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
