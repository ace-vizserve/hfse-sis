/**
 * Regression / behaviour test for the `muted` prop on MultiSeriesTrendChart.
 *
 * jsdom has no layout engine, so recharts' `ResponsiveContainer` measures 0×0
 * and emits no SVG children. We mock it to pass a fixed 400×240 to its child
 * so recharts renders the full `<LineChart>` + `<Line>` elements including
 * stroke attributes. The test then asserts that the muted series produces at
 * least one SVG `<path>` with `stroke-dasharray="5 4"`, while the non-muted
 * series produces none.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MultiSeriesTrendChart } from '@/components/dashboard/charts/multi-series-trend-chart.client';

// Mock ResponsiveContainer to render its child with fixed dimensions so
// recharts actually produces SVG paths in jsdom.
// recharts' ResponsiveContainer uses React.cloneElement to inject width/height
// into its direct child (e.g. LineChart). We replicate that here.
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
      // Inject the fixed dimensions into the LineChart child so it renders SVG.
      const child = React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 400, height: height ?? 240 }
      );
      return <div>{child}</div>;
    },
  };
});

describe('MultiSeriesTrendChart — muted series', () => {
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

  it('renders the non-muted series WITHOUT a dashed stroke', () => {
    const { container } = render(
      <MultiSeriesTrendChart
        series={[{ key: 'AY2026', label: 'AY2026' }]}
        data={[
          { x: 'T1', AY2026: 97 },
          { x: 'T2', AY2026: 96 },
        ]}
        yFormat="percent"
      />
    );

    const dashed = Array.from(container.querySelectorAll('path')).filter(
      (p) => p.getAttribute('stroke-dasharray') === '5 4'
    );
    expect(dashed.length).toBe(0);
  });
});
