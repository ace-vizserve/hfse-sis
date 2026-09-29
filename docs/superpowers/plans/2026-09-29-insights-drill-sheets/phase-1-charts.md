# Phase 1 — Shared chart click props

> Part of `docs/superpowers/plans/2026-09-29-insights-drill-sheets.md`. Its Global Constraints and Review Focus bind every task here. Spec §1.

**Goal:** Eight shared chart primitives take an optional `onSegmentClick?: (category: string, series?: string) => void` and report the part the reader clicked. Without the prop every chart renders exactly as it does today.

**What "the same treatment" means (measured, not assumed).** `ComparisonBarChart` / `DonutChart` / `LabeledPieChart` do three things when the prop is set, and nothing when it is not:

1. `style={{ cursor: 'pointer' }}` on the clickable Recharts element (on a `<Bar>` this lands on each bar's `<path>`, verified in jsdom).
2. Hover emphasis is what the chart already has — the `BAR_CURSOR` band behind a bar category, the `ACTIVE_DOT` on the hovered point. No new hover effect.
3. HTML (non-SVG) segments — the donut/pie legend rows — get `role="button"`, `tabIndex={0}`, Enter/Space, and `cursor-pointer … hover:bg-accent/40`. SVG bars/dots get no keyboard handling (ComparisonBarChart has none).

Line and area charts have no bar to click, so their clickable part is the **active dot** (the point under the pointer): drawn exactly as `ACTIVE_DOT` draws it, wrapped in a `<g>` that shows the pointer and reports `(category, series)`. On a chart with a comparison line, each line's own dot reports its own series — Review Focus #1.

**Measured in jsdom (probe run while writing this phase, then deleted):** with the existing `ResponsiveContainer` mock, `fireEvent.click` on `.recharts-bar-rectangle path` fires the `<Bar onClick>` with a `BarRectangleItem` whose `.payload` is the data row; Recharts draws bars **series by series** (series A's bars for every category, then series B's). Active dots render in jsdom when the test's `recharts` mock wraps `Tooltip` with `defaultIndex={1}`; a function `activeDot` then receives `{ cx, cy, payload, dataKey, index }` and its `onClick` fires. No test needs to fake a mouse position.

**Shells need no edit.** Every `components/dashboard/charts/<name>.tsx` shell is `export function X(props: XProps) { return <XImpl {...props} />; }` with `XProps` re-exported from the `.client.tsx` file, so a prop added to the client props type threads through the shell automatically. The phase gate's tsc confirms it.

**Series each chart reports** (actual `dataKey`s — two differ from the spec table, see the phase's findings at the bottom):

| Chart                      | `category`                                            | `series`                                                                    |
| -------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `GroupedBarChart`          | row `x`                                               | the series `key` (an AY code on the year-compare charts, e.g. `'AY2025'`)   |
| `TrendChart`               | row `x`                                               | `'current'` \| `'comparison'` — **not** an AY code; the caller maps it      |
| `CategoryLineChart`        | row `x`                                               | none (called with one argument)                                             |
| `ComposedBarLineChart`     | row `category`                                        | `'bar'` \| `'line'`                                                         |
| `RetentionStackedBarChart` | row `level`                                           | `'returned'` \| `'didNotReturn'`                                            |
| `AttritionStackedBarChart` | row `level`                                           | the reason key as passed in `reasonKeys` (Records passes reason **labels**) |
| `NationalityMixPie`        | slice nationality (incl. `'Other'` / `'Unspecified'`) | none                                                                        |
| `NationalityByLevelBars`   | row `level`                                           | segment nationality (incl. `'Other'` / `'Unspecified'`)                     |

A zero-value segment draws no bar, so there is nothing to click for it; the drill wrappers (phases 2–5) must still handle an empty list (Review Focus #2) — not a chart concern.

**Files touched in this phase**

- Modify: `components/dashboard/charts/chart-primitives.ts` (append after line 122)
- Create: `components/dashboard/charts/clickable-active-dot.tsx`
- Modify: `components/dashboard/charts/comparison-bar-chart.client.tsx` (line 46 + imports 18–30)
- Modify: `components/dashboard/charts/donut-chart.client.tsx` (line 26 + imports 8–9)
- Modify: `components/dashboard/charts/labeled-pie-chart.client.tsx` (line 25 + its `chart-primitives` import)
- Modify: `components/dashboard/charts/grouped-bar-chart.client.tsx` (imports 20–33, props 57–72, body 114–122, bars 170–198)
- Modify: `components/dashboard/charts/composed-bar-line-chart.client.tsx` (imports 18–32, props 52–58, body 60–66, bar/line 102–121)
- Modify: `components/dashboard/charts/trend-chart.client.tsx` (imports 18–30, props 36–87, body 89–102, areas 212–339)
- Modify: `components/dashboard/charts/category-line-chart.client.tsx` (imports 16–29, props 44–58, body 60–69, line 120–137)
- Modify: `components/dashboard/charts/retention-stacked-bar-chart.client.tsx` (imports 18–28, props 51–59, bars 120–145)
- Modify: `components/dashboard/charts/attrition-stacked-bar-chart.client.tsx` (imports 18–29, props 37–68, bars 140–158)
- Modify: `components/dashboard/insights/nationality-mix-pie.tsx` (props 43–55, pie 127–131)
- Modify: `components/dashboard/insights/nationality-by-level-bars.tsx` (import line 5, props 41–48, segments 79–95)
- Tests: `__tests__/dashboard/chart-segment-click.test.tsx` (new), `__tests__/dashboard/grouped-bar-chart.test.tsx` (append), `__tests__/dashboard/composed-bar-line-chart.test.tsx` (new), `__tests__/dashboard/trend-chart-click.test.tsx` (new), `__tests__/dashboard/category-line-chart.test.tsx` (new), `__tests__/dashboard/stacked-bar-charts-click.test.tsx` (new), `__tests__/dashboard/nationality-click.test.tsx` (new)

---

## Task 1.1: The shared click type and helpers; widen the three existing charts

**Files:**

- Modify: `components/dashboard/charts/chart-primitives.ts` (import at line 9; append after line 122)
- Create: `components/dashboard/charts/clickable-active-dot.tsx`
- Modify: `components/dashboard/charts/comparison-bar-chart.client.tsx:18-30,46`
- Modify: `components/dashboard/charts/donut-chart.client.tsx:8-9,26`
- Modify: `components/dashboard/charts/labeled-pie-chart.client.tsx:25` (+ its `./chart-primitives` import)
- Test: `__tests__/dashboard/chart-segment-click.test.tsx`

**Interfaces:**

- Consumes: `ACTIVE_DOT` (`chart-primitives.ts:110`); Recharts `Dot`, `ActiveDotProps`, `BarRectangleItem` (all exported from `recharts` 3.8.1).
- Produces:
  - `export type SegmentClickHandler = (category: string, series?: string) => void;`
  - `export const CLICKABLE_STYLE = { cursor: 'pointer' } as const;`
  - `export function reportSegment(onSegmentClick: SegmentClickHandler, row: unknown, categoryKey: string, series?: string): void`
  - `export function barClickHandler(onSegmentClick: SegmentClickHandler | undefined, categoryKey: string, series?: string): ((item: BarRectangleItem) => void) | undefined`
  - `export function clickableActiveDot(opts: { fill: string; categoryKey: string; series?: string; onSegmentClick: SegmentClickHandler }): (props: ActiveDotProps) => React.ReactElement` (in `clickable-active-dot.tsx`)
  - `ComparisonBarChartProps.onSegmentClick`, `DonutChartProps.onSegmentClick`, `LabeledPieChartProps.onSegmentClick` all typed `SegmentClickHandler` (type-only widening — their bodies still call with one argument, and every existing `(segment: string) => void` / `setState` caller still fits).

- [ ] **Step 1: Write the failing test**

Create `__tests__/dashboard/chart-segment-click.test.tsx`:

```tsx
/**
 * The shared click plumbing every clickable chart uses: one callback type,
 * one "read the category off the clicked row" rule, one clickable active dot.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ActiveDotProps, BarRectangleItem } from 'recharts';

import {
  barClickHandler,
  reportSegment,
} from '@/components/dashboard/charts/chart-primitives';
import { clickableActiveDot } from '@/components/dashboard/charts/clickable-active-dot';

describe('reportSegment', () => {
  it('reports the row category and the series', () => {
    const fn = vi.fn();
    reportSegment(fn, { x: 'T2', AY2026: 92 }, 'x', 'AY2026');
    expect(fn.mock.calls).toEqual([['T2', 'AY2026']]);
  });

  it('calls with ONE argument when the chart has no series', () => {
    const fn = vi.fn();
    reportSegment(fn, { x: 'P1', y: 80 }, 'x');
    expect(fn.mock.calls).toEqual([['P1']]);
  });

  it('ignores a row with no category, an empty category, or no row', () => {
    const fn = vi.fn();
    reportSegment(fn, { y: 80 }, 'x');
    reportSegment(fn, { x: '' }, 'x');
    reportSegment(fn, undefined, 'x');
    reportSegment(fn, { x: 3 }, 'x');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('barClickHandler', () => {
  it('is undefined when the chart is not clickable, so <Bar onClick> stays unset', () => {
    expect(barClickHandler(undefined, 'x', 'AY2026')).toBeUndefined();
  });

  it("reads the category off the clicked bar's payload row", () => {
    const fn = vi.fn();
    const handler = barClickHandler(fn, 'level', 'returned');
    handler!({
      payload: { level: 'P3', returned: 12 },
    } as unknown as BarRectangleItem);
    expect(fn.mock.calls).toEqual([['P3', 'returned']]);
  });
});

describe('clickableActiveDot', () => {
  const dotProps = {
    cx: 10,
    cy: 20,
    payload: { x: 'Feb', current: 5 },
    index: 1,
    dataKey: 'current',
  } as unknown as ActiveDotProps;

  it('draws the same dot ACTIVE_DOT draws, with the pointer', () => {
    const Dot = clickableActiveDot({
      fill: 'var(--color-series-1)',
      categoryKey: 'x',
      series: 'current',
      onSegmentClick: vi.fn(),
    });
    const { container } = render(<svg>{Dot(dotProps)}</svg>);
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('r')).toBe('4');
    expect(circle?.getAttribute('stroke')).toBe('var(--color-card)');
    expect(circle?.getAttribute('stroke-width')).toBe('2');
    expect(circle?.getAttribute('fill')).toBe('var(--color-series-1)');
    expect(container.querySelector('g')?.getAttribute('style')).toContain(
      'cursor: pointer'
    );
  });

  it("reports the point's category and this dot's series on click", () => {
    const fn = vi.fn();
    const Dot = clickableActiveDot({
      fill: 'var(--color-ink-5)',
      categoryKey: 'x',
      series: 'comparison',
      onSegmentClick: fn,
    });
    const { container } = render(<svg>{Dot(dotProps)}</svg>);
    fireEvent.click(container.querySelector('circle')!);
    expect(fn.mock.calls).toEqual([['Feb', 'comparison']]);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/dashboard/chart-segment-click.test.tsx --pool=threads`
Expected: FAIL — the suite cannot resolve `@/components/dashboard/charts/clickable-active-dot` (file does not exist), and `reportSegment` / `barClickHandler` are not exported.

- [ ] **Step 3: Append the type and helpers to `chart-primitives.ts`**

Add a type-only import under the existing one at line 9:

```ts
import type { ChartLegendChipColor } from '@/components/dashboard/chart-legend-chip';
import type { BarRectangleItem } from 'recharts';
```

Append after line 122 (the end of `VALUE_LABEL`):

```ts
// ─── CLICKABLE SEGMENTS ──────────────────────────────────────────────────
//
// A chart that drills reports the part the reader clicked: its category (the
// x value, the level, the slice) and, on a chart with more than one series,
// which series. One type for every chart, so a drill wrapper can hand any of
// them the same setter. The second argument is optional, so an existing
// `(segment: string) => void` handler still fits.
//
// Setting the prop changes one visual thing: the pointer. Hover emphasis is
// what each chart already has (BAR_CURSOR behind a bar, ACTIVE_DOT on a line).

export type SegmentClickHandler = (category: string, series?: string) => void;

/** On a clickable bar or dot. */
export const CLICKABLE_STYLE = { cursor: 'pointer' } as const;

/**
 * Report a clicked data row. Skips a row with no string category (nothing
 * to drill into), and calls with ONE argument when the chart has no series,
 * so a single-series caller sees exactly `(category)`.
 */
export function reportSegment(
  onSegmentClick: SegmentClickHandler,
  row: unknown,
  categoryKey: string,
  series?: string
): void {
  const category = (row as Record<string, unknown> | null | undefined)?.[
    categoryKey
  ];
  if (typeof category !== 'string' || category === '') return;
  if (series === undefined) onSegmentClick(category);
  else onSegmentClick(category, series);
}

/**
 * A `<Bar onClick>` for one series. Undefined when the chart is not
 * clickable, so the bar is exactly as before. Recharts hands the handler the
 * clicked rectangle; its data row is on `.payload`.
 */
export function barClickHandler(
  onSegmentClick: SegmentClickHandler | undefined,
  categoryKey: string,
  series?: string
): ((item: BarRectangleItem) => void) | undefined {
  if (!onSegmentClick) return undefined;
  return (item) =>
    reportSegment(onSegmentClick, item?.payload, categoryKey, series);
}
```

- [ ] **Step 4: Create `components/dashboard/charts/clickable-active-dot.tsx`**

```tsx
'use client';

import * as React from 'react';
import { Dot, type ActiveDotProps } from 'recharts';

import {
  ACTIVE_DOT,
  CLICKABLE_STYLE,
  reportSegment,
  type SegmentClickHandler,
} from './chart-primitives';

/**
 * The `activeDot` of a clickable line or area series. A line has no bar to
 * click, so the clickable part is the point under the pointer — which is
 * where the reader's pointer already is. It is drawn exactly as `ACTIVE_DOT`
 * draws it; only the pointer is new. On a chart with a comparison line, each
 * line's own dot reports its own series, so clicking last year's point opens
 * last year.
 */
export function clickableActiveDot({
  fill,
  categoryKey,
  series,
  onSegmentClick,
}: {
  fill: string;
  categoryKey: string;
  series?: string;
  onSegmentClick: SegmentClickHandler;
}) {
  return function ClickableActiveDot(props: ActiveDotProps) {
    return (
      <g
        style={CLICKABLE_STYLE}
        onClick={() =>
          reportSegment(onSegmentClick, props.payload, categoryKey, series)
        }
      >
        <Dot cx={props.cx} cy={props.cy} {...ACTIVE_DOT} fill={fill} />
      </g>
    );
  };
}
```

- [ ] **Step 5: Widen the three existing charts' prop type (type-only)**

`components/dashboard/charts/comparison-bar-chart.client.tsx` — add `type SegmentClickHandler,` to the `./chart-primitives` import (lines 18–30, after `MUTED_SERIES,`), then line 46:

```ts
  onSegmentClick?: SegmentClickHandler;
```

(replacing `  onSegmentClick?: (category: string) => void;`).

`components/dashboard/charts/donut-chart.client.tsx` — line 8 becomes:

```ts
import {
  SEGMENT_EDGE,
  SERIES_COLORS,
  type SegmentClickHandler,
} from './chart-primitives';
```

and line 26:

```ts
  onSegmentClick?: SegmentClickHandler;
```

(replacing `  onSegmentClick?: (sliceName: string) => void;`).

`components/dashboard/charts/labeled-pie-chart.client.tsx` — add `type SegmentClickHandler,` to its `./chart-primitives` import, and line 25:

```ts
  onSegmentClick?: SegmentClickHandler;
```

(replacing `  onSegmentClick?: (sliceName: string) => void;`). The comment on line 24 stays.

The three bodies are untouched: each still calls `onSegmentClick(name)` with one argument.

- [ ] **Step 6: Run the test — expect pass**

Run: `npx vitest run __tests__/dashboard/chart-segment-click.test.tsx --pool=threads`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/charts/chart-primitives.ts components/dashboard/charts/clickable-active-dot.tsx components/dashboard/charts/comparison-bar-chart.client.tsx components/dashboard/charts/donut-chart.client.tsx components/dashboard/charts/labeled-pie-chart.client.tsx __tests__/dashboard/chart-segment-click.test.tsx && git commit -m "feat(charts): one segment-click type and the helpers every chart shares" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.2: GroupedBarChart and ComposedBarLineChart

**Files:**

- Modify: `components/dashboard/charts/grouped-bar-chart.client.tsx:20-33,57-72,114-122,170-198`
- Modify: `components/dashboard/charts/composed-bar-line-chart.client.tsx:18-32,52-58,60-66,102-121`
- Test: `__tests__/dashboard/grouped-bar-chart.test.tsx` (append a `describe`), `__tests__/dashboard/composed-bar-line-chart.test.tsx` (new)

**Interfaces:**

- Consumes: `SegmentClickHandler`, `CLICKABLE_STYLE`, `barClickHandler` (Task 1.1); `clickableActiveDot` (Task 1.1).
- Produces: `GroupedBarChartProps.onSegmentClick?: SegmentClickHandler` → `(row.x, series.key)`; `ComposedBarLineChartProps.onSegmentClick?: SegmentClickHandler` → `(row.category, 'bar' | 'line')`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `__tests__/dashboard/grouped-bar-chart.test.tsx` (the file already mocks `ResponsiveContainer`; add `fireEvent` to its `@testing-library/react` import on line 12: `import { fireEvent, render } from '@testing-library/react';`):

```tsx
describe('GroupedBarChart onSegmentClick', () => {
  const series = [
    { key: 'AY2026', label: 'AY2026' },
    { key: 'AY2025', label: 'AY2025', muted: true },
  ];
  const data = [
    { x: 'T1', AY2026: 94, AY2025: 91 },
    { x: 'T2', AY2026: 92, AY2025: 90 },
  ];

  it("reports the clicked bar's category and series — the comparison year included", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <GroupedBarChart
        series={series}
        data={data}
        onSegmentClick={onSegmentClick}
      />
    );
    // Recharts draws series by series: AY2026 T1, AY2026 T2, AY2025 T1, AY2025 T2.
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    fireEvent.click(bars[1]);
    fireEvent.click(bars[2]);
    expect(onSegmentClick.mock.calls).toEqual([
      ['T2', 'AY2026'],
      ['T1', 'AY2025'],
    ]);
  });

  it('still reports the click when highlightX draws the bars as Cells', () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <GroupedBarChart
        series={[{ key: 'rate', label: 'Rate' }]}
        data={[
          { x: 'T1', rate: 94 },
          { x: 'T2', rate: 92 },
        ]}
        highlightX="T2"
        onSegmentClick={onSegmentClick}
      />
    );
    fireEvent.click(
      container.querySelectorAll('.recharts-bar-rectangle path')[0]
    );
    expect(onSegmentClick.mock.calls).toEqual([['T1', 'rate']]);
  });

  it('shows the pointer on every bar only when clickable', () => {
    const clickable = render(
      <GroupedBarChart series={series} data={data} onSegmentClick={vi.fn()} />
    );
    clickable.container
      .querySelectorAll('.recharts-bar-rectangle path')
      .forEach((el) =>
        expect(el.getAttribute('style') ?? '').toContain('cursor: pointer')
      );

    const plain = render(<GroupedBarChart series={series} data={data} />);
    plain.container
      .querySelectorAll('.recharts-bar-rectangle path')
      .forEach((el) =>
        expect(el.getAttribute('style') ?? '').not.toContain('cursor')
      );
  });
});
```

Create `__tests__/dashboard/composed-bar-line-chart.test.tsx`:

```tsx
/**
 * ComposedBarLineChart reports which part was clicked: a bar is this year
 * ('bar'), the dashed line's point is the comparison year ('line').
 *
 * jsdom has no layout engine, so ResponsiveContainer is mocked to a fixed
 * size, and Tooltip is pinned to `defaultIndex={1}` so the second category's
 * active dots are drawn without faking a mouse position.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ComposedBarLineChart } from '@/components/dashboard/charts/composed-bar-line-chart.client';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement;
      height?: number;
    }) => {
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 400, height: height ?? 300 }
      );
      return <div>{child}</div>;
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) => (
      <actual.Tooltip {...props} defaultIndex={1} />
    ),
  };
});

const data = [
  { category: 'P1', bar: 30, line: 28 },
  { category: 'P2', bar: 32, line: 35 },
];

describe('ComposedBarLineChart onSegmentClick', () => {
  it("reports a bar as ('bar')", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <ComposedBarLineChart
        data={data}
        barLabel="AY2026"
        lineLabel="AY2025"
        onSegmentClick={onSegmentClick}
      />
    );
    fireEvent.click(
      container.querySelectorAll('.recharts-bar-rectangle path')[0]
    );
    expect(onSegmentClick.mock.calls).toEqual([['P1', 'bar']]);
  });

  it("reports the comparison line's point as ('line')", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <ComposedBarLineChart
        data={data}
        barLabel="AY2026"
        lineLabel="AY2025"
        onSegmentClick={onSegmentClick}
      />
    );
    fireEvent.click(container.querySelector('.recharts-active-dot circle')!);
    expect(onSegmentClick.mock.calls).toEqual([['P2', 'line']]);
  });

  it('draws the active dot the same with or without the prop; only the pointer differs', () => {
    const clickable = render(
      <ComposedBarLineChart
        data={data}
        barLabel="AY2026"
        lineLabel="AY2025"
        onSegmentClick={vi.fn()}
      />
    );
    const plain = render(
      <ComposedBarLineChart data={data} barLabel="AY2026" lineLabel="AY2025" />
    );
    const a = clickable.container.querySelector('.recharts-active-dot circle');
    const b = plain.container.querySelector('.recharts-active-dot circle');
    for (const attr of ['r', 'fill', 'stroke', 'stroke-width']) {
      expect(a?.getAttribute(attr)).toBe(b?.getAttribute(attr));
    }
    expect(
      plain.container.querySelector('.recharts-active-dot [style*="cursor"]')
    ).toBeNull();
    expect(
      clickable.container.querySelector(
        '.recharts-active-dot [style*="cursor: pointer"]'
      )
    ).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `npx vitest run __tests__/dashboard/grouped-bar-chart.test.tsx __tests__/dashboard/composed-bar-line-chart.test.tsx --pool=threads`
Expected: FAIL — the new click tests get `expected [] to deeply equal [ [ 'T2', 'AY2026' ], … ]` (the prop is ignored) and the pointer assertions fail; the existing nine GroupedBarChart tests still pass.

- [ ] **Step 3: Implement GroupedBarChart**

In `components/dashboard/charts/grouped-bar-chart.client.tsx`, extend the `./chart-primitives` import (lines 20–33):

```ts
import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  barClickHandler,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  CLICKABLE_STYLE,
  formatterFor,
  MUTED_SERIES,
  SERIES_COLORS,
  SERIES_LEGEND,
  VALUE_LABEL,
  type SegmentClickHandler,
  type YFormat,
} from './chart-primitives';
```

Add to `GroupedBarChartProps` after `highlightX` (line 71):

```ts
  /**
   * Makes each bar clickable. Reports `(x, series key)` — on a year-compare
   * chart the series key is the AY code, so a click on last year's bar
   * names last year.
   */
  onSegmentClick?: SegmentClickHandler;
```

Destructure it (lines 114–122):

```ts
function GroupedBarChartImpl({
  series,
  data,
  height = 260,
  yFormat,
  yDomain,
  showValueLabels,
  highlightX,
  onSegmentClick,
}: GroupedBarChartProps) {
```

and give each `<Bar>` (lines 171–179) the click and the pointer:

```tsx
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={fill[i]}
            maxBarSize={40}
            radius={BAR_RADIUS_TOP}
            isAnimationActive={false}
            onClick={barClickHandler(onSegmentClick, 'x', s.key)}
            style={onSegmentClick ? CLICKABLE_STYLE : undefined}
          >
```

(the `Cell` / `LabelList` children are unchanged).

- [ ] **Step 4: Implement ComposedBarLineChart**

In `components/dashboard/charts/composed-bar-line-chart.client.tsx`, the `./chart-primitives` import becomes:

```ts
import {
  ACTIVE_DOT,
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  barClickHandler,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  CLICKABLE_STYLE,
  formatterFor,
  LINE_WIDTH,
  MUTED_SERIES,
  SERIES_COLORS,
  type SegmentClickHandler,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';
import { clickableActiveDot } from './clickable-active-dot';
```

The props type:

```ts
export type ComposedBarLineChartProps = {
  data: ComposedBarLinePoint[];
  barLabel: string;
  lineLabel: string;
  height?: number;
  yFormat?: YFormat;
  /**
   * Makes the bars and the line's points clickable. Reports
   * `(category, 'bar')` for this period's bar and `(category, 'line')` for
   * the comparison period's point — the caller maps each to its year.
   */
  onSegmentClick?: SegmentClickHandler;
};
```

The signature:

```ts
function ComposedBarLineChartImpl({
  data,
  barLabel,
  lineLabel,
  height = 300,
  yFormat,
  onSegmentClick,
}: ComposedBarLineChartProps) {
```

The `<Bar>` and `<Line>`:

```tsx
        <Bar
          dataKey="bar"
          name={barLabel}
          fill={SERIES_COLORS[0]}
          maxBarSize={40}
          radius={BAR_RADIUS_TOP}
          isAnimationActive={false}
          onClick={barClickHandler(onSegmentClick, 'category', 'bar')}
          style={onSegmentClick ? CLICKABLE_STYLE : undefined}
        />
        <Line
          dataKey="line"
          name={lineLabel}
          type="monotone"
          stroke={MUTED_SERIES}
          strokeWidth={LINE_WIDTH}
          strokeDasharray="4 4"
          dot={{ r: 2.5, fill: MUTED_SERIES }}
          activeDot={
            onSegmentClick
              ? clickableActiveDot({
                  fill: MUTED_SERIES,
                  categoryKey: 'category',
                  series: 'line',
                  onSegmentClick,
                })
              : { ...ACTIVE_DOT, fill: MUTED_SERIES }
          }
          connectNulls={false}
          isAnimationActive={false}
        />
```

- [ ] **Step 5: Run the tests — expect pass**

Run: `npx vitest run __tests__/dashboard/grouped-bar-chart.test.tsx __tests__/dashboard/composed-bar-line-chart.test.tsx --pool=threads`
Expected: PASS (12 + 3 tests).

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/charts/grouped-bar-chart.client.tsx components/dashboard/charts/composed-bar-line-chart.client.tsx __tests__/dashboard/grouped-bar-chart.test.tsx __tests__/dashboard/composed-bar-line-chart.test.tsx && git commit -m "feat(charts): grouped and bar-plus-line charts report the clicked bar or point" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.3: TrendChart and CategoryLineChart

**Files:**

- Modify: `components/dashboard/charts/trend-chart.client.tsx:18-30,36-87,89-102,242,306,327-339`
- Modify: `components/dashboard/charts/category-line-chart.client.tsx:16-29,44-58,60-69,127`
- Test: `__tests__/dashboard/trend-chart-click.test.tsx` (new), `__tests__/dashboard/category-line-chart.test.tsx` (new)

**Interfaces:**

- Consumes: `SegmentClickHandler` (Task 1.1), `clickableActiveDot` (Task 1.1).
- Produces: `TrendChartProps.onSegmentClick?: SegmentClickHandler` → `(x, 'current' | 'comparison')` (the provisional last point reports `'current'`); `CategoryLineChartProps.onSegmentClick?: SegmentClickHandler` → `(x)` with one argument.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/dashboard/trend-chart-click.test.tsx`:

```tsx
/**
 * TrendChart reports the clicked point's x and WHICH line it is on, so a
 * click on the comparison year's point opens that year (Review Focus #1).
 *
 * ResponsiveContainer is mocked to a fixed size and Tooltip pinned to
 * `defaultIndex={1}`, which draws each line's active dot at the second point.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { TrendChart } from '@/components/dashboard/charts/trend-chart.client';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement;
      height?: number;
    }) => {
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 400, height: height ?? 220 }
      );
      return <div>{child}</div>;
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) => (
      <actual.Tooltip {...props} defaultIndex={1} />
    ),
  };
});

const current = [
  { x: 'Jan', y: 12 },
  { x: 'Feb', y: 18 },
];
const comparison = [
  { x: 'Jan', y: 10 },
  { x: 'Feb', y: 14 },
];

describe('TrendChart onSegmentClick', () => {
  it("reports each line's own point: 'current' and 'comparison'", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <TrendChart
        label="Applications"
        current={current}
        comparison={comparison}
        onSegmentClick={onSegmentClick}
      />
    );
    const dots = container.querySelectorAll('.recharts-active-dot circle');
    expect(dots.length).toBe(2);
    dots.forEach((d) => fireEvent.click(d));
    expect(onSegmentClick.mock.calls).toHaveLength(2);
    expect(onSegmentClick.mock.calls).toContainEqual(['Feb', 'current']);
    expect(onSegmentClick.mock.calls).toContainEqual(['Feb', 'comparison']);
  });

  it("reports the provisional last point as 'current'", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <TrendChart
        label="Average grade"
        current={current}
        lastPointProvisional
        onSegmentClick={onSegmentClick}
      />
    );
    const dots = container.querySelectorAll('.recharts-active-dot circle');
    expect(dots.length).toBe(1);
    fireEvent.click(dots[0]);
    expect(onSegmentClick.mock.calls).toEqual([['Feb', 'current']]);
  });

  it('keeps the current dot unchanged and shows no pointer without the prop', () => {
    const clickable = render(
      <TrendChart label="A" current={current} onSegmentClick={vi.fn()} />
    );
    const plain = render(<TrendChart label="A" current={current} />);
    const a = clickable.container.querySelector('.recharts-active-dot circle');
    const b = plain.container.querySelector('.recharts-active-dot circle');
    for (const attr of ['r', 'fill', 'stroke', 'stroke-width']) {
      expect(a?.getAttribute(attr)).toBe(b?.getAttribute(attr));
    }
    expect(
      plain.container.querySelector('.recharts-active-dot [style*="cursor"]')
    ).toBeNull();
  });
});
```

Create `__tests__/dashboard/category-line-chart.test.tsx`:

```tsx
/**
 * CategoryLineChart has one series, so a click reports the point's x alone.
 * Same jsdom set-up as the other line-chart tests: fixed-size container,
 * Tooltip pinned to the second point.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CategoryLineChart } from '@/components/dashboard/charts/category-line-chart.client';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement;
      height?: number;
    }) => {
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 400, height: height ?? 260 }
      );
      return <div>{child}</div>;
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) => (
      <actual.Tooltip {...props} defaultIndex={1} />
    ),
  };
});

const data = [
  { x: 'P1', y: 80 },
  { x: 'P2', y: 82 },
  { x: 'P3', y: 79 },
];

describe('CategoryLineChart onSegmentClick', () => {
  it("reports the clicked point's x with ONE argument", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <CategoryLineChart data={data} onSegmentClick={onSegmentClick} />
    );
    fireEvent.click(container.querySelector('.recharts-active-dot circle')!);
    expect(onSegmentClick.mock.calls).toEqual([['P2']]);
  });

  it('draws the active dot the same with or without the prop; only the pointer differs', () => {
    const clickable = render(
      <CategoryLineChart data={data} onSegmentClick={vi.fn()} />
    );
    const plain = render(<CategoryLineChart data={data} />);
    const a = clickable.container.querySelector('.recharts-active-dot circle');
    const b = plain.container.querySelector('.recharts-active-dot circle');
    for (const attr of ['r', 'fill', 'stroke', 'stroke-width']) {
      expect(a?.getAttribute(attr)).toBe(b?.getAttribute(attr));
    }
    expect(
      plain.container.querySelector('.recharts-active-dot [style*="cursor"]')
    ).toBeNull();
    expect(
      clickable.container.querySelector(
        '.recharts-active-dot [style*="cursor: pointer"]'
      )
    ).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them — expect failure**

Run: `npx vitest run __tests__/dashboard/trend-chart-click.test.tsx __tests__/dashboard/category-line-chart.test.tsx --pool=threads`
Expected: FAIL — clicks record nothing (`expected [] to have a length of 2`, `expected [] to deeply equal [ [ 'P2' ] ]`) and the pointer assertion fails. The "unchanged without the prop" comparisons already pass.

- [ ] **Step 3: Implement TrendChart**

In `components/dashboard/charts/trend-chart.client.tsx`, the `./chart-primitives` import (lines 18–30) becomes:

```ts
import {
  ACTIVE_DOT,
  AXIS_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  LINE_CURSOR,
  LINE_WIDTH,
  MUTED_SERIES,
  VALUE_LABEL,
  type SegmentClickHandler,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';
import { clickableActiveDot } from './clickable-active-dot';
```

Add to `TrendChartProps` after `lastPointProvisional` (line 86):

```ts
  /**
   * Makes the point under the pointer clickable. Reports `(x, 'current')`
   * for this period's line (its provisional last point included) and
   * `(x, 'comparison')` for the dashed prior-period line — the caller maps
   * each to its year.
   */
  onSegmentClick?: SegmentClickHandler;
```

Destructure it (lines 89–102, after `lastPointProvisional = false,`):

```ts
  lastPointProvisional = false,
  onSegmentClick,
}: TrendChartProps) {
```

The `current` area's `activeDot` (line 242):

```tsx
          activeDot={
            onSegmentClick
              ? clickableActiveDot({
                  fill: mark,
                  categoryKey: 'x',
                  series: 'current',
                  onSegmentClick,
                })
              : { ...ACTIVE_DOT, fill: mark }
          }
```

The `pending` area's `activeDot` (line 306):

```tsx
            activeDot={
              onSegmentClick
                ? clickableActiveDot({
                    fill: MUTED_SERIES,
                    categoryKey: 'x',
                    series: 'current',
                    onSegmentClick,
                  })
                : { ...ACTIVE_DOT, fill: MUTED_SERIES }
            }
```

The `comparison` area (lines 327–339) gains an `activeDot` only when clickable — `undefined` keeps Recharts' default dot, exactly as today:

```tsx
{
  comparison && (
    <Area
      type="monotone"
      dataKey="comparison"
      name="Prior period"
      stroke={MUTED_SERIES}
      strokeDasharray="4 4"
      strokeWidth={LINE_WIDTH}
      fill="transparent"
      dot={false}
      activeDot={
        onSegmentClick
          ? clickableActiveDot({
              fill: MUTED_SERIES,
              categoryKey: 'x',
              series: 'comparison',
              onSegmentClick,
            })
          : undefined
      }
      isAnimationActive={false}
    />
  );
}
```

(When clickable, the comparison dot takes `ACTIVE_DOT`'s card-coloured ring instead of Recharts' default `#fff` ring — identical in light mode, and the tokenised ring is the correct one in dark mode.)

- [ ] **Step 4: Implement CategoryLineChart**

In `components/dashboard/charts/category-line-chart.client.tsx`, the `./chart-primitives` import (lines 16–29) becomes:

```ts
import {
  ACTIVE_DOT,
  AXIS_TICK,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  formatterFor,
  LINE_CURSOR,
  LINE_WIDTH,
  SERIES_COLORS,
  VALUE_LABEL,
  type SegmentClickHandler,
  type YFormat,
} from './chart-primitives';
import { chartTooltipContent } from './chart-tooltip';
import { clickableActiveDot } from './clickable-active-dot';
```

Add to `CategoryLineChartProps` after `seriesLabel` (line 57):

```ts
  /**
   * Makes the point under the pointer clickable. Reports `(x)` — one series,
   * so no second argument.
   */
  onSegmentClick?: SegmentClickHandler;
```

Destructure it (lines 60–69):

```ts
  seriesLabel = 'Value',
  onSegmentClick,
}: CategoryLineChartProps) {
```

The `<Line>` `activeDot` (line 127):

```tsx
          activeDot={
            onSegmentClick
              ? clickableActiveDot({
                  fill: color,
                  categoryKey: 'x',
                  onSegmentClick,
                })
              : { ...ACTIVE_DOT, fill: color }
          }
```

- [ ] **Step 5: Run the tests — expect pass**

Run: `npx vitest run __tests__/dashboard/trend-chart-click.test.tsx __tests__/dashboard/category-line-chart.test.tsx --pool=threads`
Expected: PASS (3 + 2 tests).

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/charts/trend-chart.client.tsx components/dashboard/charts/category-line-chart.client.tsx __tests__/dashboard/trend-chart-click.test.tsx __tests__/dashboard/category-line-chart.test.tsx && git commit -m "feat(charts): line charts report the clicked point and which line it is on" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.4: RetentionStackedBarChart and AttritionStackedBarChart

**Files:**

- Modify: `components/dashboard/charts/retention-stacked-bar-chart.client.tsx:18-28,51-59,120-138`
- Modify: `components/dashboard/charts/attrition-stacked-bar-chart.client.tsx:18-29,37-68,140-158`
- Test: `__tests__/dashboard/stacked-bar-charts-click.test.tsx` (new)

**Interfaces:**

- Consumes: `SegmentClickHandler`, `CLICKABLE_STYLE`, `barClickHandler` (Task 1.1).
- Produces: `RetentionStackedBarChartProps.onSegmentClick?: SegmentClickHandler` → `(level, 'returned' | 'didNotReturn')`; `AttritionStackedBarChartProps.onSegmentClick?: SegmentClickHandler` → `(level, reasonKey)` where `reasonKey` is the string from `reasonKeys` as passed.

- [ ] **Step 1: Write the failing test**

Create `__tests__/dashboard/stacked-bar-charts-click.test.tsx`:

```tsx
/**
 * The two stacked bar charts report the level AND the segment clicked:
 * retention says whether it is the returned or the did-not-return part,
 * attrition names the reason.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { RetentionStackedBarChart } from '@/components/dashboard/charts/retention-stacked-bar-chart.client';
import { AttritionStackedBarChart } from '@/components/dashboard/charts/attrition-stacked-bar-chart.client';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement;
      height?: number;
    }) => {
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 400, height: height ?? 280 }
      );
      return <div>{child}</div>;
    },
  };
});

const retention = [
  { level: 'P1', returned: 20, didNotReturn: 4, priorTotal: 24, pct: 83 },
  { level: 'P2', returned: 18, didNotReturn: 2, priorTotal: 20, pct: 90 },
];

const attrition = [
  { level: 'P1', Relocation: 3, Financial: 1 },
  { level: 'P2', Relocation: 2, Financial: 2 },
];

describe('RetentionStackedBarChart onSegmentClick', () => {
  it("reports (level, 'returned') and (level, 'didNotReturn')", () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <RetentionStackedBarChart
        data={retention}
        onSegmentClick={onSegmentClick}
      />
    );
    // Series by series: returned P1, returned P2, didNotReturn P1, didNotReturn P2.
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBe(4);
    fireEvent.click(bars[0]);
    fireEvent.click(bars[3]);
    expect(onSegmentClick.mock.calls).toEqual([
      ['P1', 'returned'],
      ['P2', 'didNotReturn'],
    ]);
  });

  it('shows the pointer only when clickable', () => {
    const plain = render(<RetentionStackedBarChart data={retention} />);
    plain.container
      .querySelectorAll('.recharts-bar-rectangle path')
      .forEach((el) =>
        expect(el.getAttribute('style') ?? '').not.toContain('cursor')
      );
    const clickable = render(
      <RetentionStackedBarChart data={retention} onSegmentClick={vi.fn()} />
    );
    clickable.container
      .querySelectorAll('.recharts-bar-rectangle path')
      .forEach((el) =>
        expect(el.getAttribute('style') ?? '').toContain('cursor: pointer')
      );
  });
});

describe('AttritionStackedBarChart onSegmentClick', () => {
  it('reports (level, reason key) for the clicked segment', () => {
    const onSegmentClick = vi.fn();
    const { container } = render(
      <AttritionStackedBarChart
        data={attrition}
        reasonKeys={['Relocation', 'Financial']}
        onSegmentClick={onSegmentClick}
      />
    );
    // Series by series: Relocation P1, Relocation P2, Financial P1, Financial P2.
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBe(4);
    fireEvent.click(bars[1]);
    fireEvent.click(bars[2]);
    expect(onSegmentClick.mock.calls).toEqual([
      ['P2', 'Relocation'],
      ['P1', 'Financial'],
    ]);
  });

  it('shows the pointer only when clickable', () => {
    const plain = render(
      <AttritionStackedBarChart
        data={attrition}
        reasonKeys={['Relocation', 'Financial']}
      />
    );
    plain.container
      .querySelectorAll('.recharts-bar-rectangle path')
      .forEach((el) =>
        expect(el.getAttribute('style') ?? '').not.toContain('cursor')
      );
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/dashboard/stacked-bar-charts-click.test.tsx --pool=threads`
Expected: FAIL — the two click tests get `expected [] to deeply equal […]`, the retention pointer test fails on the clickable half; the two "plain" checks pass.

- [ ] **Step 3: Implement RetentionStackedBarChart**

In `components/dashboard/charts/retention-stacked-bar-chart.client.tsx`, the `./chart-primitives` import (lines 18–28):

```ts
import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_TOP,
  barClickHandler,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  CLICKABLE_STYLE,
  MUTED_SERIES,
  SEGMENT_EDGE,
  VALUE_LABEL,
  type SegmentClickHandler,
} from './chart-primitives';
```

Props and signature (lines 51–59):

```ts
export type RetentionStackedBarChartProps = {
  data: RetentionStackRow[];
  height?: number;
  /**
   * Makes each segment clickable. Reports `(level, 'returned')` or
   * `(level, 'didNotReturn')` — the row's own data keys.
   */
  onSegmentClick?: SegmentClickHandler;
};

function RetentionStackedBarChartImpl({
  data,
  height = 280,
  onSegmentClick,
}: RetentionStackedBarChartProps) {
```

The two bars (lines 120–138):

```tsx
        <Bar
          dataKey="returned"
          name="Returned"
          stackId="cohort"
          fill="var(--color-brand-mint)"
          {...SEGMENT_EDGE}
          maxBarSize={48}
          isAnimationActive={false}
          onClick={barClickHandler(onSegmentClick, 'level', 'returned')}
          style={onSegmentClick ? CLICKABLE_STYLE : undefined}
        />
        <Bar
          dataKey="didNotReturn"
          name="Did not return"
          stackId="cohort"
          fill={MUTED_SERIES}
          {...SEGMENT_EDGE}
          radius={BAR_RADIUS_TOP}
          maxBarSize={48}
          isAnimationActive={false}
          onClick={barClickHandler(onSegmentClick, 'level', 'didNotReturn')}
          style={onSegmentClick ? CLICKABLE_STYLE : undefined}
        >
```

(the `LabelList` child and closing `</Bar>` are unchanged).

- [ ] **Step 4: Implement AttritionStackedBarChart**

In `components/dashboard/charts/attrition-stacked-bar-chart.client.tsx`, the `./chart-primitives` import:

```ts
import {
  AXIS_TICK,
  BAR_CURSOR,
  BAR_RADIUS_END,
  BAR_RADIUS_TOP,
  barClickHandler,
  CATEGORY_TICK,
  CHART_AXIS,
  CHART_GRID,
  CLICKABLE_STYLE,
  SEGMENT_EDGE,
  SERIES_COLORS,
  SERIES_LEGEND,
  type SegmentClickHandler,
} from './chart-primitives';
```

Props and signature:

```ts
export type AttritionStackedBarChartProps = {
  data: AttritionStackedBarPoint[];
  reasonKeys: string[];
  height?: number;
  /**
   * Makes each reason segment clickable. Reports `(level, reasonKey)` with
   * the key exactly as passed in `reasonKeys`.
   */
  onSegmentClick?: SegmentClickHandler;
};
```

```ts
function AttritionStackedBarChartImpl({
  data,
  reasonKeys,
  height = 260,
  onSegmentClick,
}: AttritionStackedBarChartProps) {
```

The bars:

```tsx
{
  reasonKeys.map((key, i) => (
    <Bar
      key={key}
      dataKey={key}
      name={key}
      stackId="reasons"
      fill={REASON_COLOR_VARS[i % REASON_COLOR_VARS.length]}
      {...SEGMENT_EDGE}
      maxBarSize={isHorizontal ? 16 : 40}
      isAnimationActive={false}
      radius={
        i === reasonKeys.length - 1
          ? isHorizontal
            ? BAR_RADIUS_END
            : BAR_RADIUS_TOP
          : [0, 0, 0, 0]
      }
      onClick={barClickHandler(onSegmentClick, 'level', key)}
      style={onSegmentClick ? CLICKABLE_STYLE : undefined}
    />
  ));
}
```

- [ ] **Step 5: Run the test — expect pass**

Run: `npx vitest run __tests__/dashboard/stacked-bar-charts-click.test.tsx --pool=threads`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/charts/retention-stacked-bar-chart.client.tsx components/dashboard/charts/attrition-stacked-bar-chart.client.tsx __tests__/dashboard/stacked-bar-charts-click.test.tsx && git commit -m "feat(charts): stacked retention and attrition bars report level and segment" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.5: NationalityMixPie and NationalityByLevelBars

**Files:**

- Modify: `components/dashboard/insights/nationality-mix-pie.tsx:3,43-55,127-131`
- Modify: `components/dashboard/insights/nationality-by-level-bars.tsx:5,41-48,79-95`
- Test: `__tests__/dashboard/nationality-click.test.tsx` (new)

**Interfaces:**

- Consumes: `SegmentClickHandler` (Task 1.1); `LabeledPieChart`'s existing `onSegmentClick` (slices + keyboard legend rows).
- Produces: `NationalityMixPie` prop `onSegmentClick?: SegmentClickHandler` → `(nationality)`, passed straight to `LabeledPieChart`; `NationalityByLevelBars` prop `onSegmentClick?: SegmentClickHandler` → `(row.level, segment.nationality)`. Both still render from a Server Component when the prop is absent (`NationalityMixPie` has no `'use client'` and imports nothing server-only; the phase 3/4 client wrappers render it with the prop).

- [ ] **Step 1: Write the failing test**

Create `__tests__/dashboard/nationality-click.test.tsx`:

```tsx
/**
 * The two nationality blocks report the nationality clicked — the pie by
 * slice or legend row, the per-level bars by (level, nationality).
 *
 * NationalityMixPie renders LabeledPieChart through its next/dynamic shell;
 * the shell is swapped for the client chart so the legend renders
 * synchronously in jsdom.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NationalityMixPie } from '@/components/dashboard/insights/nationality-mix-pie';
import { NationalityByLevelBars } from '@/components/dashboard/insights/nationality-by-level-bars';

vi.mock('@/components/dashboard/charts/labeled-pie-chart', async () => ({
  LabeledPieChart: (
    await import('@/components/dashboard/charts/labeled-pie-chart.client')
  ).LabeledPieChart,
}));

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
      height,
    }: {
      children: React.ReactElement;
      height?: number | string;
    }) => {
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 240, height: typeof height === 'number' ? height : 240 }
      );
      return <div>{child}</div>;
    },
  };
});

const mixRows = [
  { nationality: 'Singaporean', count: 10 },
  { nationality: 'Filipino', count: 5 },
  { nationality: 'Other', count: 2, foldedCount: 2 },
];

const byLevel = {
  legend: ['Singaporean', 'Filipino'],
  rows: [
    {
      level: 'P1',
      total: 5,
      segments: [
        { nationality: 'Singaporean', count: 2 },
        { nationality: 'Filipino', count: 3 },
      ],
    },
  ],
};

describe('NationalityMixPie onSegmentClick', () => {
  it('reports the nationality of the clicked legend row, Other included', () => {
    const onSegmentClick = vi.fn();
    render(
      <NationalityMixPie
        rows={mixRows}
        unitLabel="applicants"
        onSegmentClick={onSegmentClick}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filipino/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    expect(onSegmentClick.mock.calls).toEqual([['Filipino'], ['Other']]);
  });

  it('has nothing clickable without the prop', () => {
    render(<NationalityMixPie rows={mixRows} unitLabel="applicants" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('NationalityByLevelBars onSegmentClick', () => {
  it('reports (level, nationality) on click and on Enter', () => {
    const onSegmentClick = vi.fn();
    render(
      <NationalityByLevelBars
        data={byLevel}
        unitLabel="enrolled students"
        onSegmentClick={onSegmentClick}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'P1 · Filipino: 3' }));
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'P1 · Singaporean: 2' }),
      { key: 'Enter' }
    );
    expect(onSegmentClick.mock.calls).toEqual([
      ['P1', 'Filipino'],
      ['P1', 'Singaporean'],
    ]);
  });

  it('renders plain segments without the prop', () => {
    render(
      <NationalityByLevelBars data={byLevel} unitLabel="enrolled students" />
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it — expect failure**

Run: `npx vitest run __tests__/dashboard/nationality-click.test.tsx --pool=threads`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name /^Filipino/` (the pie is rendered without a click handler, so its legend rows are not buttons) and the same for `'P1 · Filipino: 3'`. The two "without the prop" tests pass.

- [ ] **Step 3: Implement NationalityMixPie**

In `components/dashboard/insights/nationality-mix-pie.tsx`, line 3 becomes:

```ts
import {
  SERIES_COLORS,
  type SegmentClickHandler,
} from '@/components/dashboard/charts/chart-primitives';
```

The props (lines 43–55):

```tsx
export function NationalityMixPie({
  rows,
  compareRows,
  compareLabel,
  unitLabel,
  onSegmentClick,
}: {
  rows: NationalityMixRow[];
  /** Prior-AY rows, or null when no comparison year is selected. */
  compareRows?: NationalityMixRow[] | null;
  compareLabel?: string | null;
  /** What one slice counts, e.g. "applicants" or "enrolled students". */
  unitLabel: string;
  /**
   * Makes each slice and legend row clickable. Reports `(nationality)` —
   * including the synthetic `'Other'` and `'Unspecified'` buckets, which the
   * drill must resolve to exactly the rows they count.
   */
  onSegmentClick?: SegmentClickHandler;
}) {
```

The pie (lines 127–131):

```tsx
<LabeledPieChart
  data={rows.map((r) => ({ name: r.nationality, value: r.count }))}
  colors={colors}
  height={240}
  onSegmentClick={onSegmentClick}
/>
```

- [ ] **Step 4: Implement NationalityByLevelBars**

In `components/dashboard/insights/nationality-by-level-bars.tsx`, line 5 becomes:

```ts
import {
  SERIES_COLORS,
  type SegmentClickHandler,
} from '@/components/dashboard/charts/chart-primitives';
```

The props:

```tsx
export function NationalityByLevelBars({
  data,
  unitLabel,
  onSegmentClick,
}: {
  data: NationalityByLevel;
  /** What one unit is, e.g. "enrolled students". */
  unitLabel: string;
  /**
   * Makes each segment a button. Reports `(level, nationality)` with the
   * row's level exactly as shown and the segment's nationality (`'Other'` /
   * `'Unspecified'` included). Click, Enter or Space — the segments are
   * already focusable through their hint.
   */
  onSegmentClick?: SegmentClickHandler;
}) {
```

The segment span (inside `row.segments.map`, lines 86–92):

```tsx
<span
  className={
    onSegmentClick
      ? 'h-full cursor-pointer transition-opacity hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
      : 'h-full'
  }
  style={{
    width: `${share}%`,
    background: colorFor(seg.nationality, legend),
  }}
  role={onSegmentClick ? 'button' : undefined}
  aria-label={
    onSegmentClick
      ? `${row.level} · ${seg.nationality}: ${seg.count}`
      : undefined
  }
  onClick={
    onSegmentClick
      ? () => onSegmentClick(row.level, seg.nationality)
      : undefined
  }
  onKeyDown={
    onSegmentClick
      ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSegmentClick(row.level, seg.nationality);
          }
        }
      : undefined
  }
/>
```

(`tabIndex` is not added: `HoverHint` already gives the child `tabIndex={0}`. Hover emphasis is the opacity step — the HTML counterpart of the donut legend's `hover:bg-accent/40`, since a coloured bar segment has no background to tint.)

- [ ] **Step 5: Run the test — expect pass**

Run: `npx vitest run __tests__/dashboard/nationality-click.test.tsx --pool=threads`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/insights/nationality-mix-pie.tsx components/dashboard/insights/nationality-by-level-bars.tsx __tests__/dashboard/nationality-click.test.tsx && git commit -m "feat(insights): nationality pie and per-level bars report the nationality clicked" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.6: Phase gate

**Files:** none modified unless a check fails.

- [ ] **Step 1: Types — the shells thread the prop and every existing caller still compiles**

Run: `npx tsc --noEmit`
Expected: exit 0. This covers the dynamic shells (`components/dashboard/charts/<name>.tsx` spread `{...props}` typed from the client file) and every existing `onSegmentClick` caller of the three widened charts: `components/admissions/applications-by-level-card.tsx`, `components/admissions/referral-source-chart.tsx`, `components/admissions/drills/chart-drill-cards.tsx`, `components/attendance/drills/attendance-by-section-card.tsx`, `components/attendance/drills/chart-drill-cards.tsx`, `components/evaluation/drills/chart-drill-cards.tsx`, `components/house-points/drills/chart-drill-cards.tsx`, `components/markbook/drills/chart-drill-cards.tsx`, `components/markbook/drills/teacher-entry-velocity-card.tsx`. If a tsc error appears in a file this phase did not touch, check its mtime first — another session may be mid-edit (`git status`).

- [ ] **Step 2: Every dashboard/chart test, old and new**

Run: `npx vitest run __tests__/dashboard --pool=threads`
Expected: PASS — including the pre-existing `grouped-bar-chart.test.tsx` (9 original tests: nothing changed without the prop) and `ay-comparison-line-chart.test.tsx` (untouched chart). Re-run any failure in isolation before calling it a regression.

Run: `npx vitest run __tests__/house-points __tests__/markbook/subject-term-panel.test.tsx --pool=threads`
Expected: PASS — the other suites that render these charts.

- [ ] **Step 3: Lint and format the touched files**

Run: `npx eslint components/dashboard/charts components/dashboard/insights/nationality-mix-pie.tsx components/dashboard/insights/nationality-by-level-bars.tsx __tests__/dashboard`
Expected: no errors.

Run: `npx prettier --check components/dashboard/charts components/dashboard/insights/nationality-mix-pie.tsx components/dashboard/insights/nationality-by-level-bars.tsx __tests__/dashboard`
Expected: all files formatted. If not, `npx prettier --write` the listed files and commit:

```bash
git add components/dashboard/charts components/dashboard/insights/nationality-mix-pie.tsx components/dashboard/insights/nationality-by-level-bars.tsx __tests__/dashboard && git commit -m "style(charts): prettier" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Hard Rule #7 check on the diff**

Run: `git diff "$(git log --format=%H --grep="one segment-click type" -1)~1" -- components/dashboard | grep -nE "#[0-9a-fA-F]{3,6}\b|oklch\(|slate-|zinc-|gray-|bg-white|bg-black"`
Expected: no output (the only colours added are existing `var(--color-*)` tokens and `ring-ring`).

- [ ] **Step 5: Reviewer pass**

Dispatch the standing code reviewer on this phase's commits with the Review Focus list from the plan index. For this phase the reviewer checks: (1) every chart reports the comparison series under its own key — `GroupedBarChart` the muted series' `key`, `TrendChart` `'comparison'`, `ComposedBarLineChart` `'line'`; (2) no chart changes a pixel without the prop (the "unchanged" tests plus a read of each diff); (3) the callback type is `SegmentClickHandler` in all eleven charts. Phases 2–5 may start only after approval.

No page wiring happens in this phase, so there is no page to open; the "page opened" check (Review Focus #5) belongs to phases 2–5, whose client wrappers are the first code to pass these props.

---

## Findings for phases 2–5 (differences from the spec table)

- **TrendChart reports `'current'` / `'comparison'`, not an AY code.** Its data has no year in it (`current` / `comparison` arrays). The Admissions "Applications per month" wrapper (phase 3) maps `'current'` → the selected AY and `'comparison'` → the compare AY.
- **Retention's series is `'didNotReturn'`, not `'notReturned'`** — the chart's actual `dataKey`. Phase 4's `retention` segment parser must accept `'didNotReturn'` (or the wrapper translates it).
- **Attrition reports the reason LABEL.** `lib/sis/records-insights.ts:121` documents `withdrawalReasonKeys` as "All reason labels"; the chart echoes whatever `reasonKeys` holds. Phase 4's `withdrawals` target must resolve label → reason with the same mapping the rollup used.
- **ComposedBarLineChart reports `'bar'` / `'line'`**; on Records the bar is `selectedAy` and the line `compareAy` (`app/(records)/records/insights/page.tsx:680-686`) — the wrapper maps them.
- **Both nationality blocks report `'Other'` and `'Unspecified'` as-is** (the pie's `NationalityMixRow.nationality`, the bars' segment `nationality`). Phases 3/4 translate `'Other'` to the overflow bucket (`__other__`) so the drill opens exactly the rows it counts (Review Focus #3).
- **`NationalityByLevelBars` reports `row.level` as displayed** — on Admissions that is the folded `levelApplied` label, not a level code (Review Focus #4).
