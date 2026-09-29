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
