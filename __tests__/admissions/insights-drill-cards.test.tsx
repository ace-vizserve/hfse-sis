// __tests__/admissions/insights-drill-cards.test.tsx
//
// The wrappers turn a click into (target, segment, year). Charts and sheets
// are mocked to buttons / a JSON readout so each test clicks exactly the
// part a reader would, and reads back what would open.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Click = (category: string, series?: string) => void;

vi.mock('@/components/admissions/drills/admissions-drill-sheet', () => ({
  AdmissionsDrillSheet: (p: {
    target: string;
    segment?: string | null;
    ayCode: string;
    scopeLabel?: string;
    initialGroupBy?: string;
  }) => (
    <output data-testid="drill">
      {JSON.stringify({
        target: p.target,
        segment: p.segment ?? null,
        ayCode: p.ayCode,
        scopeLabel: p.scopeLabel ?? null,
      })}
    </output>
  ),
}));
vi.mock('@/components/admissions/drills/feedback-rating-drill-sheet', () => ({
  FeedbackRatingDrillSheet: (p: { ayCode: string; segment: string | null }) => (
    <output data-testid="drill">
      {JSON.stringify({
        target: 'feedback-rating',
        segment: p.segment,
        ayCode: p.ayCode,
      })}
    </output>
  ),
}));
vi.mock('@/components/dashboard/charts/trend-chart', () => ({
  TrendChart: ({ onSegmentClick }: { onSegmentClick?: Click }) => (
    <div>
      <button onClick={() => onSegmentClick?.('Mar', 'current')}>
        current Mar
      </button>
      <button onClick={() => onSegmentClick?.('Mar', 'comparison')}>
        comparison Mar
      </button>
      <button onClick={() => onSegmentClick?.('Oct', 'current')}>
        current Oct
      </button>
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: ({
    data,
    series,
    onSegmentClick,
  }: {
    data: Array<{ x: string }>;
    series: Array<{ key: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.flatMap((row) =>
        series.map((s) => (
          <button
            key={`${row.x}-${s.key}`}
            onClick={() => onSegmentClick?.(row.x, s.key)}
          >
            {`${row.x} ${s.key}`}
          </button>
        ))
      )}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/donut-chart', () => ({
  DonutChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ name: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.map((d) => (
        <button key={d.name} onClick={() => onSegmentClick?.(d.name)}>
          {d.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/charts/comparison-bar-chart', () => ({
  ComparisonBarChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ category: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.map((d) => (
        <button key={d.category} onClick={() => onSegmentClick?.(d.category)}>
          {d.category}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/insights/nationality-mix-pie', () => ({
  NationalityMixPie: ({
    rows,
    onSegmentClick,
  }: {
    rows: Array<{ nationality: string }>;
    onSegmentClick?: Click;
  }) => (
    <div>
      {rows.map((r) => (
        <button
          key={r.nationality}
          onClick={() => onSegmentClick?.(r.nationality)}
        >
          {r.nationality}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('@/components/dashboard/insights/nationality-by-level-bars', () => ({
  NationalityByLevelBars: ({
    data,
    onSegmentClick,
  }: {
    data: {
      rows: Array<{ level: string; segments: Array<{ nationality: string }> }>;
    };
    onSegmentClick?: Click;
  }) => (
    <div>
      {data.rows.flatMap((r) =>
        r.segments.map((s) => (
          <button
            key={`${r.level}-${s.nationality}`}
            onClick={() => onSegmentClick?.(r.level, s.nationality)}
          >
            {`${r.level} ${s.nationality}`}
          </button>
        ))
      )}
    </div>
  ),
}));

import {
  AssessmentConversionDrillChart,
  CancellationReasonsDrillDonut,
  CategoryMixDrillChart,
  FeedbackRatingDrillChart,
  IntakeTrendDrillChart,
  NationalityByLevelDrillBars,
  NationalityMixDrillPie,
  ReferralVolumeDrillDonut,
  TerminalReasonsSeeAll,
  TopReasonPerLevelList,
  WithdrawnByLevelDrillDonut,
} from '@/components/admissions/drills/insights-drill-cards';
import {
  encodePairSegment,
  OVERFLOW_SEGMENT,
} from '@/lib/admissions/insights-predicates';

afterEach(cleanup);

const opened = () =>
  JSON.parse(screen.getByTestId('drill').textContent ?? 'null') as {
    target: string;
    segment: string | null;
    ayCode: string;
    scopeLabel?: string | null;
  };

describe('IntakeTrendDrillChart', () => {
  const current = [
    { x: 'Mar', y: 4 },
    { x: 'Oct', y: null as unknown as number },
  ];
  const comparison = [
    { x: 'Mar', y: 2 },
    { x: 'Oct', y: 1 },
  ];
  const props = {
    label: 'Applications',
    current,
    comparison,
    selectedAy: 'AY2026',
    compareAy: 'AY2025',
  };

  it("opens last year's applications for a click on last year's point", () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('comparison Mar'));
    expect(opened()).toEqual({
      target: 'intake-month',
      segment: 'Mar',
      ayCode: 'AY2025',
      scopeLabel: 'Whole academic year',
    });
  });

  it("opens this year's applications for this year's point", () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('current Mar'));
    expect(opened().ayCode).toBe('AY2026');
  });

  it('opens nothing for a month that has not happened yet', () => {
    render(<IntakeTrendDrillChart {...props} />);
    fireEvent.click(screen.getByText('current Oct'));
    expect(screen.queryByTestId('drill')).toBeNull();
  });
});

describe('CategoryMixDrillChart', () => {
  it("opens the comparison year's category for its bar", () => {
    render(
      <CategoryMixDrillChart
        series={[
          { key: 'current', label: 'AY2026' },
          { key: 'compare', label: 'AY2025', muted: true },
        ]}
        data={[{ x: 'New', current: 3, compare: 2 }]}
        selectedAy="AY2026"
        compareAy="AY2025"
      />
    );
    fireEvent.click(screen.getByText('New compare'));
    expect(opened()).toMatchObject({
      target: 'category',
      segment: 'New',
      ayCode: 'AY2025',
    });
  });
});

describe('AssessmentConversionDrillChart', () => {
  it('opens the not-assessed English applicants', () => {
    render(
      <AssessmentConversionDrillChart
        series={[
          { key: 'pass', label: 'Pass' },
          { key: 'notAssessed', label: 'Not assessed' },
        ]}
        data={[{ x: 'English', pass: 50, notAssessed: 20 }]}
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('English notAssessed'));
    expect(opened()).toMatchObject({
      target: 'assessment-all',
      segment: 'eng:notAssessed',
    });
  });
});

describe('CancellationReasonsDrillDonut', () => {
  it('opens the overflow slice as the overflow bucket', () => {
    render(
      <CancellationReasonsDrillDonut
        bars={[
          { key: 'financial', label: 'Financial reasons', count: 4 },
          { key: 'other_reasons', label: 'Other reasons', count: 3 },
        ]}
        centerValue="7"
        centerLabel="Cancellations"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Other reasons'));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: encodePairSegment('', OVERFLOW_SEGMENT),
    });
  });
});

describe('Top reason per level', () => {
  it('a row opens every reason for that level', () => {
    render(
      <TopReasonPerLevelList
        ayCode="AY2026"
        rows={[
          {
            level: 'Youngstarters | Little Stars',
            count: 3,
            topReasonLabel: 'Financial reasons',
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Youngstarters/ }));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: encodePairSegment('Youngstarters | Little Stars', ''),
    });
  });

  it('See all opens every application with a reason', () => {
    render(<TerminalReasonsSeeAll ayCode="AY2026" />);
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(opened()).toMatchObject({
      target: 'terminal-reason',
      segment: null,
    });
  });
});

describe('ReferralVolumeDrillDonut', () => {
  it('opens the folded Other as the overflow bucket', () => {
    render(
      <ReferralVolumeDrillDonut
        rows={[
          { source: 'Facebook', applied: 5, enrolled: 1, conversionPct: 20 },
          {
            source: 'Other',
            applied: 3,
            enrolled: 0,
            conversionPct: 0,
            folded: true,
          },
        ]}
        centerValue="8"
        centerLabel="Applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Other'));
    expect(opened()).toMatchObject({
      target: 'referral-all',
      segment: OVERFLOW_SEGMENT,
    });
  });
});

describe('the remaining charts', () => {
  it('a ★ bar opens that rating', () => {
    render(
      <FeedbackRatingDrillChart
        data={[{ category: '4★', current: 2 }]}
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('4★'));
    expect(opened()).toEqual({
      target: 'feedback-rating',
      segment: '4',
      ayCode: 'AY2026',
    });
  });

  it('a withdrawn slice opens that level', () => {
    render(
      <WithdrawnByLevelDrillDonut
        data={[{ name: 'P1', value: 2 }]}
        centerValue="2"
        centerLabel="Withdrawn"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('P1'));
    expect(opened()).toMatchObject({
      target: 'withdrawn-by-level',
      segment: 'P1',
    });
  });

  it('a nationality slice opens that nationality', () => {
    render(
      <NationalityMixDrillPie
        rows={[{ nationality: 'Singapore', count: 3 }]}
        compareRows={null}
        compareLabel={null}
        unitLabel="applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Singapore'));
    expect(opened()).toMatchObject({
      target: 'nationality',
      segment: encodePairSegment('', 'Singapore'),
    });
  });

  it('a nationality × level segment opens that level and bucket', () => {
    render(
      <NationalityByLevelDrillBars
        data={{
          legend: ['Other'],
          rows: [
            {
              level: 'Youngstarters | Little Stars',
              total: 2,
              segments: [{ nationality: 'Other', count: 2 }],
            },
          ],
        }}
        unitLabel="applicants"
        ayCode="AY2026"
      />
    );
    fireEvent.click(screen.getByText('Youngstarters | Little Stars Other'));
    expect(opened()).toMatchObject({
      target: 'nationality',
      segment: encodePairSegment('Youngstarters | Little Stars', 'Other'),
    });
  });
});
