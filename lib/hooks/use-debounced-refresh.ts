'use client';

import { useCallback, useEffect, useRef } from 'react';

// Coalescing trigger for a server refresh from a high-frequency autosave
// surface.
//
// Two surfaces have the same shape. The attendance Term sheet's stat cards
// (average attendance, perfect attendance) are computed on the server from
// `attendance_records`; the grading sheet's "Graded n/N" card is computed on
// the server from `grade_entries`. Both are correct the instant a write lands,
// but both are rendered by the page's server component, so the browser has to
// ask for them again.
//
// It lives in lib/hooks/ rather than beside either grid because it belongs to
// neither module — it moved out of components/attendance/ on 2026-07-31 when
// the grading grid became its second consumer.
//
// Asking per cell is the wrong trade: marking is bursty (a teacher fills a
// column at a time) and each refresh re-runs the page's whole server render.
// So callers signal "something changed" per write and this coalesces the burst
// into one refresh once entry goes idle. The low-frequency surfaces here
// (roster metadata, the Daily view's batched submit) still refresh directly —
// they fire once per user action, so there is nothing to coalesce.

export const STATS_REFRESH_DELAY_MS = 1500;

export function useDebouncedRefresh(
  refresh: () => void,
  delayMs: number = STATS_REFRESH_DELAY_MS
): () => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so a re-created `refresh` (router.refresh is stable, but a
  // caller could pass an inline closure) never restarts a pending timer.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Cancel on unmount — switching section or term remounts the grid, and a
  // refresh fired afterwards would be work for a page nobody is looking at.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      refreshRef.current();
    }, delayMs);
  }, [delayMs]);
}
