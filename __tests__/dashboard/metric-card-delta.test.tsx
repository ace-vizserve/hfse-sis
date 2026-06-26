import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/dashboard/metric-card';
import { computeDelta } from '@/lib/dashboard/range';

describe('MetricCard — deltaFormat/deltaUnit passthrough', () => {
  it('renders an absolute "pp" delta and the comparison label', () => {
    render(
      <MetricCard
        label="Attendance"
        value={97}
        format="percent"
        delta={computeDelta(97, 98.4)}
        deltaGoodWhen="up"
        deltaFormat="absolute"
        deltaUnit="pp"
        comparisonLabel="vs AY2025 · 98.4%"
      />
    );
    expect(screen.getByText(/1\.4 pp/)).toBeInTheDocument(); // absolute, not relative %
    expect(screen.getByText('vs AY2025 · 98.4%')).toBeInTheDocument();
  });
});
