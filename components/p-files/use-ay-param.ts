'use client';

import { useSearchParams } from 'next/navigation';

/**
 * Append the page's `?ay` to a P-Files API URL.
 *
 * ⚠ WHY THIS READS THE URL INSTEAD OF TAKING A PROP. The academic year is a
 * property of the PAGE, and five dialogs sit several parents deep inside it
 * (document card → action queue → page). Threading `ayCode` through all of
 * them gives five more places to forget it, and forgetting it is silent: the
 * route falls back to the current year and writes to the wrong year's tables.
 * Reading the same URL the page was rendered from cannot drift from it.
 *
 * ⚠ THE BUG THIS EXISTS FOR. The P-Files student page is multi-year — it reads
 * `?ay` and redirects to whichever AY the student is actually in — but every
 * one of its write routes resolved the CURRENT year instead. Opening an AY2027
 * student and uploading wrote to `ay2026_enrolment_documents`, matched no row,
 * and reported "this student has no document record for this academic year"
 * about a record visible on screen. `revisions` was worse: a read that
 * returned the wrong year's history with a 200.
 *
 * Returns the URL unchanged when there is no `?ay`, so a caller on a
 * current-year page behaves exactly as it did before.
 */
export function useAyParam(): (url: string) => string {
  const searchParams = useSearchParams();
  const ay = searchParams.get('ay');

  return (url: string) => {
    if (!ay) return url;
    return `${url}${url.includes('?') ? '&' : '?'}ay=${encodeURIComponent(ay)}`;
  };
}
