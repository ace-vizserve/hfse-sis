'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/** A page param to set (a string) or remove (`null` / `undefined` / `''`). */
export type PageParamChanges = Record<string, string | null | undefined>;

/**
 * The query string after `changes`, with every other param kept as it was.
 * Returns `null` when nothing would change, so a caller can skip the
 * navigation.
 */
export function queryWithChanges(
  search: string,
  changes: PageParamChanges
): string | null {
  const before = new URLSearchParams(search);
  const next = new URLSearchParams(search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '') next.delete(k);
    else next.set(k, v);
  }
  if (next.toString() === before.toString()) return null;
  return next.toString();
}

/**
 * Write page-level URL params — the ones a page reads itself and hands a
 * table as a starting filter (`?student=`, `?date=`, `?sheet_id=`, `?req=`).
 *
 * A filter seeded from such a param must take it out of the URL (or change
 * it) when the reader changes the filter; otherwise the param stays behind
 * and a refresh, Back or the next server render puts the old filter back.
 * Uses `router.replace` (no history entry, no scroll jump) and reads the
 * address as it stands right now, so params another control just wrote are
 * kept.
 */
export function usePageParams() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (changes: PageParamChanges) => {
      const search =
        typeof window === 'undefined' ? '' : window.location.search;
      const next = queryWithChanges(search, changes);
      if (next === null) return;
      router.replace(next ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname]
  );
}
