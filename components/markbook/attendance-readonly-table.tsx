'use client';

import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';

import { DataTable, RowActionsMenu } from '@/components/ui/data-table';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';

export type ReadOnlyRow = {
  enrolmentId: string;
  indexNumber: number;
  studentNumber: string;
  studentName: string;
  withdrawn: boolean;
  /** Set to true when enrollment_status === 'late_enrollee'. */
  lateEnrollee?: boolean;
  schoolDays: number | null;
  daysPresent: number | null;
  daysLate: number | null;
  daysExcused: number | null;
  daysAbsent: number | null;
  attendancePct: number | null;
};

// Derived status string for the facet column — not rendered, only filtered.
type AugmentedRow = ReadOnlyRow & { _status: 'active' | 'late' | 'withdrawn' };

function fmt(n: number | null): string {
  return n == null ? '—' : n.toLocaleString('en-SG');
}

// Enrollment status as the primary tab dimension (consistent with the sibling
// roster tables) — was previously a hidden facet column.
const STATUS_TABS: StatusTabConfig<AugmentedRow>[] = [
  { value: 'all', label: 'All', isDefault: true, predicate: () => true },
  {
    value: 'active',
    label: 'Active',
    predicate: (r) => r._status === 'active',
  },
  { value: 'late', label: 'Late', predicate: (r) => r._status === 'late' },
  {
    value: 'withdrawn',
    label: 'Withdrawn',
    predicate: (r) => r._status === 'withdrawn',
  },
];

const COLUMNS: ColumnDef<AugmentedRow>[] = [
  {
    accessorKey: 'indexNumber',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        #
      </SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="block text-right font-mono tabular-nums text-muted-foreground">
        {row.original.indexNumber}
      </span>
    ),
  },
  {
    accessorKey: 'studentName',
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    cell: ({ row }) => {
      const { studentName, studentNumber, withdrawn, lateEnrollee } =
        row.original;
      return (
        <div>
          <div
            className={
              withdrawn ? 'line-through text-muted-foreground' : undefined
            }
          >
            {withdrawn ? (
              <span className="font-medium text-muted-foreground">
                {studentName}
              </span>
            ) : (
              <IdentifierLink href={`/attendance/students/${studentNumber}`}>
                {studentName}
              </IdentifierLink>
            )}
            {!withdrawn && lateEnrollee && (
              <span className="ml-2 inline-flex">
                <EnrollmentStatusBadge status="late_enrollee" />
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {studentNumber}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: 'schoolDays',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        School days
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const unmarked = row.original.schoolDays == null;
      if (unmarked) {
        return (
          <span className="inline-flex items-center rounded-md border border-dashed border-border bg-muted/30 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Unmarked
          </span>
        );
      }
      return (
        <span className="block text-right font-mono tabular-nums">
          {fmt(row.original.schoolDays)}
        </span>
      );
    },
    sortingFn: (a, b) =>
      (a.original.schoolDays ?? -1) - (b.original.schoolDays ?? -1),
  },
  {
    accessorKey: 'daysPresent',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Present
      </SortableHeader>
    ),
    cell: ({ row }) =>
      row.original.schoolDays == null ? null : (
        <span className="block text-right font-mono tabular-nums">
          {fmt(row.original.daysPresent)}
        </span>
      ),
  },
  {
    accessorKey: 'daysLate',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Late
      </SortableHeader>
    ),
    cell: ({ row }) =>
      row.original.schoolDays == null ? null : (
        <span className="block text-right font-mono tabular-nums">
          {fmt(row.original.daysLate)}
        </span>
      ),
  },
  {
    accessorKey: 'daysExcused',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Excused
      </SortableHeader>
    ),
    cell: ({ row }) =>
      row.original.schoolDays == null ? null : (
        <span className="block text-right font-mono tabular-nums">
          {fmt(row.original.daysExcused)}
        </span>
      ),
  },
  {
    accessorKey: 'daysAbsent',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Absent
      </SortableHeader>
    ),
    cell: ({ row }) =>
      row.original.schoolDays == null ? null : (
        <span className="block text-right font-mono tabular-nums">
          {fmt(row.original.daysAbsent)}
        </span>
      ),
  },
  {
    accessorKey: 'attendancePct',
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        %
      </SortableHeader>
    ),
    cell: ({ row }) =>
      row.original.schoolDays == null ? null : (
        <span className="block text-right font-mono tabular-nums font-semibold">
          {row.original.attendancePct != null
            ? `${row.original.attendancePct.toFixed(1)}%`
            : '—'}
        </span>
      ),
    sortingFn: (a, b) =>
      (a.original.attendancePct ?? -1) - (b.original.attendancePct ?? -1),
  },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const { studentNumber, withdrawn } = row.original;
      // Withdrawn rows and rows without a studentNumber have no cross-module destination.
      if (withdrawn || !studentNumber) return null;
      return (
        <RowActionsMenu>
          <DropdownMenuItem asChild>
            <Link href={`/records/students/${studentNumber}`}>
              <BookOpen className="size-3.5" />
              Open in Records
            </Link>
          </DropdownMenuItem>
        </RowActionsMenu>
      );
    },
  },
];

// Read-only per-student attendance table for /markbook/sections/[id]/attendance.
// All data is written by the Attendance module (KD #47 sole-writer contract);
// this component only renders. Empty rows (no daily marks yet for this term)
// show a subdued "Unmarked" chip instead of zeros, to distinguish "nobody
// marked it" from "marked, all zero".
export function AttendanceReadOnlyTable({ rows }: { rows: ReadOnlyRow[] }) {
  const augmented = React.useMemo<AugmentedRow[]>(
    () =>
      rows.map((r) => ({
        ...r,
        _status: r.withdrawn ? 'withdrawn' : r.lateEnrollee ? 'late' : 'active',
      })),
    [rows]
  );

  return (
    <DataTable<AugmentedRow>
      data={augmented}
      columns={COLUMNS}
      getRowId={(row) => row.enrolmentId}
      searchKeys={['studentName', 'studentNumber']}
      searchPlaceholder="Search student…"
      statusTabs={STATUS_TABS}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'attn' }}
      initialSort={[{ id: 'indexNumber', desc: false }]}
      pageSize={50}
      hidePagination
      emptyState={{
        title: 'No students enrolled.',
        body: 'Sync from admissions or add a student to this section first.',
      }}
      emptyFilteredState={{
        title: 'No students match the current filters.',
        body: 'Try clearing the filters.',
      }}
    />
  );
}
