/**
 * Behaviour test for GroupedBarChart's colour resolution — the whole point of
 * this component is that a muted (comparison-year) series never renders in
 * another shade of the accent blue.
 *
 * jsdom has no layout engine, so recharts' `ResponsiveContainer` measures 0×0
 * and emits no SVG children. We mock it to pass a fixed size to its child so
 * recharts renders the full `<BarChart>` + `<Bar>` elements with fill attrs,
 * mirroring the existing `multi-series-trend-muted.test.tsx` pattern.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { GroupedBarChart } from '@/components/dashboard/charts/grouped-bar-chart.client';

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
  };
});

describe('GroupedBarChart', () => {
  it('renders one bar per series, grouped (no stackId)', () => {
    const { container } = render(
      <GroupedBarChart
        series={[
          { key: 'AY2026', label: 'AY2026' },
          { key: 'AY2025', label: 'AY2025', muted: true },
        ]}
        data={[
          { x: 'T1', AY2026: 94, AY2025: 91 },
          { x: 'T2', AY2026: 92, AY2025: 90 },
        ]}
        yFormat="percent"
        yDomain={[80, 100]}
      />
    );

    // Two categories × two series = 4 bars. Recharts draws each bar as a
    // <path class="recharts-rectangle"> (rounded corners use a path, never a
    // plain <rect>) wrapped in a <g class="recharts-bar-rectangle">.
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBe(4);
  });

  it('renders the muted series in neutral grey, never another shade of the accent blue', () => {
    const { container } = render(
      <GroupedBarChart
        series={[
          { key: 'AY2026', label: 'AY2026' },
          { key: 'AY2025', label: 'AY2025', muted: true },
        ]}
        data={[{ x: 'T1', AY2026: 94, AY2025: 91 }]}
        yFormat="percent"
      />
    );

    const fills = Array.from(
      container.querySelectorAll('.recharts-bar-rectangle path')
    ).map((el) => el.getAttribute('fill'));

    expect(fills).toContain('var(--color-chart-1)');
    expect(fills).toContain('var(--color-muted-foreground)');
    // The muted series must never fall back to a second chart-palette colour.
    expect(fills).not.toContain('var(--color-chart-2)');
  });

  it('cycles the chart palette across non-muted series (e.g. Markbook subjects)', () => {
    const { container } = render(
      <GroupedBarChart
        series={[
          { key: 'english', label: 'English' },
          { key: 'math', label: 'Math' },
          { key: 'science', label: 'Science' },
        ]}
        data={[{ x: 'T1', english: 82, math: 78, science: 85 }]}
        yFormat="number"
      />
    );

    const fills = Array.from(
      container.querySelectorAll('.recharts-bar-rectangle path')
    ).map((el) => el.getAttribute('fill'));

    expect(fills).toEqual([
      'var(--color-chart-1)',
      'var(--color-chart-2)',
      'var(--color-chart-3)',
    ]);
  });

  it('returns null (renders nothing) for empty data', () => {
    const { container } = render(
      <GroupedBarChart series={[{ key: 'a', label: 'A' }]} data={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('highlightX renders full opacity on the matching category and dims the rest', () => {
    const { container } = render(
      <GroupedBarChart
        series={[{ key: 'rate', label: 'Rate' }]}
        data={[
          { x: 'T1', rate: 94 },
          { x: 'T2', rate: 92 },
          { x: 'T3', rate: 96 },
        ]}
        yFormat="percent"
        highlightX="T2"
      />
    );

    const opacities = Array.from(
      container.querySelectorAll('.recharts-bar-rectangle path')
    ).map((el) => el.getAttribute('fill-opacity'));

    // One bar per category (single series) — T2 (index 1) is highlighted.
    expect(opacities).toEqual(['0.45', '1', '0.45']);
  });

  it('highlightX still resolves the muted series to grey, not a second chart colour', () => {
    const { container } = render(
      <GroupedBarChart
        series={[
          { key: 'AY2026', label: 'AY2026' },
          { key: 'AY2025', label: 'AY2025', muted: true },
        ]}
        data={[{ x: 'T1', AY2026: 94, AY2025: 91 }]}
        yFormat="percent"
        highlightX="T1"
      />
    );

    const fills = Array.from(
      container.querySelectorAll('.recharts-bar-rectangle path')
    ).map((el) => el.getAttribute('fill'));

    expect(fills).toContain('var(--color-chart-1)');
    expect(fills).toContain('var(--color-muted-foreground)');
    expect(fills).not.toContain('var(--color-chart-2)');
  });

  it('no highlightX leaves every bar at full opacity (no behaviour change for existing callers)', () => {
    const { container } = render(
      <GroupedBarChart
        series={[{ key: 'rate', label: 'Rate' }]}
        data={[
          { x: 'T1', rate: 94 },
          { x: 'T2', rate: 92 },
        ]}
        yFormat="percent"
      />
    );

    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    // No <Cell> children at all when highlightX is unset — nothing to assert
    // an opacity attribute on; the plain <Bar fill=...> path renders as-is.
    bars.forEach((el) => expect(el.getAttribute('fill-opacity')).toBeNull());
  });

  it('showValueLabels renders the formatted value above each bar', () => {
    const { container } = render(
      <GroupedBarChart
        series={[{ key: 'rate', label: 'Rate' }]}
        data={[{ x: 'T1', rate: 94.2 }]}
        yFormat="percent"
        showValueLabels
      />
    );

    const labelText = container.querySelector('.recharts-label-list text');
    expect(labelText?.textContent).toBe('94%');
  });

  it('showValueLabels renders an empty label (not "null") for a null data point', () => {
    const { container } = render(
      <GroupedBarChart
        series={[{ key: 'rate', label: 'Rate' }]}
        data={[{ x: 'T1', rate: null }]}
        yFormat="percent"
        showValueLabels
      />
    );

    const labelText = container.querySelector('.recharts-label-list text');
    expect(labelText?.textContent ?? '').toBe('');
  });
});
