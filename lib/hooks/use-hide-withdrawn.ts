'use client';

// "Hide withdrawn" on the grading sheet and the attendance register, kept in
// localStorage so the choice survives a reload and applies to every sheet of
// that kind on this browser. One key per surface, so hiding withdrawn
// students on the grading sheet does not change the attendance register.
//
// SSR-safe the same way as lib/classroom/use-student-order.ts: the first
// render always shows withdrawn students, and the stored choice is read after
// mount — a one-frame flash, never a hydration mismatch.

import { useCallback, useEffect, useState } from 'react';

export type HideWithdrawnSurface = 'grading' | 'attendance';

function storageKey(surface: HideWithdrawnSurface): string {
  return `hfse:hide-withdrawn:${surface}`;
}

export function useHideWithdrawn(
  surface: HideWithdrawnSurface
): [boolean, (next: boolean) => void] {
  const [hide, setHideState] = useState(false);

  useEffect(() => {
    try {
      setHideState(window.localStorage.getItem(storageKey(surface)) === '1');
    } catch {
      // Private browsing / storage disabled — keep showing everyone.
    }
  }, [surface]);

  const setHide = useCallback(
    (next: boolean) => {
      setHideState(next);
      try {
        if (next) window.localStorage.setItem(storageKey(surface), '1');
        else window.localStorage.removeItem(storageKey(surface));
      } catch {
        // Storage unavailable — the choice still applies until reload.
      }
    },
    [surface]
  );

  return [hide, setHide];
}
