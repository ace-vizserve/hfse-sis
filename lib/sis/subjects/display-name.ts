/**
 * What a subject is CALLED — two questions, two answers, one file.
 *
 * The school renamed MAPEH to STAR ("Sports, Talent, Arts and Rhythm") for
 * AY2026 while AY2025 keeps the old name, so a subject's name is a property of
 * the (subject, academic year) pair rather than of the subject. Migration 137
 * put the override on `subject_configs`, which is already the per-AY row;
 * migration 138 moved the report label onto the same row.
 *
 * ⚠ A NAME IS NOT AN IDENTITY. `subjects.code` never changes with a rename, and
 * every code-keyed list in the app depends on that: MAPEH_FAMILY_CODES sets the
 * 20/60/20 weight split, MOTHER_TONGUE_SUBJECT_CODES decides what is directly
 * attachable, and the deployment importer's SUBJECT_MAP /
 * EQUIVALENT_SUBJECT_CODES resolve a teacher's phrase to a subject. None of
 * them are affected by a rename and none of them should ever consult this
 * file. Use these for text a person reads, and `code` for everything else.
 *
 * ── WHY THERE ARE TWO FUNCTIONS AND NOT ONE CHAIN ─────────────────────────
 *
 * There WAS one chain — `display_name -> report_label -> name` — and it was
 * wrong in a way nothing could have caught, because it had no callers. The
 * 2026-08-31 read sweep gave it callers across the markbook, classroom and
 * grading screens, and the moment it did, MAPEH's report label of 'STAR'
 * started answering for AY2025 markbook screens. AY2025 is the year that is
 * supposed to keep saying MAPEH.
 *
 * The chain read as harmless because both fields sound like "the name". They
 * are not the same question:
 *
 *   subjectDisplayName  — what is this subject CALLED this year? Asked by
 *                         every screen: grading sheets, markbook, classroom,
 *                         admin, exports.
 *   subjectReportName   — what does the REPORT CARD call it this year? Asked
 *                         by the report card and nothing else.
 *
 * A report label is by definition narrower than a name, so it may only ever
 * widen the answer for the one surface it names. Keeping the functions apart
 * is what makes that structural rather than a rule somebody has to remember.
 * `__tests__/sis/report-label-scope.test.ts` fails if a non-report-card file
 * imports the second one.
 *
 * ⚠ DO NOT "SIMPLIFY" THESE BACK INTO ONE FUNCTION WITH A FLAG. A flag has a
 * default, and the default would be wrong on whichever side forgets to pass it
 * — which is precisely the failure above, rebuilt.
 */

export type SubjectNameSource = {
  name: string;
};

export type SubjectConfigNameSource = {
  display_name?: string | null;
};

export type SubjectConfigReportNameSource = SubjectConfigNameSource & {
  report_label?: string | null;
};

/**
 * What to call this subject on any screen that is not a report card.
 *
 * `config` is optional so callers that genuinely have no academic-year context
 * (the catalogue admin list, a code-keyed lookup) can pass the subject alone
 * and get the catalogue name.
 *
 * Blank strings are treated as absent, not as a name — migrations 137 and 138
 * both refuse to store one, but a caller can still hand us the empty string
 * from an unsaved form, and an empty subject heading is worse than a stale one.
 *
 * A caller holding a FLATTENED row — one object carrying `name` and
 * `display_name` together, which is what the report card and the markbook
 * loaders shape their subject rows into — passes it as both arguments:
 * `subjectDisplayName(row, row)`. That reads oddly for a moment and is
 * deliberate; the alternative was a second function whose only job was to
 * destructure, and extra entry points into a resolution rule are how the rule
 * starts to disagree with itself.
 */
export function subjectDisplayName(
  subject: SubjectNameSource,
  config?: SubjectConfigNameSource | null
): string {
  const perYear = config?.display_name?.trim();
  if (perYear) return perYear;

  return subject.name;
}

/**
 * What the REPORT CARD calls this subject in this academic year.
 *
 * Falls through to `subjectDisplayName`, so a year that set a name but no
 * report label prints the name — the report card should never disagree with
 * the rest of the app by accident, only on purpose.
 *
 * ⚠ REPORT CARD ONLY. Importing this anywhere else reintroduces the leak
 * described in the file header, and the scope test will say so by name.
 */
export function subjectReportName(
  subject: SubjectNameSource,
  config?: SubjectConfigReportNameSource | null
): string {
  const label = config?.report_label?.trim();
  if (label) return label;

  return subjectDisplayName(subject, config);
}
