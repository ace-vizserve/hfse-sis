/**
 * Canonical READ pattern (useQuery + apiFetch + error→retry), proven with a
 * minimal harness so it's deterministic and not coupled to any one screen's
 * props. This is the exact shape the migrated lazy-read components use
 * (markbook-drill-sheet, cross-ay-search, p-files history, …): loading →
 * data, error → "Try again" → refetch, and the abort signal forwarded.
 */
import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/query/fetcher';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ReadHarness() {
  const q = useQuery({
    queryKey: ['read-pattern'],
    queryFn: ({ signal }) => apiFetch<{ value: string }>('/api/x', { signal }),
  });

  if (q.isLoading) return <div>Loading…</div>;
  if (q.isError) {
    return (
      <div>
        <p>error: {q.error instanceof Error ? q.error.message : 'unknown'}</p>
        <button onClick={() => void q.refetch()}>Try again</button>
      </div>
    );
  }
  return <div>data: {q.data?.value}</div>;
}

describe('read pattern', () => {
  it('shows loading, then renders fetched data', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ value: 'ok' })));
    renderWithClient(<ReadHarness />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('data: ok')).toBeInTheDocument();
  });

  it('forwards the abort signal from the queryFn', async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse({ value: 'ok' })));
    renderWithClient(<ReadHarness />);
    await screen.findByText('data: ok');
    expect(spy).toHaveBeenCalledWith(
      '/api/x',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('shows an error state with a working retry', async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? jsonResponse({ error: 'boom' }, 500)
          : jsonResponse({ value: 'recovered' })
      );
    });
    renderWithClient(<ReadHarness />);

    expect(await screen.findByText('error: boom')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('data: recovered')).toBeInTheDocument();
  });
});
