import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApproverReadinessCards } from '@/components/sis/approvers-data-table';

describe('ApproverReadinessCards', () => {
  it('renders one card per flow with the real approver count', () => {
    render(
      <ApproverReadinessCards
        byFlow={{
          'markbook.change_request': [
            { user_id: 'u1' },
            { user_id: 'u2' },
            { user_id: 'u3' },
          ] as never,
        }}
      />
    );
    expect(screen.getByText('Ready — 3 approvers')).toBeInTheDocument();
  });

  it('shows the destructive warning card when a flow has only 1 approver', () => {
    render(
      <ApproverReadinessCards
        byFlow={{ 'markbook.change_request': [{ user_id: 'u1' }] as never }}
      />
    );
    expect(screen.getByText('Only 1 approver')).toBeInTheDocument();
    expect(screen.getByText(/two different approvers/)).toBeInTheDocument();
  });
});
