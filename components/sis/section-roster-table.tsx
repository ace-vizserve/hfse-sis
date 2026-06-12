'use client';

import * as React from 'react';
import { ArrowRightLeft, Pencil, Users } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import Link from 'next/link';

import { DataTable } from '@/components/ui/data-table';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { Button } from '@/components/ui/button';

import { EnrolmentEditSheet } from '@/components/sis/enrolment-edit-sheet';
import {
  SectionTransferDialog,
  type SiblingSection,
} from '@/components/sis/section-transfer-dialog';

export type SectionRosterRow = {
  enrolmentId: string;
  indexNumber: number;
  studentName: string;
  studentNumber: string;
  enroleeNumber: string | null; // null when admissions row missing — Move disabled
  enrollmentStatus: 'active' | 'late_enrollee' | 'withdrawn';
  busNo?: string | null;
  classroomOfficerRole?: string | null;
  withdrawalReason?: string | null;
  withdrawalNotes?: string | null;
  lateEnrolleTermNumber?: number | null;
  // Optional date fields — promoted to hidden-by-default columns (KD #68 pattern).
  // Pages that query enrollment_date + withdrawal_date from section_students
  // can pass them; components that don't will see "—" in those columns.
  enrollment_date?: string | null;
  withdrawal_date?: string | null;
  // termJoined is resolved server-side via lib/sis/terms.ts::getTermForDate.
  // TODO: wire once the page passes it; for now left undefined → "—" in column.
  termJoined?: string | null;
};

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.replace(/-/g, '/'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function SectionRosterTable({
  rows,
  ayCode,
  sectionName,
  sectionId,
  siblings,
}: {
  rows: SectionRosterRow[];
  ayCode: string;
  sectionName: string;
  sectionId: string;
  siblings: SiblingSection[];
}) {
  const columns: ColumnDef<SectionRosterRow>[] = React.useMemo(
    () => [
      {
        id: 'indexNumber',
        accessorKey: 'indexNumber',
        header: '#',
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.indexNumber}
          </span>
        ),
        enableSorting: true,
        enableHiding: false,
      },
      {
        id: 'studentName',
        accessorKey: 'studentName',
        header: 'Student',
        cell: ({ row }) => {
          const r = row.original;
          // Link to records detail page via studentNumber (KD #81).
          const nameEl = (
            <div className="flex flex-col">
              {r.enrollmentStatus === 'withdrawn' ? (
                <span className="font-medium line-through text-muted-foreground">
                  {r.studentName}
                </span>
              ) : (
                <Link
                  href={`/records/students/${encodeURIComponent(r.studentNumber)}`}
                  className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
                >
                  {r.studentName}
                </Link>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                {r.studentNumber}
              </span>
            </div>
          );
          return nameEl;
        },
        enableHiding: false,
      },
      {
        id: 'enrollmentStatus',
        accessorKey: 'enrollmentStatus',
        header: 'Status',
        cell: ({ row }) => (
          <EnrollmentStatusBadge status={row.original.enrollmentStatus} />
        ),
        filterFn: (row, _id, value) => {
          if (!value || (Array.isArray(value) && value.length === 0))
            return true;
          return Array.isArray(value)
            ? value.includes(row.original.enrollmentStatus)
            : row.original.enrollmentStatus === value;
        },
      },
      {
        // enrollment_date: hidden-by-default, promoted per spec
        id: 'enrollment_date',
        accessorKey: 'enrollment_date',
        // This is the class-start date (when the student begins attending),
        // NOT the admissions enrolment date — label it honestly for late
        // enrollees (KD #68/#117).
        header: 'Starts class on',
        cell: ({ row }) => {
          const d = formatDate(row.original.enrollment_date);
          return d ? (
            <span className="font-mono text-[11px] tabular-nums text-foreground">
              {d}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        enableSorting: true,
      },
      {
        // withdrawal_date: hidden-by-default, promoted per spec
        id: 'withdrawal_date',
        accessorKey: 'withdrawal_date',
        header: 'Withdrawn on',
        cell: ({ row }) => {
          const d = formatDate(row.original.withdrawal_date);
          return d ? (
            <span className="font-mono text-[11px] tabular-nums text-foreground">
              {d}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        enableSorting: true,
      },
      {
        // termJoined: hidden-by-default (KD #68 pattern — requires server-side
        // lib/sis/terms.ts::getTermForDate; page passes it once wired)
        id: 'termJoined',
        accessorKey: 'termJoined',
        header: 'Term joined',
        cell: ({ row }) =>
          row.original.termJoined ? (
            <span className="text-sm text-foreground">
              {row.original.termJoined}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        enableSorting: true,
      },
      {
        id: 'action',
        header: '',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              <EnrolmentEditSheet
                sectionId={sectionId}
                enrolmentId={r.enrolmentId}
                ayCode={ayCode}
                studentName={r.studentName}
                indexNumber={r.indexNumber}
                initial={{
                  bus_no: r.busNo ?? null,
                  classroom_officer_role: r.classroomOfficerRole ?? null,
                  enrollment_status: r.enrollmentStatus,
                  withdrawal_reason: r.withdrawalReason ?? null,
                  withdrawal_notes: r.withdrawalNotes ?? null,
                  late_enrollee_term_number: r.lateEnrolleTermNumber ?? null,
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  title="Edit enrolment details"
                >
                  <Pencil className="size-3" />
                  <span className="sr-only">Edit enrolment</span>
                </Button>
              </EnrolmentEditSheet>
              {r.enrollmentStatus !== 'withdrawn' && r.enroleeNumber && (
                <SectionTransferDialog
                  enroleeNumber={r.enroleeNumber}
                  studentName={r.studentName}
                  fromSectionName={sectionName}
                  ayCode={ayCode}
                  siblings={siblings}
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      <ArrowRightLeft className="size-3" />
                      Move
                    </Button>
                  }
                />
              )}
            </div>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [ayCode, sectionId, sectionName, siblings]
  );

  const statusTabs = [
    {
      value: 'active',
      label: 'Active',
      isDefault: true,
      predicate: (r: SectionRosterRow) => r.enrollmentStatus === 'active',
    },
    {
      value: 'late_enrollee',
      label: 'Late',
      predicate: (r: SectionRosterRow) =>
        r.enrollmentStatus === 'late_enrollee',
    },
    {
      value: 'withdrawn',
      label: 'Withdrawn',
      predicate: (r: SectionRosterRow) => r.enrollmentStatus === 'withdrawn',
    },
    {
      value: 'all',
      label: 'All',
      predicate: () => true,
    },
  ];

  return (
    <DataTable<SectionRosterRow>
      data={rows}
      columns={columns}
      getRowId={(row) => row.enrolmentId}
      searchKeys={['studentName', 'studentNumber']}
      searchPlaceholder="Search student…"
      statusTabs={statusTabs}
      // Namespaced url-state so filters persist + are shareable; leaves the page's own params untouched (KD #84)
      url={{ enabled: true, namespace: 'roster' }}
      initialSort={[{ id: 'indexNumber', desc: false }]}
      initialColumnVisibility={{
        enrollment_date: false,
        withdrawal_date: false,
        termJoined: false,
      }}
      hidePagination={true}
      emptyState={{
        icon: Users,
        title: 'No students in this section.',
      }}
      emptyFilteredState={{
        title: 'No students match.',
        body: 'Try a different tab or clear the search.',
      }}
    />
  );
}
