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
  },
  {
    id: 'row-2',
    label: 'Sheet unlocked',
    summary: '—',
    tone: 'warning',
    timeAgo: '2h ago',
  },
];

describe('RecentActionsPanel', () => {
  it('renders one timeline row per action with its label, summary, and time', () => {
    render(<RecentActionsPanel actions={actions} />);
    expect(screen.getByText('Recent actions')).toBeInTheDocument();
    expect(screen.getByText('Sheet locked')).toBeInTheDocument();
    expect(screen.getByText('Math T1')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('Sheet unlocked')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    // Two dots + a connecting line, list-item-per-action
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows an empty state when there is no recent activity', () => {
    // ⚠ ASSERTS BOTH HALVES, not just that some text appeared. §7.6 says an
    // empty state carries a title AND a sentence of guidance — this panel
    // shipped with only a one-line note until 2026-09-10, which is exactly
    // what a test matching a single string cannot tell you.
    render(<RecentActionsPanel actions={[]} />);
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Marks, attendance and approvals you record/)
    ).toBeInTheDocument();
  });
});
