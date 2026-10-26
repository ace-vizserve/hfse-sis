'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { formatMoment } from '@/components/sow/format';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import type { SowQueueRow } from '@/lib/sow/review';

// "Waiting for you" (board 5's queue): one row per scheme of work whose live
// step names the reader. Each row opens the SOW page, where the decision is
// made with the weeks in front of them — nothing is decided from the list.
//
// No primary button on this screen: every row's action is the same outline
// "Open", so none of them is the one path forward (09a §9.2).

export function ReviewQueueTable({ rows }: { rows: SowQueueRow[] }) {
  const columns = useMemo<ColumnDef<SowQueueRow>[]>(
    () => [
      {
        id: 'subject',
        accessorFn: (r) => `${r.subjectName} ${r.levelLabel} ${r.track}`,
        header: 'Subject · level · track',
        meta: { label: 'Subject, level and track' },
        enableSorting: false,
        cell: ({ row }) => (
          <span>
            <span className="font-medium text-foreground">
              {row.original.subjectName}
            </span>{' '}
            <span className="text-muted-foreground">
              · {row.original.levelLabel} · {row.original.track} · Term{' '}
              {row.original.termNumber}
            </span>
          </span>
        ),
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
        accessorFn: (r) => r.teacher,
        header: 'Teacher',
        meta: { label: 'Teacher' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-ink-2">{row.original.teacher}</span>
        ),
      },
      {
        id: 'step',
        accessorFn: (r) => r.step,
        header: 'Step',
        meta: { label: 'Step' },
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone="warning">{row.original.step}</StatusBadge>
        ),
      },
      {
        id: 'since',
        accessorFn: (r) => r.waitingSince ?? '',
        header: 'Waiting since',
        meta: { label: 'Waiting since' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[13px] tabular-nums text-ink-3">
            {row.original.waitingSince
              ? formatMoment(row.original.waitingSince)
              : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/classroom/sow/${row.original.sowId}`}>Open</Link>
            </Button>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <DataTable<SowQueueRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.requestId}
      hidePagination
      emptyState={{
        icon: Inbox,
        title: 'Nothing is waiting for you.',
        body: 'When a scheme of work reaches a step you are on, it appears here. Open it to vet or approve it, or return it to the teacher with a note.',
      }}
    />
  );
}
