import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Charts stand in as one button per clickable segment, calling the same
// callback the real chart calls — the wiring is what is under test.
vi.mock('@/components/dashboard/charts/grouped-bar-chart', () => ({
  GroupedBarChart: ({
    data,
    series,
    onSegmentClick,
  }: {
    data: Array<Record<string, unknown>>;
    series: Array<{ key: string }>;
    onSegmentClick?: (category: string, series?: string) => void;
  }) => (
    <div>
      {data.flatMap((row) =>
        series.map((s) => (
          <button
            key={`${String(row.x)}:${s.key}`}
            type="button"
            onClick={() => onSegmentClick?.(String(row.x), s.key)}
          >
            {`${String(row.x)}:${s.key}`}
          </button>
        ))
      )}
    </div>
  ),
}));

vi.mock('@/components/dashboard/charts/labeled-pie-chart', () => ({
  LabeledPieChart: ({
    data,
    onSegmentClick,
  }: {
    data: Array<{ name: string }>;
    onSegmentClick?: (name: string) => void;
  }) => (
    <div>
      {data.map((d) => (
        <button
          key={d.name}
          type="button"
          onClick={() => onSegmentClick?.(d.name)}
        >
          {d.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/attendance/drills/attendance-drill-sheet', () => ({
  AttendanceDrillSheet: (props: Record<string, unknown>) => (
    <pre data-testid="drill">{JSON.stringify(props)}</pre>
  ),
}));

import {
  AttendanceMixPieDrill,
  CompositionBarsDrill,
  SeeAllDrillButton,
  TermRateBarsDrill,
} from '@/components/attendance/drills/insights-drill-cards';
import type { TermWindowMap } from '@/lib/attendance/insights-drill';

const termWindows: TermWindowMap = {
  AY2026: {
    T1: { from: '2026-01-05', to: '2026-03-13' },
    T2: { from: '2026-03-23', to: '2026-05-29' },
  },
  AY2025: {
    T1: { from: '2025-01-06', to: '2025-03-14' },
    T2: { from: '2025-03-24', to: '2025-05-30' },
  },
};

function openedDrill(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('drill').textContent ?? '{}');
}

describe('AttendanceMixPieDrill', () => {
  it('opens the clicked status for the selected term', () => {
    render(
      <AttendanceMixPieDrill
        data={[
          { name: 'Present', value: 90 },
          { name: 'Absent', value: 3 },
        ]}
        colors={['a', 'b']}
        ayCode="AY2026"
        from="2026-03-23"
        to="2026-05-29"
      />
    );
    expect(screen.queryByTestId('drill')).toBeNull();
    fireEvent.click(screen.getByText('Present'));
    expect(openedDrill()).toMatchObject({
      target: 'present',
      ayCode: 'AY2026',
      initialFrom: '2026-03-23',
      initialTo: '2026-05-29',
    });
  });
});

describe('TermRateBarsDrill', () => {
  const data = [
    { x: 'T1', AY2026: 95, AY2025: 94 },
    { x: 'T2', AY2026: 96, AY2025: 93 },
    { x: 'T3', AY2026: null, AY2025: 92 },
  ];
  const series = [
    { key: 'AY2026', label: 'This year (AY2026)' },
    { key: 'AY2025', label: 'AY2025', muted: true },
  ];

  it("opens the comparison year's term when its bar is clicked", () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T2:AY2025'));
    expect(openedDrill()).toMatchObject({
      target: 'attendance-summary',
      ayCode: 'AY2025',
      initialFrom: '2025-03-24',
      initialTo: '2025-05-30',
    });
  });

  it("opens this year's term when this year's bar is clicked", () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T1:AY2026'));
    expect(openedDrill()).toMatchObject({
      ayCode: 'AY2026',
      initialFrom: '2026-01-05',
      initialTo: '2026-03-13',
    });
  });

  it('opens nothing for a term that has no dates', () => {
    render(
      <TermRateBarsDrill
        series={series}
        data={data}
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T3:AY2025'));
    expect(screen.queryByTestId('drill')).toBeNull();
  });
});

describe('CompositionBarsDrill', () => {
  it("opens the clicked status in the clicked term's window", () => {
    render(
      <CompositionBarsDrill
        series={[
          { key: 'present', label: 'Present' },
          { key: 'late', label: 'Late' },
        ]}
        data={[
          { x: 'T1', present: 95, late: 2 },
          { x: 'T2', present: 96, late: 1 },
        ]}
        ayCode="AY2026"
        termWindows={termWindows}
      />
    );
    fireEvent.click(screen.getByText('T2:late'));
    expect(openedDrill()).toMatchObject({
      target: 'lates',
      ayCode: 'AY2026',
      initialFrom: '2026-03-23',
      initialTo: '2026-05-29',
    });
  });
});

describe('SeeAllDrillButton', () => {
  it('opens its target with the segment and term it was given', () => {
    render(
      <SeeAllDrillButton
        target="over-leave-quota"
        segment="compassionate"
        ayCode="AY2026"
        termId="term-2"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(openedDrill()).toMatchObject({
      target: 'over-leave-quota',
      segment: 'compassionate',
      ayCode: 'AY2026',
      termId: 'term-2',
    });
  });
});
