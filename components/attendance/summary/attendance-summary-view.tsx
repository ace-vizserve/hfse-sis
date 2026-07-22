'use client';

import { useMemo, useState } from 'react';
import { CalendarX, Percent, TrendingUp, TriangleAlert } from 'lucide-react';
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
  ComparisonBarChart,
  type ComparisonBarPoint,
} from '@/components/dashboard/charts/comparison-bar-chart';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { IdentifierLink } from '@/components/ui/identifier-link';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import {
  buildAttendanceRows,
  type AttendanceRow,
  type EnrollmentStatusLabel,
} from '@/lib/markbook/academic-summary-views';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';
import { cn } from '@/lib/utils';

// Attendance Summary three-tier page — relocated from Academic Summary (see
// docs/superpowers/plans/2026-07-22-academic-summary-module-redesign.md,
// Task 4). Shell copied from AwardsSummaryView (Task 3). ① MetricCard stat
// row → ② donut (rate-band distribution) + per-class comparison bars → ③
// DataTable detail list.
//
// count == table (KD #124): unlike Awards (fixed headline scope), the Term
// selector here drives a single `rows` array shared by all three tiers —
// there is no separate table-only scope, so the headline and the table are
// always the same set by construction.

const STATUS_TO_ENROLLMENT: Record<
  EnrollmentStatusLabel,
  'active' | 'late_enrollee' | 'withdrawn'
> = {
  Active: 'active',
  'Late enrollee': 'late_enrollee',
  Withdrawn: 'withdrawn',
};

// Rate band → text color token (design-system §9.3 semantic color
// discipline). ≥ 95 healthy mint · 85–94.9 watch amber · < 85 at-risk red.
function rateClass(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground';
  if (rate >= 95) return 'text-brand-mint';
  if (rate >= 85) return 'text-brand-amber';
  return 'text-destructive';
}

// Row type for the DataTable — augments AttendanceRow with a stable synthetic
// id. `getRowId` on the shared shell only receives the row (no index), so the
// index-derived uniqueness has to be baked into the row data itself.
type AttendanceTableRow = AttendanceRow & { _rowId: string };

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}% of the level` : '—';
}

export function AttendanceSummaryView({
  payload,
}: {
  payload: MasterfilePayload;
}) {
  // Term scope (interactive) — shared by tier ①/②/③, so headline and table
  // are always the same rows.
  const [termNumber, setTermNumber] = useState<number | null>(null);

  const rows: AttendanceTableRow[] = useMemo(() => {
    const built = buildAttendanceRows(payload, { termNumber });
    return built.map((r, i) => ({
      ...r,
      _rowId: `${r.studentNumber ?? r.studentName}-${i}`,
    }));
  }, [payload, termNumber]);

  const termOptions = [
    { value: '__all__', label: 'Full year' },
    ...payload.terms.map((t) => ({
      value: String(t.termNumber),
      label: `Term ${t.termNumber}`,
    })),
  ];

  // ── Tier ① + ② derivations ────────────────────────────────────────────

  const nonNullRates = rows
    .map((r) => r.rate)
    .filter((v): v is number => v != null);
  const avgRate =
    nonNullRates.length > 0
      ? Math.round(
          (nonNullRates.reduce((a, b) => a + b, 0) / nonNullRates.length) * 10
        ) / 10
      : null;
  const avgRateLabel = avgRate != null ? `${avgRate.toFixed(1)}%` : '—';

  // Rate bands — a partition of every student with a rate (each falls in
  // exactly one band) → genuine donut.
  const bands = useMemo(() => {
    const b = { good: 0, watch: 0, risk: 0 };
    for (const r of rows) {
      if (r.rate == null) continue;
      if (r.rate >= 95) b.good += 1;
      else if (r.rate >= 85) b.watch += 1;
      else b.risk += 1;
    }
    return b;
  }, [rows]);

  const totalAbsences = rows.reduce((sum, r) => sum + r.absent, 0);

  const bandDonut: DonutSlice[] = [
    { name: '≥ 95%', value: bands.good },
    { name: '85–94%', value: bands.watch },
    { name: '< 85%', value: bands.risk },
  ];
  const bandColors = [
    'var(--color-brand-mint)',
    'var(--color-brand-amber)',
    'var(--color-destructive)',
  ];

  // Avg rate per class (>= 2 sections only) — horizontal comparison bars.
  const perClass: ComparisonBarPoint[] = useMemo(() => {
    const bySection = new Map<string, number[]>();
    for (const r of rows) {
      if (r.rate == null) continue;
      const arr = bySection.get(r.sectionName) ?? [];
      arr.push(r.rate);
      bySection.set(r.sectionName, arr);
    }
    return Array.from(bySection.entries()).map(([category, rates]) => ({
      category,
      current:
        Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10,
    }));
  }, [rows]);
  const showPerClass = payload.sections.length >= 2 && perClass.length >= 2;

  // ── Tier ③ columns ────────────────────────────────────────────────────

  const columns = useMemo<ColumnDef<AttendanceTableRow>[]>(
    () => [
      {
        id: 'index',
        accessorFn: (r) => r.indexNumber ?? '',
        header: ({ column }) => (
          <SortableHeader column={column}>#</SortableHeader>
        ),
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
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            {row.original.studentNumber ? (
              <IdentifierLink
                href={`/attendance/students/${encodeURIComponent(row.original.studentNumber)}`}
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
        cell: ({ row }) => (
          <EnrollmentStatusBadge
            status={STATUS_TO_ENROLLMENT[row.original.status]}
          />
        ),
        filterFn: (r, id, value) =>
          !value?.length || value.includes(r.getValue(id)),
      },
      {
        accessorKey: 'present',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Present
          </SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {row.original.present}
          </span>
        ),
      },
      {
        accessorKey: 'late',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Late
          </SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {row.original.late}
          </span>
        ),
      },
      {
        accessorKey: 'absent',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Absent
          </SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-foreground">
            {row.original.absent}
          </span>
        ),
      },
      {
        accessorKey: 'rate',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Rate
          </SortableHeader>
        ),
        cell: ({ row }) => (
          <span
            className={cn(
              'block text-right font-mono text-sm font-semibold tabular-nums',
              rateClass(row.original.rate)
            )}
          >
            {row.original.rate == null
              ? '—'
              : `${row.original.rate.toFixed(1)}%`}
          </span>
        ),
      },
      {
        accessorKey: 'schoolDays',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            School days
          </SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="block text-right font-mono text-sm tabular-nums text-muted-foreground">
            {row.original.schoolDays}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Tier ① stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Avg rate"
          value={avgRate ?? '—'}
          format="percent"
          icon={Percent}
          subtext="Mean attendance rate"
        />
        <MetricCard
          label="≥ 95%"
          value={bands.good}
          icon={TrendingUp}
          subtext={pct(bands.good, rows.length)}
        />
        <MetricCard
          label="< 85%"
          value={bands.risk}
          icon={TriangleAlert}
          subtext={pct(bands.risk, rows.length)}
        />
        <MetricCard
          label="Absences"
          value={totalAbsences}
          icon={CalendarX}
          subtext="Days marked absent"
        />
      </div>

      {/* Tier ② analytics */}
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightChartCard
          cap="Distribution"
          title="Attendance rate bands"
          icon={Percent}
        >
          {rows.length === 0 ? (
            <EmptyChartState message="No students at this level yet." />
          ) : (
            <DonutChart
              data={bandDonut}
              colors={bandColors}
              centerValue={avgRateLabel}
              centerLabel="Avg rate"
            />
          )}
        </InsightChartCard>
        <InsightChartCard
          cap="By class"
          title="Avg attendance rate per class"
          icon={TrendingUp}
        >
          {!showPerClass ? (
            <EmptyChartState message="Add a second class at this level to compare attendance rates side by side." />
          ) : (
            <ComparisonBarChart
              data={perClass}
              orientation="horizontal"
              yFormat="percent"
              rotateLabels={false}
            />
          )}
        </InsightChartCard>
      </div>

      {/* Tier ③ detail table */}
      <DataTable<AttendanceTableRow>
        data={rows}
        columns={columns}
        getRowId={(r) => r._rowId}
        searchKeys={['studentName', 'studentNumber', 'sectionName']}
        searchPlaceholder="Search students…"
        toolbarLeading={
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
        }
        initialSort={[{ id: 'rate', desc: false }]}
        pageSize={25}
        csv={{
          filename: `attendance-${payload.ayCode}-${payload.level.code}.csv`,
        }}
        url={{ enabled: true, namespace: 'attnsummary' }}
        emptyState={{
          icon: CalendarX,
          title: 'No students match this scope.',
          body: 'Adjust the term above.',
        }}
      />

      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Excused (EX) days are tracked in the Attendance module.
      </p>
    </div>
  );
}
