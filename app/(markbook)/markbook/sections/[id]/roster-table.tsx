'use client';

import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';

export type RosterRow = {
  id: string;
  /** UUID from `public.students.id` — drives the per-student report-card
   *  link (the markbook surface for this student's grades). Null when
   *  the enrolment row references a student record that's been deleted
   *  or was never synced from admissions. */
  student_id: string | null;
  index_number: number;
  /** Stable cross-year identifier per Hard Rule #4 — used for the Records
   *  deep-link per KD #81. */
  student_number: string;
  student_name: string;
  enrollment_status: 'active' | 'late_enrollee' | 'withdrawn';
  bus_no: string | null;
  classroom_officer_role: string | null;
  /** ISO date string — hidden by default; shown via Columns toggle. */
  enrollment_date?: string | null;
  /** ISO date string — hidden by default; shown via Columns toggle. */
  withdrawal_date?: string | null;
};

const STATUS_TABS: StatusTabConfig<RosterRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'active',
    label: 'Active',
    predicate: (r) => r.enrollment_status === 'active',
  },
  {
    value: 'late',
    label: 'Late',
    predicate: (r) => r.enrollment_status === 'late_enrollee',
  },
  {
    value: 'withdrawn',
    label: 'Withdrawn',
    predicate: (r) => r.enrollment_status === 'withdrawn',
  },
];

function buildColumns(sectionId: string): ColumnDef<RosterRow>[] {
  return [
    {
      accessorKey: 'index_number',
      header: ({ column }) => (
        <SortableHeader column={column}>#</SortableHeader>
      ),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-muted-foreground">
          {row.original.index_number}
        </span>
      ),
    },
    {
      accessorKey: 'student_number',
      header: 'Student number',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.student_number || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'student_name',
      header: ({ column }) => (
        <SortableHeader column={column}>Name</SortableHeader>
      ),
      cell: ({ row }) => {
        const withdrawn = row.original.enrollment_status === 'withdrawn';
        if (withdrawn) {
          return (
            <span className="font-medium line-through text-muted-foreground">
              {row.original.student_name}
            </span>
          );
        }
        return (
          <IdentifierLink
            href={`/records/students/${row.original.student_number}`}
          >
            {row.original.student_name}
          </IdentifierLink>
        );
      },
    },
    {
      accessorKey: 'enrollment_status',
      header: 'Status',
      cell: ({ row }) => (
        <EnrollmentStatusBadge status={row.original.enrollment_status} />
      ),
    },
    {
      id: 'metadata',
      header: 'Bus · Officer',
      cell: ({ row }) => {
        const { bus_no, classroom_officer_role } = row.original;
        if (!bus_no && !classroom_officer_role) {
          return (
            <span className="font-mono text-[11px] text-muted-foreground">
              —
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
            {bus_no && (
              <span
                title="Bus number"
                className="rounded bg-muted/60 px-1.5 py-0.5"
              >
                Bus {bus_no}
              </span>
            )}
            {classroom_officer_role && (
              <span
                title="Classroom officer role"
                className="rounded bg-muted/60 px-1.5 py-0.5"
              >
                {classroom_officer_role}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'enrollment_date',
      header: 'Enrolled',
      cell: ({ row }) => {
        const d = row.original.enrollment_date;
        if (!d) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(d).toLocaleDateString('en-SG', { dateStyle: 'medium' })}
          </span>
        );
      },
    },
    {
      accessorKey: 'withdrawal_date',
      header: 'Withdrawn',
      cell: ({ row }) => {
        const d = row.original.withdrawal_date;
        if (!d) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(d).toLocaleDateString('en-SG', { dateStyle: 'medium' })}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {row.original.student_id && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
            >
              <Link
                href={`/markbook/report-cards/${row.original.student_id}`}
                title={`Open ${row.original.student_name}'s report card`}
              >
                <BookOpen className="size-3" />
                <span>Grades</span>
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ];
}

export function RosterTable({
  data,
  sectionId,
}: {
  data: RosterRow[];
  sectionId: string;
}) {
  const columns = buildColumns(sectionId);

  return (
    <DataTable<RosterRow>
      data={data}
      columns={columns}
      getRowId={(row) => row.id}
      searchKeys={[
        'student_name',
        'student_number',
        (r) => String(r.index_number),
      ]}
      searchPlaceholder="Search name, student number, index…"
      statusTabs={STATUS_TABS}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'roster' }}
      initialSort={[{ id: 'index_number', desc: false }]}
      initialColumnVisibility={{
        enrollment_date: false,
        withdrawal_date: false,
      }}
      pageSize={25}
      pageSizeOptions={[10, 25, 50]}
      emptyState={{ title: 'No students enrolled yet.' }}
      emptyFilteredState={{ title: 'No students match the current filter.' }}
    />
  );
}
