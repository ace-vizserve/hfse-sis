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

  it('gives only the first action the primary gradient treatment — the rest are outline (§9.2, one default button per view)', () => {
    render(
      <QuickActionsRow
        actions={[
          { label: 'Enter grades', href: '/markbook/grading' },
          { label: 'Mark attendance', href: '/attendance/sections' },
          { label: 'Write evaluation', href: '/evaluation' },
        ]}
      />
    );
    const primary = screen.getByRole('link', { name: /Enter grades/ });
    const secondary1 = screen.getByRole('link', { name: /Mark attendance/ });
    const secondary2 = screen.getByRole('link', { name: /Write evaluation/ });

    expect(primary.className).toContain('shadow-button');
    expect(secondary1.className).not.toContain('shadow-button');
    expect(secondary1.className).toContain('shadow-input');
    expect(secondary2.className).not.toContain('shadow-button');
    expect(secondary2.className).toContain('shadow-input');
  });
});
