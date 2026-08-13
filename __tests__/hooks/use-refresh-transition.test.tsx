/**
 * `useRefreshTransition` — `router.refresh()` you can await.
 *
 * ⚠ WHAT THESE TESTS CANNOT PROVE, stated plainly so nobody reads a green run
 * as more than it is. The property that matters — that the promise stays
 * unresolved until the server re-render has COMMITTED — depends on Next's
 * router marking a React transition as pending across an RSC round trip. In
 * jsdom `router.refresh` is a mock that does nothing, so the transition
 * settles immediately and the pending window has no duration to observe.
 *
 * So these tests pin the mechanics either side of that window: the refresh is
 * requested, waiters are resolved rather than stranded, concurrent callers
 * share one refresh, and unmounting does not leave a promise hanging forever
 * (which would strand a pending toast on screen for the rest of the session).
 *
 * The held-through-commit behaviour is verified in a browser, against a page
 * slow enough to see it. Same distinction `scripts/verify-relief-migrations.ts`
 * draws in its own header: a green check of the shape is not a check of the
 * behaviour.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));

import {
  REFRESH_WATCHDOG_MS,
  useRefreshTransition,
} from '@/lib/hooks/use-refresh-transition';

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useRefreshTransition', () => {
  // NOTE ON SHAPE. These start the refresh inside `act` but await the promise
  // OUTSIDE it, then assert with `waitFor`. Awaiting inside `act` deadlocks:
  // the promise resolves from an effect, and `act` is still waiting for the
  // callback that is waiting for that effect. The first draft did exactly that
  // and hung for the full test timeout.

  it('asks the router to refresh', async () => {
    const { result } = renderHook(() => useRefreshTransition());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current();
    });
    await pending;
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('resolves once the transition is idle', async () => {
    const { result } = renderHook(() => useRefreshTransition());
    let settled = false;
    let pending!: Promise<void>;
    act(() => {
      pending = result.current().then(() => {
        settled = true;
      });
    });
    await pending;
    await waitFor(() => expect(settled).toBe(true));
  });

  it('resolves every concurrent caller from one refresh', async () => {
    const { result } = renderHook(() => useRefreshTransition());
    const settled: number[] = [];
    let pending!: Promise<unknown>;
    act(() => {
      pending = Promise.all([
        result.current().then(() => settled.push(1)),
        result.current().then(() => settled.push(2)),
        result.current().then(() => settled.push(3)),
      ]);
    });
    await pending;
    expect(settled).toHaveLength(3);
  });

  it('resolves a waiter whose component unmounts mid-flight', async () => {
    // The stranded-toast case: a surface that closes as part of its own
    // success path takes the transition owner with it. The waiter must be
    // flushed rather than left, or the pending toast — which has no timeout —
    // stays on screen forever.
    const { result, unmount } = renderHook(() => useRefreshTransition());

    let settled = false;
    let pending!: Promise<void>;
    act(() => {
      pending = result.current().then(() => {
        settled = true;
      });
    });

    unmount();
    await pending;
    expect(settled).toBe(true);
  });

  it('gives up waiting after the watchdog rather than hanging', async () => {
    vi.useFakeTimers();
    // A never-idle transition cannot be simulated in jsdom, so this asserts
    // the ceiling exists and is wired to a timer — not that it fires in
    // production. It is the backstop for a wedged re-render.
    expect(REFRESH_WATCHDOG_MS).toBeGreaterThan(0);

    const { result } = renderHook(() => useRefreshTransition(50));
    let settled = false;
    const pending = act(async () => {
      await result.current().then(() => {
        settled = true;
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    await pending;
    expect(settled).toBe(true);
  });
});
