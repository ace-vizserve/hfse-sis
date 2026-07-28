// Classroom scope — "which classes can this user open, and in what capacity."
//
// There was no single helper for this before: the codebase answered it three
// different ways (`listFormAdviserSectionIds` for Evaluation, an inline
// `teacher_assignments` query in the Attendance section list, and nothing at
// all in Markbook's, which showed every user every section).
//
// The capability a user holds over a section is NOT a UI preference — it
// mirrors what RLS already enforces in supabase/migrations/005_rls_teacher_scoping.sql:
//
//   attendance_records      -> is_adviser_for_section   (form adviser only)
//   report_card_comments    -> is_adviser_for_section   (form adviser only)
//   grading_sheets/entries  -> is_teacher_for_sheet     (own subject, or any if adviser)
//   students/section_students -> is_teacher_for_section (any assignment)
//
// So a subject-teacher-only user genuinely cannot read a section's attendance
// or write-ups. The classroom must render a narrowed view for them rather than
// panels that would come back empty. `canReadAttendance` / `canReadWriteups`
// below are the single source for that decision — do not re-derive it inline.

import type { Role } from '@/lib/auth/roles';
import type { AssignmentRow } from '@/lib/auth/teacher-assignments';

/** What a user may do in a given class. */
export type ClassroomCapability =
  | 'adviser' // form adviser: the full classroom
  | 'subject' // subject teacher only: roster + their own subject's sheet
  | 'oversight'; // coordinator / school_admin / superadmin: read everything

/** Roles that see every class in the AY rather than only assigned ones. */
const OVERSIGHT_ROLES: ReadonlySet<Role> = new Set<Role>([
  'academic_coordinator',
  'school_admin',
  'superadmin',
]);

export type ClassroomScope = {
  /**
   * `null` means "every section in the AY" (oversight roles) — callers should
   * skip the id filter entirely rather than pass a huge IN list. An empty
   * array means "no classes at all" (admissions / p_file_officer), which is
   * distinct from null and must not be treated as unscoped.
   */
  sectionIds: string[] | null;
  /** Only populated for assignment-derived scopes; empty for oversight. */
  capabilityBySection: Record<string, ClassroomCapability>;
  isOversight: boolean;
};

/**
 * Pure. Derives scope from assignment rows already loaded by
 * `loadAssignmentsForUser`, so it is unit-testable without a database.
 *
 * A section where the user holds BOTH a form_adviser row and a
 * subject_teacher row resolves to 'adviser' — the wider capability wins,
 * matching `is_teacher_for_sheet`, which lets an adviser read every subject
 * in their own section.
 */
export function resolveClassroomScope(
  role: Role | null,
  assignments: AssignmentRow[]
): ClassroomScope {
  if (role != null && OVERSIGHT_ROLES.has(role)) {
    return { sectionIds: null, capabilityBySection: {}, isOversight: true };
  }

  // Only `teacher` derives scope from assignments. Every other role
  // (admissions, p_file_officer, or a null/unknown role) gets nothing —
  // they have no teaching relationship to any class.
  if (role !== 'teacher') {
    return { sectionIds: [], capabilityBySection: {}, isOversight: false };
  }

  const capabilityBySection: Record<string, ClassroomCapability> = {};
  for (const a of assignments) {
    if (a.role === 'form_adviser') {
      capabilityBySection[a.section_id] = 'adviser';
    } else if (a.role === 'subject_teacher') {
      // Never downgrade an adviser to subject, regardless of row order.
      capabilityBySection[a.section_id] ??= 'subject';
    }
  }

  return {
    sectionIds: Object.keys(capabilityBySection),
    capabilityBySection,
    isOversight: false,
  };
}

/** The capability this user holds over one section, or null if none. */
export function capabilityForSection(
  scope: ClassroomScope,
  sectionId: string
): ClassroomCapability | null {
  if (scope.isOversight) return 'oversight';
  return scope.capabilityBySection[sectionId] ?? null;
}

/**
 * Attendance is adviser-only at the DB level (`is_adviser_for_section`).
 * A subject teacher's classroom must not offer it.
 */
export function canReadAttendance(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'adviser' || capability === 'oversight';
}

/** FCA write-ups are adviser-only, same RLS predicate as attendance. */
export function canReadWriteups(
  capability: ClassroomCapability | null
): boolean {
  return capability === 'adviser' || capability === 'oversight';
}

/** Any capability at all means the roster is readable (`is_teacher_for_section`). */
export function canReadRoster(capability: ClassroomCapability | null): boolean {
  return capability != null;
}
