/**
 * The shared click plumbing every clickable chart uses: one callback type,
 * one "read the category off the clicked row" rule, one clickable active dot.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ActiveDotProps, BarRectangleItem } from 'recharts';

import {
  barClickHandler,
  reportSegment,
} from '@/components/dashboard/charts/chart-primitives';
import { clickableActiveDot } from '@/components/dashboard/charts/clickable-active-dot';

describe('reportSegment', () => {
  it('reports the row category and the series', () => {
    const fn = vi.fn();
    reportSegment(fn, { x: 'T2', AY2026: 92 }, 'x', 'AY2026');
    expect(fn.mock.calls).toEqual([['T2', 'AY2026']]);
  });

  it('calls with ONE argument when the chart has no series', () => {
    const fn = vi.fn();
    reportSegment(fn, { x: 'P1', y: 80 }, 'x');
    expect(fn.mock.calls).toEqual([['P1']]);
  });

  it('ignores a row with no category, an empty category, or no row', () => {
    const fn = vi.fn();
    reportSegment(fn, { y: 80 }, 'x');
    reportSegment(fn, { x: '' }, 'x');
    reportSegment(fn, undefined, 'x');
    reportSegment(fn, { x: 3 }, 'x');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('barClickHandler', () => {
  it('is undefined when the chart is not clickable, so <Bar onClick> stays unset', () => {
    expect(barClickHandler(undefined, 'x', 'AY2026')).toBeUndefined();
  });

  it("reads the category off the clicked bar's payload row", () => {
    const fn = vi.fn();
    const handler = barClickHandler(fn, 'level', 'returned');
    handler!({
      payload: { level: 'P3', returned: 12 },
    } as unknown as BarRectangleItem);
    expect(fn.mock.calls).toEqual([['P3', 'returned']]);
  });
});

describe('clickableActiveDot', () => {
  const dotProps = {
    cx: 10,
    cy: 20,
    payload: { x: 'Feb', current: 5 },
    index: 1,
    dataKey: 'current',
  } as unknown as ActiveDotProps;

  it('draws the same dot ACTIVE_DOT draws, with the pointer', () => {
    const Dot = clickableActiveDot({
      fill: 'var(--color-series-1)',
      categoryKey: 'x',
      series: 'current',
      onSegmentClick: vi.fn(),
    });
    const { container } = render(<svg>{Dot(dotProps)}</svg>);
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('r')).toBe('4');
    expect(circle?.getAttribute('stroke')).toBe('var(--color-card)');
    expect(circle?.getAttribute('stroke-width')).toBe('2');
    expect(circle?.getAttribute('fill')).toBe('var(--color-series-1)');
    expect(container.querySelector('g')?.getAttribute('style')).toContain(
      'cursor: pointer'
    );
  });

  it("reports the point's category and this dot's series on click", () => {
    const fn = vi.fn();
    const Dot = clickableActiveDot({
      fill: 'var(--color-ink-5)',
      categoryKey: 'x',
      series: 'comparison',
      onSegmentClick: fn,
    });
    const { container } = render(<svg>{Dot(dotProps)}</svg>);
    fireEvent.click(container.querySelector('circle')!);
    expect(fn.mock.calls).toEqual([['Feb', 'comparison']]);
  });
});
