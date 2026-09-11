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

  it('on a step-by-step request, Approve decides the step on the approval engine', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: true,
        message: 'Approved. It moves on to the next step.',
      }),
    })) as unknown as typeof fetch;

    renderWithClient(
      <TodoCrActions requestId="cr-1" approvalRequestId="appr-1" />
    );
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/approvals/appr-1/decide',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      })
    );
    // The engine's own sentence is what the approver reads.
    expect(toastSuccess.mock.calls[0][0]).toBe(
      'Approved. It moves on to the next step.'
    );
  });

  // Migration 145. On a step that needs everyone, an approval can be saved
  // while the step waits for the others — a success, told in its own words.
  it('treats an approval recorded on a step that needs everyone as a success', async () => {
    toastError.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: true,
        outcome: 'recorded',
        message: 'Approved. This step is still waiting on the others.',
      }),
    })) as unknown as typeof fetch;

    renderWithClient(
      <TodoCrActions requestId="cr-1" approvalRequestId="appr-1" />
    );
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toBe(
      'Approved. This step is still waiting on the others.'
    );
    expect(toastError).not.toHaveBeenCalled();
    // The list is re-read, so the row it came from goes away.
    expect(refreshMock).toHaveBeenCalled();
  });

  it('on a step-by-step request, Reject still deep-links by the grade change id', () => {
    renderWithClient(
      <TodoCrActions requestId="cr-1" approvalRequestId="appr-1" />
    );
    expect(screen.getByRole('link', { name: /reject/i })).toHaveAttribute(
      'href',
      '/markbook/change-requests?req=cr-1&action=reject'
    );
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
