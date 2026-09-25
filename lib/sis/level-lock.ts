import type { SupabaseClient } from '@supabase/supabase-js';

import { isEnrolledStatus as isEnrolledApplication } from '@/lib/p-files/_shared';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';

// A student's level is fixed once they are enrolled or sitting in a class.
//
// Before that it is an application detail — "Level applied" on the profile —
// and admissions corrects it freely. After it, the level has a class, subjects,
// grades and attendance hanging off it, and editing the text changes none of
// those: a P1 child relabelled "Primary Two" stays in their P1 class and the
// record disagrees with itself (Records → Level mismatches). So the edit is
// refused, on the sheet and on the server, rather than left to be cleaned up.
//
// Two tests, not one, because a child can be placed in a class BEFORE their
// application reads Enrolled (the AY2027 intake was placed while Submitted).

export const LEVEL_LOCKED_MESSAGE =
  "Level can't be changed once the student is enrolled or placed in a class.";

/** Pure form, for a page that already holds both facts. */
export function isLevelLocked(input: {
  applicationStatus: string | null | undefined;
  inClass: boolean;
}): boolean {
  return input.inClass || isEnrolledApplication(input.applicationStatus);
}

/** Reads both facts for one application. Used by the profile save. */
export async function loadLevelLock(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  studentNumber: string | null
): Promise<boolean> {
  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const [statusRes, classRes] = await Promise.all([
    service
      .from(`${prefix}_enrolment_status`)
      .select('applicationStatus')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    studentNumber
      ? service
          .from('section_students')
          .select(
            'id, sections!inner(academic_years!inner(ay_code)), students!inner(student_number)'
          )
          .eq('students.student_number', studentNumber)
          .eq('sections.academic_years.ay_code', ayCode)
          .in('enrollment_status', ENROLLED_STATUSES)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // A read that fails locks rather than unlocks: refusing a level edit is
  // recoverable, letting one through onto an enrolled child is not.
  if (statusRes.error || classRes.error) return true;
  return isLevelLocked({
    applicationStatus: (
      statusRes.data as { applicationStatus: string | null } | null
    )?.applicationStatus,
    inClass: (classRes.data ?? []).length > 0,
  });
}
