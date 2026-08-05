import type { Role } from '@/lib/auth/roles';

// Who may WRITE to a student's own record, and who may move them between
// classes. Two lists, because `app/api/sis/students/[enroleeNumber]/**` really
// does hold two different audiences — see WHY THIS IS NOT A CAPABILITY below.

/**
 * The shared student record — profile, family, pipeline stage, STP status,
 * residence history, pre-course counselling — plus the GET that feeds the
 * stage dialog's section picker.
 *
 * REVERSES KD #74's "school_admin is read-only oversight" FOR THIS FOLDER, on
 * Mr Ace's instruction (2026-07-31). The routes were the outlier, not the
 * pages: `/records/students/[studentNumber]` and
 * `/admissions/applications/[enroleeNumber]` both admit her and both render
 * the Edit sheets, so every save she attempted came back `403 forbidden`
 * against a form that had opened for her. This is a real permission widening
 * on a live system, recorded deliberately (KD #173).
 */
export const STUDENT_RECORD_WRITERS = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];

/**
 * Placement and money — section assignment, mid-year transfer, compassionate
 * and vacation-leave allowances.
 *
 * `admissions` is deliberately ABSENT: enrolment placement is not theirs
 * (KD #51 — the funnel ends at Enrolled, and the academic lifecycle on
 * `section_students` belongs to Records). This list already included
 * school_admin before KD #173 and is unchanged by it; it exists here so the
 * distinction between the two sets is stated once, in a name, instead of
 * living as two coincidentally-similar literals in eleven route files.
 */
export const ENROLMENT_PLACEMENT_WRITERS = [
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];

// WHY THIS IS NOT A CAPABILITY.
//
// The obvious move is a `student_record.edit` capability. It was considered
// and rejected, for three reasons worth keeping:
//
//   1. ONE capability cannot describe this folder. The two lists above differ
//      by exactly `admissions`, so collapsing them would hand the admissions
//      team section placement and allowance edits — a silent permission
//      change, which lib/auth/capabilities.ts forbids in its own header. Two
//      capabilities to model one folder is vocabulary invented to satisfy a
//      refactor rather than a need.
//   2. A code-only capability is INERT. `role_permissions` is authoritative
//      once populated (lib/auth/permission-map.ts), so a new capability does
//      nothing until its migration reaches production — and until then
//      `requireCapability` would 403 EVERYONE, which is a worse failure than
//      the one being fixed.
//   3. Capabilities exist for a different problem: "one PERSON needs a right
//      their role name denies" (the P-Files officer validating documents on
//      both sides of enrolment, KD #166). This is just a role set that was
//      written down wrong.

/** May this role write to the shared student record? */
export function canWriteStudentRecord(role: Role | null): boolean {
  return !!role && (STUDENT_RECORD_WRITERS as readonly string[]).includes(role);
}

/**
 * May this role put a student into a class?
 *
 * The two lists differ by exactly `admissions`, and that difference is the
 * school's admission process: Enrolment is step 10 (admissions), Class
 * Assignment is step 11, done by Student Affairs "subject to a deliberation
 * by Academics Team" (docs/context/admission-process.md). So an admissions
 * user finishes the funnel and hands over; they never choose the class.
 */
export function canAssignSection(role: Role | null): boolean {
  return (
    !!role && (ENROLMENT_PLACEMENT_WRITERS as readonly string[]).includes(role)
  );
}
