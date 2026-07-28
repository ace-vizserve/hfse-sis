import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDebouncedRefresh } from '@/components/attendance/use-debounced-refresh';

// The Term sheet's stat cards (average attendance, perfect attendance) are
// RSC-computed from the rollup each cell write recomputes server-side, so the
// grid has to ask the server for them. Marking is high-frequency — a refresh
// per cell would re-run the whole page render on every keystroke — so the
// calls coalesce into one refresh once marking goes idle.

describe('useDebouncedRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not refresh immediately', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useDebouncedRefresh(refresh, 1500));

    act(() => result.current());

    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once the delay elapses', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useDebouncedRefresh(refresh, 1500));

    act(() => result.current());
    act(() => void vi.advanceTimersByTime(1500));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of marks into a single refresh', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useDebouncedRefresh(refresh, 1500));

    // Twenty cells marked in quick succession — each resets the timer.
    for (let i = 0; i < 20; i += 1) {
      act(() => result.current());
      act(() => void vi.advanceTimersByTime(200));
    }
    expect(refresh).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1500));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes again for a later, separate burst', () => {
    const refresh = vi.fn();
    const { result } = renderHook(() => useDebouncedRefresh(refresh, 1500));

    act(() => result.current());
    act(() => void vi.advanceTimersByTime(1500));
    act(() => result.current());
    act(() => void vi.advanceTimersByTime(1500));

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending refresh on unmount', () => {
    const refresh = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedRefresh(refresh, 1500)
    );

    act(() => result.current());
    unmount();
    act(() => void vi.advanceTimersByTime(5000));

    expect(refresh).not.toHaveBeenCalled();
  });
});
