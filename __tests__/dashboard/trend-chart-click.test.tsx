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
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    for (const attr of ['r', 'fill', 'stroke', 'stroke-width']) {
      expect(a?.getAttribute(attr)).not.toBeNull();
      expect(a?.getAttribute(attr)).toBe(b?.getAttribute(attr));
    }
    expect(
      plain.container.querySelector('.recharts-active-dot [style*="cursor"]')
    ).toBeNull();
  });
});
