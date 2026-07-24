import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChartLegendChip } from '@/components/dashboard/chart-legend-chip';

describe('ChartLegendChip', () => {
  it('applies the gradient class for the given color', () => {
    render(<ChartLegendChip color="chart-4" label="School event" />);
    const badge = screen.getByText('School event').closest('div');
    expect(badge?.className).toContain('from-chart-4');
    expect(badge?.className).toContain('to-chart-2');
  });

  it('does not fall back to the default indigo gradient', () => {
    render(<ChartLegendChip color="very-stale" label="Term exam" />);
    const badge = screen.getByText('Term exam').closest('div');
    expect(badge?.className).not.toContain('from-brand-indigo');
  });

  it('forwards a caller className alongside the color gradient', () => {
    render(
      <ChartLegendChip
        color="fresh"
        label="Custom"
        className="hidden sm:inline-flex"
      />
    );
    const badge = screen.getByText('Custom').closest('div');
    expect(badge?.className).toContain('hidden');
    expect(badge?.className).toContain('sm:inline-flex');
    expect(badge?.className).toContain('from-chart-5'); // 'fresh' → chart-5→chart-3
  });
});
