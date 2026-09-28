'use client';

import { ArrowUpRight, ListChecks } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { type StatusTabConfig } from '@/components/ui/data-table/types';
import { IdentifierLink } from '@/components/ui/identifier-link';
import type { EnrolledOpenStepsRow } from '@/lib/admissions/enrolled-open-steps';
import { ENROLLED_PREREQ_STAGES, STAGE_LABELS } from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Queue surface at /admissions/enrolled-open-steps. Children enrolled with
// "Enrol anyway" while prerequisite steps were still open — the chase list.
// Mirrors Records' "Students needing setup" (components/sis/
// unsynced-students-queue.tsx): one row per child, what is outstanding, and a
// way to the record that fixes it. Rows arrive sorted (most steps open, then
// longest enrolled — `compareEnrolledOpenSteps`), so no initial sort is set.
// ──────────────────────────────────────────────────────────────────────────

// One tab per step, so the person chasing fees sees only the fee chases.
const STATUS_TABS: StatusTabConfig<EnrolledOpenStepsRow>[] = [
  { value: 'all', label: 'All', predicate: () => true, isDefault: true },
  ...ENROLLED_PREREQ_STAGES.map((k) => ({
    value: k,
    label: STAGE_LABELS[k],
    predicate: (r: EnrolledOpenStepsRow) =>
      r.openSteps.includes(STAGE_LABELS[k]),
  })),
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function applicationHref(row: EnrolledOpenStepsRow): string {
  return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}?ay=${encodeURIComponent(row.ayCode)}&tab=enrollment`;
}

export function EnrolledOpenStepsQueue({
  rows,
}: {
  rows: EnrolledOpenStepsRow[];
}) {
  const columns = React.useMemo<ColumnDef<EnrolledOpenStepsRow>[]>(
    () => [
      {
        accessorKey: 'studentName',
        header: 'Student',
        cell: ({ row }) => (
          <IdentifierLink href={applicationHref(row.original)}>
            {row.original.studentName}
          </IdentifierLink>
        ),
      },
      {
        accessorKey: 'enroleeNumber',
        header: 'Enrolee #',
        meta: { label: 'Enrolee number' },
        cell: ({ row }) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {row.original.enroleeNumber}
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
        accessorKey: 'classLabel',
        header: 'Class',
        cell: ({ row }) =>
          row.original.classLabel ? (
            <span className="text-sm text-foreground">
              {row.original.classLabel}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No class yet</span>
          ),
      },
      {
        id: 'openSteps',
        // The CSV and the search read the plain words; the sort reads how many.
        accessorFn: (r) => r.openSteps.join(', '),
        header: ({ column }) => (
          <SortableHeader column={column}>Steps still open</SortableHeader>
        ),
        meta: { label: 'Steps still open' },
        sortingFn: (a, b) =>
          a.original.openSteps.length - b.original.openSteps.length,
        cell: ({ row }) => (
          <div className="flex max-w-xs flex-wrap gap-1.5">
            {row.original.openSteps.map((step) => (
              <span
                key={step}
                className="inline-flex h-6 items-center rounded-md border border-brand-amber/45 bg-brand-amber/10 px-2 text-xs font-medium text-foreground"
              >
                {step}
              </span>
            ))}
          </div>
        ),
      },
      {
        id: 'enrolledOn',
        accessorFn: (r) => r.enrolledOn ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>Enrolled on</SortableHeader>
        ),
        meta: { label: 'Enrolled on' },
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="text-sm tabular-nums text-foreground">
              {row.original.enrolledOn
                ? formatDate(row.original.enrolledOn)
                : '—'}
              {/* No enrolment stamp on this row — the date is when the
                  application was last updated, which may be later. */}
              {row.original.enrolledOn && !row.original.enrolledOnExact && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  last update
                </span>
              )}
            </div>
            {row.original.enrolledBy && (
              <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                by {row.original.enrolledBy}
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end">
            <Button size="sm" variant="outline" asChild>
              <Link href={applicationHref(row.original)}>
                Open application
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.enroleeNumber}
      searchKeys={[
        (r) => r.studentName,
        (r) => r.enroleeNumber,
        (r) => r.studentNumber ?? '',
        (r) => r.levelApplied ?? '',
      ]}
      searchPlaceholder="Search by name, enrolee number, or level…"
      statusTabs={STATUS_TABS}
      facets={[{ columnId: 'levelApplied', label: 'Level' }]}
      url={{ enabled: true, namespace: 'enrolled-open' }}
      emptyState={{
        icon: ListChecks,
        title: 'Nothing to chase',
        body: 'Every enrolled child this year has finished their steps. Anyone enrolled before their steps are done will appear here.',
      }}
      emptyFilteredState={{
        title: 'No matches',
        body: 'Try another tab or clear the search.',
      }}
    />
  );
}
