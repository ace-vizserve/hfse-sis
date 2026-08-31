/**
 * What a subject is CALLED, in one place.
 *
 * The school renamed MAPEH to STAR ("Sports, Talent, Arts and Rhythm") for
 * AY2026 while AY2025 keeps the old name, so a subject's name is a property of
 * the (subject, academic year) pair rather than of the subject. Migration 137
 * put the override on `subject_configs`, which is already the per-AY row.
 *
 * ⚠ A NAME IS NOT AN IDENTITY. `subjects.code` never changes with a rename, and
 * every code-keyed list in the app depends on that: MAPEH_FAMILY_CODES sets the
 * 20/60/20 weight split, MOTHER_TONGUE_SUBJECT_CODES decides what is directly
 * attachable, and the deployment importer's SUBJECT_MAP /
 * EQUIVALENT_SUBJECT_CODES resolve a teacher's phrase to a subject. None of
 * them are affected by a rename and none of them should ever consult this
 * function. Use it for text a person reads, and `code` for everything else.
 *
 * ⚠ RESOLUTION ORDER, and why report_label sits in the middle.
 *   1. `display_name` — what the school called it THAT YEAR (migration 137).
 *   2. `report_label` — a global "call it this on the report card" override
 *      (migration 087), used for fan-in labels.
 *   3. `name` — the catalogue name.
 * A year-specific name beats a global label because it is the more specific
 * statement about the same thing; a year with no override still honours the
 * report label, which is what keeps 087's consumers working unchanged.
 */

export type SubjectNameSource = {
  name: string;
  report_label?: string | null;
};

export type SubjectConfigNameSource = {
  display_name?: string | null;
};

/**
 * Resolve the name to show. `config` is optional so callers that genuinely have
 * no academic-year context (the catalogue admin list, a code-keyed lookup) can
 * pass the subject alone and get the global answer.
 *
 * Blank strings are treated as absent, not as a name — migration 137's CHECK
 * constraint refuses to store one, but a caller can still hand us the empty
 * string from an unsaved form, and an empty subject heading is worse than a
 * stale one.
 */
export function subjectDisplayName(
  subject: SubjectNameSource,
  config?: SubjectConfigNameSource | null
): string {
  // A caller holding a FLATTENED row — one object carrying `name`,
  // `report_label` and `display_name` together, which is what the report card
  // and the markbook loaders shape their subject rows into — passes it as both
  // arguments: `subjectDisplayName(row, row)`. That reads oddly for a moment
  // and is deliberate; the alternative was a second exported function whose
  // only job was to destructure, and two entry points into a resolution rule
  // is exactly how the rule starts to disagree with itself.
  const perYear = config?.display_name?.trim();
  if (perYear) return perYear;

  const reportLabel = subject.report_label?.trim();
  if (reportLabel) return reportLabel;

  return subject.name;
}
