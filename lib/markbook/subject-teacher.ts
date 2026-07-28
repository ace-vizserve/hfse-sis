// Pure — batch-resolves the LIVE subject-teacher display names for a
// (section, subject) pair, given `teacher_assignments` rows (role =
// 'subject_teacher') and the staff id→name lookup from
// lib/auth/staff-list.ts::getStaffDisplayNameById().
//
// Reads teacher_assignments, never the denormalized `grading_sheets.teacher_name`
// column — that field is written once at sheet creation and never updated when
// assignments change, so it drifts (and across AY2026 it is simply empty).
// Same authoritative-vs-mirror choice as buildFormAdviserNameMap in
// lib/markbook/masterfile.ts.
//
// Extracted so the resolution is unit-testable without mocking the surrounding
// Supabase call graph — the only consumer is an async RSC.
//
// Returns ALL teachers for a pair, not just the first: the unique index
// `teacher_assignments_subject_teacher_unique` is on
// (teacher_user_id, section_id, subject_id), so co-teaching is permitted and
// silently dropping the second name would be a hard-to-notice wrong.

export type SubjectTeacherAssignmentRow = {
  section_id: string;
  subject_id: string | null;
  teacher_user_id: string;
};

export function subjectTeacherKey(
  sectionId: string,
  subjectId: string
): string {
  return `${sectionId}|${subjectId}`;
}

export function buildSubjectTeacherNameMap(
  assignments: SubjectTeacherAssignmentRow[],
  staffNameEntries: Array<[string, string]>
): Map<string, string[]> {
  const nameById = new Map(staffNameEntries);
  const out = new Map<string, string[]>();
  for (const a of assignments) {
    // Defensive: the role/subject CHECK constraint already guarantees a
    // subject_id on subject_teacher rows, but this function takes plain data.
    if (!a.subject_id) continue;
    const key = subjectTeacherKey(a.section_id, a.subject_id);
    // Fall back to the raw id rather than a blank — an id tells a superadmin
    // which account to fix, a blank tells them nothing.
    const name = nameById.get(a.teacher_user_id) ?? a.teacher_user_id;
    const existing = out.get(key);
    if (existing) existing.push(name);
    else out.set(key, [name]);
  }
  return out;
}
