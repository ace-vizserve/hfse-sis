// Pure comparison: which subjects does Structure Defaults (template_subject_
// configs) say a level should have, that this AY's subject_configs is
// missing? A missing config silently omits that subject from grading-sheet
// creation AND the report card (build-report-card.ts scopes subjects by
// subject_configs — no error, no visible signal anywhere) — this is the
// computation that surfaces the gap on /sis/admin/subjects. A level with no
// template rows at all is treated as complete (nothing to compare against,
// avoids false negatives for volatile/manually-managed levels).
//
// Same underlying comparison as lib/sis/readiness.ts's fetchClasses step —
// that one aggregates to a fraction for the readiness pill, this one
// produces a human-readable per-level breakdown for the warning banner.
// Kept as two call sites reading the same tables rather than one shared
// function because their outputs serve different shapes (aggregate count
// vs. named subject list) and the readiness engine is scoped to in-use
// levels while this is scoped to every level shown on the page.

export type SubjectConfigGap = {
  levelId: string;
  levelLabel: string;
  missingSubjectCodes: string[];
};

export function computeSubjectConfigGaps(
  levels: Array<{ id: string; label: string }>,
  subjects: Array<{ id: string; code: string }>,
  templateRows: Array<{ level_id: string; subject_id: string }>,
  actualConfigs: Array<{ level_id: string; subject_id: string }>
): SubjectConfigGap[] {
  const subjectCodeById = new Map(subjects.map((s) => [s.id, s.code]));

  const templateByLevel = new Map<string, Set<string>>();
  for (const r of templateRows) {
    const set = templateByLevel.get(r.level_id) ?? new Set<string>();
    set.add(r.subject_id);
    templateByLevel.set(r.level_id, set);
  }

  const actualByLevel = new Map<string, Set<string>>();
  for (const r of actualConfigs) {
    const set = actualByLevel.get(r.level_id) ?? new Set<string>();
    set.add(r.subject_id);
    actualByLevel.set(r.level_id, set);
  }

  const gaps: SubjectConfigGap[] = [];
  for (const level of levels) {
    const templateSubjects = templateByLevel.get(level.id);
    if (!templateSubjects || templateSubjects.size === 0) continue;

    const actualSubjects = actualByLevel.get(level.id) ?? new Set<string>();
    const missingSubjectCodes = Array.from(templateSubjects)
      .filter((subjectId) => !actualSubjects.has(subjectId))
      .map((subjectId) => subjectCodeById.get(subjectId))
      .filter((code): code is string => !!code)
      .sort();

    if (missingSubjectCodes.length > 0) {
      gaps.push({
        levelId: level.id,
        levelLabel: level.label,
        missingSubjectCodes,
      });
    }
  }

  return gaps.sort((a, b) => a.levelLabel.localeCompare(b.levelLabel));
}
