import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecentActionsPanel } from '@/components/home/recent-actions-panel';
import type { RecentAction } from '@/lib/home/recent-actions';

const actions: RecentAction[] = [
  {
    id: 'row-1',
    label: 'Sheet locked',
    summary: 'Math T1',
    tone: 'secondary',
    timeAgo: '5m ago',
    module: 'Markbook',
  },
  {
    id: 'row-2',
    label: 'Sheet unlocked',
    summary: '—',
    tone: 'warning',
    timeAgo: '2h ago',
    module: null,
  },
];

describe('RecentActionsPanel', () => {
  it('renders one row per action with its module tag, label, summary, and time', () => {
    render(<RecentActionsPanel actions={actions} />);
    expect(screen.getByText('Recent actions')).toBeInTheDocument();
    expect(screen.getByText('Your last 2')).toBeInTheDocument();
    expect(screen.getByText('Markbook')).toBeInTheDocument();
    expect(screen.getByText('Sheet locked')).toBeInTheDocument();
    expect(screen.getByText('Math T1')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('Sheet unlocked')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('links to the audit log only when given a destination', () => {
    const { rerender } = render(<RecentActionsPanel actions={actions} />);
    expect(
      screen.queryByRole('link', { name: /See all in the audit log/ })
    ).not.toBeInTheDocument();
    rerender(
      <RecentActionsPanel actions={actions} auditLogHref="/sis/audit-log" />
    );
    expect(
      screen.getByRole('link', { name: /See all in the audit log/ })
    ).toHaveAttribute('href', '/sis/audit-log');
  });

  it('shows an empty state when there is no recent activity', () => {
    // ⚠ ASSERTS BOTH HALVES, not just that some text appeared. §7.6 says an
    // empty state carries a title AND a sentence of guidance.
    render(<RecentActionsPanel actions={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Marks, attendance and approvals you record/)
    ).toBeInTheDocument();
  });
});
