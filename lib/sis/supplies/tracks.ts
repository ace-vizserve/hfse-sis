// A student's track (Global / Standard) for the books & supplies list.
//
// The track is the one the parent chose on the application, not the class's:
// most sections carry no `class_type`, so reading the class alone put every
// Primary child on the Standard books (Mr Ace, 2026-10-28, "do #2"). The
// application's `levelApplied` + `classType` labels name a row of that AY's
// `admission_options` (migration 174), and the row's `track` is the answer.
// Schedule is not looked at — the same level and class type is one track
// whichever session it runs in.
//
// Unresolved (no application, a blank or retired label, or rows that disagree
// on the track) → null, and the caller falls back to the class
// (`trackOfStudent` in lib/sis/supplies/student-list.ts). Unlike the section
// picker's hint (`deriveApplicationFit`), the label's words are never guessed
// from: a wrong guess here hands a child the other track's books.
//
// `trackOfApplication` is the pure half (tested); `resolveStudentTracks` reads
// the rows and hands them to it.

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SupplyClassType } from '@/lib/sis/supplies/types';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';

export type TrackOption = {
  level_label: string;
  class_type_label: string;
  track: SupplyClassType;
};

export type TrackApplication = {
  levelApplied: string | null;
  classType: string | null;
};

/**
 * The track an application's level and class type name in the year's
 * options: exact labels (trimmed), every schedule. No row, or rows that
 * disagree → null.
 */
export function trackOfApplication(
  app: TrackApplication,
  options: readonly TrackOption[]
): SupplyClassType | null {
  const level = (app.levelApplied ?? '').trim();
  const classType = (app.classType ?? '').trim();
  if (!level || !classType) return null;
  const tracks = new Set(
    options
      .filter(
        (o) =>
          o.level_label.trim() === level &&
          o.class_type_label.trim() === classType
      )
      .map((o) => o.track)
  );
  return tracks.size === 1 ? [...tracks][0] : null;
}

/**
 * studentNumber → the track their application(s) for the year resolve to.
 * A child with two applications in one year (a re-submitted form) takes the
 * track they agree on; if they name different tracks, null. Every number
 * asked about is in the map. Throws on a failed read.
 */
export async function resolveStudentTracks(
  service: SupabaseClient,
  ayCode: string,
  studentNumbers: readonly string[]
): Promise<Map<string, SupplyClassType | null>> {
  const numbers = [...new Set(studentNumbers.filter(Boolean))];
  const out = new Map<string, SupplyClassType | null>(
    numbers.map((n) => [n, null])
  );
  if (!numbers.length) return out;

  // RLS on with no policies (migration 174): the service client is the only
  // reader. The AY is matched by code through an inner join.
  const options = await fetchAllPages<TrackOption>((from, to) =>
    service
      .from('admission_options')
      .select(
        'level_label, class_type_label, track, academic_years!inner(ay_code)'
      )
      .eq('academic_years.ay_code', ayCode)
      .range(from, to)
  );
  // A year with no options (the years before migration 174) resolves no one,
  // so its applications — whose older tables may lack `classType` — are not
  // read at all.
  if (!options.length) return out;

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  type AppRow = TrackApplication & { studentNumber: string | null };
  const apps = await fetchInChunks(numbers, (slice) =>
    fetchAllPages<AppRow>((from, to) =>
      service
        .from(`${prefix}_enrolment_applications`)
        .select('studentNumber, levelApplied, classType')
        .in('studentNumber', slice)
        .range(from, to)
    )
  );

  const tracksOf = new Map<string, Set<SupplyClassType>>();
  for (const a of apps) {
    const number = a.studentNumber?.trim();
    const track = trackOfApplication(a, options);
    if (!number || !out.has(number) || !track) continue;
    let set = tracksOf.get(number);
    if (!set) tracksOf.set(number, (set = new Set()));
    set.add(track);
  }
  for (const [number, set] of tracksOf) {
    out.set(number, set.size === 1 ? [...set][0] : null);
  }
  return out;
}
