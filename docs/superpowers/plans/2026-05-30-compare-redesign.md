# Compare Feature Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the CompareGrid table (remove heatmap, add sticky first column, AY group borders, clean delta display) across all 5 modules, and add a subject performance trend chart to the Markbook compare page.

**Architecture:** Two independent workstreams. (1) CompareGrid is a shared component — one file change propagates to all 5 modules; each module page updates its metric `direction` fields. (2) Markbook gets a new `MultiSeriesTrendChart` component (doesn't exist yet), a new `getSubjectPerformanceTrend` query in `lib/markbook/compare.ts`, and an updated compare page that renders the chart above the grid. `CompareCell` gains a `termId` field (needed by the new query) via a small change to `lib/dashboard/compare.ts`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui Table primitives, recharts (already installed), Supabase service client, `unstable_cache`, `fetchAllPages` (already exists at `lib/supabase/paginate.ts`).

---

## File Map

| Action       | File                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Modify       | `lib/dashboard/compare.ts` — add `termId` to `CompareCell` + populate in `buildCompareCells` |
| Full rewrite | `components/dashboard/compare-grid.tsx` — remove heatmap, add sticky col, clean delta        |
| Modify       | `app/(admissions)/admissions/compare/page.tsx` — update metric `direction` fields            |
| Modify       | `app/(attendance)/attendance/compare/page.tsx` — update metric `direction` fields            |
| Modify       | `app/(records)/records/compare/page.tsx` — update metric `direction` fields                  |
| Modify       | `app/(markbook)/markbook/compare/page.tsx` — update `direction` fields + add chart section   |
| Modify       | `app/(evaluation)/evaluation/compare/page.tsx` — update metric `direction` fields            |
| Modify       | `lib/markbook/compare.ts` — add `SubjectTrendPoint` type + `getSubjectPerformanceTrend`      |
| Create       | `components/dashboard/charts/multi-series-trend-chart.client.tsx`                            |
| Create       | `components/dashboard/charts/multi-series-trend-chart.tsx` (next/dynamic wrapper)            |

---

## Task 1: Add `termId` to `CompareCell`

**Files:**

- Modify: `lib/dashboard/compare.ts`

`CompareCell` currently has no term UUID — only `termNumber: number`. The Markbook subject performance query needs the actual `term.id` UUID to filter `grading_sheets.term_id`. This change adds `termId?: string` to the type and populates it when building term-kind cells.

- [ ] **Step 1: Update `CompareCell` type** — add `termId?: string` after `termNumber?`:

```typescript
export type CompareCell = {
  ayCode: string;
  label: string;
  range: DateRange;
  kind: 'term' | 'month';
  termNumber?: number;
  month?: string;
  termId?: string; // populated for term-kind cells only
};
```

- [ ] **Step 2: Update the terms query** — add `id` to the select:

Change line 112:

```typescript
// BEFORE
.select('term_number, start_date, end_date, academic_years!inner(ay_code)')
// AFTER
.select('id, term_number, start_date, end_date, academic_years!inner(ay_code)')
```

- [ ] **Step 3: Update the `Row` type** — add `id: string`:

```typescript
type Row = {
  id: string;
  term_number: number;
  start_date: string | null;
  end_date: string | null;
  academic_years: { ay_code: string } | { ay_code: string }[];
};
```

- [ ] **Step 4: Update `termsByAy` Map** — store both range and termId:

Change the Map type and its population:

```typescript
// BEFORE
const termsByAy = new Map<string, Map<number, DateRange>>();
// ...
termsByAy.get(ay.ay_code)!.set(row.term_number, {
  from: row.start_date,
  to: row.end_date,
});

// AFTER
const termsByAy = new Map<
  string,
  Map<number, { range: DateRange; termId: string }>
>();
// ...
termsByAy.get(ay.ay_code)!.set(row.term_number, {
  range: { from: row.start_date, to: row.end_date },
  termId: row.id,
});
```

- [ ] **Step 5: Update cell building** — read from new Map shape and add `termId`:

```typescript
// BEFORE
const range = ayTerms?.get(t);
if (!range) continue;
cells.push({
  ayCode: ay,
  label: `${ay} · T${t}`,
  range,
  kind: 'term',
  termNumber: t,
});

// AFTER
const termData = ayTerms?.get(t);
if (!termData) continue;
cells.push({
  ayCode: ay,
  label: `${ay} · T${t}`,
  range: termData.range,
  kind: 'term',
  termNumber: t,
  termId: termData.termId,
});
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/compare.ts
git commit -m "feat(compare): add termId to CompareCell for term-kind cells

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Redesign `CompareGrid`

**Files:**

- Full rewrite: `components/dashboard/compare-grid.tsx`

Removes `bucketOf`, `Bucket`, `BUCKET_CLASS`, `lowerIsBetter`, `highlightExtremes`. Adds `direction`, sticky first column, AY group top-border, min/max dot on row label. All cell backgrounds become plain `bg-card`.

- [ ] **Step 1: Write the complete new file**

```typescript
import { LayoutGrid } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { CompareCellResult } from '@/lib/dashboard/compare';

export type CompareGridMetric<T> = {
  key: string;
  label: string;
  format?: 'number' | 'percent' | 'days';
  /** Pull the numeric value out of T for this metric. null = no data. */
  getValue: (data: T) => number | null;
  /**
   * 'higherIsBetter' | 'lowerIsBetter' — drives delta colour and min/max dot.
   * Omit for ambiguous metrics (transfers, expected counts, etc.) — delta
   * and dot are suppressed to avoid misleading direction signals.
   */
  direction?: 'higherIsBetter' | 'lowerIsBetter';
};

export type CompareGridProps<T> = {
  cells: CompareCellResult<T>[];
  metrics: CompareGridMetric<T>[];
  title: string;
  description?: string;
};

function formatValue(
  v: number | null,
  fmt: CompareGridMetric<unknown>['format']
): string {
  if (v === null) return '—';
  if (fmt === 'percent') return `${Math.round(v)}%`;
  if (fmt === 'days') return `${Math.round(v)}d`;
  return v.toLocaleString('en-SG');
}

function formatDelta(
  value: number | null,
  baseline: number | null,
  fmt: CompareGridMetric<unknown>['format'],
  direction: CompareGridMetric<unknown>['direction'],
  isBaseline: boolean
): { text: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (isBaseline) return null;
  if (value === null || baseline === null) return null;
  if (value === baseline) return { text: '± 0', tone: 'neutral' };

  const isPositive = value > baseline;
  let tone: 'good' | 'bad' | 'neutral' = 'neutral';
  if (direction === 'higherIsBetter') tone = isPositive ? 'good' : 'bad';
  if (direction === 'lowerIsBetter') tone = isPositive ? 'bad' : 'good';

  if (fmt === 'percent') {
    const diff = value - baseline;
    return { text: `${diff > 0 ? '+' : ''}${Math.round(diff)}pp`, tone };
  }
  if (baseline === 0) {
    return { text: value > 0 ? 'new' : '—', tone };
  }
  const pct = ((value - baseline) / Math.abs(baseline)) * 100;
  return { text: `${pct > 0 ? '+' : ''}${Math.round(pct)}%`, tone };
}

const DELTA_TONE: Record<'good' | 'bad' | 'neutral', string> = {
  good: 'text-brand-mint',
  bad: 'text-destructive',
  neutral: 'text-muted-foreground',
};

function cellSubLabel(cell: CompareCellResult<unknown>['cell']): string {
  if (cell.kind === 'term' && cell.termNumber !== undefined) {
    return `T${cell.termNumber}`;
  }
  if (cell.kind === 'month' && cell.month) {
    const [y, m] = cell.month.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' });
  }
  const idx = cell.label.indexOf('·');
  return idx >= 0 ? cell.label.slice(idx + 1).trim() : cell.label;
}

function groupByAy<T>(
  cells: CompareCellResult<T>[]
): Array<{ ayCode: string; startIdx: number; span: number }> {
  const groups: Array<{ ayCode: string; startIdx: number; span: number }> = [];
  for (let i = 0; i < cells.length; i++) {
    const code = cells[i].cell.ayCode;
    const last = groups[groups.length - 1];
    if (last && last.ayCode === code) {
      last.span += 1;
    } else {
      groups.push({ ayCode: code, startIdx: i, span: 1 });
    }
  }
  return groups;
}

/**
 * Find best and worst cell indices for a metric row.
 * Returns null for both when direction is unset (neutral metric) or all values equal.
 */
function findBestWorst(
  values: (number | null)[],
  direction: CompareGridMetric<unknown>['direction']
): { bestIdx: number | null; worstIdx: number | null } {
  if (!direction) return { bestIdx: null, worstIdx: null };
  const numeric = values
    .map((v, i) => (v !== null ? { v, i } : null))
    .filter((x): x is { v: number; i: number } => x !== null);
  if (numeric.length < 2) return { bestIdx: null, worstIdx: null };
  const sorted = [...numeric].sort((a, b) => a.v - b.v);
  const minItem = sorted[0];
  const maxItem = sorted[sorted.length - 1];
  if (minItem.v === maxItem.v) return { bestIdx: null, worstIdx: null };
  return direction === 'lowerIsBetter'
    ? { bestIdx: minItem.i, worstIdx: maxItem.i }
    : { bestIdx: maxItem.i, worstIdx: minItem.i };
}

export function CompareGrid<T>({
  cells,
  metrics,
  title,
  description,
}: CompareGridProps<T>) {
  const ayGroups = groupByAy(cells);
  const baselineIdx = 0;

  return (
    <Card className="@container/card">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <span
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile"
          aria-hidden
        >
          <LayoutGrid className="h-5 w-5" />
        </span>
        <div className="flex-1 space-y-1">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Compare
          </CardDescription>
          <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
            {title}
          </CardTitle>
          {description && (
            <p className="text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <Table>
            <TableHeader>
              {/* AY group row — 2px indigo top border groups columns by year */}
              <TableRow className="hover:bg-transparent">
                <TableHead
                  rowSpan={2}
                  className="sticky left-0 z-20 border-r border-hairline bg-muted/30 align-bottom"
                >
                  Metric
                </TableHead>
                {ayGroups.map((g) => (
                  <TableHead
                    key={g.ayCode}
                    colSpan={g.span}
                    className="border-l border-t-2 border-l-hairline border-t-brand-indigo/30 bg-card text-center text-[11px] font-semibold text-brand-navy"
                  >
                    {g.ayCode}
                  </TableHead>
                ))}
              </TableRow>
              {/* Per-cell sub-labels */}
              <TableRow className="hover:bg-transparent">
                {cells.map((c, i) => (
                  <TableHead
                    key={`${c.cell.ayCode}-${cellSubLabel(c.cell)}-${i}`}
                    className={cn(
                      'h-9 border-l border-hairline bg-muted/20 text-center text-muted-foreground',
                      i === baselineIdx && 'font-semibold text-foreground'
                    )}
                    title={
                      i === baselineIdx
                        ? 'Baseline — Δ values are measured against this cell'
                        : undefined
                    }
                  >
                    {cellSubLabel(c.cell)}
                    {i === baselineIdx && (
                      <span className="ml-1 text-[8px] tracking-normal text-muted-foreground/70">
                        BASE
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.map((metric) => {
                const values = cells.map((c) => metric.getValue(c.data));
                const baselineValue = values[baselineIdx];
                const { bestIdx, worstIdx } = findBestWorst(values, metric.direction);
                return (
                  <TableRow key={metric.key}>
                    {/* Sticky metric label column */}
                    <TableCell className="sticky left-0 z-10 border-r border-hairline bg-card text-foreground">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{metric.label}</span>
                        {metric.direction === 'lowerIsBetter' && (
                          <span
                            className="text-[10px] text-muted-foreground"
                            title="Lower is better"
                          >
                            ↓
                          </span>
                        )}
                        {bestIdx !== null && worstIdx !== null && (
                          <span className="ml-auto flex gap-0.5 text-[10px]">
                            <span
                              className="text-brand-mint"
                              title={`Best: ${cells[bestIdx].cell.label}`}
                            >
                              ●
                            </span>
                            <span
                              className="text-destructive"
                              title={`Worst: ${cells[worstIdx].cell.label}`}
                            >
                              ●
                            </span>
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {cells.map((c, i) => {
                      const v = values[i];
                      const delta = formatDelta(
                        v,
                        baselineValue,
                        metric.format,
                        metric.direction,
                        i === baselineIdx
                      );
                      return (
                        <TableCell
                          key={`${c.cell.label}-${i}`}
                          className="border-l border-hairline text-right align-middle font-mono tabular-nums"
                          title={v === null ? 'No data for this period' : undefined}
                        >
                          <div className="font-semibold text-foreground">
                            {formatValue(v, metric.format)}
                          </div>
                          {delta && (
                            <div
                              className={cn(
                                'mt-0.5 text-[10px] font-normal tracking-tight',
                                DELTA_TONE[delta.tone]
                              )}
                            >
                              {delta.text}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 px-1 text-[11px] text-muted-foreground">
          Δ values are measured against the leftmost{' '}
          <span className="font-mono">BASE</span> cell.{' '}
          <span className="font-mono">↓</span> on the metric label means lower
          is better. ● mint = best, ● red = worst (only shown for directional
          metrics).
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. (The 5 compare pages will have TypeScript errors until Task 3 — that's expected.)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/compare-grid.tsx
git commit -m "feat(compare): redesign CompareGrid — remove heatmap, sticky col, AY borders, clean delta

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update metric definitions in all 5 compare pages

**Files:**

- Modify: `app/(admissions)/admissions/compare/page.tsx`
- Modify: `app/(attendance)/attendance/compare/page.tsx`
- Modify: `app/(records)/records/compare/page.tsx`
- Modify: `app/(markbook)/markbook/compare/page.tsx`
- Modify: `app/(evaluation)/evaluation/compare/page.tsx`

Replace `lowerIsBetter: true/false` with `direction: 'lowerIsBetter'/'higherIsBetter'`. Remove all `highlightExtremes` props. Leave neutral metrics without a `direction` field.

- [ ] **Step 1: Update `app/(admissions)/admissions/compare/page.tsx`**

Replace the entire `metrics` array:

```typescript
const metrics: CompareGridMetric<AdmissionsCompareKpis>[] = [
  {
    key: 'applicationsInRange',
    label: 'Applications received',
    format: 'number',
    getValue: (d) => d.applicationsInRange,
    direction: 'higherIsBetter',
  },
  {
    key: 'enrolledInRange',
    label: 'Enrolled in range',
    format: 'number',
    getValue: (d) => d.enrolledInRange,
    direction: 'higherIsBetter',
  },
  {
    key: 'conversionPct',
    label: 'Conversion %',
    format: 'percent',
    getValue: (d) => d.conversionPct,
    direction: 'higherIsBetter',
  },
  {
    key: 'avgDaysToEnroll',
    label: 'Avg days to enroll',
    format: 'days',
    getValue: (d) => d.avgDaysToEnroll,
    direction: 'lowerIsBetter',
  },
  {
    key: 'sampleSize',
    label: 'Sample size',
    format: 'number',
    getValue: (d) => d.sampleSize,
  },
];
```

- [ ] **Step 2: Update `app/(attendance)/attendance/compare/page.tsx`**

Replace the entire `metrics` array:

```typescript
const metrics: CompareGridMetric<AttendanceCompareKpis>[] = [
  {
    key: 'attendancePct',
    label: 'Attendance %',
    format: 'percent',
    getValue: (d) => d.attendancePct,
    direction: 'higherIsBetter',
  },
  {
    key: 'present',
    label: 'Present',
    format: 'number',
    getValue: (d) => d.present,
    direction: 'higherIsBetter',
  },
  {
    key: 'late',
    label: 'Late',
    format: 'number',
    getValue: (d) => d.late,
    direction: 'lowerIsBetter',
  },
  {
    key: 'absent',
    label: 'Absent',
    format: 'number',
    getValue: (d) => d.absent,
    direction: 'lowerIsBetter',
  },
  {
    key: 'excused',
    label: 'Excused',
    format: 'number',
    getValue: (d) => d.excused,
  },
  {
    key: 'encodedDays',
    label: 'School days',
    format: 'number',
    getValue: (d) => d.encodedDays,
  },
];
```

- [ ] **Step 3: Update `app/(records)/records/compare/page.tsx`**

Replace the entire `metrics` array:

```typescript
const metrics: CompareGridMetric<RecordsCompareKpis>[] = [
  {
    key: 'activeEnrolled',
    label: 'Active enrolled',
    format: 'number',
    getValue: (d) => d.activeEnrolled,
  },
  {
    key: 'enrollmentsInRange',
    label: 'Enrollments in range',
    format: 'number',
    getValue: (d) => d.enrollmentsInRange,
    direction: 'higherIsBetter',
  },
  {
    key: 'lateEnroleesInRange',
    label: 'Late enrolees',
    format: 'number',
    getValue: (d) => d.lateEnroleesInRange,
  },
  {
    key: 'withdrawalsInRange',
    label: 'Withdrawals in range',
    format: 'number',
    getValue: (d) => d.withdrawalsInRange,
    direction: 'lowerIsBetter',
  },
  {
    key: 'expiringSoon',
    label: 'Expiring soon',
    format: 'number',
    getValue: (d) => d.expiringSoon,
    direction: 'lowerIsBetter',
  },
];
```

- [ ] **Step 4: Update `app/(markbook)/markbook/compare/page.tsx`**

Replace the entire `metrics` array (the chart section comes in Task 6):

```typescript
const metrics: CompareGridMetric<MarkbookCompareKpis>[] = [
  {
    key: 'gradesEntered',
    label: 'Grade entries',
    format: 'number',
    getValue: (d) => d.gradesEntered,
  },
  {
    key: 'sheetsLocked',
    label: 'Sheets locked',
    format: 'number',
    getValue: (d) => d.sheetsLocked,
    direction: 'higherIsBetter',
  },
  {
    key: 'lockedPct',
    label: 'Lock %',
    format: 'percent',
    getValue: (d) => d.lockedPct,
    direction: 'higherIsBetter',
  },
  {
    key: 'changeRequestsPending',
    label: 'CRs pending',
    format: 'number',
    getValue: (d) => d.changeRequestsPending,
    direction: 'lowerIsBetter',
  },
  {
    key: 'avgDecisionHours',
    label: 'Avg decision (hrs)',
    format: 'days',
    getValue: (d) => d.avgDecisionHours,
    direction: 'lowerIsBetter',
  },
];
```

- [ ] **Step 5: Update `app/(evaluation)/evaluation/compare/page.tsx`**

Replace the entire `metrics` array:

```typescript
const metrics: CompareGridMetric<EvaluationCompareKpis>[] = [
  {
    key: 'submissionPct',
    label: 'Submission %',
    format: 'percent',
    getValue: (d) => d.submissionPct,
    direction: 'higherIsBetter',
  },
  {
    key: 'submitted',
    label: 'Submitted',
    format: 'number',
    getValue: (d) => d.submitted,
    direction: 'higherIsBetter',
  },
  {
    key: 'expected',
    label: 'Expected',
    format: 'number',
    getValue: (d) => d.expected,
  },
  {
    key: 'medianTimeToSubmitDays',
    label: 'Median time to submit',
    format: 'days',
    getValue: (d) => d.medianTimeToSubmitDays,
    direction: 'lowerIsBetter',
  },
  {
    key: 'lateSubmissions',
    label: 'Late submissions',
    format: 'number',
    getValue: (d) => d.lateSubmissions,
    direction: 'lowerIsBetter',
  },
];
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add "app/(admissions)/admissions/compare/page.tsx" \
        "app/(attendance)/attendance/compare/page.tsx" \
        "app/(records)/records/compare/page.tsx" \
        "app/(markbook)/markbook/compare/page.tsx" \
        "app/(evaluation)/evaluation/compare/page.tsx"
git commit -m "feat(compare): update metric direction fields across all 5 modules

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Create `MultiSeriesTrendChart`

**Files:**

- Create: `components/dashboard/charts/multi-series-trend-chart.client.tsx`
- Create: `components/dashboard/charts/multi-series-trend-chart.tsx`

The existing `TrendChart` only supports one current + one optional comparison series. The Markbook subject performance chart needs N series (one per subject). Follow the exact same file-splitting pattern as `trend-chart.tsx` / `trend-chart.client.tsx`. The `ChartSkeleton` already has a `'multi-trend'` kind slot (h-[240px]).

- [ ] **Step 1: Create `components/dashboard/charts/multi-series-trend-chart.client.tsx`**

```typescript
'use client';

import * as React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type MultiSeriesTrendSeries = {
  key: string;
  label: string;
};

export type MultiSeriesTrendChartProps = {
  /** Each series maps to one line. series[i].key must be a key in data objects. */
  series: MultiSeriesTrendSeries[];
  /** Each object has 'x' (string label) + one numeric key per series. */
  data: Array<Record<string, string | number | null>>;
  height?: number;
  yFormat?: 'number' | 'percent' | 'days';
  /** Fixed Y domain e.g. [0, 100] for grade charts. */
  yDomain?: [number, number];
};

const SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
];

function formatY(
  v: number,
  fmt: MultiSeriesTrendChartProps['yFormat']
): string {
  if (fmt === 'percent') return `${Math.round(v)}%`;
  if (fmt === 'days') return `${Math.round(v)}d`;
  return v.toLocaleString('en-SG');
}

function MultiSeriesTrendChartImpl({
  series,
  data,
  height = 240,
  yFormat,
  yDomain,
}: MultiSeriesTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="2 4"
          stroke="var(--color-border)"
          vertical={false}
          opacity={0.6}
        />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={32}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => formatY(v as number, yFormat)}
          domain={yDomain}
          width={36}
        />
        <Tooltip
          cursor={{
            stroke: 'var(--color-muted-foreground)',
            strokeDasharray: '3 3',
          }}
          contentStyle={{
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            fontSize: 11,
            padding: '8px 10px',
          }}
          labelStyle={{
            color: 'var(--color-foreground)',
            fontWeight: 600,
            marginBottom: 2,
          }}
          formatter={(value, name) => {
            const v = typeof value === 'number' ? value : Number(value);
            return [formatY(v, yFormat), name as string];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          iconType="line"
          iconSize={12}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              strokeWidth: 2,
              stroke: 'var(--color-background)',
            }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export const MultiSeriesTrendChart = React.memo(MultiSeriesTrendChartImpl);
MultiSeriesTrendChart.displayName = 'MultiSeriesTrendChart';
```

- [ ] **Step 2: Create `components/dashboard/charts/multi-series-trend-chart.tsx`**

```typescript
import dynamic from 'next/dynamic';

import { ChartSkeleton } from './chart-skeleton';
import type {
  MultiSeriesTrendChartProps,
  MultiSeriesTrendSeries,
} from './multi-series-trend-chart.client';

const MultiSeriesTrendChartImpl = dynamic(
  () =>
    import('./multi-series-trend-chart.client').then(
      (m) => m.MultiSeriesTrendChart
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton kind="multi-trend" />,
  }
);

export function MultiSeriesTrendChart(props: MultiSeriesTrendChartProps) {
  return <MultiSeriesTrendChartImpl {...props} />;
}

export type { MultiSeriesTrendChartProps, MultiSeriesTrendSeries };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/charts/multi-series-trend-chart.client.tsx \
        components/dashboard/charts/multi-series-trend-chart.tsx
git commit -m "feat(charts): add MultiSeriesTrendChart (N-series line chart)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Add `getSubjectPerformanceTrend` to `lib/markbook/compare.ts`

**Files:**

- Modify: `lib/markbook/compare.ts`

Two-step server query: (1) fetch examinable grading sheets for the selected term IDs, (2) fetch all grade entries for those sheets via `fetchAllPages`, (3) compute averages in JS. Wrapped in `unstable_cache` keyed on sorted term IDs.

- [ ] **Step 1: Add imports at the top of `lib/markbook/compare.ts`**

Add after the existing imports:

```typescript
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages } from '@/lib/supabase/paginate';
import type { CompareCellResult } from '@/lib/dashboard/compare';
```

- [ ] **Step 2: Add the `SubjectTrendPoint` type**

Add after the `MarkbookCompareKpis` export:

```typescript
export type SubjectTrendPoint = {
  /** e.g. "T1", "T2" */
  periodLabel: string;
  ayCode: string;
  termId: string;
  subjectName: string;
  /** Average quarterly grade rounded to 1dp. null when no entries exist. */
  avgGrade: number | null;
};
```

- [ ] **Step 3: Add the internal uncached loader**

Add after the `getMarkbookCompareKpis` function:

```typescript
type CellMeta = {
  termId: string;
  periodLabel: string;
  ayCode: string;
};

async function loadSubjectPerformanceTrendUncached(
  termIds: string[],
  cellMeta: CellMeta[]
): Promise<SubjectTrendPoint[]> {
  const service = createServiceClient();

  // Step A: get all examinable grading sheets for the selected terms.
  type SheetRow = {
    id: string;
    term_id: string;
    subject:
      | { name: string; is_examinable: boolean }
      | { name: string; is_examinable: boolean }[]
      | null;
  };
  const { data: sheets, error: sheetsErr } = await service
    .from('grading_sheets')
    .select('id, term_id, subject:subjects!inner(name, is_examinable)')
    .in('term_id', termIds)
    .eq('subjects.is_examinable', true);

  if (sheetsErr || !sheets || sheets.length === 0) return [];

  // Build a map: sheetId → { termId, subjectName }
  const sheetMeta = new Map<string, { termId: string; subjectName: string }>();
  for (const s of sheets as SheetRow[]) {
    const subject = Array.isArray(s.subject) ? s.subject[0] : s.subject;
    if (!subject?.is_examinable) continue;
    sheetMeta.set(s.id, { termId: s.term_id, subjectName: subject.name });
  }

  const sheetIds = Array.from(sheetMeta.keys());
  if (sheetIds.length === 0) return [];

  // Step B: fetch all grade entries for these sheets (paginated past 1000-row cap).
  type EntryRow = { grading_sheet_id: string; quarterly_grade: number | null };
  const entries = await fetchAllPages<EntryRow>((from, to) =>
    service
      .from('grade_entries')
      .select('grading_sheet_id, quarterly_grade')
      .in('grading_sheet_id', sheetIds)
      .not('quarterly_grade', 'is', null)
      .range(from, to)
  );

  // Step C: compute sums per (termId, subjectName).
  const sums = new Map<string, { sum: number; count: number }>();
  for (const entry of entries) {
    if (entry.quarterly_grade === null) continue;
    const meta = sheetMeta.get(entry.grading_sheet_id);
    if (!meta) continue;
    const key = `${meta.termId}\x00${meta.subjectName}`;
    const slot = sums.get(key) ?? { sum: 0, count: 0 };
    slot.sum += entry.quarterly_grade;
    slot.count += 1;
    sums.set(key, slot);
  }

  // Step D: build result array using cellMeta for period labels.
  const cellByTermId = new Map<string, CellMeta>(
    cellMeta.map((c) => [c.termId, c])
  );

  const points: SubjectTrendPoint[] = [];
  for (const [key, { sum, count }] of sums) {
    const nullIdx = key.indexOf('\x00');
    const termId = key.slice(0, nullIdx);
    const subjectName = key.slice(nullIdx + 1);
    const cell = cellByTermId.get(termId);
    if (!cell) continue;
    points.push({
      periodLabel: cell.periodLabel,
      ayCode: cell.ayCode,
      termId,
      subjectName,
      avgGrade: count > 0 ? Math.round((sum / count) * 10) / 10 : null,
    });
  }

  return points;
}
```

- [ ] **Step 4: Add the exported cached function**

Add after `loadSubjectPerformanceTrendUncached`:

```typescript
export function getSubjectPerformanceTrend(
  cells: CompareCellResult<MarkbookCompareKpis>[]
): Promise<SubjectTrendPoint[]> {
  const cellMeta: CellMeta[] = cells
    .filter((c) => !!c.cell.termId)
    .map((c) => ({
      termId: c.cell.termId!,
      periodLabel: `T${c.cell.termNumber ?? '?'}`,
      ayCode: c.cell.ayCode,
    }));

  if (cellMeta.length === 0) return Promise.resolve([]);

  const termIds = [...new Set(cellMeta.map((c) => c.termId))].sort();
  const firstAy = cellMeta[0].ayCode;

  return unstable_cache(
    loadSubjectPerformanceTrendUncached,
    ['markbook', 'subject-performance', ...termIds],
    { tags: [`markbook-drill:${firstAy}`], revalidate: 60 }
  )(termIds, cellMeta);
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/markbook/compare.ts
git commit -m "feat(markbook): add getSubjectPerformanceTrend for compare page chart

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Add subject performance chart to Markbook compare page

**Files:**

- Modify: `app/(markbook)/markbook/compare/page.tsx`

Call `getSubjectPerformanceTrend` in parallel with the existing KPI fetch. Group results by AY, build recharts data arrays, and render one `MultiSeriesTrendChart` per AY above the `CompareGrid`.

- [ ] **Step 1: Replace the entire file content**

```typescript
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import {
  CompareGrid,
  type CompareGridMetric,
} from '@/components/dashboard/compare-grid';
import { CompareToolbar } from '@/components/dashboard/compare-toolbar';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { listAyCodes } from '@/lib/academic-year';
import { parseCompareParams } from '@/lib/dashboard/compare';
import {
  getMarkbookCompareKpis,
  getSubjectPerformanceTrend,
  type MarkbookCompareKpis,
  type SubjectTrendPoint,
} from '@/lib/markbook/compare';
import { createClient, getSessionUser } from '@/lib/supabase/server';

const ALLOWED_ROLES = new Set(['registrar', 'school_admin', 'superadmin']);

export default async function MarkbookComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ays?: string; terms?: string; months?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!sessionUser.role || !ALLOWED_ROLES.has(sessionUser.role)) {
    notFound();
  }

  const sp = await searchParams;
  const supabase = await createClient();
  const ayCodes = await listAyCodes(supabase);
  const input = parseCompareParams(sp);

  // Fetch KPIs first (builds the cells, which carry termId), then derive
  // the subject-performance trend from those same cells. Sequential because
  // the trend query depends on compareData.cells.
  let compareData:
    | Awaited<ReturnType<typeof getMarkbookCompareKpis>>
    | null = null;
  let trendPoints: SubjectTrendPoint[] = [];
  if (input) {
    compareData = await getMarkbookCompareKpis(input);
    trendPoints = await getSubjectPerformanceTrend(compareData.cells);
  }

  const metrics: CompareGridMetric<MarkbookCompareKpis>[] = [
    {
      key: 'gradesEntered',
      label: 'Grade entries',
      format: 'number',
      getValue: (d) => d.gradesEntered,
    },
    {
      key: 'sheetsLocked',
      label: 'Sheets locked',
      format: 'number',
      getValue: (d) => d.sheetsLocked,
      direction: 'higherIsBetter',
    },
    {
      key: 'lockedPct',
      label: 'Lock %',
      format: 'percent',
      getValue: (d) => d.lockedPct,
      direction: 'higherIsBetter',
    },
    {
      key: 'changeRequestsPending',
      label: 'CRs pending',
      format: 'number',
      getValue: (d) => d.changeRequestsPending,
      direction: 'lowerIsBetter',
    },
    {
      key: 'avgDecisionHours',
      label: 'Avg decision (hrs)',
      format: 'days',
      getValue: (d) => d.avgDecisionHours,
      direction: 'lowerIsBetter',
    },
  ];

  return (
    <PageShell>
      <Link
        href="/markbook"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Markbook
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Markbook · Compare
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Term-on-term, year-on-year.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Pick the academic years and terms you want to line up, side by side.
          Numbers are equivalent slices — T1 of one AY against T1 of another —
          so you can spot real movement.
        </p>
      </header>

      <CompareToolbar kind="term" ayCodes={ayCodes} initial={input} />

      {!input ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          Pick at least one AY and one term above to see the comparison.
        </div>
      ) : compareData && compareData.cells.length > 0 ? (
        <>
          <SubjectPerformanceCharts
            cells={compareData.cells}
            trendPoints={trendPoints}
          />
          <CompareGrid
            title="KPI comparison"
            description={`${compareData.cells.length} cell${compareData.cells.length === 1 ? '' : 's'} — ${input.ays.join(', ')} × ${input.terms.map((t) => `T${t}`).join(', ')}`}
            cells={compareData.cells}
            metrics={metrics}
          />
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
          No data found for this selection. Verify the AYs and terms are seeded.
        </div>
      )}
    </PageShell>
  );
}

/**
 * Renders one subject performance chart per AY.
 * One line per examinable subject; X axis = selected terms in order.
 * Hidden entirely when no trend data is available.
 */
function SubjectPerformanceCharts({
  cells,
  trendPoints,
}: {
  cells: Array<{ cell: { ayCode: string; termId?: string; termNumber?: number } }>;
  trendPoints: SubjectTrendPoint[];
}) {
  if (trendPoints.length === 0) return null;

  // Group trend points by AY
  const byAy = new Map<string, SubjectTrendPoint[]>();
  for (const pt of trendPoints) {
    if (!byAy.has(pt.ayCode)) byAy.set(pt.ayCode, []);
    byAy.get(pt.ayCode)!.push(pt);
  }

  // Period order: T1 < T2 < T3 < T4
  const allPeriods = [
    ...new Set(
      cells
        .map((c) => (c.cell.termNumber ? `T${c.cell.termNumber}` : null))
        .filter((p): p is string => p !== null)
    ),
  ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  const ayEntries = Array.from(byAy.entries());

  return (
    <div
      className={`grid grid-cols-1 gap-6 ${ayEntries.length > 1 ? 'md:grid-cols-2' : ''}`}
    >
      {ayEntries.map(([ayCode, points]) => {
        const subjects = [...new Set(points.map((p) => p.subjectName))].sort();
        if (subjects.length === 0) return null;

        const chartData = allPeriods.map((period) => {
          const row: Record<string, string | number | null> = { x: period };
          for (const subject of subjects) {
            const pt = points.find(
              (p) => p.periodLabel === period && p.subjectName === subject
            );
            row[subject] = pt?.avgGrade ?? null;
          }
          return row;
        });

        const series = subjects.map((s) => ({ key: s, label: s }));

        return (
          <Card key={ayCode} className="@container/card">
            <CardHeader className="space-y-1">
              <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
                Average quarterly grade
              </CardDescription>
              <CardTitle className="font-serif text-[18px] font-semibold tracking-tight text-foreground">
                Subject Performance — {ayCode}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MultiSeriesTrendChart
                series={series}
                data={chartData}
                yFormat="number"
                yDomain={[0, 100]}
                height={240}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(markbook)/markbook/compare/page.tsx"
git commit -m "feat(markbook): add subject performance trend chart to compare page

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Build verification

- [ ] **Step 1: Run full build**

```bash
npx next build
```

Expected: clean compile, 0 TypeScript errors, all routes generate successfully.

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```

Expected: all 77 tests passing.

- [ ] **Step 3: Fix any build errors, commit if needed**

If `npx next build` surfaces errors, the most likely causes:

- Missing import in any compare page (check all 5 pages import `CompareGridMetric` without `lowerIsBetter`)
- `getSubjectPerformanceTrend` type mismatch on `cells` argument (verify `CompareCellResult<MarkbookCompareKpis>[]` type matches)
- `MultiSeriesTrendChart` missing `'use client'` boundary (the RSC wrapper handles this via `dynamic` — verify `ssr: false` is set)

```bash
git add <fixed-files>
git commit -m "fix(compare): resolve build errors after redesign

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
