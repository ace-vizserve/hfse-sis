'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { BookOpen, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { SowStatusBadge } from '@/components/sow/sow-status-badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { OversightSowRow } from '@/lib/sow/oversight';

// The "SOWs" tab of oversight (board 9): every scheme of work of the term in
// the viewer's scope, plus each subject × level × track the year teaches that
// has none yet. Each row opens the scheme; nothing is decided from the list,
// so every action is the same outline button and the page has no primary.

const STATE_ORDER = [
  'waiting',
  'in_review',
  'returned',
  'draft',
  'none',
  'approved',
];

export function OversightSowsTable({ rows }: { rows: OversightSowRow[] }) {
  const columns = useMemo<ColumnDef<OversightSowRow>[]>(
    () => [
      {
        id: 'subject',
        accessorFn: (r) => `${r.subjectName} ${r.levelLabel} ${r.track}`,
        header: 'Subject · level · track',
        meta: { label: 'Subject, level and track' },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <span>
            <span className="font-medium text-foreground">
              {row.original.subjectName}
            </span>{' '}
            <span className="text-muted-foreground">
              · {row.original.levelLabel} · {row.original.track}
            </span>
          </span>
        ),
      },
      // Facet-only, hidden: the toolbar's Level filter.
      {
        id: 'level',
        accessorFn: (r) => r.levelLabel,
        header: 'Level',
        meta: { label: 'Level' },
        enableSorting: false,
      },
      {
        id: 'classes',
        accessorFn: (r) => r.classes.join(', '),
        header: 'Classes',
        meta: { label: 'Classes' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-ink-2">
            {row.original.classes.join(', ') || '—'}
          </span>
        ),
      },
      {
        id: 'teacher',
        accessorFn: (r) => r.teachers.join(', '),
        header: 'Teacher',
        meta: { label: 'Teacher' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-ink-2">
            {row.original.teachers.join(', ') || '—'}
          </span>
        ),
      },
      {
        id: 'status',
        accessorFn: (r) =>
          r.state === null
            ? 'Not started'
            : r.waitingOnYou
              ? 'Waiting on you'
              : r.state,
        header: 'Status',
        meta: { label: 'Status', excludeFromExport: true },
        enableSorting: false,
        cell: ({ row }) => (
          <SowStatusBadge
            state={row.original.state}
            step={row.original.step}
            mine={row.original.waitingOnYou}
          />
        ),
      },
      {
        id: 'waiting',
        accessorFn: (r) => r.waiting,
        header: 'Waiting',
        meta: { label: 'Waiting' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums text-ink-3">
            {row.original.waiting}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) =>
          row.original.sowId ? (
            <div className="flex justify-end">
              <Button asChild variant="outline" size="sm">
                <Link href={`/classroom/sow/${row.original.sowId}`}>
                  {row.original.waitingOnYou ? 'Review' : 'Open'}
                </Link>
              </Button>
            </div>
          ) : null,
      },
    ],
    []
  );

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          STATE_ORDER.indexOf(
            a.waitingOnYou ? 'waiting' : (a.state ?? 'none')
          ) -
          STATE_ORDER.indexOf(b.waitingOnYou ? 'waiting' : (b.state ?? 'none'))
      ),
    [rows]
  );

  return (
    <DataTable<OversightSowRow>
      data={sorted}
      columns={columns}
      getRowId={(r) => r.id}
      searchKeys={[
        (r) =>
          `${r.subjectName} ${r.levelLabel} ${r.classes.join(' ')} ${r.teachers.join(' ')}`,
      ]}
      searchPlaceholder="Search subjects, classes or teachers"
      facets={[{ columnId: 'level', label: 'Level' }]}
      initialColumnVisibility={{ level: false }}
      statusTabs={[
        { value: 'all', label: 'All', predicate: () => true, isDefault: true },
        {
          value: 'review',
          label: 'In review',
          predicate: (r) => r.state === 'in_review',
        },
        {
          value: 'returned',
          label: 'Returned',
          predicate: (r) => r.state === 'returned',
        },
        {
          value: 'draft',
          label: 'Draft',
          predicate: (r) => r.state === 'draft',
        },
        {
          value: 'none',
          label: 'Not started',
          predicate: (r) => r.state === null,
        },
        {
          value: 'approved',
          label: 'Approved',
          predicate: (r) => r.state === 'approved',
        },
      ]}
      meScope={{
        enabled: true,
        userId: null,
        label: 'Waiting on me',
        icon: Hourglass,
        predicate: (r) => r.waitingOnYou,
      }}
      hidePagination
      emptyState={{
        icon: BookOpen,
        title: 'No schemes of work this term.',
        body: 'Subjects with grading sheets this term appear here as soon as a class is assigned a teacher.',
      }}
    />
  );
}
