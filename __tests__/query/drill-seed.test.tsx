/**
 * Regression test for the drill-seed bug (2026-06-15).
 *
 * Drill sheets are seeded from a server-prefetched row array for instant paint,
 * then the per-(target,segment) narrowing happens in the drill API route
 * (KD #82). The seed is therefore a NON-AUTHORITATIVE placeholder for most
 * drills (admissions/p-files/records/lifecycle/evaluation/attendance pass a
 * broad/kind-level seed, not a (target,segment)-narrowed one).
 *
 * Bug: using `initialData` + `initialDataUpdatedAt: Date.now()` marks the broad
 * seed as fresh, so the narrowing fetch is SKIPPED and every drill shows the
 * same full unfiltered set. Fix: use `placeholderData` — paint the seed
 * instantly but ALWAYS fetch the authoritative narrowed rows and replace.
 */
import { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/lib/query/fetcher';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The bug only manifests with the production staleTime (60s) — that's what
// makes a `Date.now()`-stamped seed count as "fresh" and skip the fetch. With
// the default test staleTime of 0 the seed is immediately stale and refetches,
// masking the bug. So this suite uses a production-faithful client.
function prodLikeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
}

const BROAD_SEED = ['broad-a', 'broad-b', 'broad-c'];

function DrillHarness({ mode }: { mode: 'initialData' | 'placeholderData' }) {
  const q = useQuery({
    queryKey: ['drill-seed', mode],
    queryFn: () => apiFetch<string[]>('/api/drill/target'),
    ...(mode === 'initialData'
      ? { initialData: BROAD_SEED, initialDataUpdatedAt: Date.now() }
      : { placeholderData: BROAD_SEED }),
  });
  return (
    <ul>
      {(q.data ?? []).map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  );
}

describe('drill seed handling', () => {
  it('FOOTGUN: initialData + initialDataUpdatedAt skips the fetch under production staleTime (shows the broad seed forever)', async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse(['narrow-1'])));
    renderWithClient(<DrillHarness mode="initialData" />, prodLikeClient());

    // Seed is fresh within staleTime → no fetch → narrowed row never appears.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText('broad-a')).toBeInTheDocument();
    expect(screen.queryByText('narrow-1')).not.toBeInTheDocument();
  });

  it('FIX: placeholderData paints the seed but still fetches and replaces with narrowed rows (even at production staleTime)', async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse(['narrow-1'])));
    renderWithClient(<DrillHarness mode="placeholderData" />, prodLikeClient());

    // Instant paint of the placeholder…
    expect(screen.getByText('broad-a')).toBeInTheDocument();
    // …then the authoritative narrowed row replaces it.
    expect(await screen.findByText('narrow-1')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('broad-a')).not.toBeInTheDocument()
    );
  });
});
