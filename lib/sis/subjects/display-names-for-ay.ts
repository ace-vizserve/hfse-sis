import type { SupabaseClient } from '@supabase/supabase-js';

import {
  subjectDisplayName,
  type SubjectNameSource,
} from '@/lib/sis/subjects/display-name';

/**
 * What every subject is CALLED in one academic year, keyed by subject id.
 *
 * ⚠ NO `import 'server-only'` HERE, DELIBERATELY, AND IT IS NOT AN OVERSIGHT.
 * `lib/markbook/drill.ts` is dual-use on purpose — client components import its
 * pure column helpers (`defaultColumnsForTarget`, `DRILL_COLUMN_LABELS`) while
 * server loaders import its cached readers — so it carries no `server-only`
 * marker itself. Adding one here put this module in the client bundle graph
 * through drill.ts and broke the build outright:
 *
 *   You're importing a module that depends on "server-only" ...
 *     ./lib/sis/subjects/display-names-for-ay.ts [Client Component Browser]
 *     ./lib/markbook/drill.ts [Client Component Browser]
 *
 * Losing the marker costs nothing real: this function creates no client and
 * holds no secret. It takes a `SupabaseClient` as a parameter, so whatever the
 * caller is scoped to is what it reads with, and its only other import is the
 * pure resolver. Do NOT "restore" the marker without first moving drill.ts's
 * presentation helpers out of it.
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
    // ⚠ SKIP A ROW WITH NO ID, rather than keying the map on `undefined`.
    // Every caller selects `id`, so this should not happen — but when it did
    // (a test fixture built before the select gained `id`), every subject
    // collapsed onto the same `undefined` key and the LAST one's name was
    // returned for all of them. A subject silently showing another subject's
    // name is the worst failure this module can have, so it is guarded rather
    // than assumed away.
    if (!s.id) continue;
    byId.set(
      s.id,
      subjectDisplayName(s, { display_name: perYear.get(s.id) ?? null })
    );
  }
  return byId;
}

/**
 * The same question when the rows SPAN academic years.
 *
 * `subjectDisplayNamesForAy` above assumes one year. Three surfaces cannot:
 * a teacher's own account page, the "you're covering" panel, and the
 * assignment audit context all read rows whose year comes from each row's own
 * section, not from a parameter. Each had hand-rolled the same
 * `${ayId}|${subjectId}` map, which is three copies of one rule and the way
 * rules start to disagree.
 *
 * Returns a resolver rather than a Map because the caller has to supply the
 * year per row, and a two-part key is easy to build wrong at the call site.
 *
 * ⚠ Same rules as its sibling: display only, never key anything off the
 * result, and a subject with no config for that year is normal — it falls back
 * to the catalogue name.
 */
export async function subjectDisplayNameResolver(
  client: SupabaseClient,
  ayIds: (string | null | undefined)[],
  subjectIds: (string | null | undefined)[]
): Promise<
  (
    ayId: string | null | undefined,
    subject: SubjectNameSource & { id: string }
  ) => string
> {
  const ays = [...new Set(ayIds.filter(Boolean))] as string[];
  const subjects = [...new Set(subjectIds.filter(Boolean))] as string[];
  const perYear = new Map<string, string>();

  if (ays.length > 0 && subjects.length > 0) {
    const { data } = await client
      .from('subject_configs')
      .select('academic_year_id, subject_id, display_name')
      .in('academic_year_id', ays)
      .in('subject_id', subjects);
    for (const row of (data ?? []) as {
      academic_year_id: string;
      subject_id: string;
      display_name: string | null;
    }[]) {
      if (row.display_name) {
        perYear.set(
          `${row.academic_year_id}|${row.subject_id}`,
          row.display_name
        );
      }
    }
  }

  return (ayId, subject) =>
    (ayId ? perYear.get(`${ayId}|${subject.id}`) : undefined) ??
    subjectDisplayName(subject);
}
