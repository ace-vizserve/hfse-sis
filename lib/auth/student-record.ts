import type { Role } from '@/lib/auth/roles';

// Who may WRITE to a student's own record, and who may move them between
// classes. Two lists — record edits and placement — used to hold two
// different audiences; as of 2026-09-10 they hold the same roles (see
// ENROLMENT_PLACEMENT_WRITERS below for why). Still two names because
// ~14 call sites read one or the other — see WHY THIS IS NOT A CAPABILITY.

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

// ⚠ THESE TWO LISTS ARE NOW IDENTICAL, and the comment that used to explain
// why they differed is gone on purpose. Until 2026-09-10 admissions could move
// an applicant through the funnel but not put them in a class — the funnel was
// theirs, the placement was Records'. Records is theirs too now (the P-Files
// officer role was retired into it), so the split has nothing left to protect.
// Kept as two names because ~14 call sites read one or the other, and
// collapsing them is a rename, not a permissions change.
export const ENROLMENT_PLACEMENT_WRITERS = [
  'admissions',
  'academic_coordinator',
  'school_admin',
  'superadmin',
] as const satisfies readonly Role[];

// WHY THIS IS NOT A CAPABILITY.
//
// The obvious move is a `student_record.edit` capability. It was considered
// and rejected, for three reasons worth keeping:
//
//   1. RETIRED (2026-09-10). This used to be "one capability can't describe
//      this folder, because the two lists differ by exactly `admissions`" —
//      collapsing them would have handed admissions section placement as a
//      silent permission change. They no longer differ, so that argument is
//      gone. The two lists stay separate NAMES anyway (~14 call sites read
//      one or the other; collapsing the names is a rename hazard, not a
//      modelling one) but that alone doesn't argue for a capability — reasons
//      2 and 3 below are what still keep this off `requireCapability`.
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
 * Same roster as `canWriteStudentRecord` as of 2026-09-10 — admissions now
 * owns Records end to end (the P-Files officer role was retired into it), so
 * the old boundary at "Enrolment is step 10 (admissions), Class Assignment is
 * step 11 (Student Affairs)" (docs/context/admission-process.md) no longer
 * marks a permission edge. Kept as its own function/name because call sites
 * read intent ("can this role place a student"), not the literal role list.
 */
export function canAssignSection(role: Role | null): boolean {
  return (
    !!role && (ENROLMENT_PLACEMENT_WRITERS as readonly string[]).includes(role)
  );
}
