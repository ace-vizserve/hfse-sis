/**
 * Behaviour test for AyComparisonLineChart — the fix for the original bug
 * (the current-year and comparison-year lines were both near-identical
 * blues). Asserts the current series renders solid brand blue with an area
 * fill, and the comparison series renders dashed neutral grey, never another
 * shade of blue.
 *
 * jsdom has no layout engine, so recharts' `ResponsiveContainer` measures 0×0
 * and emits no SVG children. We mock it to pass a fixed size to its child so
 * recharts renders full SVG output, mirroring the existing
 * `multi-series-trend-muted.test.tsx` pattern.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AyComparisonLineChart } from '@/components/dashboard/charts/ay-comparison-line-chart.client';

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
        { width: 400, height: height ?? 240 }
      );
      return <div>{child}</div>;
    },
  };
});

const twoAySeries = [
  { key: 'AY2026', label: 'AY2026' },
  { key: 'AY2025', label: 'AY2025', muted: true },
];

describe('AyComparisonLineChart', () => {
  it('renders the current series solid brand blue with an area fill, never dashed', () => {
    const { container } = render(
      <AyComparisonLineChart
        series={twoAySeries}
        data={[
          { x: 'Jan', AY2026: 12, AY2025: 10 },
          { x: 'Feb', AY2026: 18, AY2025: 14 },
        ]}
        yFormat="number"
      />
    );

    const curves = container.querySelectorAll('.recharts-area-curve');
    const currentCurve = Array.from(curves).find(
      (el) => el.getAttribute('stroke') === 'var(--color-chart-1)'
    );
    expect(currentCurve).toBeTruthy();
    expect(currentCurve?.getAttribute('stroke-dasharray')).toBeFalsy();

    const areas = container.querySelectorAll('.recharts-area-area');
    const currentArea = Array.from(areas).find((el) =>
      (el.getAttribute('fill') ?? '').startsWith('url(#')
    );
    expect(currentArea).toBeTruthy();
  });

  it('renders the comparison series dashed neutral grey, never another shade of blue', () => {
    const { container } = render(
      <AyComparisonLineChart
        series={twoAySeries}
        data={[
          { x: 'Jan', AY2026: 12, AY2025: 10 },
          { x: 'Feb', AY2026: 18, AY2025: 14 },
        ]}
        yFormat="number"
      />
    );

    const curves = Array.from(
      container.querySelectorAll('.recharts-area-curve')
    );
    const comparisonCurve = curves.find(
      (el) => el.getAttribute('stroke') === 'var(--color-muted-foreground)'
    );
    expect(comparisonCurve).toBeTruthy();
    expect(comparisonCurve?.getAttribute('stroke-dasharray')).toBe('6 5');

    // Never a second blue for the comparison year.
    const strokes = curves.map((el) => el.getAttribute('stroke'));
    expect(strokes).not.toContain('var(--color-chart-2)');
    expect(strokes).not.toContain('var(--color-chart-3)');
  });

  it('draws a zero reference line only when the data straddles zero', () => {
    const straddling = render(
      <AyComparisonLineChart
        series={[{ key: 'net', label: 'Net movement' }]}
        data={[
          { x: 'Jan', net: 4 },
          { x: 'Feb', net: -2 },
        ]}
        yFormat="number"
      />
    );
    expect(
      straddling.container.querySelectorAll('.recharts-reference-line').length
    ).toBeGreaterThan(0);

    const allPositive = render(
      <AyComparisonLineChart
        series={[{ key: 'net', label: 'Net movement' }]}
        data={[
          { x: 'Jan', net: 4 },
          { x: 'Feb', net: 2 },
        ]}
        yFormat="number"
      />
    );
    expect(
      allPositive.container.querySelectorAll('.recharts-reference-line').length
    ).toBe(0);
  });

  it('marks each series endpoint with a reference dot', () => {
    const { container } = render(
      <AyComparisonLineChart
        series={twoAySeries}
        data={[
          { x: 'Jan', AY2026: 12, AY2025: 10 },
          { x: 'Feb', AY2026: 18, AY2025: 14 },
        ]}
        yFormat="number"
      />
    );
    expect(container.querySelectorAll('.recharts-reference-dot').length).toBe(
      2
    );
  });

  it('returns null (renders nothing) for empty data', () => {
    const { container } = render(
      <AyComparisonLineChart series={[{ key: 'a', label: 'A' }]} data={[]} />
    );
    expect(container.firstChild).toBeNull();
  });
});
