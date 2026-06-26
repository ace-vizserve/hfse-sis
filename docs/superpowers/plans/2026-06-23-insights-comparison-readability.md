# Insights Comparison Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two-AY comparison legible on all four Insights pages by overlaying both years as chart series on a relative axis (Pattern A) and surfacing the change as a delta-first KPI (Pattern C).

**Architecture:** Three shared primitives first — a pure single-metric trend-series builder (`buildAyTrend`), a `muted` (dashed) series option on the existing `MultiSeriesTrendChart`, and a `deltaFormat`/`deltaUnit` passthrough on the existing `MetricCard` delta slot — then convert the four insights `page.tsx` files (Attendance first) to use them. No new DB queries; per-period series are aggregated from already-loaded data. No new KPI component (MetricCard already renders the delta chip).

**Tech Stack:** Next.js 16 RSC, TypeScript, recharts (`MultiSeriesTrendChart`), Vitest + jsdom + Testing Library, Tailwind v4, design system 09/09a.

## Global Constraints

- **No DB schema changes, migrations, or new query patterns.** Per-period series come from already-loaded data.
- **Relative x-axis, never calendar dates:** term-index T1–T4 (academic: Attendance, Markbook); month-index 1..N (flexible: Admissions, Records). Per KD #79.
- **Compared AY renders muted + dashed; current AY solid.** Legend names both AY codes via the chart's own `<Legend>`.
- **Delta tone is by good/bad, not up/down:** mint when favourable, destructive when not (MetricCard `deltaGoodWhen` already does this).
- **Design system binding (Hard Rule #7):** tokens only — no raw hex / `slate-*` / `gray-*` in `app/` or `components/`. Build-phase visual work runs under the `frontend-design` + `ui-ux-pro-max` skills (per `always-do-first.md`).
- **Build must stay green:** `npx tsc --noEmit` + `npx next build` clean; existing tests pass.
- **Pattern B (per-category bars) is OUT OF SCOPE.** `CompareAyPicker` + the `compareAy` URL param are unchanged.

---

### Task 1: `buildAyTrend` — single-metric relative-axis series builder

**Files:**

- Create: `lib/dashboard/insights-trend.ts`
- Test: `__tests__/dashboard/insights-trend.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export type AyTrendPoint = {
    periodLabel: string;
    ayCode: string;
    value: number | null;
  };
  export type AyTrendResult = {
    data: Array<Record<string, string | number | null>>; // recharts rows, keyed by 'x' + one key per AY
    series: Array<{ key: string; label: string; muted?: boolean }>; // one per AY; muted=true for the compared AY
  };
  export function buildAyTrend(
    points: AyTrendPoint[],
    periods: string[],
    ays: string[]
  ): AyTrendResult;
  ```

  Contract: `ays[0]` is the current AY (solid), `ays[1..]` are compared AYs (`muted: true`). Series `key` = the AY code; `label` = the AY code. Each data row is `{ x: period, [ay]: value|null }`; a missing `(period, ay)` is `null` (renders as a gap). Mirrors `buildMultiAyTrend` (`lib/markbook/insights-compare.ts`) but with one line per AY instead of per subject×AY.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/dashboard/insights-trend.test.ts
import { describe, it, expect } from 'vitest';
import { buildAyTrend } from '@/lib/dashboard/insights-trend';

describe('buildAyTrend', () => {
  it('aligns two AYs on the same relative periods, one series each', () => {
    const points = [
      { periodLabel: 'T1', ayCode: 'AY2026', value: 97 },
      { periodLabel: 'T2', ayCode: 'AY2026', value: 96 },
      { periodLabel: 'T1', ayCode: 'AY2025', value: 98.5 },
      { periodLabel: 'T2', ayCode: 'AY2025', value: 98.8 },
    ];
    const { data, series } = buildAyTrend(
      points,
      ['T1', 'T2', 'T3', 'T4'],
      ['AY2026', 'AY2025']
    );
    expect(series).toEqual([
      { key: 'AY2026', label: 'AY2026', muted: false },
      { key: 'AY2025', label: 'AY2025', muted: true },
    ]);
    expect(data[0]).toEqual({ x: 'T1', AY2026: 97, AY2025: 98.5 });
    expect(data[2]).toEqual({ x: 'T3', AY2026: null, AY2025: null }); // missing period → gap
  });

  it('single AY → one solid series, no muted', () => {
    const points = [{ periodLabel: 'T1', ayCode: 'AY2026', value: 97 }];
    const { series } = buildAyTrend(points, ['T1'], ['AY2026']);
    expect(series).toEqual([{ key: 'AY2026', label: 'AY2026', muted: false }]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run __tests__/dashboard/insights-trend.test.ts`
Expected: FAIL — `buildAyTrend` not exported.

- [ ] **Step 3: Implement**

```ts
// lib/dashboard/insights-trend.ts
export type AyTrendPoint = {
  periodLabel: string;
  ayCode: string;
  value: number | null;
};
export type AyTrendResult = {
  data: Array<Record<string, string | number | null>>;
  series: Array<{ key: string; label: string; muted?: boolean }>;
};

/** One line per AY on a shared relative x-axis. ays[0] = current (solid); rest = muted. */
export function buildAyTrend(
  points: AyTrendPoint[],
  periods: string[],
  ays: string[]
): AyTrendResult {
  const series = ays.map((ayCode, i) => ({
    key: ayCode,
    label: ayCode,
    muted: i > 0,
  }));
  const lookup = new Map<string, number | null>();
  for (const p of points)
    lookup.set(`${p.periodLabel}\x00${p.ayCode}`, p.value);
  const data = periods.map((period) => {
    const row: Record<string, string | number | null> = { x: period };
    for (const ay of ays) {
      const k = `${period}\x00${ay}`;
      row[ay] = lookup.has(k) ? (lookup.get(k) ?? null) : null;
    }
    return row;
  });
  return { data, series };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run __tests__/dashboard/insights-trend.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/insights-trend.ts __tests__/dashboard/insights-trend.test.ts
git commit -m "feat(insights): buildAyTrend single-metric relative-axis series builder"
```

---

### Task 2: `MultiSeriesTrendChart` — `muted` (dashed) series option

**Files:**

- Modify: `components/dashboard/charts/multi-series-trend-chart.client.tsx:15-18` (series type) + `:118-135` (the `<Line>` map)
- Test: `__tests__/dashboard/multi-series-trend-muted.test.tsx` (jsdom render assertion)

**Interfaces:**

- Consumes: `AyTrendResult.series` from Task 1 (`{ key, label, muted? }`).
- Produces: `MultiSeriesTrendSeries` gains optional `muted?: boolean`. A muted series renders with `stroke="var(--color-muted-foreground)"`, `strokeDasharray="5 4"`, `strokeWidth={2}`; non-muted keeps the indexed `SERIES_COLORS` solid `strokeWidth={2}` (existing behaviour preserved when `muted` is absent).

- [ ] **Step 1: Write the failing test** — render two series (one muted) and assert one `<path>` carries a dash array.

```tsx
// __tests__/dashboard/multi-series-trend-muted.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart.client';

it('renders the muted series with a dashed stroke', () => {
  const { container } = render(
    <div style={{ width: 400, height: 240 }}>
      <MultiSeriesTrendChart
        series={[
          { key: 'AY2026', label: 'AY2026' },
          { key: 'AY2025', label: 'AY2025', muted: true },
        ]}
        data={[
          { x: 'T1', AY2026: 97, AY2025: 98 },
          { x: 'T2', AY2026: 96, AY2025: 98 },
        ]}
        yFormat="percent"
      />
    </div>
  );
  const dashed = Array.from(container.querySelectorAll('path')).filter(
    (p) => p.getAttribute('stroke-dasharray') === '5 4'
  );
  expect(dashed.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/dashboard/multi-series-trend-muted.test.tsx` → FAIL (no dashed path; recharts may need a sized container — the wrapping `<div>` provides it).

- [ ] **Step 3: Implement** — add `muted?: boolean` to `MultiSeriesTrendSeries` (line 15-18) and branch the `<Line>` props (line 118-135):

```tsx
export type MultiSeriesTrendSeries = {
  key: string;
  label: string;
  muted?: boolean;
};
// …inside series.map((s, i) => …):
<Line
  key={s.key}
  type="monotone"
  dataKey={s.key}
  name={s.label}
  stroke={
    s.muted
      ? 'var(--color-muted-foreground)'
      : SERIES_COLORS[i % SERIES_COLORS.length]
  }
  strokeWidth={s.muted ? 2 : 2.5}
  strokeDasharray={s.muted ? '5 4' : undefined}
  dot={false}
  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background)' }}
  isAnimationActive={false}
  connectNulls={false}
/>;
```

- [ ] **Step 4: Run it, verify it passes** → PASS. Also `npx vitest run __tests__/query` and any existing markbook-insights chart test to confirm the Markbook trend (no `muted`) is unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/charts/multi-series-trend-chart.client.tsx __tests__/dashboard/multi-series-trend-muted.test.tsx
git commit -m "feat(insights): muted/dashed series option on MultiSeriesTrendChart"
```

---

### Task 3: `MetricCard` — `deltaFormat`/`deltaUnit` passthrough (Pattern C primitive)

**Files:**

- Modify: `components/dashboard/metric-card.tsx:36-58` (props), `:102-126` (`DeltaChip`), `:128-186` (impl wiring)
- Test: `__tests__/dashboard/metric-card-delta.test.tsx`

**Interfaces:**

- Produces: `MetricCardProps` gains `deltaFormat?: 'percent' | 'absolute'` (default `'percent'`) + `deltaUnit?: string`. `DeltaChip` forwards them to `formatDeltaLabel(delta, { format: deltaFormat, unit: deltaUnit })`. Existing callers (no new props) are unchanged — percent mode is the default. This lets a percentage metric show "+1.4 pp" via `deltaFormat="absolute" deltaUnit="pp"`.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/dashboard/metric-card-delta.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/dashboard/metric-card';
import { computeDelta } from '@/lib/dashboard/range';

it('renders an absolute "pp" delta and the comparison label', () => {
  render(
    <MetricCard
      label="Attendance"
      value={97}
      format="percent"
      delta={computeDelta(97, 98.4)}
      deltaGoodWhen="up"
      deltaFormat="absolute"
      deltaUnit="pp"
      comparisonLabel="vs AY2025 · 98.4%"
    />
  );
  expect(screen.getByText(/1\.4 pp/)).toBeInTheDocument(); // absolute, not relative %
  expect(screen.getByText('vs AY2025 · 98.4%')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/dashboard/metric-card-delta.test.tsx` → FAIL (chip shows relative `−1.4%`, not `1.4 pp`).

- [ ] **Step 3: Implement** — thread the two props through:

```tsx
// props block: add to MetricCardProps
deltaFormat?: 'percent' | 'absolute';
deltaUnit?: string;

// DeltaChip signature + body:
function DeltaChip({ delta, goodWhen, format, unit }: {
  delta: Delta; goodWhen: 'up' | 'down'; format?: 'percent' | 'absolute'; unit?: string;
}) {
  const Icon = delta.direction === 'up' ? ArrowUpIcon : delta.direction === 'down' ? ArrowDownIcon : MinusIcon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', deltaChipClass(delta, goodWhen))}>
      <Icon className="size-3" strokeWidth={2.5} />
      {formatDeltaLabel(delta, { format, unit })}
    </span>
  );
}

// impl: destructure deltaFormat, deltaUnit from props; pass to <DeltaChip … format={deltaFormat} unit={deltaUnit} />
```

- [ ] **Step 4: Run it, verify it passes** → PASS. Run `npx vitest run __tests__/dashboard` to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/metric-card.tsx __tests__/dashboard/metric-card-delta.test.tsx
git commit -m "feat(insights): deltaFormat/deltaUnit passthrough on MetricCard"
```

---

### Task 4: Attendance Insights — delta headline (C) + per-term rate overlay (A)

**Files:**

- Modify: `lib/attendance/insights-compare.ts` (add `getAttendanceRateTrendByAy`), `app/(attendance)/attendance/insights/page.tsx` (§1 rate card ~238-243, §2 trend ~285)
- Test: `__tests__/attendance/rate-trend-by-ay.test.ts` (pure shaping, if the new loader has a pure core) + manual.

**Interfaces:**

- Consumes: `buildAyTrend` (Task 1), `MultiSeriesTrendChart` `muted` (Task 2), `MetricCard` `deltaFormat`/`deltaUnit` (Task 3), `computeDelta` (`lib/dashboard/range`).
- Produces: `getAttendanceRateTrendByAy(ays: string[]): Promise<AyTrendPoint[]>` — for each AY × term, attendance % from the cached daily rows (`loadDailyRows(ay)` sliced per the AY's term windows via `kpisFor`), `periodLabel = 'T'+termNumber`, `value = attendancePct | null`.

**Build-phase note:** this task writes JSX → **invoke `frontend-design` + `ui-ux-pro-max` first** (per `always-do-first.md`) for the line/legend/delta visual treatment; keep to design-system tokens.

- [ ] **Step 1 (C — headline):** In `page.tsx` §1, replace the rate `MetricCard`'s `subtext={`${priorRate}% in ${compareAy}`}` with:

  ```tsx
  delta={priorRate != null ? computeDelta(rate, priorRate) : undefined}
  deltaGoodWhen="up" deltaFormat="absolute" deltaUnit="pp"
  comparisonLabel={priorRate != null ? `vs ${compareAy} · ${priorRate.toFixed(1)}%` : undefined}
  ```

  (Leave the hero `rateBadge` as-is — it's a separate hero element.)

- [ ] **Step 2 (A — loader):** Add `getAttendanceRateTrendByAy` to `lib/attendance/insights-compare.ts` per the interface above. Where a pure reshaping helper is extracted, unit-test it (`__tests__/attendance/rate-trend-by-ay.test.ts`); the DB-touching wrapper is verified by build + manual.

- [ ] **Step 3 (A — chart):** In §2, replace the single-AY daily `TrendChart` with:

  ```tsx
  const trend = buildAyTrend(
    await getAttendanceRateTrendByAy(
      compareAy ? [selectedAy, compareAy] : [selectedAy]
    ),
    ['T1', 'T2', 'T3', 'T4'],
    compareAy ? [selectedAy, compareAy] : [selectedAy]
  );
  // …
  <MultiSeriesTrendChart
    series={trend.series}
    data={trend.data}
    yFormat="percent"
    yDomain={[80, 100]}
  />;
  ```

  Update the section title/description to "per term".

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npx next build` clean; `npx vitest run __tests__/attendance`; **manual:** open `/attendance/insights`, pick AY2025 as compare → §1 shows a pp delta chip + "vs AY2025"; §2 shows two lines (AY2026 solid, AY2025 dashed) on T1–T4 with a legend. No "fetch failed" (the URL-chunk fix is already merged).

- [ ] **Step 5: Commit**

```bash
git add lib/attendance/insights-compare.ts "app/(attendance)/attendance/insights/page.tsx" __tests__/attendance/rate-trend-by-ay.test.ts
git commit -m "feat(attendance/insights): delta headline + per-term two-AY rate overlay"
```

---

### Task 5: Admissions Insights — delta headline (C) + per-month intake overlay (A)

**Files:**

- Modify: `lib/admissions/insights-compare.ts` (create if absent) or `lib/admissions/dashboard.ts` (add `getIntakeTrendByAy`), `app/(admissions)/admissions/insights/page.tsx` (§1 headline ~259-265, §2 intake ~306-310)
- Test: pure reshaping test if extracted + manual.

**Interfaces:**

- Produces: `getIntakeTrendByAy(ays: string[]): Promise<AyTrendPoint[]>` — applications per **month-index** (`periodLabel = 'M'+n` or the month label), one point per (AY, month). Reuse the existing applications-velocity loader, regrouped by month-of-AY.

**Build-phase note:** writes JSX → invoke `frontend-design` + `ui-ux-pro-max` first.

- [ ] **Step 1 (C):** Replace §1 "Applications received" `subtext={`${priorApplications} in ${compareAy}`}` with `delta={computeDelta(applications, priorApplications)}` + `deltaGoodWhen="up"` + `comparisonLabel={`vs ${compareAy} · ${priorApplications}`}` (count metric → default percent format, or `deltaFormat="absolute"`). Apply the same to the conversion-rate headline (`deltaFormat="absolute" deltaUnit="pp"`).
- [ ] **Step 2 (A):** Add `getIntakeTrendByAy`; build the overlay with `buildAyTrend(points, months, ays)` + `MultiSeriesTrendChart muted`. Replace the within-AY-prior-period overlay (page ~306) with the compared-AY overlay.
- [ ] **Step 3: Verify** — tsc + build clean; manual on `/admissions/insights` (AY2025 compare): delta chips on headlines; §2 = two lines per month.
- [ ] **Step 4: Commit** — `git commit -m "feat(admissions/insights): delta headlines + per-month two-AY intake overlay"`

---

### Task 6: Records Insights — delta headline (C) + per-month net-movement overlay (A)

**Files:**

- Modify: `lib/sis/records-insights.ts` (add `getMovementTrendByAy`), `app/(records)/records/insights/page.tsx` (§1 enrolled ~215-220, §3 velocity ~345-350)
- Test: pure reshaping test if extracted + manual.

**Interfaces:**

- Produces: `getMovementTrendByAy(ays: string[]): Promise<AyTrendPoint[]>` — **net enrolment movement** (enrolments − withdrawals) per month-index, one point per (AY, month), from `getMovementEvents`/`rollupMovements`.

**Build-phase note:** writes JSX → invoke `frontend-design` + `ui-ux-pro-max` first.

- [ ] **Step 1 (C):** Replace §1 "Enrolled students" `subtext={`${priorTotal} in ${compareAy}`}` with `delta={computeDelta(total, priorTotal)}` + `deltaGoodWhen="up"` + `comparisonLabel={`vs ${compareAy} · ${priorTotal}`}`.
- [ ] **Step 2 (A):** Add `getMovementTrendByAy`; add the compared-AY net-movement line via `buildAyTrend` + `MultiSeriesTrendChart muted`. The operational enrolments-vs-withdrawals framing stays elsewhere; the insights comparison view is net-movement per AY.
- [ ] **Step 3: Verify** — tsc + build clean; manual on `/records/insights`.
- [ ] **Step 4: Commit** — `git commit -m "feat(records/insights): delta headline + per-month two-AY net-movement overlay"`

---

### Task 7: Markbook Insights — delta headline (C); trend unchanged

**Files:**

- Modify: `app/(markbook)/markbook/insights/page.tsx` (§1 headline ~186; §2 trend ~327-333 stays — it's per-subject via `buildMultiAyTrend`, a different shape than `buildAyTrend`, and already overlays both AYs correctly).
- Test: manual.

**Interfaces:** Consumes `MetricCard` `deltaFormat`/`deltaUnit` + `computeDelta`. `buildMultiAyTrend` (multi-subject) is intentionally NOT replaced by `buildAyTrend` (single-metric) — different shapes.

**Build-phase note:** writes JSX → invoke `frontend-design` + `ui-ux-pro-max` first.

- [ ] **Step 1 (C):** Convert the Markbook §1 top-band headline `MetricCard` to the delta pattern (`deltaFormat="absolute" deltaUnit="pp"`, `comparisonLabel="vs {compareAy} · {prior}"`). The hero `topBandBadge` stays.
- [ ] **Step 2: Verify** — tsc + build clean; manual on `/markbook/insights`: §1 delta chip; §2 subject overlay still renders both AYs (regression check — no `muted` flag passed, unchanged).
- [ ] **Step 3: Commit** — `git commit -m "feat(markbook/insights): delta headline (subject trend unchanged)"`

---

### Task 8: Final whole-branch review + consistency pass

**Files:** none new — review + any small fixes.

- [ ] Confirm all four pages share one comparison treatment: solid current / dashed compared line + legend on trends; delta chip + "vs {AY}" on headlines.
- [ ] `npx tsc --noEmit` + `npx next build` clean; `npx vitest run` green.
- [ ] Grep that no insights headline still uses the old `subtext={…in ${compareAy}}` pattern: `rg "in \\\$\\{compareAy\\}" "app"` returns nothing in insights pages.
- [ ] Manual sweep: each `/<module>/insights` with AY2025 compare — comparison is visible in the charts/KPIs, not buried.
- [ ] Dispatch the whole-branch code review (subagent-driven-development's final review), then `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:** Pattern A (relative-axis overlay) → Tasks 1, 2, 4, 5, 6 (Markbook §2 already overlays). Pattern C (delta-first KPI) → Tasks 3, 4, 5, 6, 7. All four pages covered. No DB changes (data reshaped from loaded sources). Pattern B explicitly deferred (matches spec non-goals). ✓

**Placeholder scan:** Primitives (Tasks 1–3) carry full code + tests. Page-conversion tasks (4–7) give exact props/loader signatures + representative JSX; the implementer reads the page at the cited lines (per-page JSX is repetitive and verbatim-pasting all four would be noise). The per-period loader internals are specified by contract (input/output + source) because each reuses a different existing module loader. ✓

**Type consistency:** `AyTrendPoint`/`AyTrendResult` (Task 1) consumed by Tasks 4–6; `MultiSeriesTrendSeries.muted` (Task 2) produced by Task 1's `series`; `deltaFormat`/`deltaUnit` (Task 3) consumed by Tasks 4–7; `computeDelta`/`formatDeltaLabel`/`Delta` are existing (`lib/dashboard/range.ts`). Names consistent across tasks. ✓
