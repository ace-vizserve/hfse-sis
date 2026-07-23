import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { HubStat } from '@/components/sis/hub-stat';

describe('HubStat delta chip', () => {
  it('renders a mint chip for a good "up" delta', () => {
    render(
      <HubStat
        label="Enrolled students"
        value={330}
        icon={Users}
        delta={{ abs: 12, pct: 3.8, direction: 'up' }}
        comparisonLabel="vs AY2025"
      />
    );
    expect(screen.getByText(/\+12/)).toBeInTheDocument();
    expect(screen.getByText('vs AY2025')).toBeInTheDocument();
  });

  it('renders nothing extra when delta is omitted', () => {
    const { container } = render(
      <HubStat label="Active sections" value={24} icon={Users} />
    );
    expect(container.querySelector('[data-slot="delta-chip"]')).toBeNull();
  });
});
