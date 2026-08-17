'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useRefreshTransition } from '@/lib/hooks/use-refresh-transition';

// One lifecycle for every write: pending toast → do the work → let the surface
// react → wait for the screen to actually change → say what happened.
//
// WHAT IT FIXES. Writes were reporting success at the wrong moment. A mutation
// resolves, we toast "Saved", close the dialog and re-enable the button — and
// the list underneath is still the old list, because `router.refresh()` was
// fired and not awaited. The user is told the work is done while it visibly
// is not. Holding the indicator across the re-render closes that gap, which is
// the difference between "slow" and "broken-feeling".
//
// IT WRAPS THE PROMISE, NOT `useMutation`. Deliberate. Replacing `useMutation`
// would mean absorbing every branch its call sites already rely on —
// `onMutate` optimistic snapshots
// (components/admissions/document-validation/validation-queue.tsx:160-169),
// error handlers that open a dialog instead of toasting
// (components/grading/lock-toggle.tsx:77-95) — and the API would either bloat
// to fit them or quietly exclude them. Wrapping is additive: mutations keep
// their `retry: 0`, their `ApiError` typing and their branches, and only the
// toast and refresh lines move.
//
// IT USES `toast.loading` + `toast.dismiss`, NOT `toast.promise`. `toast.promise`
// gives no toast id back (sileo exposes no update-in-place API), and the id is
// what makes three things possible: suppressing the pending toast for a write
// that finishes quickly, dismissing it when the surface answers an error with a
// dialog instead, and cleaning it up on unmount. Without the id a pending toast
// has no owner, and this one has no timeout.

/**
 * How long a write may take before it earns a pending toast. Under this, the
 * work is done before a spinner would have registered and only the success
 * toast shows — no flash. This is `docs/context/09-design-system.md:230`'s
 * 300ms rule applied to the toast channel.
 */
export const PENDING_DELAY_MS = 250;

export type WriteActionOptions<T> = {
  /**
   * Shown while the write is in flight, if it takes longer than
   * PENDING_DELAY_MS.
   *
   * `false` means this surface shows the change itself and a toast would be
   * noise — an optimistic list that has already removed the row, or an inline
   * "Saved" affordance. It is not optional, so every call states a decision,
   * and `pending: false` is greppable.
   */
  pending: string | false;

  /**
   * What to say when it worked. Receives the parsed response body.
   *
   * Return `null` when the surface has already said it — the mirror of
   * `error`'s null. Added for the one case that needed it: an upload can
   * succeed and still come back with `body.warning`, which must be reported as
   * a WARNING and not recoloured as a success
   * (`components/p-files/upload-dialog.tsx`). Without this the choice was a
   * green toast carrying warning text, or two toasts for one action.
   */
  success: string | ((data: T) => string | null);

  /**
   * What to say when it failed. Receives the thrown error — usually an
   * `ApiError` carrying `.status` and the PARSED `.body`, so route-specific
   * codes can drive the wording. KD #24 forbids flattening those into a
   * generic message, which is why this takes the error rather than a string.
   *
   * Return `null` when the surface answers the error itself (a dialog
   * explaining a 409, say). The pending toast is dismissed and no error toast
   * appears — one signal per action, never a toast and a dialog saying the
   * same thing.
   *
   * Omit it to use the message `apiFetch` already resolved from the body.
   */
  error?: string | ((err: unknown) => string | null);

  /**
   * Runs after the write resolves and BEFORE the refresh is awaited. Close the
   * dialog here, reset the form here. The split is the point: the surface
   * reacts immediately while the toast keeps holding until the data on screen
   * is really new.
   */
  onResolved?: (data: T) => void;

  /**
   * Whether to wait for a server re-render. Defaults to true. Pass a predicate
   * when only the response can say — `assign-section-dialog.tsx:114-117` swaps
   * the dialog body instead of closing on one branch, and that branch does its
   * own refresh later.
   */
  refresh?: boolean | ((data: T) => boolean);
};

export type WriteAction = <T>(
  work: () => Promise<T>,
  opts: WriteActionOptions<T>
) => Promise<T | undefined>;

/**
 * `apiFetch` already resolves `body.error` / `body.message` into `Error.message`
 * (lib/query/fetcher.ts:31-38), so the server's own wording survives without
 * the call site doing anything.
 */
function defaultErrorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'Something went wrong.';
}

/**
 * Returns `run`, which NEVER REJECTS: it resolves the parsed body, or
 * `undefined` if the write failed.
 *
 * That removes the `.catch(() => {})` incantation from call sites, and means an
 * unawaited call cannot raise an unhandled rejection (which fails tests rather
 * than merely warning). `undefined` is a safe sentinel — `apiFetch` returns
 * parsed JSON or text, never `undefined` (lib/query/fetcher.ts:48-60).
 */
export function useWriteAction(): WriteAction {
  const awaitRefresh = useRefreshTransition();
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastsRef = useRef(new Set<string>());

  // A pending toast has no timeout, so anything still open when this surface
  // goes away would stay on screen for the rest of the session.
  useEffect(() => {
    const timers = timersRef.current;
    const toasts = toastsRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const id of toasts) toast.dismiss(id);
      timers.clear();
      toasts.clear();
    };
  }, []);

  return useCallback(
    async <T>(
      work: () => Promise<T>,
      opts: WriteActionOptions<T>
    ): Promise<T | undefined> => {
      let toastId: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (opts.pending !== false) {
        const label = opts.pending;
        timer = setTimeout(() => {
          if (timer) timersRef.current.delete(timer);
          timer = null;
          toastId = toast.loading(label);
          toastsRef.current.add(toastId);
        }, PENDING_DELAY_MS);
        timersRef.current.add(timer);
      }

      const clearPending = () => {
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(timer);
          timer = null;
        }
        if (toastId) {
          toast.dismiss(toastId);
          toastsRef.current.delete(toastId);
          toastId = null;
        }
      };

      try {
        const data = await work();

        // The surface reacts now; the toast keeps holding.
        opts.onResolved?.(data);

        const wantsRefresh =
          typeof opts.refresh === 'function'
            ? opts.refresh(data)
            : (opts.refresh ?? true);
        if (wantsRefresh) await awaitRefresh();

        clearPending();
        const message =
          typeof opts.success === 'function'
            ? opts.success(data)
            : opts.success;
        // `null` — the surface reported the outcome itself, in a tone this
        // helper cannot pick (a warning on an otherwise-successful write).
        if (message !== null) toast.success(message);
        return data;
      } catch (err) {
        clearPending();
        const message =
          typeof opts.error === 'function'
            ? opts.error(err)
            : (opts.error ?? defaultErrorMessage(err));
        // `null` — the surface is showing its own explanation.
        if (message !== null) toast.error(message);
        return undefined;
      }
    },
    [awaitRefresh]
  );
}
