'use client';

import * as React from 'react';
import { Users } from 'lucide-react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';

import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { StalenessBadge } from '@/components/admissions/staleness-badge';
import type { EnrollmentStatus } from '@/components/ui/enrollment-status-badge';
import type { StudentListRow } from '@/lib/sis/queries';
import {
  STALENESS_ORDER,
  daysSinceUpdate,
  stalenessLabel,
  stalenessRank,
  type StalenessLabel,
} from '@/lib/admissions/staleness';
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  type ApplicationTerminalReason,
} from '@/lib/schemas/sis';

// ─── Bucket types ───────────────────────────────────────────────────────────

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
  // Matches against enrollmentStatus (active | late_enrollee | withdrawn).
  // Serializable alternative to `predicate` — safe to pass from RSC props.
  enrollmentStatuses?: string[];
  // Client-only: overrides statuses + enrollmentStatuses. Only usable when
  // the StatusBucketDef is constructed inside a Client Component, never via
  // RSC props (functions are not serializable across the RSC boundary).
  predicate?: (row: StudentListRow) => boolean;
};

const DEFAULT_STATUS_BUCKETS: StatusBucketDef[] = [
  { key: 'all', label: 'All' },
  {
    key: 'enrolled',
    label: 'Enrolled',
    statuses: ['Enrolled', 'Enrolled (Conditional)'],
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    statuses: ['Submitted', 'Ongoing Verification', 'Processing'],
  },
  {
    key: 'withdrawn',
    label: 'Withdrawn',
    statuses: ['Withdrawn', 'Cancelled'],
  },
];

function bucketMatchesRow(def: StatusBucketDef, row: StudentListRow): boolean {
  if (def.predicate) return def.predicate(row);
  if (def.enrollmentStatuses)
    return def.enrollmentStatuses.includes((row.enrollmentStatus ?? '').trim());
  if (!def.statuses) return true;
  return def.statuses.includes((row.applicationStatus ?? '').trim());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function studentDisplayName(row: StudentListRow): string {
  if (row.enroleeFullName) return row.enroleeFullName;
  const parts = [row.lastName, row.firstName, row.middleName].filter(Boolean);
  return parts.length ? parts.join(' ') : '(no name on file)';
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

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
  ayCode,
  linkBase = '/admissions/applications',
  linkAttribute = 'enroleeNumber',
  linkQuery,
  defaultSorting,
  showSubmittedColumn = false,
  showReasonColumn = false,
  showIndex = false,
  showStaleness = false,
  statusBuckets = DEFAULT_STATUS_BUCKETS,
}: {
  data: StudentListRow[];
  ayCode?: string;
  linkBase?: string;
  linkAttribute?: 'enroleeNumber' | 'studentNumber';
  linkQuery?: Record<string, string>;
  defaultSorting?: SortingState;
  showSubmittedColumn?: boolean;
  showReasonColumn?: boolean;
  /** When true, prepends a compact # column showing the student's active
   *  section index number (section_students.index_number). Only pass this
   *  from the Records student directory — Admissions callers omit it so
   *  applicants without section assignments don't see an empty column. */
  showIndex?: boolean;
  /** When true, adds a "Staleness" badge column + facet derived from
   *  applicationUpdatedDate (Fresh / Warning / Critical / Never updated). Only
   *  pass from the active Admissions applications list — staleness is a
   *  pre-enrolment follow-up signal, not meaningful for enrolled/closed rows. */
  showStaleness?: boolean;
  statusBuckets?: StatusBucketDef[];
}) {
  const querySuffix = React.useMemo(() => {
    if (!linkQuery) return '';
    const entries = Object.entries(linkQuery).filter(([, v]) => v);
    if (entries.length === 0) return '';
    const params = new URLSearchParams(entries);
    return `?${params.toString()}`;
  }, [linkQuery]);

  const columns: ColumnDef<StudentListRow>[] = React.useMemo(
    () => [
      ...(showIndex
        ? [
            {
              accessorFn: (row: StudentListRow) => row.indexNumber ?? null,
              id: 'indexNumber',
              header: '#',
              cell: ({ row }: { row: { original: StudentListRow } }) =>
                row.original.indexNumber != null ? (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {row.original.indexNumber}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              enableHiding: false,
              size: 48,
            } satisfies ColumnDef<StudentListRow>,
          ]
        : []),
      {
        accessorFn: (row) => studentDisplayName(row),
        id: 'name',
        header: ({ column }) => (
          <SortableHeader column={column}>Name</SortableHeader>
        ),
        cell: ({ row }) => {
          const linkId =
            linkAttribute === 'studentNumber'
              ? (row.original.studentNumber ?? row.original.enroleeNumber)
              : row.original.enroleeNumber;
          return (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <IdentifierLink href={`${linkBase}/${linkId}${querySuffix}`}>
                  {studentDisplayName(row.original)}
                </IdentifierLink>
                {row.original.enrollmentStatus === 'late_enrollee' && (
                  <EnrollmentStatusBadge
                    status={'late_enrollee' as EnrollmentStatus}
                  />
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {row.original.studentNumber ?? row.original.enroleeNumber}
              </div>
            </div>
          );
        },
        enableHiding: false,
      },
      {
        accessorKey: 'studentNumber',
        id: 'studentNumber',
        header: 'Student ID',
        cell: ({ row }) =>
          row.original.studentNumber ? (
            <span className="font-mono text-xs tabular-nums text-foreground">
              {row.original.studentNumber}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        // Applicant Number is hidden-by-default — Hard Rule #4 risk.
        // Available via column visibility toggle, NOT removed.
        accessorKey: 'enroleeNumber',
        id: 'enroleeNumber',
        header: 'Applicant Number',
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.enroleeNumber}
          </span>
        ),
      },
      {
        accessorFn: (row) => row.classLevel ?? row.levelApplied ?? '',
        id: 'level',
        header: 'Level',
        cell: ({ row }) => {
          const lvl = row.original.classLevel ?? row.original.levelApplied;
          return lvl ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {lvl}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'classSection',
        id: 'section',
        header: 'Section',
        cell: ({ row }) =>
          row.original.classSection ? (
            <span className="text-foreground">{row.original.classSection}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        filterFn: (row, id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.getValue(id))
            : row.getValue(id) === value;
        },
      },
      {
        accessorKey: 'applicationStatus',
        id: 'applicationStatus',
        header: 'Status',
        cell: ({ row }) => (
          <ApplicationStatusBadge status={row.original.applicationStatus} />
        ),
        enableHiding: false,
      },
      ...(showStaleness
        ? [
            {
              // Derived tier label (used as the facet vocabulary + sort key);
              // the cell renders the day-count badge from the same source.
              id: 'staleness',
              accessorFn: (row: StudentListRow) =>
                stalenessLabel(daysSinceUpdate(row.applicationUpdatedDate)),
              header: ({ column }) => (
                <SortableHeader column={column}>Staleness</SortableHeader>
              ),
              cell: ({ row }: { row: { original: StudentListRow } }) => (
                <StalenessBadge
                  days={daysSinceUpdate(row.original.applicationUpdatedDate)}
                />
              ),
              filterFn: (
                row: { getValue: (id: string) => unknown },
                id: string,
                value: unknown
              ) => {
                if (!value || (Array.isArray(value) && value.length === 0))
                  return true;
                return Array.isArray(value)
                  ? value.includes(row.getValue(id))
                  : row.getValue(id) === value;
              },
              sortingFn: (
                a: { getValue: (id: string) => unknown },
                b: { getValue: (id: string) => unknown }
              ) =>
                stalenessRank(a.getValue('staleness') as StalenessLabel) -
                stalenessRank(b.getValue('staleness') as StalenessLabel),
            } satisfies ColumnDef<StudentListRow>,
          ]
        : []),
      ...(showSubmittedColumn
        ? [
            {
              accessorKey: 'created_at',
              id: 'submitted',
              sortingFn: 'datetime',
              header: ({ column }) => (
                <SortableHeader column={column}>Submitted</SortableHeader>
              ),
              cell: ({ row }) => {
                const formatted = formatDate(row.original.created_at);
                return formatted ? (
                  <span className="font-mono text-[11px] tabular-nums text-foreground">
                    {formatted}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                );
              },
            } satisfies ColumnDef<StudentListRow>,
          ]
        : []),
      ...(showReasonColumn
        ? [
            {
              id: 'terminalReason',
              header: 'Reason',
              cell: ({ row }) => {
                const raw = row.original.applicationTerminalReason as
                  | string
                  | null;
                const label: string | null =
                  raw !== null && raw in APPLICATION_TERMINAL_REASON_LABELS
                    ? APPLICATION_TERMINAL_REASON_LABELS[
                        raw as ApplicationTerminalReason
                      ]
                    : (raw ?? null);
                const notes = row.original.applicationTerminalNotes as
                  | string
                  | null;
                if (!label)
                  return (
                    <span className="text-sm text-muted-foreground">—</span>
                  );
                return (
                  <div>
                    <span className="text-sm">{label}</span>
                    {notes && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {notes}
                      </p>
                    )}
                  </div>
                );
              },
            } satisfies ColumnDef<StudentListRow>,
          ]
        : []),
      {
        // Last updated — hidden-by-default, now sortable (nulls sort last)
        accessorKey: 'applicationUpdatedDate',
        id: 'lastUpdated',
        header: ({ column }) => (
          <SortableHeader column={column}>Last updated</SortableHeader>
        ),
        sortingFn: (a, b) => {
          const av = a.original.applicationUpdatedDate ?? null;
          const bv = b.original.applicationUpdatedDate ?? null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av < bv ? -1 : av > bv ? 1 : 0;
        },
        cell: ({ row }) => {
          const formatted = formatDate(
            row.original.applicationUpdatedDate ?? null
          );
          return formatted ? (
            <span className="font-mono text-[11px] tabular-nums text-foreground">
              {formatted}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
    ],
    [
      linkBase,
      linkAttribute,
      querySuffix,
      showSubmittedColumn,
      showReasonColumn,
      showIndex,
      showStaleness,
    ]
  );

  const statusTabs = React.useMemo(
    () =>
      statusBuckets.map((def) => ({
        value: def.key,
        label: def.label,
        isDefault: def.key === statusBuckets[0]?.key,
        predicate: (row: StudentListRow) => bucketMatchesRow(def, row),
      })),
    [statusBuckets]
  );

  const initialColumnVisibility = React.useMemo(
    () => ({
      enroleeNumber: false,
      lastUpdated: false,
    }),
    []
  );

  return (
    <DataTable<StudentListRow>
      data={data}
      columns={columns}
      getRowId={(row) => row.enroleeNumber}
      searchKeys={[
        (row) => studentDisplayName(row),
        'studentNumber',
        'enroleeNumber',
        'classSection',
        'classLevel',
        'levelApplied',
      ]}
      searchPlaceholder="Search name, student #, enrolee #, section…"
      facets={[
        { columnId: 'level', label: 'Level' },
        { columnId: 'section', label: 'Section' },
        ...(showStaleness
          ? [
              {
                columnId: 'staleness',
                label: 'Staleness',
                valueOptions: [...STALENESS_ORDER],
              },
            ]
          : []),
      ]}
      statusTabs={statusTabs}
      // Namespaced so filters/search/tab persist + are shareable. 'students.*'
      // only — the page's own ?ay= (server-scope) is left untouched (KD #84).
      url={{ enabled: true, namespace: 'students' }}
      initialSort={
        defaultSorting ?? [
          { id: 'level', desc: false },
          { id: 'section', desc: false },
        ]
      }
      initialColumnVisibility={initialColumnVisibility}
      pageSize={25}
      csv={{ filename: `students-${ayCode ?? 'export'}.csv` }}
      emptyState={{
        icon: Users,
        title: 'No students in view.',
        body: 'Adjust the filters above or search across academic years for a returning student.',
      }}
      emptyFilteredState={{
        title: 'No students match.',
        body: 'Try clearing filters or adjusting the search.',
      }}
    />
  );
}
