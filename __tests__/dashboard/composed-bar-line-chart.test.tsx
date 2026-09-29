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
