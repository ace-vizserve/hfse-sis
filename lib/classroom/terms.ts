// Classroom term axis — pure resolution logic, importable from both server
// pages (to fetch the right term's data) and the client sub-nav (to render
// the active term tab / build hrefs). No I/O here — see
// lib/classroom/queries.ts for the Supabase read.
//
// The actual date math is NOT reimplemented here — `resolveCurrentTermId`
// (lib/sis/current-term.ts) is the one canonical resolver in the codebase and
// this file is a thin, section-page-shaped wrapper around it, mirroring how
// app/(attendance)/attendance/[sectionId]/page.tsx honours `?term_id=`.

import { sgToday } from '@/lib/dates';
import { resolveCurrentTermId, type TermLike } from '@/lib/sis/current-term';

export type ClassroomTerm = {
  id: string;
  label: string;
  term_number: number;
  is_current: boolean;
  start_date: string | null;
  end_date: string | null;
};

/**
 * Resolve the selected term id for a classroom sub-route: honour `?term_id=`
 * when it names a real term in this AY, otherwise fall back to the canonical
 * current-term resolver. Pure — every caller (layout nav + all 5 pages) must
 * pass the same `terms` array and the same `termIdParam` to agree on the
 * same term; `today` is threaded in (rather than called internally) so tests
 * can pin a date without mocking the clock.
 */
export function resolveSelectedTermId(
  terms: TermLike[],
  termIdParam: string | undefined,
  today: string = sgToday()
): string | null {
  if (termIdParam && terms.some((t) => t.id === termIdParam)) {
    return termIdParam;
  }
  return resolveCurrentTermId(terms, today);
}
