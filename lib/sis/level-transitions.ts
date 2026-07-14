// Pure "observed progression" helper for the Grade Levels admin page.
// Answers "for students who were in level X last AY, what did they actually
// apply for this AY?" by cross-referencing real enrolment data — no
// hand-maintained progression map to keep in sync. Naturally one-to-many:
// a level can show multiple destinations (e.g. Primary Six students split
// between "Secondary One" and an HFSE Global Education Programme track)
// because it's reporting what happened, not curating a rule.
//
// No I/O, no Supabase — the RSC loader supplies the prior-AY roster
// (student_number + level_id, from section_students/students/sections,
// Hard Rule #4) and the accepting-AY applications (student_number +
// levelApplied). A returning applicant is identified purely by having a
// student_number that also appears in the prior-AY roster — no reliance on
// the applications table's own `category` field, which is separate,
// parent-reported data.

import { canonicalizeLevelLabel } from '@/lib/sis/levels';
import type { LevelRow } from '@/lib/sis/levels';

export type LevelTransitionRow = {
  fromLevelId: string;
  toLabel: string;
  toLevelId: string | null;
  count: number;
};

export function computeLevelTransitions(
  priorEnrollments: Array<{ studentNumber: string; levelId: string }>,
  currentApplications: Array<{
    studentNumber: string | null;
    levelApplied: string | null;
  }>,
  levels: LevelRow[]
): LevelTransitionRow[] {
  const priorLevelByStudent = new Map(
    priorEnrollments.map((e) => [e.studentNumber, e.levelId])
  );
  const levelByLabel = new Map(levels.map((l) => [l.label, l]));
  // fromLevelId -> toLabel -> count. Nested map avoids building a composite
  // string key out of toLabel (which contains spaces, e.g. "Secondary One")
  // and having to split it back apart later.
  const counts = new Map<string, Map<string, number>>();

  for (const app of currentApplications) {
    if (!app.studentNumber) continue;
    const fromLevelId = priorLevelByStudent.get(app.studentNumber);
    if (!fromLevelId) continue; // not a student we can place last AY
    const toLabel = canonicalizeLevelLabel(app.levelApplied);
    if (!toLabel) continue;
    const byToLabel = counts.get(fromLevelId) ?? new Map<string, number>();
    byToLabel.set(toLabel, (byToLabel.get(toLabel) ?? 0) + 1);
    counts.set(fromLevelId, byToLabel);
  }

  const rows: LevelTransitionRow[] = [];
  for (const [fromLevelId, byToLabel] of counts) {
    for (const [toLabel, count] of byToLabel) {
      const toLevelId = levelByLabel.get(toLabel)?.id ?? null;
      rows.push({ fromLevelId, toLabel, toLevelId, count });
    }
  }
  return rows.sort((a, b) => b.count - a.count);
}

// Groups transition rows by their origin level — the shape the UI actually
// renders (one card/row per level, its observed destinations as chips).
export function groupTransitionsByFromLevel(
  rows: LevelTransitionRow[]
): Map<string, LevelTransitionRow[]> {
  const map = new Map<string, LevelTransitionRow[]>();
  for (const row of rows) {
    const arr = map.get(row.fromLevelId) ?? [];
    arr.push(row);
    map.set(row.fromLevelId, arr);
  }
  return map;
}
