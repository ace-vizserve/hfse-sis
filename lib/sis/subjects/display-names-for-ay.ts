import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  subjectDisplayName,
  type SubjectNameSource,
} from '@/lib/sis/subjects/display-name';

/**
 * What every subject is CALLED in one academic year, keyed by subject id.
 *
 * ── why this exists ───────────────────────────────────────────────────────
 *
 * `subjectDisplayName` resolves ONE subject when the caller already holds its
 * config row. Most loaders do not: they read `subjects` on its own — a flat
 * catalogue list with no year in it — and build a `Map<subjectId, name>` that
 * every downstream label reads from. Migration 137 put the per-year name on
 * `subject_configs`, one table across, so those loaders need the join they
 * never had a reason to make.
 *
 * Rather than reshape each of them, this takes the subject rows they already
 * fetched and overlays this year's names in one extra read. The result is the
 * same shape they were building anyway, so the conversion at each call site is
 * one line and the map's meaning does not change — only its contents, and only
 * for a year that renamed something.
 *
 * ⚠ ONE EXTRA READ, AND IT IS SMALL. `subject_configs` holds one row per
 * (subject, academic year): 35 rows across every year in production as of
 * 2026-08-31, of which ~18 belong to any single year. Filtered by AY it is a
 * handful of rows and no join.
 *
 * ⚠ A SUBJECT WITH NO CONFIG FOR THE YEAR IS NORMAL, NOT AN ERROR. It means
 * the subject is not set up for that year, or simply was never renamed; either
 * way `subjectDisplayName` falls through to `name`, which is what those
 * loaders showed before this existed.
 *
 * ⚠ DISPLAY ONLY. Never key anything off the value returned here — a rename
 * changes it and `subjects.code` does not. Codes are the identity every static
 * list in the app depends on (MAPEH_FAMILY_CODES and its 20/60/20 split,
 * MOTHER_TONGUE_SUBJECT_CODES, the deployment importer's SUBJECT_MAP).
 */
export async function subjectDisplayNamesForAy<
  T extends SubjectNameSource & { id: string },
>(
  service: SupabaseClient,
  academicYearId: string,
  subjects: T[]
): Promise<Map<string, string>> {
  const byId = new Map<string, string>();
  if (subjects.length === 0) return byId;

  const { data } = await service
    .from('subject_configs')
    .select('subject_id, display_name')
    .eq('academic_year_id', academicYearId);

  const perYear = new Map<string, string | null>(
    ((data ?? []) as { subject_id: string; display_name: string | null }[]).map(
      (r) => [r.subject_id, r.display_name]
    )
  );

  for (const s of subjects) {
    byId.set(
      s.id,
      subjectDisplayName(s, { display_name: perYear.get(s.id) ?? null })
    );
  }
  return byId;
}
