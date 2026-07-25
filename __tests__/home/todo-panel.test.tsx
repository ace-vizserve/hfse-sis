import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderWithClient } from '../_utils/render-with-client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoPanel } from '@/components/home/todo-panel';
import type { HomeTodoItem } from '@/lib/home/todos';

describe('TodoPanel', () => {
  it('renders a review item with its module, text, and a Review link — and no grouping when nothing is urgent', () => {
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
    expect(screen.getByText('Admissions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      '/admissions/document-validation'
    );
    expect(screen.getByText('1 to review')).toBeInTheDocument();
    expect(screen.queryByText('Needs a decision')).not.toBeInTheDocument();
  });

  it('renders a change-request item with Approve/Reject, the requester folded into the module line, and a day-count numeral', () => {
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
      screen.getByText('Markbook · teacher@hfse.test')
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('days old')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /reject/i })).toBeInTheDocument();
  });

  it('singularizes the day-count caption at exactly 1 day', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'cr-1',
        module: 'Markbook',
        text: 'Grade change — T1 English',
        href: '/markbook/change-requests?req=cr-1',
        kind: 'change-request',
        aging: { label: '1 day', tone: 'success' },
        requestId: 'cr-1',
      },
    ];
    renderWithClient(<TodoPanel title="To-do" items={items} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('day old')).toBeInTheDocument();
  });

  it('groups into "Needs a decision" vs "In good standing" only when both are present, and flags urgency in the header chip', () => {
    const items: HomeTodoItem[] = [
      {
        id: 'cr-urgent',
        module: 'Markbook',
        text: 'Grade change — T2 Mathematics',
        href: '/markbook/change-requests?req=cr-urgent',
        kind: 'change-request',
        aging: { label: '9 days', tone: 'destructive' },
        requestId: 'cr-urgent',
      },
      {
        id: 'admissions-doc-validation',
        module: 'Admissions',
        text: '3 documents awaiting validation',
        href: '/admissions/document-validation',
        kind: 'review',
      },
    ];
    renderWithClient(<TodoPanel title="To-do" items={items} />);
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText('In good standing')).toBeInTheDocument();
    expect(screen.getByText('1 needs attention')).toBeInTheDocument();
  });

  it('renders the empty state when there are no items', () => {
    render(<TodoPanel title="To-do" items={[]} />);
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs you right now')).toBeInTheDocument();
    expect(
      screen.getByText(
        'New approvals and reviews will show up here as they come in.'
      )
    ).toBeInTheDocument();
  });
});
