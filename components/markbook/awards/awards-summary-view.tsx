'use client';

import { useMemo, useState } from 'react';
import { Award, ChartPie, Medal, Trophy, Users } from 'lucide-react';
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
import type { FacetConfig } from '@/components/ui/data-table/types';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import {
  buildAwardsRows,
  type AwardsRow,
  type EnrollmentStatusLabel,
} from '@/lib/markbook/academic-summary-views';
import type { AwardTier } from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Awards three-tier page — relocated from Academic Summary (see
// docs/superpowers/plans/2026-07-22-academic-summary-module-redesign.md,
// Task 3). ① MetricCard stat row → ② donut (tier distribution) +
// grouped-bar (tiers per class) → ③ DataTable detail list.
//
// count == table (KD #124): tier ① + ② are always computed from the fixed
// "Overall Academic Award · Full year" scope (`overallRows`); the table's
// own Subject/Term selectors only narrow the table, never the headline.

type TierKey = AwardTier; // 'gold' | 'silver' | 'bronze' | 'notEligible'

const TIER_ORDER: TierKey[] = ['gold', 'silver', 'bronze', 'notEligible'];

const TIER_LABEL: Record<TierKey, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  notEligible: 'Not eligible',
};

const TIER_VAR: Record<TierKey, string> = {
  gold: 'var(--color-brand-amber)',
  silver: 'var(--color-ink-4)',
  bronze: 'var(--color-brand-bronze)',
  notEligible: 'var(--color-muted-foreground)',
};

// Stat-tile gradients (MetricCard.tileClassName).
const TIER_TILE: Record<Exclude<TierKey, 'notEligible'>, string> = {
  gold: 'from-brand-amber to-brand-amber/70',
  silver: 'from-ink-4 to-ink-2',
  bronze: 'from-brand-bronze to-brand-bronze/70',
};

// Table badge classes — reused verbatim from the retired awards-view.tsx
// TIER_CONFIG (gold=brand-amber, silver=ink-4, bronze=brand-bronze,
// notEligible=muted — matches the donut colors above).
const TIER_BADGE: Record<TierKey, string> = {
  gold: 'inline-flex items-center rounded-full bg-brand-amber/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-amber',
  silver:
    'inline-flex items-center rounded-full bg-ink-4/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4',
  bronze:
    'inline-flex items-center rounded-full bg-brand-bronze/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-bronze',
  notEligible:
    'inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
};

const STATUS_TO_ENROLLMENT: Record<
  EnrollmentStatusLabel,
  'active' | 'late_enrollee' | 'withdrawn'
> = {
  Active: 'active',
  'Late enrollee': 'late_enrollee',
  Withdrawn: 'withdrawn',
};

// Row type for the DataTable — augments AwardsRow with a stable synthetic id.
// `getRowId` on the shared shell only receives the row (no index), so the
// index-derived uniqueness has to be baked into the row data itself.
type AwardsTableRow = AwardsRow & { _rowId: string };

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}% of the level` : '—';
}

export function AwardsSummaryView({ payload }: { payload: MasterfilePayload }) {
  // Headline (fixed): overall academic award, full year.
  const overallRows = useMemo(
    () =>
      buildAwardsRows(payload, {
        subjectId: 'overall',
        termNumber: null,
        tier: 'all',
      }),
    [payload]
  );
  const tierCounts = useMemo(() => {
    const c: Record<AwardTier, number> = {
      gold: 0,
      silver: 0,
      bronze: 0,
      notEligible: 0,
    };
    for (const r of overallRows) if (r.tier) c[r.tier] += 1;
    return c;
  }, [overallRows]);
  const students = overallRows.length;

  const donutData: DonutSlice[] = TIER_ORDER.map((t) => ({
    name: TIER_LABEL[t],
    value: tierCounts[t],
  }));
  const donutColors = TIER_ORDER.map((t) => TIER_VAR[t]);

  // Per-class tier counts (only when >= 2 sections).
  const perClass = useMemo(() => {
    const bySection = new Map<string, Record<AwardTier, number>>();
    for (const r of overallRows) {
      const cur = bySection.get(r.sectionName) ?? {
        gold: 0,
        silver: 0,
        bronze: 0,
        notEligible: 0,
      };
      if (r.tier) cur[r.tier] += 1;
      bySection.set(r.sectionName, cur);
    }
    return Array.from(bySection.entries()).map(([x, counts]) => ({
      x,
      ...counts,
    }));
  }, [overallRows]);
  const showPerClass = payload.sections.length >= 2 && perClass.length >= 2;
  const perClassSeries: GroupedBarSeries[] = TIER_ORDER.map((t) => ({
    key: t,
    label: TIER_LABEL[t],
    color: TIER_VAR[t],
  }));

  // Table scope (interactive) — Subject/Term selectors re-run buildAwardsRows;
  // they narrow only the table, never the tier ①/② headline above.
  const [subjectId, setSubjectId] = useState<string>('overall');
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const tableRows: AwardsTableRow[] = useMemo(() => {
    const rows = buildAwardsRows(payload, {
      subjectId,
      termNumber,
      tier: 'all',
    });
    return rows.map((r, i) => ({
      ...r,
      _rowId: `${r.studentNumber ?? r.studentName}-${i}`,
    }));
  }, [payload, subjectId, termNumber]);
  const showAward = termNumber == null;
  const scoreDp = termNumber != null ? 0 : subjectId === 'overall' ? 1 : 2;

  const subjectOptions = [
    { value: 'overall', label: 'Overall Academic Award' },
    ...payload.subjects.map((s) => ({ value: s.id, label: s.name })),
  ];
  const termOptions = [
    { value: '__all__', label: 'Full year' },
    ...payload.terms.map((t) => ({
      value: String(t.termNumber),
      label: `Term ${t.termNumber}`,
    })),
  ];

  const columns = useMemo<ColumnDef<AwardsTableRow>[]>(() => {
    const base: ColumnDef<AwardsTableRow>[] = [
      {
        id: 'index',
        accessorFn: (r) => r.indexNumber ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>#</SortableHeader>
        ),
        meta: { label: 'Index number' },
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {row.original.indexNumber ?? '—'}
          </span>
        ),
      },
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
        accessorKey: 'status',
        header: ({ column }) => (
          <SortableHeader column={column}>Status</SortableHeader>
        ),
        meta: { label: 'Status' },
        cell: ({ row }) => (
          <EnrollmentStatusBadge
            status={STATUS_TO_ENROLLMENT[row.original.status]}
          />
        ),
        filterFn: (r, id, value) =>
          !value?.length || value.includes(r.getValue(id)),
      },
      {
        accessorKey: 'score',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Score
          </SortableHeader>
        ),
        meta: { label: 'Score' },
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm font-semibold tabular-nums text-foreground">
            {row.original.score == null
              ? '—'
              : row.original.score.toFixed(scoreDp)}
          </span>
        ),
      },
    ];
    if (showAward) {
      base.push({
        id: 'tier',
        accessorFn: (r) => (r.tier ? TIER_LABEL[r.tier] : '—'),
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Award
          </SortableHeader>
        ),
        meta: { label: 'Award' },
        cell: ({ row }) => (
          <span className="block text-right">
            {row.original.tier == null ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                —
              </span>
            ) : (
              <span className={TIER_BADGE[row.original.tier]}>
                {TIER_LABEL[row.original.tier]}
              </span>
            )}
          </span>
        ),
        filterFn: (r, id, value) =>
          !value?.length || value.includes(r.getValue(id)),
      });
    }
    return base;
  }, [showAward, scoreDp]);

  const facets: FacetConfig[] = showAward
    ? [
        {
          columnId: 'tier',
          label: 'Tier',
          valueOptions: TIER_ORDER.map((t) => TIER_LABEL[t]),
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Tier ① stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Students"
          value={students}
          icon={Users}
          subtext="At this level"
        />
        <MetricCard
          label="Gold"
          value={tierCounts.gold}
          icon={Trophy}
          tileClassName={TIER_TILE.gold}
          subtext={pct(tierCounts.gold, students)}
        />
        <MetricCard
          label="Silver"
          value={tierCounts.silver}
          icon={Medal}
          tileClassName={TIER_TILE.silver}
          subtext={pct(tierCounts.silver, students)}
        />
        <MetricCard
          label="Bronze"
          value={tierCounts.bronze}
          icon={Award}
          tileClassName={TIER_TILE.bronze}
          subtext={pct(tierCounts.bronze, students)}
        />
      </div>

      {/* Tier ② analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightChartCard
          cap="Distribution"
          title="Award tiers"
          icon={ChartPie}
        >
          {students === 0 ? (
            <EmptyChartState message="No students at this level yet." />
          ) : (
            <DonutChart
              data={donutData}
              colors={donutColors}
              centerValue={students}
              centerLabel="Students"
            />
          )}
        </InsightChartCard>
        <InsightChartCard
          cap="By class"
          title="Award tiers per class"
          icon={Award}
        >
          {!showPerClass ? (
            <EmptyChartState message="Add a second class at this level to compare award tiers side by side." />
          ) : (
            <GroupedBarChart
              series={perClassSeries}
              data={perClass}
              yFormat="number"
            />
          )}
        </InsightChartCard>
      </div>

      {/* Tier ③ detail table */}
      {termNumber != null && (
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Provisional — awards finalise once Term 4 grades are complete.
        </p>
      )}
      <DataTable<AwardsTableRow>
        data={tableRows}
        columns={columns}
        getRowId={(r) => r._rowId}
        searchKeys={['studentName', 'studentNumber', 'sectionName']}
        searchPlaceholder="Search students…"
        facets={facets}
        toolbarLeading={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subjectOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </div>
        }
        initialSort={[{ id: 'score', desc: true }]}
        pageSize={25}
        csv={{ filename: `awards-${payload.ayCode}-${payload.level.code}.csv` }}
        url={{ enabled: true, namespace: 'awards' }}
        emptyState={{
          icon: Award,
          title: 'No students match this scope.',
          body: 'Adjust the subject or term above.',
        }}
      />
    </div>
  );
}
