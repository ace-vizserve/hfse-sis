/**
 * `useWriteAction` — the single lifecycle every write goes through.
 *
 * The assertion that matters is ORDERING: the success toast must not appear
 * until the server re-render has landed. Before this hook existed, a write
 * toasted "Saved", closed its dialog and re-enabled its button the moment the
 * POST resolved, while `router.refresh()` was still in flight — so the list
 * underneath was still the old list. Every other test here guards a detail;
 * this one guards the reason the hook was written.
 *
 * `useRefreshTransition` is mocked with a promise this file controls. That is
 * deliberate: React's transition timing is not observable in jsdom (see
 * use-refresh-transition.test.tsx), and what is under test here is what
 * `useWriteAction` does with the signal, not how the signal is produced.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refreshMock, toastSpies } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSpies: {
    success: vi.fn(),
    error: vi.fn(),
    // A surface may answer a SUCCESSFUL write with a warning instead — an
    // upload that landed but merged the files. The helper stays out of the way
    // when the success resolver returns null.
    warning: vi.fn(),
    loading: vi.fn(() => 'toast-1'),
    dismiss: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-refresh-transition', () => ({
  useRefreshTransition: () => refreshMock,
}));

vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    ...toastSpies,
  },
}));

import { PENDING_DELAY_MS, useWriteAction } from '@/lib/hooks/use-write-action';

/** A promise plus the handles to settle it later. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useWriteAction', () => {
  it('does not flash a pending toast for a write that finishes quickly', async () => {
    const { result } = renderHook(() => useWriteAction());

    await act(async () => {
      await result.current(async () => ({ ok: true }), {
        pending: 'Saving…',
        success: 'Saved',
      });
    });

    expect(toastSpies.loading).not.toHaveBeenCalled();
    expect(toastSpies.success).toHaveBeenCalledWith('Saved');
  });

  it('shows the pending toast once the write outlasts the delay, then dismisses it', async () => {
    const work = deferred<{ ok: boolean }>();
    const { result } = renderHook(() => useWriteAction());

    let done!: Promise<unknown>;
    act(() => {
      done = result.current(() => work.promise, {
        pending: 'Assigning class…',
        success: 'Assigned',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS + 1);
    });
    expect(toastSpies.loading).toHaveBeenCalledWith('Assigning class…');
    expect(toastSpies.success).not.toHaveBeenCalled();

    await act(async () => {
      work.resolve({ ok: true });
      await done;
    });
    expect(toastSpies.dismiss).toHaveBeenCalledWith('toast-1');
    expect(toastSpies.success).toHaveBeenCalledWith('Assigned');
  });

  it('holds the success toast until the refresh resolves — the whole point', async () => {
    const refresh = deferred<void>();
    refreshMock.mockReturnValueOnce(refresh.promise);
    const { result } = renderHook(() => useWriteAction());

    let done!: Promise<unknown>;
    act(() => {
      done = result.current(async () => ({ ok: true }), {
        pending: 'Saving…',
        success: 'Saved',
      });
    });

    // The write has resolved; the re-render has not.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS + 1);
    });
    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(toastSpies.dismiss).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve();
      await done;
    });
    expect(toastSpies.success).toHaveBeenCalledWith('Saved');
  });

  it('runs onResolved before the refresh, so the dialog closes immediately', async () => {
    const refresh = deferred<void>();
    refreshMock.mockReturnValueOnce(refresh.promise);
    const onResolved = vi.fn();
    const { result } = renderHook(() => useWriteAction());

    let done!: Promise<unknown>;
    act(() => {
      done = result.current(async () => ({ ok: true }), {
        pending: 'Saving…',
        success: 'Saved',
        onResolved,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(toastSpies.success).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve();
      await done;
    });
  });

  it('passes the parsed body to the success and refresh resolvers', async () => {
    const { result } = renderHook(() => useWriteAction());

    await act(async () => {
      await result.current(async () => ({ sectionName: 'Respect' }), {
        pending: 'Assigning…',
        success: (body) => `Assigned to ${body.sectionName}`,
        refresh: (body) => body.sectionName !== 'Respect',
      });
    });

    expect(toastSpies.success).toHaveBeenCalledWith('Assigned to Respect');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('shows no success toast when the surface reports the outcome itself', async () => {
    // The mirror of the error resolver's `null`. A write can succeed and still
    // need a WARNING rather than a success — an upload that landed but merged
    // the files, say (components/p-files/upload-dialog.tsx). Without this the
    // only options were a green toast carrying warning text, or two toasts for
    // one action.
    const { result } = renderHook(() => useWriteAction());

    await act(async () => {
      await result.current(async () => ({ warning: 'Merged 3 PDFs' }), {
        pending: 'Uploading…',
        success: (body) => {
          if (body.warning) {
            toastSpies.warning(body.warning);
            return null;
          }
          return 'Uploaded';
        },
      });
    });

    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(toastSpies.warning).toHaveBeenCalledWith('Merged 3 PDFs');
    // Still a success in every other respect — the refresh happened.
    expect(refreshMock).toHaveBeenCalled();
  });

  it('skips the refresh when told to', async () => {
    const { result } = renderHook(() => useWriteAction());
    await act(async () => {
      await result.current(async () => ({ ok: true }), {
        pending: 'Saving…',
        success: 'Saved',
        refresh: false,
      });
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('never shows a pending toast when pending is false', async () => {
    const work = deferred<{ ok: boolean }>();
    const { result } = renderHook(() => useWriteAction());

    let done!: Promise<unknown>;
    act(() => {
      done = result.current(() => work.promise, {
        pending: false,
        success: 'Removed',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS * 4);
    });
    expect(toastSpies.loading).not.toHaveBeenCalled();

    await act(async () => {
      work.resolve({ ok: true });
      await done;
    });
    expect(toastSpies.success).toHaveBeenCalledWith('Removed');
  });

  describe('failure', () => {
    it('resolves undefined instead of rejecting, and uses the server message', async () => {
      const { result } = renderHook(() => useWriteAction());

      let returned: unknown = 'untouched';
      await act(async () => {
        returned = await result.current(
          async () => {
            throw new Error('Section is full');
          },
          { pending: 'Assigning…', success: 'Assigned' }
        );
      });

      expect(returned).toBeUndefined();
      expect(toastSpies.error).toHaveBeenCalledWith('Section is full');
      expect(toastSpies.success).not.toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('shows no error toast when the surface answers with its own dialog', async () => {
      const { result } = renderHook(() => useWriteAction());
      const openDialog = vi.fn();

      await act(async () => {
        await result.current(
          async () => {
            throw new Error('grading_lock_date_passed');
          },
          {
            pending: 'Locking…',
            success: 'Locked',
            error: () => {
              openDialog();
              return null;
            },
          }
        );
      });

      expect(openDialog).toHaveBeenCalledTimes(1);
      expect(toastSpies.error).not.toHaveBeenCalled();
    });

    it('dismisses a pending toast that was already showing', async () => {
      const work = deferred<unknown>();
      const { result } = renderHook(() => useWriteAction());

      let done!: Promise<unknown>;
      act(() => {
        done = result.current(() => work.promise, {
          pending: 'Saving…',
          success: 'Saved',
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PENDING_DELAY_MS + 1);
      });
      expect(toastSpies.loading).toHaveBeenCalled();

      await act(async () => {
        work.reject(new Error('nope'));
        await done;
      });
      expect(toastSpies.dismiss).toHaveBeenCalledWith('toast-1');
      expect(toastSpies.error).toHaveBeenCalledWith('nope');
    });
  });
});
