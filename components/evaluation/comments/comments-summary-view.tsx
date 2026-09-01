'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  MessageSquare,
  PencilLine,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MetricCard } from '@/components/dashboard/metric-card';
import {
  InsightChartCard,
  EmptyChartState,
} from '@/components/dashboard/insights/insight-chart-card';
import {
  DonutChart,
  type DonutSlice,
} from '@/components/dashboard/charts/donut-chart';
import {
  GroupedBarChart,
  type GroupedBarSeries,
} from '@/components/dashboard/charts/grouped-bar-chart';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import {
  buildCommentRows,
  type CommentRow,
  type CommentStatus,
} from '@/lib/markbook/academic-summary-views';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';
import { toPlainText } from '@/lib/rich-text';

// Comments three-tier page — relocated from Academic Summary (see
// docs/superpowers/plans/2026-07-22-academic-summary-module-redesign.md,
// Task 5). Shell copied from AwardsSummaryView (Task 3)/AttendanceSummaryView
// (Task 4). ① MetricCard stat row → ② donut (status distribution) +
// grouped-bar (completeness per class) → ③ DataTable detail list.
//
// count == table (KD #124): tier ① + ② are always computed from the fixed
// "all T1–T3 rows" scope (`allRows`); the table's own Term/Status selectors
// only narrow the table, never the headline.
//
// N.A. handling (KD #148): a term the student wasn't enrolled for is not a
// chase item, so it is excluded from the tier ①/② counts and denominator
// (`required = submitted + draft + missing`). It still appears as a
// selectable table filter and a distinct StatusBadge tone (muted).

const COMMENT_TONE: Record<CommentStatus, StatusTone> = {
  Submitted: 'healthy',
  Draft: 'warning',
  Missing: 'locked',
  'N.A.': 'muted',
};

type StatusFilter = CommentStatus | 'all';

// Row type for the DataTable — augments CommentRow with a stable synthetic
// id. `getRowId` on the shared shell only receives the row (no index), so the
// index-derived uniqueness has to be baked into the row data itself.
//
// `plainText` is the write-up with its formatting stripped. The write-up is
// stored as HTML now, and this table does three things with it that HTML
// breaks: it sorts, it filters, and it exports to CSV — plus a `line-clamp`
// that would clamp two lines of tags. `text` stays as stored for any surface
// that later renders the formatting.
type CommentTableRow = CommentRow & {
  _rowId: string;
  plainText: string | null;
};

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}% of required` : '—';
}

export function CommentsSummaryView({
  payload,
}: {
  payload: MasterfilePayload;
}) {
  // Headline (fixed): all T1–T3 rows, every status.
  const allRows = useMemo(
    () => buildCommentRows(payload, { termNumber: null, status: 'all' }),
    [payload]
  );

  const statusCounts = useMemo(() => {
    const c: Record<CommentStatus, number> = {
      Submitted: 0,
      Draft: 0,
      Missing: 0,
      'N.A.': 0,
    };
    for (const r of allRows) c[r.commentStatus] += 1;
    return c;
  }, [allRows]);

  const submitted = statusCounts.Submitted;
  const draft = statusCounts.Draft;
  const missing = statusCounts.Missing;
  const required = submitted + draft + missing; // N.A. excluded (KD #148)
  const submittedPct = required > 0 ? (submitted / required) * 100 : 0;
  const submittedPctLabel = `${Math.round(submittedPct)}%`;

  const statusDonut: DonutSlice[] = [
    { name: 'Submitted', value: submitted },
    { name: 'Draft', value: draft },
    { name: 'Missing', value: missing },
  ];
  const statusColors = [
    'var(--color-brand-mint)',
    'var(--color-brand-amber)',
    'var(--color-destructive)',
  ];

  // Completeness per class (>= 2 sections only), N.A. excluded.
  const perSection = useMemo(() => {
    const bySection = new Map<
      string,
      { submitted: number; draft: number; missing: number }
    >();
    for (const r of allRows) {
      if (r.commentStatus === 'N.A.') continue;
      const cur = bySection.get(r.sectionName) ?? {
        submitted: 0,
        draft: 0,
        missing: 0,
      };
      if (r.commentStatus === 'Submitted') cur.submitted += 1;
      else if (r.commentStatus === 'Draft') cur.draft += 1;
      else if (r.commentStatus === 'Missing') cur.missing += 1;
      bySection.set(r.sectionName, cur);
    }
    return Array.from(bySection.entries()).map(([x, counts]) => ({
      x,
      ...counts,
    }));
  }, [allRows]);
  const showPerSection = payload.sections.length >= 2 && perSection.length >= 2;
  const perSectionSeries: GroupedBarSeries[] = [
    { key: 'submitted', label: 'Submitted', color: 'var(--color-brand-mint)' },
    { key: 'draft', label: 'Draft', color: 'var(--color-brand-amber)' },
    { key: 'missing', label: 'Missing', color: 'var(--color-destructive)' },
  ];

  // Table scope (interactive) — Term/Status selectors re-run
  // buildCommentRows; they narrow only the table, never the tier ①/②
  // headline above.
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  // Stripping formatted text is a parse through the TipTap schema, so it is
  // done once per distinct write-up and cached, never inside an `accessorFn`
  // or a cell (both run for every visible row on every render). The cache is
  // keyed on the stored HTML itself — identical text strips identically — and
  // is rebuilt when a new payload arrives.
  const plainTextCache = useMemo(() => new Map<string, string>(), [payload]);
  const tableRows: CommentTableRow[] = useMemo(() => {
    const rows = buildCommentRows(payload, { termNumber, status });
    return rows.map((r, i) => {
      let plainText: string | null = null;
      if (r.text != null) {
        const cached = plainTextCache.get(r.text);
        plainText = cached ?? toPlainText(r.text);
        if (cached === undefined) plainTextCache.set(r.text, plainText);
      }
      return {
        ...r,
        _rowId: `${r.studentNumber ?? r.studentName}-${r.termNumber}-${i}`,
        plainText,
      };
    });
  }, [payload, termNumber, status, plainTextCache]);

  // Section-id lookup: name → id (for deep-linking to the evaluation section
  // editor at /evaluation/sections/{sectionId}).
  const sectionIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of payload.sections) map.set(s.name, s.id);
    return map;
  }, [payload.sections]);

  const termOptions = [
    { value: '__all__', label: 'All terms' },
    ...payload.terms
      .filter((t) => t.termNumber >= 1 && t.termNumber <= 3)
      .map((t) => ({
        value: String(t.termNumber),
        label: `Term ${t.termNumber}`,
      })),
  ];
  const statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All statuses' },
    { value: 'Submitted', label: 'Submitted' },
    { value: 'Draft', label: 'Draft' },
    { value: 'Missing', label: 'Missing' },
    { value: 'N.A.', label: 'N.A. (not enrolled that term)' },
  ];

  const columns = useMemo<ColumnDef<CommentTableRow>[]>(
    () => [
      // No index-number column: an index is a student's roll number WITHIN a
      // section, and this view spans sections (it carries a Class column). A
      // bare "#5" here answers "fifth in some section", which is not a
      // question anyone asks. The index still belongs on section-scoped
      // surfaces — section rosters, grading, attendance and evaluation
      // sheets — and it is still exported as the masterfile's S/N column.
      {
        accessorKey: 'studentName',
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        meta: { label: 'Student' },
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            {row.original.studentNumber ? (
              <IdentifierLink
                href={`/records/students/${encodeURIComponent(row.original.studentNumber)}`}
              >
                {row.original.studentName}
              </IdentifierLink>
            ) : (
              <span className="font-medium text-foreground">
                {row.original.studentName}
              </span>
            )}
            {row.original.studentNumber && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {row.original.studentNumber}
              </span>
            )}
            {row.original.status === 'Late enrollee' &&
              row.original.lateTermNumber != null && (
                <span className="font-mono text-[10px] font-semibold text-brand-amber">
                  · T{row.original.lateTermNumber}
                </span>
              )}
          </div>
        ),
      },
      {
        accessorKey: 'sectionName',
        header: ({ column }) => (
          <SortableHeader column={column}>Class</SortableHeader>
        ),
        meta: { label: 'Class' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.sectionName}
          </span>
        ),
      },
      {
        accessorKey: 'termNumber',
        header: ({ column }) => (
          <SortableHeader column={column}>Term</SortableHeader>
        ),
        meta: { label: 'Term' },
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums text-foreground">
            T{row.original.termNumber}
          </span>
        ),
      },
      {
        accessorKey: 'commentStatus',
        header: ({ column }) => (
          <SortableHeader column={column}>Status</SortableHeader>
        ),
        meta: { label: 'Status' },
        cell: ({ row }) => (
          <StatusBadge tone={COMMENT_TONE[row.original.commentStatus]}>
            {row.original.commentStatus}
          </StatusBadge>
        ),
        filterFn: (r, id, value) =>
          !value?.length || value.includes(r.getValue(id)),
      },
      {
        accessorKey: 'adviser',
        header: ({ column }) => (
          <SortableHeader column={column}>Adviser</SortableHeader>
        ),
        meta: { label: 'Adviser' },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.adviser ?? '—'}
          </span>
        ),
      },
      {
        id: 'comment',
        // ⚠ PLAIN TEXT, NOT THE STORED HTML. This accessor is the column's
        // value everywhere — the table's own filtering and the CSV export both
        // resolve it (`buildScreenFields` → `resolveColumnValue`), so the
        // registrar's downloaded file would otherwise hold a column of tags.
        // Already stripped on the row (see `tableRows`), so this is a read.
        accessorFn: (r) => r.plainText ?? '',
        header: 'Comment',
        enableSorting: false,
        cell: ({ row }) => {
          const sectionId = sectionIdByName.get(row.original.sectionName);
          const evalHref = sectionId
            ? `/evaluation/sections/${sectionId}`
            : '/evaluation/sections';
          return (
            <div className="flex flex-col gap-1">
              {row.original.plainText == null ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  —
                </span>
              ) : (
                <p className="line-clamp-2 max-w-100 text-sm text-muted-foreground">
                  {row.original.plainText}
                </p>
              )}
              <IdentifierLink href={evalHref}>
                Open in Evaluation
              </IdentifierLink>
            </div>
          );
        },
      },
    ],
    [sectionIdByName]
  );

  return (
    <div className="space-y-6">
      {/* Tier ① stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Submitted %"
          value={submittedPct}
          format="percent"
          icon={MessageSquare}
          subtext="Of required write-ups"
        />
        <MetricCard
          label="Submitted"
          value={submitted}
          icon={CheckCircle2}
          subtext={pct(submitted, required)}
        />
        <MetricCard
          label="Draft"
          value={draft}
          icon={PencilLine}
          subtext={pct(draft, required)}
        />
        <MetricCard
          label="Missing"
          value={missing}
          icon={CircleAlert}
          subtext={pct(missing, required)}
        />
      </div>

      {/* Tier ② analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightChartCard
          cap="Distribution"
          title="Write-up status"
          icon={MessageSquare}
        >
          {required === 0 ? (
            <EmptyChartState message="No write-ups required at this level yet." />
          ) : (
            <DonutChart
              data={statusDonut}
              colors={statusColors}
              centerValue={submittedPctLabel}
              centerLabel="Submitted"
            />
          )}
        </InsightChartCard>
        <InsightChartCard
          cap="By class"
          title="Completeness per class"
          icon={CheckCircle2}
        >
          {!showPerSection ? (
            <EmptyChartState message="Add a second class at this level to compare completeness side by side." />
          ) : (
            <GroupedBarChart
              series={perSectionSeries}
              data={perSection}
              yFormat="number"
            />
          )}
        </InsightChartCard>
      </div>

      {/* Tier ③ detail table */}
      <DataTable<CommentTableRow>
        data={tableRows}
        columns={columns}
        getRowId={(r) => r._rowId}
        searchKeys={['studentName', 'studentNumber', 'sectionName', 'adviser']}
        searchPlaceholder="Search students…"
        toolbarLeading={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={termNumber == null ? '__all__' : String(termNumber)}
              onValueChange={(v) =>
                setTermNumber(v === '__all__' ? null : Number(v))
              }
            >
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {termOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusFilter)}
            >
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        pageSize={25}
        csv={{
          filename: `comments-${payload.ayCode}-${payload.level.code}.csv`,
        }}
        url={{ enabled: true, namespace: 'comments' }}
        emptyState={{
          icon: MessageSquare,
          title: 'No write-ups match this scope.',
          body: 'Adjust the term or status above.',
        }}
      />

      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Read-only — edit write-ups in the Evaluation module.
      </p>
    </div>
  );
}
