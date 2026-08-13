'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useTransition } from 'react';

// `router.refresh()` you can await — it resolves when the server re-render has
// COMMITTED, not when the call returns.
//
// WHY THIS EXISTS. `router.refresh()` returns `void` immediately and the new
// data arrives some time later. Every write in this app calls it unawaited, so
// the moment a mutation's promise resolves we close the dialog, re-enable the
// button and tell the user "saved" — while the list behind them is still the
// old list. Nothing on screen says the work is unfinished, and on the heavier
// pages that gap is long: `app/(markbook)/markbook/grading/[id]/page.tsx:156`
// runs a service-role RPC write on every render before its six-way fetch.
// That gap is the whole reason writes feel unfinished.
//
// THE SIGNAL. A transition started with `startTransition` stays pending until
// the RSC payload is fetched and applied. This app already reads exactly that
// signal for navigations — `components/admissions/ay-switcher.tsx:24` and
// `components/evaluation/term-switcher.tsx:33` both drive a spinner from a
// transition wrapping `router.push`. This applies it to `refresh` and bridges
// the boolean into a promise.
//
// TWO GUARDS, because the pending toast this feeds has no timeout: if a waiter
// is never flushed, a toast stays on screen forever.
//
//   1. Unmount. Some surfaces unmount as part of their own success path. The
//      cleanup flushes every waiter rather than leaving them stranded.
//   2. Watchdog. A wedged or very slow re-render resolves anyway after
//      REFRESH_WATCHDOG_MS — and resolves SUCCESSFULLY, deliberately. The write
//      landed; only the re-render is late, and reporting a failed save because
//      a dashboard was slow would be a lie in the more alarming direction.

/** Ceiling on how long a caller waits for the re-render before giving up on it. */
export const REFRESH_WATCHDOG_MS = 10_000;

export function useRefreshTransition(
  watchdogMs: number = REFRESH_WATCHDOG_MS
): () => Promise<void> {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const waitersRef = useRef<Array<() => void>>([]);
  // Read inside a timeout, where hook state would be a stale closure. Synced in
  // an effect rather than during render — a render may be discarded, and
  // writing a ref from one is the side effect `react-hooks/refs` forbids.
  const isRefreshingRef = useRef(false);

  const flush = useCallback(() => {
    // Swap before running: a waiter that somehow queues another must not be
    // dropped, and must not be run twice.
    const waiting = waitersRef.current;
    waitersRef.current = [];
    for (const resolve of waiting) resolve();
  }, []);

  // Flush whenever the transition is idle. Reading "is idle" rather than the
  // pending→idle EDGE is deliberate: if a refresh somehow completes without
  // ever registering as pending, an edge would never fire and every caller
  // would sit until the watchdog. Idle with waiters queued means there is
  // nothing left to wait for, which is exactly when they should resolve.
  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
    if (!isRefreshing) flush();
  }, [isRefreshing, flush]);

  // Unmount: resolve anyone still waiting.
  useEffect(() => flush, [flush]);

  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(settle, watchdogMs);

        waitersRef.current.push(settle);
        startTransition(() => {
          router.refresh();
        });

        // If that transition never registered as pending there is no re-render
        // coming, so the effect below never runs and this caller would sit
        // until the watchdog. Checking on the next macrotask — after React has
        // had its chance to render — turns a ten-second hang into an immediate
        // resolve for the case where there was simply nothing to wait for.
        setTimeout(() => {
          if (!isRefreshingRef.current) settle();
        }, 0);
      }),
    [router, watchdogMs]
  );
}
