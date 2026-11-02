'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveState = 'saved' | 'saving' | 'error';

/**
 * Debounced autosave. Saves `value` `delayMs` after the last change, keeps one
 * request in flight, and the latest value always wins: an edit made while a
 * save is running is saved right after it finishes. The value the hook starts
 * with is never saved. A failed save leaves `state` at 'error'; the next edit
 * retries (an edit made during the failed save is retried after the delay).
 *
 * `flush()` saves the latest value now and resolves true once nothing is
 * pending or in flight, or false if that save failed.
 */
export function useAutosave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  delayMs = 800
): {
  state: AutosaveState;
  savedAt: Date | null;
  flush: () => Promise<boolean>;
} {
  const [state, setState] = useState<AutosaveState>('saved');
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const latest = useRef(value);
  const baseline = useRef(value); // last value known to be saved
  const saveRef = useRef(save);
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = useRef(delayMs);

  useEffect(() => {
    saveRef.current = save;
    delay.current = delayMs;
  });

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const start = useCallback((): Promise<boolean> => {
    if (running.current) return running.current;
    // Deferred one microtask so `running.current` is set BEFORE any of the work
    // (and its clean-up) runs; otherwise a no-op run could clear it first and the
    // assignment below would leave a finished promise stuck there.
    const p: Promise<boolean> = Promise.resolve().then(async () => {
      let ok = true;
      while (!Object.is(latest.current, baseline.current)) {
        const sending = latest.current;
        setState('saving');
        try {
          await saveRef.current(sending);
        } catch {
          setState('error');
          ok = false;
          break;
        }
        baseline.current = sending;
        setSavedAt(new Date());
        setState('saved');
      }
      if (running.current === p) running.current = null;
      if (!ok && !Object.is(latest.current, baseline.current)) {
        // An edit arrived while the save was failing: try it after the delay.
        clearTimer();
        timer.current = setTimeout(() => {
          timer.current = null;
          void start();
        }, delay.current);
      }
      return ok;
    });
    running.current = p;
    return p;
  }, []);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    // Each pass either returns or awaits a real save, so this cannot spin.
    for (;;) {
      if (running.current) await running.current;
      if (Object.is(latest.current, baseline.current)) return true;
      clearTimer();
      if (!(await start())) return false;
    }
  }, [start]);

  useEffect(() => {
    latest.current = value;
    if (Object.is(value, baseline.current)) {
      // Edited back to what is already saved: nothing left to send.
      clearTimer();
      return;
    }
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      void start();
    }, delayMs);
  }, [value, delayMs, start]);

  useEffect(
    () => () => {
      // Leaving the page inside the delay still saves the last edit.
      if (timer.current) {
        clearTimer();
        void start();
      }
    },
    [start]
  );

  return { state, savedAt, flush };
}
