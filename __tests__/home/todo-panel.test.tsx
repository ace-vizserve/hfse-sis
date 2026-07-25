import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithClient } from '../_utils/render-with-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoPanel } from '@/components/home/todo-panel';
import type { HomeTodoItem } from '@/lib/home/todos';

describe('TodoPanel', () => {
  it('renders a timeline dot + text for a review item, with a Review link', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'admissions-doc-validation',
        module: 'Admissions',
        text: '5 documents awaiting validation',
        href: '/admissions/document-validation',
        kind: 'review',
      },
    ];
    render(<TodoPanel title="To-do" items={items} />);
    expect(
      screen.getByText('5 documents awaiting validation')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      '/admissions/document-validation'
    );
  });

  it('renders a requester sub-card with Approve/Reject for a change-request item', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'cr-1',
        module: 'Markbook',
        text: 'Grade change — T2 Science',
        href: '/markbook/change-requests?req=cr-1',
        kind: 'change-request',
        aging: { label: '2 days', tone: 'success' },
        requestId: 'cr-1',
        requestedBy: 'teacher@hfse.test',
      },
    ];
    renderWithClient(<TodoPanel title="To-do" items={items} />);
    expect(screen.getByText('Grade change — T2 Science')).toBeInTheDocument();
    expect(
      screen.getByText(/requested by teacher@hfse.test/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reject/i })).toBeInTheDocument();
  });

  it('renders the empty state when there are no items', () => {
    render(<TodoPanel title="To-do" items={[]} />);
    expect(
      screen.getByText('Nothing needs your attention right now.')
    ).toBeInTheDocument();
  });
});
