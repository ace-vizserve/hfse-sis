import type { SupabaseClient } from '@supabase/supabase-js';

import type { DisciplineRecordInput } from '@/lib/schemas/discipline';

// Writing a disciplinary record — action item #7 from the 2026-07-31 academics
// training.
//
// The client is a PARAMETER, never created here: the route owns it, the same
// split lib/p-files/mutations.ts and lib/attendance/mutations.ts use. Results
// are returned as objects rather than thrown, so a route can turn a failure
// into a sentence for the person filing instead of a 500.
//
// Nothing in this file decides anything. There is no threshold, no escalation
// and no letter generation — the 80% attendance rule and the award-eligibility
// rule live in the school's own Student Handbook, which they revise on their
// own schedule (Mr Ace, 2026-08-17). Staff decide; this records it.

export type DisciplineWriteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** The three facts the route resolves and the filer never supplies. */
export type DisciplineRecordOwner = {
  studentId: string;
  sectionId: string;
  academicYearId: string;
};

/**
 * Turns the validated form body into the row shape.
 *
 * `nullish()` fields arrive as `undefined` when the form omitted them and
 * `null` when it cleared them; both mean "no value", and Postgres wants `null`
 * for each. Without the `?? null` an omitted key would be dropped from the
 * update payload entirely, so clearing a remark would silently keep the old
 * one — the exact class of bug that left `classSection` stale in
 * `section-transfer.ts`.
 */
function toColumns(input: DisciplineRecordInput) {
  return {
    record_type: input.record_type,
    occurred_on: input.occurred_on,
    occurred_at_time: input.occurred_at_time ?? null,
    nature: input.nature,
    details: input.details ?? '',
    remarks: input.remarks ?? null,
    // `|| null`, not `?? null`. The schema accepts `''` so that a link can be
    // cleared, and `??` would store that empty string — which then renders as
    // a link to nowhere instead of as no link at all.
    document_url: input.document_url || null,
    // `record_type !== 'letter'` is belt-and-braces over the schema's own
    // refine AND migration 122's CHECK. It matters on an EDIT: a record
    // switched from letter to incident must not carry its acknowledgement
    // date over, and relying on the caller to have cleared the field would
    // make a 500 out of an ordinary correction.
    acknowledged_on:
      input.record_type === 'letter' ? (input.acknowledged_on ?? null) : null,
    filed_by_office: input.filed_by_office ?? null,
  };
}

/**
 * Files a new record against a student.
 *
 * `filedBy` is the verified session's own id, passed in by the route — never
 * taken from the request body. Accepting it from the body would let anyone
 * file under someone else's name, which on a child's behavioural record is not
 * a small thing. Same rule as `classroom_notes.teacher_user_id` (migration
 * 094).
 */
export async function createDisciplineRecord(
  service: SupabaseClient,
  owner: DisciplineRecordOwner,
  filedBy: string,
  input: DisciplineRecordInput
): Promise<DisciplineWriteResult> {
  const { data, error } = await service
    .from('student_discipline_records')
    .insert({
      student_id: owner.studentId,
      section_id: owner.sectionId,
      academic_year_id: owner.academicYearId,
      filed_by: filedBy,
      ...toColumns(input),
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Edits an existing record.
 *
 * Whether this caller MAY edit is the route's decision (the filer, or
 * leadership — Mr Ace, 2026-08-17), not this function's. `updated_by` is the
 * verified session id for the same reason `filed_by` is.
 *
 * The student, the class and the year are deliberately not updatable. A record
 * filed against the wrong child is not an edit, it is a different record —
 * moving it would rewrite one student's history into another's and leave the
 * audit trail describing a change that reads as harmless.
 */
export async function updateDisciplineRecord(
  service: SupabaseClient,
  id: string,
  updatedBy: string,
  input: DisciplineRecordInput
): Promise<DisciplineWriteResult> {
  const { data, error } = await service
    .from('student_discipline_records')
    .update({
      ...toColumns(input),
      updated_by: updatedBy,
      // Set explicitly: the column defaults on INSERT only, and there is no
      // trigger on this table. Without this line an edited record would keep
      // reporting the moment it was first filed.
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}
