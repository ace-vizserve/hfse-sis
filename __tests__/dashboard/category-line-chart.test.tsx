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
