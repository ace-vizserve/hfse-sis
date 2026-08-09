import { requireCurrentAyCode } from '@/lib/academic-year';
import { prefixFor } from '@/lib/admissions/_shared';
import type { StudentDetailsSource } from '@/lib/classroom/student-details';
import { createAdmissionsClient } from '@/lib/supabase/admissions';

// The one admissions read behind the Classroom student drawer.
//
// WHY NOT `getStudentDetail`. That helper (lib/sis/queries.ts) is keyed on
// enroleeNumber, which the classroom roster does not hold, and it fetches the
// application, the enrolment status AND every document row — three round trips
// for a drawer that needs one. It also returns the whole application, including
// the passport and fee columns this feature exists to keep away from teachers.
//
// WHY NOT `getEnrollmentHistory`. It resolves a studentNumber across academic
// years by querying every AY table in turn. A teacher opening a student on this
// year's roster needs this year, and the roster row already proves the student
// is enrolled in it.
//
// Columns are listed explicitly and match `StudentDetailsSource` exactly, so a
// column added to the admissions table cannot arrive here by accident.
const COLUMNS = [
  'allergies',
  'allergyDetails',
  'foodAllergies',
  'foodAllergyDetails',
  'asthma',
  'heartConditions',
  'epilepsy',
  'eczema',
  'diabetes',
  'otherMedicalConditions',
  'dietaryRestrictions',
  'paracetamolConsent',
  'additionalLearningNeeds',
  'otherLearningNeeds',
  'motherFullName',
  'motherMobile',
  'motherEmail',
  'fatherFullName',
  'fatherMobile',
  'guardianFullName',
  'guardianMobile',
  'guardianEmail',
  'contactPerson',
  'contactPersonNumber',
  'livingWithWhom',
].join(',');

/**
 * This academic year's application row for a student, or `null` when there
 * isn't one.
 *
 * `null` is a real answer, not an error: a student backfilled into an earlier
 * year's roster can sit on `section_students` with no application row behind
 * them. The caller renders an empty record rather than failing to open.
 */
export async function loadStudentDetailsSource(
  studentNumber: string
): Promise<StudentDetailsSource | null> {
  const ayCode = await requireCurrentAyCode();
  const supabase = createAdmissionsClient();

  const { data, error } = await supabase
    .from(`${prefixFor(ayCode)}_enrolment_applications`)
    .select(COLUMNS)
    .eq('studentNumber', studentNumber)
    .maybeSingle();

  if (error) {
    // Logged rather than thrown: a drawer that opens empty is a better failure
    // than one that will not open. The log is how we find out it happened.
    console.error('[classroom] student details lookup failed:', error.message);
    return null;
  }
  return (data as StudentDetailsSource | null) ?? null;
}
