'use client';

import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import type { StatusTabConfig } from '@/components/ui/data-table/types';
import type { FeedbackRow } from '@/lib/admissions/feedback';

// ─── Rating helpers ───────────────────────────────────────────────────────────

const RATING_CONFIG: Record<
  number,
  {
    label: string;
    variant: 'blocked' | 'warning' | 'muted' | 'default' | 'success';
  }
> = {
  1: { label: 'Very Difficult', variant: 'blocked' },
  2: { label: 'Frustrating', variant: 'warning' },
  3: { label: 'Okay', variant: 'muted' },
  4: { label: 'Easy', variant: 'default' },
  5: { label: 'Excellent', variant: 'success' },
};

function RatingBadge({ rating }: { rating: number | null | undefined }) {
  if (rating === null || rating === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const cfg = RATING_CONFIG[rating];
  if (!cfg) return <Badge variant="outline">{rating}</Badge>;
  return (
    <Badge variant={cfg.variant}>
      {rating} · {cfg.label}
    </Badge>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function TruncatedText({
  value,
  max = 100,
}: {
  value: string | null | undefined;
  max?: number;
}) {
  const s = (value ?? '').trim();
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  const truncated = s.length > max ? `${s.slice(0, max)}…` : s;
  return (
    <span className="text-sm text-foreground" title={s}>
      {truncated}
    </span>
  );
}

// ─── Table config ─────────────────────────────────────────────────────────────

function buildColumns(ayCode: string): ColumnDef<FeedbackRow>[] {
  return [
    {
      id: 'student',
      accessorFn: (r) => r.enroleeFullName ?? r.enroleeNumber,
      header: 'Applicant',
      cell: ({ row }) => {
        const params = new URLSearchParams({ ay: ayCode, tab: 'profile' });
        const href = `/admissions/applications/${encodeURIComponent(row.original.enroleeNumber)}?${params.toString()}`;
        return (
          <Link href={href} className="block space-y-0.5 hover:underline">
            <div className="font-medium text-foreground">
              {row.original.enroleeFullName ?? '—'}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {row.original.enroleeNumber}
              {row.original.studentNumber
                ? ` · ${row.original.studentNumber}`
                : ''}
            </div>
          </Link>
        );
      },
      enableSorting: true,
    },
    {
      id: 'levelApplied',
      accessorKey: 'levelApplied',
      header: 'Level',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.levelApplied ?? '—'}
        </span>
      ),
      enableSorting: true,
    },
    {
      id: 'applicationStatus',
      accessorKey: 'applicationStatus',
      header: 'App status',
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.applicationStatus ?? '—'}</Badge>
      ),
      enableSorting: true,
    },
    {
      id: 'feedbackRating',
      accessorFn: (r) => r.feedbackRating ?? -1,
      header: 'Rating',
      cell: ({ row }) => <RatingBadge rating={row.original.feedbackRating} />,
      enableSorting: true,
    },
    {
      id: 'feedbackComments',
      accessorKey: 'feedbackComments',
      header: 'Comments',
      cell: ({ row }) => (
        <TruncatedText value={row.original.feedbackComments} />
      ),
      enableSorting: false,
    },
    {
      id: 'feedbackConsent',
      accessorFn: (r) =>
        r.feedbackConsent === true ? 2 : r.feedbackConsent === false ? 0 : 1,
      header: 'May contact',
      cell: ({ row }) => {
        if (row.original.feedbackConsent === true)
          return <Badge variant="success">Yes</Badge>;
        if (row.original.feedbackConsent === false)
          return <Badge variant="outline">No</Badge>;
        return <span className="text-xs text-muted-foreground">—</span>;
      },
      enableSorting: true,
    },
    {
      id: 'feedbackSubmittedAt',
      accessorFn: (r) => r.feedbackSubmittedAt ?? '',
      header: 'Submitted',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">
          {formatDate(row.original.feedbackSubmittedAt)}
        </span>
      ),
      enableSorting: true,
    },
  ];
}

const STATUS_TABS: StatusTabConfig<FeedbackRow>[] = [
  {
    value: 'all',
    label: 'All',
    predicate: () => true,
    isDefault: true,
  },
  {
    value: 'high',
    label: 'Positive (4–5)',
    predicate: (r) => (r.feedbackRating ?? 0) >= 4,
  },
  {
    value: 'neutral',
    label: 'Neutral (3)',
    predicate: (r) => r.feedbackRating === 3,
  },
  {
    value: 'low',
    label: 'Needs attention (1–2)',
    predicate: (r) =>
      (r.feedbackRating ?? 0) >= 1 && (r.feedbackRating ?? 0) <= 2,
  },
  {
    value: 'contact',
    label: 'May contact',
    predicate: (r) => r.feedbackConsent === true,
  },
];

const FACETS = [
  { columnId: 'levelApplied', label: 'Level' },
  { columnId: 'applicationStatus', label: 'App status' },
  { columnId: 'feedbackConsent', label: 'May contact' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedbackTable({
  rows,
  ayCode,
}: {
  rows: FeedbackRow[];
  ayCode: string;
}) {
  return (
    <DataTable<FeedbackRow>
      data={rows}
      columns={buildColumns(ayCode)}
      getRowId={(r) => r.enroleeNumber}
      searchKeys={['enroleeFullName', 'enroleeNumber', 'feedbackComments']}
      searchPlaceholder="Search applicants or comments…"
      facets={FACETS}
      statusTabs={STATUS_TABS}
      pageSize={25}
      csv={{ filename: `feedback-${ayCode}.csv` }}
      url={{ enabled: true, namespace: 'feedback' }}
      emptyState={{
        title: 'No feedback received yet.',
        body: 'Ratings and comments from the online application form will appear here once parents submit them.',
      }}
      emptyFilteredState={{ title: 'No matches for current filters.' }}
    />
  );
}
