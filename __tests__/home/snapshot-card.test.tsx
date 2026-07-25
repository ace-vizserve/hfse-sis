import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SnapshotCard } from '@/components/home/snapshot-card';
import type { HomeKpi } from '@/lib/home/kpis';

describe('SnapshotCard', () => {
  it('renders each KPI value, label, and its fraction caption when present', () => {
    const kpis: HomeKpi[] = [
      { value: '1,048', label: 'Active students, AY2026' },
      {
        value: '96%',
        label: 'Attendance rate, today',
        fraction: '480 of 500 marked as attending',
      },
    ];
    render(<SnapshotCard kpis={kpis} />);
    expect(screen.getByText('1,048')).toBeInTheDocument();
    expect(screen.getByText('Active students, AY2026')).toBeInTheDocument();
    expect(screen.getByText('96%')).toBeInTheDocument();
    expect(
      screen.getByText('480 of 500 marked as attending')
    ).toBeInTheDocument();
  });

  it('renders nothing when there are no KPIs', () => {
    const { container } = render(<SnapshotCard kpis={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
