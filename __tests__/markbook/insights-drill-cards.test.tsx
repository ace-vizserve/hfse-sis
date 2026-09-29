/**
 * The Insights wrappers turn a click into the right drill: target, segment,
 * and — for a comparison series — that series' year. Charts are next/dynamic
 * (ssr:false) and never draw in jsdom, so each is replaced by buttons that
 * call onSegmentClick the way Phase 1's charts do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const opened: Record<string, unknown>[] = [];

vi.mock('@/components/markbook/drills/markbook-drill-sheet', () => ({
  MarkbookDrillSheet: (props: Record<string, unknown>) => {
    opened.push(props);
    return (
      <div data-testid="drill">{props.description as React.ReactNode}</div>
    );
  },
}));
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: (p: {
    onSegmentClick?: (c: string, s?: string) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => p.onSegmentClick?.('T2', 'Mathematics · AY2025')}
      >
        trend bar
      </button>
      <button
        type="button"
        onClick={() => p.onSegmentClick?.('Term 3', 'locked')}
      >
        lock bar
      </button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: (p: {
    onSegmentClick?: (c: string) => void;
    data: Array<{ category: string }>;
  }) => (
    <div>
      {p.data.map((d) => (
        <button
          key={d.category}
          type="button"
          onClick={() => p.onSegmentClick?.(d.category)}
        >
          {d.category}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/category-line-chart', () => ({
  CategoryLineChart: (p: {
    onSegmentClick?: (x: string) => void;
    data: Array<{ x: string }>;
  }) => (
    <div>
      {p.data.map((d) => (
        <button key={d.x} type="button" onClick={() => p.onSegmentClick?.(d.x)}>
          {d.x}
        </button>
      ))}
    </div>
  ),
}));

import {
  LevelAverageDrillChart,
  SheetLockDrillChart,
  SubjectTrendDrillChart,
  SubjectsToWatchDrillChart,
  TermMovementDrillChart,
  TopBandBadgeDrill,
} from '@/components/markbook/drills/insights-drill-cards';

const last = () => opened[opened.length - 1];

beforeEach(() => {
  opened.length = 0;
});

describe('Markbook Insights drill wrappers', () => {
  it('a trend bar opens its subject, term and the SERIES year', async () => {
    render(<SubjectTrendDrillChart series={[]} data={[]} />);
    await userEvent.click(screen.getByText('trend bar'));
    expect(last()).toMatchObject({
      target: 'subject-term-entries',
      segment: 'Mathematics|T2',
      ayCode: 'AY2025',
      showInsightsSummary: true,
    });
  });

  it('a subject-to-watch bar opens that subject in the latest term', async () => {
    render(
      <SubjectsToWatchDrillChart
        data={[{ category: 'English', current: 78.2 }]}
        ayCode="AY2026"
        termNumber={3}
      />
    );
    await userEvent.click(screen.getByText('English'));
    expect(last()).toMatchObject({
      target: 'subject-term-entries',
      segment: 'English|T3',
      ayCode: 'AY2026',
    });
  });

  it('a level point opens that level in the latest term', async () => {
    render(
      <LevelAverageDrillChart
        data={[{ x: 'P2', y: 80 }]}
        ayCode="AY2026"
        termNumber={3}
      />
    );
    await userEvent.click(screen.getByText('P2'));
    expect(last()).toMatchObject({
      target: 'level-term-entries',
      segment: 'P2|T3',
    });
  });

  it('a movement pair opens its subject × level', async () => {
    render(
      <TermMovementDrillChart
        data={[{ category: 'Mathematics · P1', current: 80, comparison: 85 }]}
        ayCode="AY2026"
        segmentByCategory={{ 'Mathematics · P1': 'Mathematics|P1' }}
      />
    );
    await userEvent.click(screen.getByText('Mathematics · P1'));
    expect(last()).toMatchObject({
      target: 'subject-level-entries',
      segment: 'Mathematics|P1',
    });
  });

  it('a lock bar labelled "Term 3" opens T3, not every sheet', async () => {
    render(<SheetLockDrillChart series={[]} data={[]} ayCode="AY2026" />);
    await userEvent.click(screen.getByText('lock bar'));
    expect(last()).toMatchObject({
      target: 'term-sheet-status',
      segment: 'T3',
      ayCode: 'AY2026',
    });
  });

  it('the top-band badge opens this year, then the comparison year on request', async () => {
    render(
      <TopBandBadgeDrill
        badge={{ label: '▲ 4pp vs AY2025', tone: 'mint' }}
        years={[
          { ayCode: 'AY2026', termNumber: 2, topCount: 40, total: 100 },
          { ayCode: 'AY2025', termNumber: 2, topCount: 27, total: 90 },
        ]}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /85 and above/ }));
    expect(last()).toMatchObject({
      target: 'grade-bucket-entries',
      segment: 'top|T2',
      ayCode: 'AY2026',
    });
    expect(
      screen.getByText(
        /40 of 100 graded marks in Term 2 of AY2026 are 85 or above \(40%\)/
      )
    ).toBeTruthy();

    await userEvent.click(
      screen.getByRole('button', { name: 'Show AY2025 instead' })
    );
    expect(last()).toMatchObject({ segment: 'top|T2', ayCode: 'AY2025' });
  });

  it('with nothing graded the badge is plain text', () => {
    render(
      <TopBandBadgeDrill
        badge={{ label: 'Building history', tone: 'muted' }}
        years={[]}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Building history')).toBeTruthy();
  });
});
