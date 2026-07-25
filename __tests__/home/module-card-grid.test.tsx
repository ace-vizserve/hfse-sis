import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModuleCardGrid } from '@/components/home/module-card-grid';
import type { ModuleCard } from '@/lib/home/module-cards';

const cards: ModuleCard[] = [
  {
    module: 'Markbook',
    href: '/markbook',
    statValue: '82%',
    statLabel: 'Sheets locked',
    chart: { kind: 'bar', pct: 82 },
  },
  {
    module: 'Records',
    href: '/records',
    statValue: '812',
    statLabel: 'Enrolled',
    chart: { kind: 'none' },
    badge: { label: '2 unsynced', tone: 'warning' },
  },
];

describe('ModuleCardGrid', () => {
  it('renders one card per module with its stat + label', () => {
    render(<ModuleCardGrid cards={cards} />);
    expect(screen.getByText('Markbook')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('Sheets locked')).toBeInTheDocument();
    expect(screen.getByText('Records')).toBeInTheDocument();
    expect(screen.getByText('2 unsynced')).toBeInTheDocument();
  });

  it('links each card to its module', () => {
    render(<ModuleCardGrid cards={cards} />);
    expect(screen.getByRole('link', { name: /Markbook/ })).toHaveAttribute(
      'href',
      '/markbook'
    );
  });
});
