import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole } from '@/lib/schemas/teacher-assignment';
import type { OverlappingFiling } from '@/lib/declarations/filing-window';

// The school attaching a medical certificate the parent could not file.
//
// ⚠ SAME TABLE AS THE PARENT'S, and that is the whole design. There is one
// answer to "why was this child away", and a second evidence store beside
// `student_declarations` would immediately produce two — which is precisely
// the four-disconnected-places problem migration 125 was written to end.
//
// ─────────────────────────────────────────────────────────────────────────
// IT GOES IN ALREADY APPROVED AND DOES NOT ENTER THE APPROVAL LADDER
//
// The FCA → officer-in-charge ladder (KD #196) exists to vet a claim a PARENT
// is making. When the office scans a certificate that was physically handed
// in, the school is recording its OWN evidence and there is nobody left to
// vet it. It grants no new authority either: whoever may do this can already
// mark the day `EX` with a note today, which is exactly the ad-hoc practice
// this replaces.
//
// ⚠ THE CONSEQUENCE IS REAL AND IS HANDLED RATHER THAN HIDDEN. With no
// `approval_request` the filing appears in no declarations queue and produces
// no event in the Activity panel — `lib/activity/feed.ts` derives its events
// from `approval_request_stages`, and there are none. `audit_log` is therefore
// the record, and the write route logs the actor, the child, the class, the
// dates and whether a file or a link was attached.
//
// ─────────────────────────────────────────────────────────────────────────
// IT MUST NOT WRITE THE REGISTER
//
// KD #197's register write fires when the LAST approval stage approves. Here
// the teacher is already marking the day `EX` through the normal attendance
// path — that IS the register write. Doing it again would append a second mark
// for the same day. `register_written_at` stays null on purpose; see the
// comment on the insert in the route, and the matching guard in
// `scripts/repair-declaration-approvals.ts`, which would otherwise read every
// one of these rows as "approved but never marked" and mark it.

/**
 * Where a staff upload lives inside the existing public `parent-portal`
 * bucket.
 *
 * ⚠ ITS OWN PREFIX, SEPARATE FROM THE PARENT'S. Parent uploads land under
 * `declarations/<parent user id>/…` and the parent route refuses any path
 * outside the caller's own folder — the prefix is the only thing tying a file
 * to a person. Staff need the same check against the same kind of mistake, and
 * they need it against a folder a parent can never write to, so that a path
 * lifted from one side cannot be replayed on the other.
 */
export const STAFF_EVIDENCE_FOLDER = 'declarations/staff';

/** The one folder this member of staff may attach from. */
export function staffEvidencePrefix(userId: string): string {
  return `${STAFF_EVIDENCE_FOLDER}/${userId}/`;
}

/**
 * Is this path the caller's own upload?
 *
 * ⚠ `evidencePath` is just a string in the request body. A path outside the
 * caller's folder is either a typo or an attempt to attach somebody else's
 * medical certificate to a child they can reach — where every staff screen
 * would then render it. Mirrors the parent route's check step for step.
 *
 * ⚠ `..` is rejected outright rather than resolved. `declarations/staff/<me>/
 * ../<them>/x.pdf` starts with the right prefix and is not the right folder;
 * refusing the segment is exact, where normalising it invites a second
 * implementation of path resolution to disagree with Storage's.
 */
export function isOwnStaffEvidencePath(userId: string, path: string): boolean {
  if (!path.startsWith(staffEvidencePrefix(userId))) return false;
  return !path.split('/').includes('..');
}

/**
 * May this person mark that section's register?
 *
 * ⚠ THIS IS THE DAILY WRITE ROUTE'S PREDICATE, NOT A NEW ONE. The rule is
 * "whoever may mark that section's register may record a certificate against
 * it", so the check is the same pair of primitives `PATCH /api/attendance/
 * daily` uses — `loadEffectiveAssignmentsForUser` for the assignments, and
 * `isAdviserRole` rather than the `form_adviser` literal, because migration
 * 124's `is_adviser_for_section` admits a co-adviser and comparing the literal
 * would refuse somebody the database already lets write the register.
 *
 * ⚠ EFFECTIVE, not substantive: a relief teacher covering the class today is
 * exactly who is standing in front of it when a certificate is handed over.
 *
 * ⚠ IT FAILS CLOSED. A lookup that throws refuses, and an empty assignment
 * list refuses — "no assignments came back" is not "no section to object to".
 */
export async function assertCanMarkRegisterForSection(
  service: SupabaseClient,
  caller: { userId: string; role: Role },
  sectionId: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Registrar and above write any section, exactly as the daily route allows.
  if (caller.role !== 'teacher') return { ok: true };

  if (!sectionId) {
    return { ok: false, reason: 'unknown class for that student' };
  }

  let assignments: Array<{ section_id: string; role: string }>;
  try {
    assignments = await loadEffectiveAssignmentsForUser(service, caller.userId);
  } catch (err) {
    return {
      ok: false,
      reason: `teacher_assignments lookup failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const advises = assignments.some(
    (a) => a.section_id === sectionId && isAdviserRole(a.role)
  );
  return advises
    ? { ok: true }
    : { ok: false, reason: `not form adviser for section ${sectionId}` };
}

/** Everything the insert and the audit row need, from one enrolment id. */
export type FilingTarget = {
  sectionStudentId: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  sectionId: string;
  sectionName: string | null;
  className: string | null;
  levelCode: string | null;
  academicYearId: string;
};

/**
 * Resolve one enrolment into the child, the class and the academic year.
 *
 * Two reads: the enrolment (which carries the student and the section), then
 * the section and the student together. `academic_year_id` lives on the
 * SECTION rather than the enrolment, so it cannot be skipped — and a filing
 * stamped with the wrong year would sit outside every term lookup the rest of
 * the feature makes.
 */
export async function resolveFilingTarget(
  service: SupabaseClient,
  sectionStudentId: string
): Promise<FilingTarget | null> {
  const { data: enrolment, error } = await service
    .from('section_students')
    .select('id, student_id, section_id')
    .eq('id', sectionStudentId)
    .maybeSingle();
  if (error) throw new Error(`enrolment lookup failed: ${error.message}`);
  if (!enrolment) return null;

  const row = enrolment as unknown as {
    id: string;
    student_id: string;
    section_id: string;
  };

  const [sectionRes, studentRes] = await Promise.all([
    service
      .from('sections')
      .select('id, name, academic_year_id, levels(code)')
      .eq('id', row.section_id)
      .maybeSingle(),
    service
      .from('students')
      .select('id, student_number, first_name, last_name')
      .eq('id', row.student_id)
      .maybeSingle(),
  ]);
  if (sectionRes.error) {
    throw new Error(`class lookup failed: ${sectionRes.error.message}`);
  }
  if (studentRes.error) {
    throw new Error(`student lookup failed: ${studentRes.error.message}`);
  }
  if (!sectionRes.data || !studentRes.data) return null;

  const section = sectionRes.data as unknown as {
    id: string;
    name: string | null;
    academic_year_id: string;
    // PostgREST returns an embedded to-one as an object or a single-element
    // array depending on how it infers the relationship; both shapes appear in
    // this codebase, so normalise rather than assume.
    levels: { code: string } | { code: string }[] | null;
  };
  const student = studentRes.data as unknown as {
    id: string;
    student_number: string;
    first_name: string;
    last_name: string;
  };

  const level = Array.isArray(section.levels)
    ? section.levels[0]
    : section.levels;
  const levelCode = level?.code ?? null;

  return {
    sectionStudentId: row.id,
    studentId: row.student_id,
    studentNumber: student.student_number,
    studentName: `${student.first_name} ${student.last_name}`.trim(),
    sectionId: section.id,
    sectionName: section.name,
    className: [levelCode, section.name].filter(Boolean).join(' ') || null,
    levelCode,
    academicYearId: section.academic_year_id,
  };
}

/**
 * What a member of staff reads when those days are already on record.
 *
 * ⚠ WORDED FOR THE OFFICE, NOT FOR A PARENT. `alreadyFiledMessage` in
 * `filing-window.ts` tells a parent to ring the school; saying that to the
 * school is absurd. This says what exists and what to do with the certificate
 * in their hand instead — open the filing that is already there.
 *
 * ⚠ It never names a constraint, a table or a status code. A school admin is
 * not IT.
 */
export function alreadyOnRecordMessage(existing: OverlappingFiling): string {
  const range =
    existing.startDate === existing.endDate
      ? existing.startDate
      : `${existing.startDate} to ${existing.endDate}`;
  // ⚠ THE ARTICLE COMES WITH THE NOUN, not from a template. A first cut built
  // this as `a ${kind}` and produced "already has a absence on record" on the
  // commonest path of the two. Nothing type-checks a sentence, and the only
  // reader is a member of staff who now trusts the message slightly less.
  const kind =
    existing.declarationType === 'travel'
      ? {
          indefinite: 'a travel declaration',
          approved: 'an approved travel declaration',
        }
      : { indefinite: 'an absence', approved: 'an approved absence' };

  if (existing.status === 'approved') {
    return `${existing.studentName} already has ${kind.approved} on record for ${range}. Open that record to add the certificate to it instead of creating a second one.`;
  }
  return `${existing.studentName} already has ${kind.indefinite} on record for ${range} that the school has not decided yet. Open it from the declarations queue and attach the certificate there.`;
}
