import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithClient } from '../_utils/render-with-client';
import { TodoCrActions } from '@/components/home/todo-cr-actions.client';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

describe('TodoCrActions', () => {
  beforeEach(() => {
    refreshMock.mockClear();
    toastSuccess.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'approved' }),
    })) as unknown as typeof fetch;
  });

  it('Approve fires the PATCH immediately with no dialog', async () => {
    renderWithClient(<TodoCrActions requestId="cr-1" />);
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/change-requests/cr-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('Reject is a link into the real change-request page, not an inline action', () => {
    renderWithClient(<TodoCrActions requestId="cr-1" />);
    const reject = screen.getByRole('link', { name: /reject/i });
    expect(reject).toHaveAttribute(
      'href',
      '/markbook/change-requests?req=cr-1&action=reject'
    );
  });
});
