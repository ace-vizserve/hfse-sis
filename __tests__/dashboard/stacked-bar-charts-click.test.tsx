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
    const plainBars = plain.container.querySelectorAll(
      '.recharts-bar-rectangle path'
    );
    expect(plainBars.length).toBeGreaterThan(0);
    plainBars.forEach((el) =>
      expect(el.getAttribute('style') ?? '').not.toContain('cursor')
    );
    const clickable = render(
      <RetentionStackedBarChart data={retention} onSegmentClick={vi.fn()} />
    );
    const clickableBars = clickable.container.querySelectorAll(
      '.recharts-bar-rectangle path'
    );
    expect(clickableBars.length).toBeGreaterThan(0);
    clickableBars.forEach((el) =>
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
    const plainBars = plain.container.querySelectorAll(
      '.recharts-bar-rectangle path'
    );
    expect(plainBars.length).toBeGreaterThan(0);
    plainBars.forEach((el) =>
      expect(el.getAttribute('style') ?? '').not.toContain('cursor')
    );
  });
});
