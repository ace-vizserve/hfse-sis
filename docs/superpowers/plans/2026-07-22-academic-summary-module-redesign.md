# Academic Summary → Module Pages Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the three Records → Academic Summary quick-views into their owning modules as standalone three-tier analytics pages — Awards (`/markbook/awards`), Attendance Summary (`/attendance/summary`), Comments (`/evaluation/comments`) — while the masterfile export stays on Records.

**Architecture:** Each page is an async RSC that resolves scope via the existing `resolveAcademicSummaryScope` (AY × level × class), renders the `MasterfileToolbar` picker, and mounts a `'use client'` view component that transforms the same `MasterfilePayload` (via the existing pure `buildAwardsRows`/`buildAttendanceRows`/`buildCommentRows`) into three tiers: ① `MetricCard` stat row → ② two analytics panels (a partition `DonutChart` + a `GroupedBarChart`/`ComparisonBarChart`) → ③ a `<DataTable>` detail table. Zero new data plumbing; the old quick-view routes become query-preserving redirect stubs; the old view components are deleted.

**Tech Stack:** Next.js 16 (App Router, RSC/client split), TypeScript, existing `components/dashboard/charts/*` (recharts wrappers), `components/ui/data-table` shell (`@tanstack/react-table`), Aurora Vault tokens, Vitest + `@testing-library/react`.

## Global Constraints

- **Hard Rule #7 (binding):** tokens only from `app/globals.css`. No raw `#rrggbb` / `oklch(...)` / `slate-*` / `zinc-*` / `gray-*` / `bg-white` / `bg-black` in `app/` or `components/`. Use semantic (`bg-card`, `text-foreground`) or explicit Aurora Vault (`brand-amber`, `brand-bronze`, `ink-4`, `brand-mint`) tokens. Chart colors passed as `var(--color-*)` CSS vars.
- **Access:** all three pages are `registrar | school_admin | superadmin` only (same as Academic Summary today) — via an explicit `ROUTE_ACCESS` row placed **above** the broad module rule + `requiresRoles` on the nav item + a per-page RSC guard.
- **count == table (KD #124):** tier ① + ② aggregates are computed from the **same** `build*Rows` output the tier ③ table lists (the table may narrow further via its own controls, but the headline scope must match).
- **No new data plumbing:** reuse `loadMasterfile`, `resolveAcademicSummaryScope`, `MasterfileToolbar`, and the pure `build*Rows` — do not modify their logic.
- **Chart wrappers** are `'use client'` dynamic components used directly inside the `'use client'` view components; guard every chart with an `EmptyChartState` when its data is empty (chart wrappers already return `null`, but the page must not render an orphaned header).
- **Verify each task:** `npx tsc --noEmit` clean; `npx vitest run` no count regression; the final task runs `npx next build` + a Hard-Rule-#7 grep sweep.

---

## File Structure

**New:**

- `app/(markbook)/markbook/awards/page.tsx` — Awards RSC (guard + scope + header + toolbar + view).
- `components/markbook/awards/awards-summary-view.tsx` — `'use client'` three-tier Awards view.
- `app/(attendance)/attendance/summary/page.tsx` — Attendance Summary RSC.
- `components/attendance/summary/attendance-summary-view.tsx` — Attendance Summary view.
- `app/(evaluation)/evaluation/comments/page.tsx` — Comments RSC.
- `components/evaluation/comments/comments-summary-view.tsx` — Comments view.
- `components/dashboard/insights/insight-chart-card.tsx` — shared `InsightChartCard` + `EmptyChartState` (extracted so the three new pages don't re-declare them).

**Modified:**

- `components/dashboard/metric-card.tsx` — add optional `tileClassName` prop (tier-tinted icon tiles).
- `lib/auth/roles.ts` — 3 `ROUTE_ACCESS` rows; add Awards/Attendance-Summary/Comments nav items; drop the 3 `academic-summary/*` sub-items from `RECORDS_NAV`.
- `lib/sidebar/registry.ts` — `iconByHref` add 3 new / remove 3 old.

**Rewritten as redirect stubs:**

- `app/(records)/records/academic-summary/awards/page.tsx` → `/markbook/awards`.
- `app/(records)/records/academic-summary/attendance/page.tsx` → `/attendance/summary`.
- `app/(records)/records/academic-summary/comments/page.tsx` → `/evaluation/comments`.

**Deleted:**

- `components/markbook/academic-summary/awards-view.tsx`
- `components/markbook/academic-summary/attendance-view.tsx`
- `components/markbook/academic-summary/comments-view.tsx`
- `components/markbook/academic-summary/quick-view-header.tsx` (only if no other importer remains — grep first).

---

### Task 1: `MetricCard` gains a `tileClassName` prop

**Files:**

- Modify: `components/dashboard/metric-card.tsx`
- Test: `__tests__/dashboard/metric-card-tile.test.tsx` (create)

**Interfaces:**

- Produces: `MetricCardProps.tileClassName?: string` — when set, replaces the default `bg-gradient-to-br from-brand-indigo to-brand-navy` tile gradient (the Awards Gold/Silver/Bronze tiles pass tier gradients). Default behavior unchanged.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/dashboard/metric-card-tile.test.tsx
import { render } from '@testing-library/react';
import { Trophy } from 'lucide-react';
import { MetricCard } from '@/components/dashboard/metric-card';

describe('MetricCard tileClassName', () => {
  it('applies a custom tile gradient when tileClassName is set', () => {
    const { container } = render(
      <MetricCard
        label="Gold"
        value={12}
        icon={Trophy}
        tileClassName="from-brand-amber to-brand-amber/70"
      />
    );
    const tile = container.querySelector('.from-brand-amber');
    expect(tile).not.toBeNull();
    // the default indigo gradient must NOT be present when overridden
    expect(container.querySelector('.from-brand-indigo')).toBeNull();
  });

  it('falls back to the indigo tile when tileClassName is omitted', () => {
    const { container } = render(
      <MetricCard label="Students" value={35} icon={Trophy} />
    );
    expect(container.querySelector('.from-brand-indigo')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/dashboard/metric-card-tile.test.tsx`
Expected: FAIL (both `from-brand-amber` absent and default indigo present when overridden).

- [ ] **Step 3: Implement the prop**

In `components/dashboard/metric-card.tsx`:

1. Add to `MetricCardProps` (after `subtext?: string;`): `tileClassName?: string;`
2. Destructure `tileClassName` in `MetricCardImpl`'s params (next to `subtext`).
3. Replace the tile div's className. The current tile (in the `CardAction`) is:

```tsx
<div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
  <Icon className="size-4" />
</div>
```

Change to:

```tsx
<div
  className={cn(
    'flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
    tileClassName ?? 'from-brand-indigo to-brand-navy'
  )}
>
  <Icon className="size-4" />
</div>
```

(`cn` is already imported.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/dashboard/metric-card-tile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/metric-card.tsx __tests__/dashboard/metric-card-tile.test.tsx
git commit -m "feat(dashboard): MetricCard tileClassName prop for tinted icon tiles"
```

---

### Task 2: Shared `InsightChartCard` + `EmptyChartState`

**Files:**

- Create: `components/dashboard/insights/insight-chart-card.tsx`

**Interfaces:**

- Produces: `InsightChartCard({ cap, title, icon, scopeNote?, children })` and `EmptyChartState({ message })` — the chart-panel + empty-state idiom the three new views reuse. Verbatim copies of the page-local helpers currently in `app/(attendance)/attendance/insights/page.tsx` (do NOT modify those pages — touch-it-when-you-touch-it).

- [ ] **Step 1: Create the shared component**

```tsx
// components/dashboard/insights/insight-chart-card.tsx
import type { ReactNode } from 'react';
import { Filter, type LucideIcon } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Shared chart-panel shell for the module analytics pages (Academic Summary
 * relocation). Mono cap + serif title + gradient icon tile in CardAction,
 * chart or EmptyChartState in the body. Extracted from the page-local copies
 * in the Insights pages so the Awards / Attendance Summary / Comments pages
 * don't each re-declare it.
 */
export function InsightChartCard({
  cap,
  title,
  icon: Icon,
  scopeNote,
  children,
}: {
  cap: string;
  title: string;
  icon: LucideIcon;
  scopeNote?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {cap}
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        {scopeNote && (
          <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand-indigo-soft/50 bg-gradient-to-b from-brand-indigo/12 to-brand-indigo/4 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-brand-indigo-deep">
            {scopeNote}
          </span>
        )}
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Filter className="size-4" />
      </div>
      <p className="max-w-70 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (no consumers yet; this only adds a module).

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/insights/insight-chart-card.tsx
git commit -m "feat(dashboard): shared InsightChartCard + EmptyChartState for module analytics pages"
```

---

### Task 3: Awards page + `AwardsSummaryView` (canonical three-tier page)

**Files:**

- Create: `components/markbook/awards/awards-summary-view.tsx`
- Create: `app/(markbook)/markbook/awards/page.tsx`
- Test: `__tests__/markbook/awards-summary-view.test.tsx` (create)

**Interfaces:**

- Consumes: `buildAwardsRows(payload, { subjectId, termNumber, tier })` + `AwardsRow` + `EnrollmentStatusLabel` from `lib/markbook/academic-summary-views`; `AwardTier` from `lib/markbook/masterfile-dashboard`; `MasterfilePayload` from `lib/markbook/masterfile`; `MetricCard` (Task 1); `InsightChartCard`/`EmptyChartState` (Task 2); `DonutChart`/`DonutSlice`; `GroupedBarChart`/`GroupedBarSeries`; `DataTable`/`FacetConfig` + `SortableHeader`; `IdentifierLink`; `EnrollmentStatusBadge`.
- Produces: `AwardsSummaryView({ payload })`.

**Tier definitions (used across all charts + badges — the color thread):**

```ts
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
// stat-tile gradients (Task 1 tileClassName)
const TIER_TILE: Record<Exclude<TierKey, 'notEligible'>, string> = {
  gold: 'from-brand-amber to-brand-amber/70',
  silver: 'from-ink-4 to-ink-2',
  bronze: 'from-brand-bronze to-brand-bronze/70',
};
// table badge classes (reuse the current awards-view TIER_CONFIG classes verbatim)
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
```

**Component logic:**

- The **headline scope is Overall academic award · Full year** (fixed). Tier ① + ② are computed from `overallRows = buildAwardsRows(payload, { subjectId: 'overall', termNumber: null, tier: 'all' })`.
- The **table** has its own `subjectId` + `termNumber` state (Subject/Term `<Select>`s in `toolbarLeading` — data-shaping, they re-run `buildAwardsRows`) and a `tier` **facet** (full-year only). When `termNumber != null`, the Award column + tier facet hide and a "provisional" note shows (mirror the current `awards-view.tsx` behavior).

- [ ] **Step 1: Write the failing render test**

```tsx
// __tests__/markbook/awards-summary-view.test.tsx
import { render, screen } from '@testing-library/react';
import { AwardsSummaryView } from '@/components/markbook/awards/awards-summary-view';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Minimal payload factory — one Gold student. Reuse the shape from
// __tests__/markbook/academic-summary-views.test.ts (copy its makePayload helper).
function makePayload(): MasterfilePayload {
  /* copy from academic-summary-views.test.ts */ return {} as MasterfilePayload;
}

describe('AwardsSummaryView', () => {
  it('renders the four tier stat cards', () => {
    render(<AwardsSummaryView payload={makePayload()} />);
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('Silver')).toBeInTheDocument();
    expect(screen.getByText('Bronze')).toBeInTheDocument();
  });
});
```

> Implementer note: reuse the existing `makePayload` helper from `__tests__/markbook/academic-summary-views.test.ts` (import or copy it) so the payload shape stays correct as `MasterfilePayload` evolves. Keep the test minimal — the pure `build*Rows` logic is already covered by that suite; this only smoke-tests rendering.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/markbook/awards-summary-view.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `AwardsSummaryView`**

Full component. Compute headline from `overallRows`; build donut + per-class series; render three tiers.

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Award, ChartPie, Medal, Trophy, Users } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'; // NOTE: tier ③ uses <DataTable>, not this — see below
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
import type { ColumnDef } from '@tanstack/react-table';

// ... TIER_ORDER / TIER_LABEL / TIER_VAR / TIER_TILE / TIER_BADGE / STATUS_TO_ENROLLMENT
//     (exactly as defined in the Interfaces block above) ...

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

  // Table scope (interactive).
  const [subjectId, setSubjectId] = useState<string>('overall');
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const tableRows = useMemo(
    () => buildAwardsRows(payload, { subjectId, termNumber, tier: 'all' }),
    [payload, subjectId, termNumber]
  );
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

  const columns = useMemo<ColumnDef<AwardsRow>[]>(() => {
    const base: ColumnDef<AwardsRow>[] = [
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
        accessorKey: 'score',
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Score
          </SortableHeader>
        ),
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
          subtext="Enrolled at this level"
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
      <DataTable<AwardsRow>
        data={tableRows}
        columns={columns}
        getRowId={(r, i) => `${r.studentNumber ?? r.studentName}-${i}`}
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

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}% of the level` : '—';
}
```

> Notes: (1) `getRowId` receives `(row, index)` — the shell passes the index; verify the shell's `getRowId` signature accepts it, else derive a stable id from `studentNumber ?? studentName` alone. (2) Remove the unused `Table*` import if the final component doesn't use the raw table (it uses `<DataTable>`). (3) Lucide icon names (`ChartPie`, `Medal`, `Trophy`, `Award`, `Users`) — confirm each exists in the installed `lucide-react`; substitute the nearest (`PieChart`, `Medal`, `Trophy`, `Award`, `Users`) if a name differs.

- [ ] **Step 4: Implement the page RSC**

Mirror `app/(records)/records/academic-summary/awards/page.tsx` **exactly** for the role guard + `resolveAcademicSummaryScope` + `noAyRow`/`empty`/null-payload handling + `MasterfileToolbar` wiring (read that file and copy its imports + guard verbatim — same scope contract). The only differences: (a) render a module page header instead of `QuickViewHeader`; (b) mount `AwardsSummaryView` instead of `AwardsView`.

```tsx
// app/(markbook)/markbook/awards/page.tsx
// ... same imports + guard + resolveAcademicSummaryScope(...) as the records child page ...
import { AwardsSummaryView } from '@/components/markbook/awards/awards-summary-view';
import { MasterfileToolbar } from '@/components/markbook/masterfile-toolbar';

export default async function MarkbookAwardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 1. role guard: registrar | school_admin | superadmin (copy from the records child page)
  // 2. const sp = await searchParams; const scope = await resolveAcademicSummaryScope({ ay, level, class });
  // 3. handle scope.noAyRow / scope.empty / !scope.payload with the same states as the child page

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Markbook · Academic awards
          </p>
          <h1 className="font-serif text-[32px] font-semibold leading-tight tracking-tight text-foreground md:text-[38px]">
            Awards
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Subject and overall academic awards across a level, ranked
            best-first. Finalises when Term 4 grades are in.
          </p>
        </div>
        <MasterfileToolbar
          ayCodes={scope.ayCodes}
          selectedAyCode={scope.ayCode}
          levels={scope.levels}
          selectedLevelId={scope.selectedLevelId}
          sections={scope.payload?.sections ?? []}
          selectedSectionId={scope.selectedSectionId}
        />
      </header>
      {scope.payload ? (
        <AwardsSummaryView payload={scope.payload} />
      ) : /* empty state */ null}
    </div>
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run __tests__/markbook/awards-summary-view.test.tsx && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add app/(markbook)/markbook/awards components/markbook/awards __tests__/markbook/awards-summary-view.test.tsx
git commit -m "feat(markbook): Awards three-tier page (relocated from Academic Summary)"
```

---

### Task 4: Attendance Summary page + `AttendanceSummaryView`

**Files:**

- Create: `components/attendance/summary/attendance-summary-view.tsx`
- Create: `app/(attendance)/attendance/summary/page.tsx`

**Interfaces:**

- Consumes: `buildAttendanceRows(payload, { termNumber })` + `AttendanceRow` from `lib/markbook/academic-summary-views`; same chart/table/badge imports as Task 3.
- Produces: `AttendanceSummaryView({ payload })`.

Structure is **identical to `AwardsSummaryView`** (copy its shell — the three-tier layout, DataTable wiring, page RSC). The differences:

**Tier ① (from `rows = buildAttendanceRows(payload, { termNumber: fullYearOrSelected })`):** four `MetricCard`s, **all default indigo tiles** (the tier-color thread is Awards-specific; Attendance uses the semantic health palette in its charts, not tiles):

- Avg rate — `format="percent"`, value = mean of non-null `rate` (1dp), icon `Percent`.
- ≥ 95% — count of `rate != null && rate >= 95`, icon `TrendingUp`.
- < 85% — count of `rate != null && rate < 85`, icon `TriangleAlert`.
- Absences — sum of `absent`, icon `CalendarX`.

**Tier ② — a rate-band `DonutChart` (partition) + an avg-rate-per-class `ComparisonBarChart`:**

```tsx
// Rate bands are a partition of the roster (each student in exactly one band) → donut.
const bands = { good: 0, watch: 0, risk: 0 }; // >=95 / 85-94 / <85 (rate != null)
for (const r of rows) if (r.rate != null) { if (r.rate >= 95) bands.good++; else if (r.rate >= 85) bands.watch++; else bands.risk++; }
const bandDonut: DonutSlice[] = [
  { name: '≥ 95%', value: bands.good },
  { name: '85–94%', value: bands.watch },
  { name: '< 85%', value: bands.risk },
];
const bandColors = ['var(--color-brand-mint)', 'var(--color-brand-amber)', 'var(--color-destructive)'];
// centerValue = avg rate string e.g. "94.2%"

// Avg rate per class (>= 2 sections only) — horizontal comparison bars.
const perClass: ComparisonBarPoint[] = /* group rows by sectionName, mean of rate */;
```

- Panel 1: `<DonutChart data={bandDonut} colors={bandColors} centerValue={avgRateLabel} centerLabel="Avg rate" />` guarded by `EmptyChartState` when `rows.length === 0`.
- Panel 2: `<ComparisonBarChart data={perClass} orientation="horizontal" yFormat="percent" rotateLabels={false} />` guarded when `< 2` sections.

Import `ComparisonBarChart` + `ComparisonBarPoint` from `@/components/dashboard/charts/comparison-bar-chart`.

**Tier ③ — `<DataTable>`** (namespace `attnsummary`), single **Term `<Select>`** in `toolbarLeading` (drives `buildAttendanceRows`; Full year + each term). Columns: `#` · Student (`IdentifierLink` → `/attendance/students/{studentNumber}`) · Class · Status (`EnrollmentStatusBadge`) · Present (right) · Late (right) · Absent (right) · Rate (right, color-banded) · School days (right). Rate cell color:

```tsx
function rateClass(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground';
  if (rate >= 95) return 'text-brand-mint'; // healthy
  if (rate >= 85) return 'text-brand-amber'; // watch
  return 'text-destructive'; // at risk
}
```

`initialSort={[{ id: 'rate', desc: false }]}` (worst-first). `csv={{ filename: \`attendance-${payload.ayCode}-${payload.level.code}.csv\` }}`. Footnote below the table: "Excused (EX) days are tracked in the Attendance module." Empty state icon `CalendarX`.

**Page RSC** (`app/(attendance)/attendance/summary/page.tsx`): mirror the attendance insights page's role guard (`ALLOWED_ROLES` set = `registrar`/`school_admin`/`superadmin` → `redirect('/login')` / `notFound()`) + `resolveAcademicSummaryScope` + `MasterfileToolbar`; header eyebrow "Attendance · Class summary", H1 "Attendance Summary", description "Per-student present, late, and absent across a level, with attendance rate."

- [ ] **Step 1: Implement `AttendanceSummaryView`** (copy the Awards shell, apply the differences above).
- [ ] **Step 2: Implement the page RSC** (mirror the attendance insights guard + scope).
- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/(attendance)/attendance/summary components/attendance/summary
git commit -m "feat(attendance): Attendance Summary three-tier page (relocated from Academic Summary)"
```

---

### Task 5: Comments page + `CommentsSummaryView`

**Files:**

- Create: `components/evaluation/comments/comments-summary-view.tsx`
- Create: `app/(evaluation)/evaluation/comments/page.tsx`

**Interfaces:**

- Consumes: `buildCommentRows(payload, { termNumber, status })` + `CommentRow` + `CommentStatus` from `lib/markbook/academic-summary-views`.
- Produces: `CommentsSummaryView({ payload })`.

Same three-tier shell. Differences:

**Tier ① (from `allRows = buildCommentRows(payload, { termNumber: null, status: 'all' })`, i.e. all T1–T3 rows):** count by `commentStatus`, **excluding `N.A.`** (N.A. terms aren't a gap, KD #148). `required = submitted + draft + missing`. Four indigo `MetricCard`s:

- Submitted % — `format="percent"`, value = `required > 0 ? submitted / required * 100 : 0`, icon `MessageSquare`.
- Submitted — count, icon `CheckCircle2`.
- Draft — count, icon `PencilLine`.
- Missing — count, icon `CircleAlert`.

**Tier ② — a status `DonutChart` (partition) + a completeness-per-section `GroupedBarChart`:**

- Panel 1: `<DonutChart data={[{name:'Submitted',value:submitted},{name:'Draft',value:draft},{name:'Missing',value:missing}]} colors={['var(--color-brand-mint)','var(--color-brand-amber)','var(--color-destructive)']} centerValue={submittedPctLabel} centerLabel="Submitted" />` guarded when `required === 0`.
- Panel 2: `<GroupedBarChart series={[{key:'submitted',label:'Submitted',color:'var(--color-brand-mint)'},{key:'draft',label:'Draft',color:'var(--color-brand-amber)'},{key:'missing',label:'Missing',color:'var(--color-destructive)'}]} data={perSection} yFormat="number" />` where `perSection` groups `allRows` by `sectionName` counting each status (N.A. excluded). Guarded when `< 2` sections.

**Tier ③ — `<DataTable>`** (namespace `comments`), two data-shaping `<Select>`s in `toolbarLeading`: Term (All / T1 / T2 / T3 — drives `buildCommentRows` `termNumber`) + Status (All / Submitted / Draft / Missing / N.A. — drives `status`). Columns: `#` · Student (`IdentifierLink` → `/records/students/{studentNumber}`, late-term suffix) · Class · Term (`T{n}`) · Status (`StatusBadge` toned: Submitted `healthy`, Draft `warning`, Missing `locked`, N.A. `muted`) · Adviser · Comment (line-clamped `<p className="line-clamp-2 max-w-100 text-sm text-muted-foreground">` + an "Open in Evaluation" `IdentifierLink` → `/evaluation/sections/{sectionId}` resolved by section name→id from `payload.sections`, fallback `/evaluation/sections`). Read-only. `csv={{ filename: \`comments-${payload.ayCode}-${payload.level.code}.csv\` }}`.

Import `StatusBadge` from `@/components/ui/status-badge`. Status→tone map:

```ts
const COMMENT_TONE: Record<
  CommentStatus,
  'healthy' | 'warning' | 'locked' | 'muted'
> = {
  Submitted: 'healthy',
  Draft: 'warning',
  Missing: 'locked',
  'N.A.': 'muted',
};
```

**Page RSC** (`app/(evaluation)/evaluation/comments/page.tsx`): guard `registrar`/`school_admin`/`superadmin` (mirror an evaluation page's session guard, e.g. the sections page) + `resolveAcademicSummaryScope` + `MasterfileToolbar`; header eyebrow "Evaluation · FCA comments", H1 "Comments", description "Form-class-adviser write-up status per student and term (T1–T3)."

- [ ] **Step 1: Implement `CommentsSummaryView`.**
- [ ] **Step 2: Implement the page RSC.**
- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` clean.
- [ ] **Step 4: Commit**

```bash
git add app/(evaluation)/evaluation/comments components/evaluation/comments
git commit -m "feat(evaluation): Comments three-tier page (relocated from Academic Summary)"
```

---

### Task 6: Nav + route access + sidebar icons

**Files:**

- Modify: `lib/auth/roles.ts`
- Modify: `lib/sidebar/registry.ts`

- [ ] **Step 1: `ROUTE_ACCESS` — 3 new rows, above the broad module rules**

In `lib/auth/roles.ts`, in the `ROUTE_ACCESS` array, add (each ABOVE its broad module rule, matching how `/markbook/masterfile` sits above `/markbook`):

```ts
{ prefix: '/markbook/awards', allowed: ['registrar', 'school_admin', 'superadmin'] },
// ... above the existing { prefix: '/markbook', allowed: [...] }
{ prefix: '/attendance/summary', allowed: ['registrar', 'school_admin', 'superadmin'] },
// ... above the existing { prefix: '/attendance', ... }
{ prefix: '/evaluation/comments', allowed: ['registrar', 'school_admin', 'superadmin'] },
// ... above the existing { prefix: '/evaluation', ... }
```

- [ ] **Step 2: Nav items**

- **Markbook** (`NAV_BY_MODULE.markbook` — per-role): add `{ href: '/markbook/awards', label: 'Awards' }` to the registrar, school_admin, and superadmin arrays (NOT the teacher array), near the Report Cards group.
- **Evaluation** (`EVALUATION_NAV`): add `{ href: '/evaluation/comments', label: 'Comments', requiresRoles: ['registrar', 'school_admin', 'superadmin'] }` to the `Write-ups` group.
- **Attendance** (find the attendance nav; if per-role like markbook, add to registrar+ arrays; if a single `NavSection[]`, add with `requiresRoles`): `{ href: '/attendance/summary', label: 'Attendance Summary', requiresRoles: ['registrar', 'school_admin', 'superadmin'] }`.
- **Records** (`RECORDS_NAV`): **remove** the three `academic-summary/{awards,attendance,comments}` sub-items. Keep the `academic-summary` hub item.

- [ ] **Step 3: `iconByHref` in `lib/sidebar/registry.ts`**

- Markbook config `iconByHref`: add `'/markbook/awards': Award` (import `Award` if not present — it already is, used by the records entries).
- Attendance config `iconByHref`: add `'/attendance/summary': CalendarCheck` (import `CalendarCheck` from `lucide-react` if absent).
- Evaluation config `iconByHref`: add `'/evaluation/comments': MessageSquare` (already imported).
- **Remove** the three `'/records/academic-summary/{awards,attendance,comments}'` entries from the Records config `iconByHref`.

- [ ] **Step 4: Typecheck + the SIS-nav consistency test**

Run: `npx tsc --noEmit && npx vitest run __tests__/auth`
Expected: clean; if a `sis-nav-route-consistency`-style test exists for other modules, ensure the new items are proxy-reachable by their roles (the `ROUTE_ACCESS` rows satisfy this).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/roles.ts lib/sidebar/registry.ts
git commit -m "feat(nav): route access + sidebar entries for relocated Academic Summary pages"
```

---

### Task 7: Redirect stubs + delete old quick-view components

**Files:**

- Rewrite: `app/(records)/records/academic-summary/awards/page.tsx`
- Rewrite: `app/(records)/records/academic-summary/attendance/page.tsx`
- Rewrite: `app/(records)/records/academic-summary/comments/page.tsx`
- Delete: `components/markbook/academic-summary/{awards-view,attendance-view,comments-view,quick-view-header}.tsx`

- [ ] **Step 1: Rewrite each child route as a query-preserving redirect stub**

Use the `app/(markbook)/markbook/masterfile/page.tsx` pattern verbatim (forward `level`/`class`/`ay`). Awards:

```tsx
// app/(records)/records/academic-summary/awards/page.tsx
import { redirect } from 'next/navigation';

export default async function AcademicSummaryAwardsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const key of ['level', 'class', 'ay'] as const) {
    const value = sp[key];
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (value != null) params.set(key, value);
  }
  const query = params.toString();
  redirect(`/markbook/awards${query ? `?${query}` : ''}`);
}
```

Attendance → `/attendance/summary`; Comments → `/evaluation/comments` (same body, different target). Keep the `/records/academic-summary` `ROUTE_ACCESS` prefix (role gate fires before redirect).

- [ ] **Step 2: Grep for remaining importers, then delete the old views**

Run: `git grep -n "academic-summary/\(awards-view\|attendance-view\|comments-view\|quick-view-header\)"`
Expected: only the (now-rewritten) redirect stubs, which no longer import them. Then delete the four component files. (If `quick-view-header` still has an importer, leave it; otherwise delete.)

```bash
git rm components/markbook/academic-summary/awards-view.tsx components/markbook/academic-summary/attendance-view.tsx components/markbook/academic-summary/comments-view.tsx components/markbook/academic-summary/quick-view-header.tsx
```

- [ ] **Step 3: Typecheck + build the affected routes**

Run: `npx tsc --noEmit`
Expected: clean (no dangling imports).

- [ ] **Step 4: Commit**

```bash
git add app/(records)/records/academic-summary
git commit -m "refactor(records): redirect old Academic Summary quick-views to their module pages"
```

---

### Task 8: Full verification

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` → clean.
- [ ] **Step 2: Tests** — `npx vitest run` → no count regression vs the pre-change baseline (record the baseline count before Task 1; new tests should raise it by the tests added in Tasks 1 + 3).
- [ ] **Step 3: Build** — `npx next build` → clean; confirm no RSC/client boundary errors on the three new routes.
- [ ] **Step 4: Hard Rule #7 grep sweep** on every new/edited file:

```bash
git grep -nE "#[0-9a-fA-F]{6}|oklch\(|slate-|zinc-|gray-|bg-white|bg-black" -- \
  'components/markbook/awards/*' 'components/attendance/summary/*' 'components/evaluation/comments/*' \
  'app/(markbook)/markbook/awards/*' 'app/(attendance)/attendance/summary/*' 'app/(evaluation)/evaluation/comments/*' \
  'components/dashboard/insights/insight-chart-card.tsx' 'components/dashboard/metric-card.tsx'
```

Expected: no matches (all color via tokens / `var(--color-*)`).

- [ ] **Step 5: Manual smoke (no browser this session — static read if unavailable)**
  - Each new route loads under the AY × level × class picker; changing level/class re-scopes; changing AY resets level/class.
  - The three old `academic-summary/{awards,attendance,comments}` routes redirect to the new homes with `ay`/`level`/`class` preserved.
  - Teachers do not see the new nav items and are blocked by `ROUTE_ACCESS` (registrar/school_admin/superadmin only).
  - The Records `academic-summary` hub still renders its grid + Generate Masterfile export (unchanged).

- [ ] **Step 6: Final commit (if any sweep fixes)**

```bash
git add -A && git commit -m "chore: academic-summary relocation — verification fixes"
```

---

## Self-Review notes (author)

- **Spec coverage:** all §4 per-page tiers map to Tasks 3–5; Records export + redirects to Tasks 5-note + 7; access to Task 6; the `tileClassName` deviation to Task 1; the shared chart card to Task 2. ✓
- **Chart honesty:** each page's donut is a genuine partition (award tiers / rate bands / comment status all partition the roster or required rows); per-class panels are grouped/comparison bars. ✓
- **count == table:** tier ① + ② use the fixed headline `build*Rows` scope; the table narrows via its own controls but the headline is the canonical scope. Note in review that the Awards table's Subject/Term selectors intentionally move only the table, not the headline. ✓
- **Type consistency:** `AwardsRow`/`AttendanceRow`/`CommentRow`, `AwardTier`, `EnrollmentStatusLabel`, `DonutSlice`, `GroupedBarSeries`, `ComparisonBarPoint`, `FacetConfig`, `StatusTone` are all consumed exactly as defined by their source modules (verified). ✓
- **Open verification for the implementer:** confirm the `DataTable` `getRowId` signature (does it pass an index?); confirm lucide icon names exist; confirm the exact `getSessionUser`/guard imports by reading the canonical existing page named in each task before writing the new one.
