'use client';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { StatusBadge } from '@/components/admissions/drills/admissions-drill-sheet';
import { DrillDownSheet } from '@/components/dashboard/drill-down-sheet';
import { DrillSheetSkeleton } from '@/components/dashboard/drill-sheet-skeleton';
import { Button } from '@/components/ui/button';
import type { FeedbackRow } from '@/lib/admissions/feedback';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

// The parents behind one bar of the Insights ★ histogram (KD #229). Its own
// sheet because a feedback response is not an applicant DrillRow.

const EMPTY_ROWS: FeedbackRow[] = [];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusOf(row: FeedbackRow): string {
  return (row.applicationStatus ?? '').trim() || 'No status';
}

// KD #81: enrolled → Records; everyone else → their application.
function applicantHref(row: FeedbackRow): string {
  const status = statusOf(row);
  if (status !== 'Enrolled' && status !== 'Enrolled (Conditional)') {
    return `/admissions/applications/${encodeURIComponent(row.enroleeNumber)}`;
  }
  return row.studentNumber
    ? `/records/students/${encodeURIComponent(row.studentNumber)}`
    : `/records/students/by-enrolee/${encodeURIComponent(row.enroleeNumber)}`;
}

function feedbackDrillUrl(
  ayCode: string,
  segment: string | null,
  format: 'json' | 'csv'
): string {
  const params = new URLSearchParams({ ay: ayCode });
  if (segment) params.set('segment', segment);
  if (format === 'csv') params.set('format', 'csv');
  return `/api/admissions/drill/feedback-rating?${params.toString()}`;
}

const COLUMNS: ColumnDef<FeedbackRow, unknown>[] = [
  {
    id: 'applicant',
    accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
    header: 'Applicant',
    meta: { label: 'Applicant' },
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <Link
          href={applicantHref(row.original)}
          className="font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          {row.original.enroleeFullName ?? row.original.enroleeNumber}
        </Link>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {row.original.enroleeNumber}
        </div>
      </div>
    ),
    enableSorting: true,
  },
  {
    id: 'levelApplied',
    accessorFn: (r) => r.levelApplied ?? '',
    header: 'Level applied for',
    meta: { label: 'Level applied for' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.levelApplied?.trim() || '—'}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'status',
    accessorFn: statusOf,
    header: 'Status',
    meta: { label: 'Status' },
    cell: ({ row }) => <StatusBadge status={statusOf(row.original)} />,
    enableSorting: true,
  },
  {
    id: 'rating',
    accessorKey: 'feedbackRating',
    header: 'Rating',
    meta: { label: 'Rating' },
    cell: ({ row }) => (
      <span className="font-mono text-sm tabular-nums text-foreground">
        {row.original.feedbackRating ?? '—'} / 5
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'comment',
    accessorFn: (r) => r.feedbackComments ?? '',
    header: 'Comment',
    meta: { label: 'Comment' },
    cell: ({ row }) => (
      <p className="max-w-80 whitespace-normal text-sm leading-relaxed text-foreground">
        {row.original.feedbackComments ?? '—'}
      </p>
    ),
    enableSorting: false,
  },
  {
    id: 'consent',
    accessorFn: (r) =>
      r.feedbackConsent === true
        ? 'Yes'
        : r.feedbackConsent === false
          ? 'No'
          : '',
    header: 'Open to follow-up',
    meta: { label: 'Open to follow-up' },
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.feedbackConsent === true
          ? 'Yes'
          : row.original.feedbackConsent === false
            ? 'No'
            : '—'}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: 'submittedAt',
    accessorKey: 'feedbackSubmittedAt',
    header: 'Submitted on',
    meta: { label: 'Submitted on' },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatDate(row.original.feedbackSubmittedAt)}
      </span>
    ),
    enableSorting: true,
  },
];

export function FeedbackRatingDrillSheet({
  ayCode,
  segment,
}: {
  ayCode: string;
  segment: string | null;
}) {
  const query = useQuery({
    queryKey: queryKeys.admissionsDrill('feedback-rating', {
      ay: ayCode,
      segment,
    }),
    queryFn: async ({ signal }) => {
      const json = await apiFetch<{ rows?: FeedbackRow[] }>(
        feedbackDrillUrl(ayCode, segment, 'json'),
        { credentials: 'include', signal }
      );
      return Array.isArray(json.rows) ? json.rows : [];
    },
  });

  const rows = query.data ?? EMPTY_ROWS;
  const title = segment
    ? `Parents who rated the form ${segment} out of 5`
    : 'Every rating of the application form';

  if (query.isLoading) return <DrillSheetSkeleton title={title} />;

  if (query.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive ring-1 ring-inset ring-destructive/20">
          <AlertTriangle className="size-6" />
        </div>
        <p className="font-serif text-lg font-semibold text-foreground">
          Couldn’t load these ratings
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RotateCcw
            className={cn('size-4', query.isFetching && 'animate-spin')}
          />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <DrillDownSheet<FeedbackRow>
      title={title}
      eyebrow="Application experience"
      description="Whole academic year"
      count={rows.length}
      csvHref={feedbackDrillUrl(ayCode, segment, 'csv')}
      columns={COLUMNS}
      rows={rows}
      emptyMessage="No parent gave this rating."
    />
  );
}
