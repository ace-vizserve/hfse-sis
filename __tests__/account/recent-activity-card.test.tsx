import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecentActivityCard } from '@/app/(dashboard)/account/recent-activity-card';

describe('RecentActivityCard', () => {
  it('shows an honest empty state with no rows', () => {
    render(
      <RecentActivityCard rows={[]} viewAllHref="/markbook/audit-log?actor=x" />
    );
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it('renders a label + relative time per row', () => {
    render(
      <RecentActivityCard
        rows={[
          {
            id: '1',
            createdAt: new Date().toISOString(),
            label: 'Grade updated',
            summary: 'Filipino · W2',
            tone: 'default',
          },
        ]}
        viewAllHref="/markbook/audit-log?actor=x"
      />
    );
    expect(screen.getByText('Grade updated')).toBeInTheDocument();
    expect(screen.getByText('Filipino · W2')).toBeInTheDocument();
  });

  it('always renders the "View all activity" link, even under 6 rows', () => {
    render(
      <RecentActivityCard rows={[]} viewAllHref="/markbook/audit-log?actor=x" />
    );
    const link = screen.getByRole('link', { name: /view all activity/i });
    expect(link).toHaveAttribute('href', '/markbook/audit-log?actor=x');
  });
});
