import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/sis/drills/records-drill-sheet', () => ({
  RecordsDrillSheet: (p: {
    target: string;
    segment?: string | null;
    ayCode: string;
    compareAy?: string;
  }) => (
    <div
      data-testid="drill"
      data-target={p.target}
      data-segment={p.segment ?? ''}
      data-ay={p.ayCode}
      data-compare={p.compareAy ?? ''}
    />
  ),
}));
vi.mock('@/components/dashboard/charts/composed-bar-line-chart', () => ({
  ComposedBarLineChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <>
      <button onClick={() => p.onSegmentClick?.('P1', 'bar')}>bar P1</button>
      <button onClick={() => p.onSegmentClick?.('P1', 'line')}>line P1</button>
    </>
  ),
}));
vi.mock('@/components/dashboard/charts/retention-stacked-bar-chart', () => ({
  RetentionStackedBarChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <button onClick={() => p.onSegmentClick?.('P2', 'didNotReturn')}>
      left P2
    </button>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: (p: { onSegmentClick?: (c: string) => void }) => (
    <button onClick={() => p.onSegmentClick?.('Term 3')}>Term 3</button>
  ),
}));

import {
  LateByTermDrillCard,
  PopulationByLevelDrillCard,
  RecordsSeeAllButton,
  RetentionByLevelDrillCard,
} from '@/components/sis/drills/insights-drill-cards';

const drill = () => screen.getByTestId('drill');

describe('insights drill cards', () => {
  it('a this-year bar opens this year', () => {
    render(
      <PopulationByLevelDrillCard
        data={[]}
        barLabel="AY2026"
        lineLabel="AY2025"
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('bar P1'));
    expect(drill().dataset).toMatchObject({
      target: 'enrolled-headcount',
      segment: 'level:P1',
      ay: 'AY2026',
    });
  });

  it('the comparison line opens the comparison year', () => {
    render(
      <PopulationByLevelDrillCard
        data={[]}
        barLabel="AY2026"
        lineLabel="AY2025"
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('line P1'));
    expect(drill().dataset.ay).toBe('AY2025');
  });

  it('retention carries both years and the outcome', () => {
    render(
      <RetentionByLevelDrillCard data={[]} ayCode="AY2026" compareAy="AY2025" />
    );
    fireEvent.click(screen.getByText('left P2'));
    expect(drill().dataset).toMatchObject({
      target: 'retention',
      segment: 'level:P2|outcome:didNotReturn',
      ay: 'AY2026',
      compare: 'AY2025',
    });
  });

  it('late by term sends the term number', () => {
    render(<LateByTermDrillCard data={[]} ayCode="AY2026" />);
    fireEvent.click(screen.getByText('Term 3'));
    expect(drill().dataset).toMatchObject({
      target: 'late-enrollees',
      segment: 'term:3',
    });
  });

  it('See all opens the whole list only when pressed', () => {
    render(<RecordsSeeAllButton target="withdrawals" ayCode="AY2026" />);
    expect(screen.queryByTestId('drill')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /see all/i }));
    expect(drill().dataset).toMatchObject({
      target: 'withdrawals',
      segment: '',
    });
  });
});
