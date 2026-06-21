'use client';

import { ArrowUpRight, GraduationCap, UserX } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import {
  AssignSectionDialog,
  type AssignableSection,
} from '@/components/sis/assign-section-dialog';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type {
  UnsyncedGapReason,
  UnsyncedStudentRow,
} from '@/lib/sis/unsynced-students';

// ──────────────────────────────────────────────────────────────────────────
// Queue surface at /records/unsynced. Lists enrolled students whose
// admissions row hasn't crossed over into the grading schema yet — a
// per-row "what's wrong" + per-row CTA pattern, NOT a triage flow.
//
// Action per gap reason:
//   no_class_section  → "Assign section" opens <AssignSectionDialog> with
//                        the pre-fetched sections at the student's level.
//   not_synced        → Same "Assign section" entry point — re-running the
//                        per-row sync is what the dialog effectively does
//                        once the section is confirmed (the API route
//                        is idempotent for the already-assigned case).
//   no_student_number → No action button (Directus must issue the number
//                        first); the registrar can still pivot via the
//                        "Open in admissions" link to see the apps row.
// ──────────────────────────────────────────────────────────────────────────

type Props = {
  rows: UnsyncedStudentRow[];
  ayCode: string;
  sectionsByLevel: Record<string, AssignableSection[]>;
};

const GAP_COPY: Record<UnsyncedGapReason, string> = {
  no_class_section: 'No class section assigned',
  no_student_number: 'No student number yet',
  not_synced: 'Not yet synced to grading',
};

const STATUS_TABS: StatusTabConfig<UnsyncedStudentRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'no_class_section',
    label: 'No class section assigned',
    predicate: (r) => r.gapReason === 'no_class_section',
  },
  {
    value: 'no_student_number',
    label: 'No student number yet',
    predicate: (r) => r.gapReason === 'no_student_number',
  },
  {
    value: 'not_synced',
    label: 'Not yet synced to grading',
    predicate: (r) => r.gapReason === 'not_synced',
  },
];

function fullNameOf(row: UnsyncedStudentRow): string {
  if (row.enroleeFullName && row.enroleeFullName.trim().length > 0) {
    return row.enroleeFullName.trim();
  }
  const parts = [row.lastName, row.firstName, row.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : row.enroleeNumber;
}

export function UnsyncedStudentsQueue({
  rows,
  ayCode,
  sectionsByLevel,
}: Props) {
  const [dialogRow, setDialogRow] = React.useState<UnsyncedStudentRow | null>(
    null
  );

  const columns = React.useMemo<ColumnDef<UnsyncedStudentRow>[]>(
    () => [
      {
        accessorKey: 'enroleeFullName',
        header: 'Student',
        cell: ({ row }) => {
          const name = fullNameOf(row.original);
          const studentNumber = row.original.studentNumber;
          return (
            <div className="space-y-0.5">
              {studentNumber ? (
                <IdentifierLink
                  href={`/records/students/${encodeURIComponent(studentNumber)}`}
                >
                  {name}
                </IdentifierLink>
              ) : (
                <span className="font-medium text-foreground">{name}</span>
              )}
              <div className="font-mono text-[10px] text-muted-foreground">
                {row.original.enroleeNumber}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'studentNumber',
        header: 'Student #',
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.studentNumber ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'levelApplied',
        header: 'Level',
        cell: ({ row }) => row.original.levelApplied ?? '—',
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
        header: 'Status',
        cell: ({ row }) => (
          <ApplicationStatusBadge status={row.original.applicationStatus} />
        ),
      },
      {
        accessorKey: 'gapReason',
        header: "What's missing",
        cell: ({ row }) => (
          <span className="text-sm text-foreground">
            {GAP_COPY[row.original.gapReason]}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const canAssign =
            row.original.gapReason === 'no_class_section' ||
            row.original.gapReason === 'not_synced';
          return (
            <div className="flex items-center justify-end gap-2">
              {canAssign && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setDialogRow(row.original)}
                >
                  <GraduationCap className="size-3.5" />
                  Assign section
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link
                  href={`/admissions/applications/${encodeURIComponent(row.original.enroleeNumber)}?ay=${encodeURIComponent(ayCode)}`}
                >
                  Open in admissions
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          );
        },
      },
    ],
    [ayCode]
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.enroleeNumber}
        searchKeys={[
          (r) => fullNameOf(r),
          (r) => r.enroleeNumber,
          (r) => r.studentNumber ?? '',
          (r) => r.levelApplied ?? '',
        ]}
        searchPlaceholder="Search by name, student number, or level…"
        statusTabs={STATUS_TABS}
        facets={[{ columnId: 'levelApplied', label: 'Level' }]}
        url={{ enabled: true, namespace: 'unsynced' }}
        initialSort={[{ id: 'enroleeFullName', desc: false }]}
        emptyState={{
          icon: UserX,
          title: 'Everyone is set up',
          body: 'No enrolled students are waiting for a class section. New gaps will appear here as admissions rows are added.',
        }}
        emptyFilteredState={{
          title: 'No matches',
          body: 'Try clearing the search.',
        }}
      />
      {dialogRow && (
        <AssignSectionDialog
          enroleeNumber={dialogRow.enroleeNumber}
          ayCode={ayCode}
          levelApplied={dialogRow.levelApplied}
          studentName={fullNameOf(dialogRow)}
          availableSections={
            sectionsByLevel[dialogRow.levelApplied ?? ''] ?? []
          }
          open={true}
          onOpenChange={(open) => {
            if (!open) setDialogRow(null);
          }}
        />
      )}
    </>
  );
}
