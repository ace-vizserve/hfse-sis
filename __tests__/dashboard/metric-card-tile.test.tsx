import { render } from '@testing-library/react';
import { Trophy } from 'lucide-react';
import { MetricCard } from '@/components/dashboard/metric-card';

describe('MetricCard tileClassName', () => {
  it('applies a custom tile gradient when tileClassName is set', () => {
    const { container } = render(
      <MetricCard
        label="Gold"
        value={12}
        icon={Trophy}
        tileClassName="from-brand-amber to-brand-amber/70"
      />
    );
    const tile = container.querySelector('.from-brand-amber');
    expect(tile).not.toBeNull();
    // the default indigo gradient must NOT be present when overridden
    expect(container.querySelector('.from-brand-indigo')).toBeNull();
  });

  it('falls back to the indigo tile when tileClassName is omitted', () => {
    const { container } = render(
      <MetricCard label="Students" value={35} icon={Trophy} />
    );
    expect(container.querySelector('.from-brand-indigo')).not.toBeNull();
  });
});
