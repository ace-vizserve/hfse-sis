import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickActionsRow } from '@/components/home/quick-actions-row';

describe('QuickActionsRow', () => {
  it('renders one link per action with an ArrowUpRight icon', () => {
    render(
      <QuickActionsRow
        actions={[
          { label: 'Enter grades', href: '/markbook/grading' },
          { label: 'Mark attendance', href: '/attendance/sections' },
        ]}
      />
    );
    const link = screen.getByRole('link', { name: /Enter grades/ });
    expect(link).toHaveAttribute('href', '/markbook/grading');
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  it('renders nothing when there are no actions', () => {
    const { container } = render(<QuickActionsRow actions={[]} />);
    expect(container.querySelector('a')).toBeNull();
  });
});
