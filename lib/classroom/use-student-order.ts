'use client';

// Client-only persistence for the student-order preference (see
// lib/classroom/student-order.ts for the pure sort/parse logic this wraps).
// Mirrors the shape of lib/sidebar/use-change-request-count.ts — a small
// 'use client' hook module living in lib/<module>/, not under components/.
//
// SSR-safe by construction: the initial render (both server and the client's
// first paint, before hydration effects run) always returns
// DEFAULT_STUDENT_ORDER, so there is nothing for React to complain about a
// mismatch on. The real stored value (if any) is read inside a `useEffect`,
// which only runs after mount, then setState updates the sort a frame later
// — a one-frame flash to the default order on first load, never a hydration
// warning.

import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_STUDENT_ORDER,
  parseStudentOrder,
  studentOrderStorageKey,
  type StudentOrder,
} from '@/lib/classroom/student-order';

export function useStudentOrder(
  sectionId: string
): [StudentOrder, (next: StudentOrder) => void] {
  const [order, setOrderState] = useState<StudentOrder>(DEFAULT_STUDENT_ORDER);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        studentOrderStorageKey(sectionId)
      );
      setOrderState(parseStudentOrder(stored));
    } catch {
      // Private-browsing / storage-disabled — silently keep the default.
    }
  }, [sectionId]);

  const setOrder = useCallback(
    (next: StudentOrder) => {
      setOrderState(next);
      try {
        window.localStorage.setItem(studentOrderStorageKey(sectionId), next);
      } catch {
        // Storage unavailable — the in-memory state above still updates the
        // UI for this session, it just won't survive a reload.
      }
    },
    [sectionId]
  );

  return [order, setOrder];
}
