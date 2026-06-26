// Write-once enrolment-timestamp stamp (migration 075).
//
// `ay{YY}_enrolment_status."enrolledAt"` captures the exact moment a student
// first reached an Enrolled state ('Enrolled' or 'Enrolled (Conditional)').
// It is WRITE-ONCE: a re-enrol (withdrawn → Enrolled again) or any later edit
// must NOT overwrite the original moment.
//
// Server-only — the caller passes the service/admissions client. The
// `enrolledAt IS NULL` filter makes the write-once guarantee atomic at the DB
// level (no read-then-write race): the UPDATE only touches the row when the
// column is still empty, so concurrent calls and repeated calls are no-ops.
//
// `enrolledAt` is a full timestamptz, so a UTC `new Date().toISOString()` is
// correct here — the SGT helpers in lib/dates.ts are for date-only
// school-calendar comparisons, not timestamps (KD #32).

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stamp `enrolledAt = now()` on the enrolment_status row for this enrolee,
 * but ONLY if it is currently NULL (write-once). Best-effort: on error it logs
 * a warning and returns `false` rather than throwing — capturing the timestamp
 * must never break the enrolment flow that triggered it.
 *
 * @param service       service/admissions client (createAdmissionsClient())
 * @param statusTable   e.g. `ay2026_enrolment_status`
 * @param enroleeNumber the admissions key on the status row
 * @returns true when the stamp was written (was NULL), false otherwise
 */
export async function stampEnrolledAtIfNull(
  service: SupabaseClient,
  statusTable: string,
  enroleeNumber: string
): Promise<boolean> {
  try {
    const { data, error } = await service
      .from(statusTable)
      .update({ enrolledAt: new Date().toISOString() })
      .eq('enroleeNumber', enroleeNumber)
      .is('enrolledAt', null)
      .select('id');
    if (error) {
      console.warn('[enrolledAt] stamp failed:', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    console.warn(
      '[enrolledAt] stamp threw:',
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}
