import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role } from '@/lib/auth/roles';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import { isAdviserRole } from '@/lib/schemas/teacher-assignment';
import { formatDayRange } from '@/lib/declarations/format';

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

// ─────────────────────────────────────────────────────────────────────────
// WHEN THE DAY IS ALREADY ON RECORD, THE CERTIFICATE JOINS IT
//
// Mr Ace: *"the simplest way is just allow the SIS users to upload the MC."*
// ONE control, and the person using it is never asked whether a parent filed
// — they are holding a certificate for a day, and that is the whole of what
// they know. So the SERVER decides: no filing yet and it creates one; a filing
// already covering those days and the certificate is attached to THAT row
// instead. Two rows for one illness is the thing a second filing would create,
// and it is exactly the four-disconnected-places problem migration 125 exists
// to end.
//
// ⚠ The route used to answer this case with a 409 telling the office to go and
// open the filing themselves. That was a branch the person had to understand,
// on a screen that already knows the answer.

/** A live filing already covering the days a certificate is being recorded for. */
export type ExistingFiling = {
  id: string;
  declarationType: 'absence' | 'travel';
  /** Only ever `pending` or `approved` — see the query below. */
  status: string;
  startDate: string;
  endDate: string;
  /** A certificate is already on it — an upload, a link, or both. */
  hasEvidence: boolean;
};

/**
 * The filing a certificate for these days belongs on, if there is one.
 *
 * ⚠ `rejected` and `cancelled` are deliberately NOT counted, the same rule
 * `findOverlappingFilings` follows: a filing turned down for the want of a
 * certificate is precisely when the office needs to record one, and attaching
 * proof to a dead row would put it somewhere nobody reads.
 *
 * ⚠ AN ABSENCE WINS OVER A TRAVEL ROW when both cover the day. A certificate
 * belongs on the absence; the travel row is returned only when it is the only
 * thing there, so the route can say plainly why it will not take it.
 *
 * ⚠ Overlap, not containment — `yyyy-MM-dd` compares correctly as text, the
 * way every date test in this feature does.
 */
export async function findFilingCoveringDays(
  service: SupabaseClient,
  args: { studentId: string; startDate: string; endDate: string }
): Promise<ExistingFiling | null> {
  const { data, error } = await service
    .from('student_declarations')
    .select(
      'id, declaration_type, status, start_date, end_date, evidence_path, evidence_url'
    )
    .eq('student_id', args.studentId)
    .in('status', ['pending', 'approved'])
    .lte('start_date', args.endDate)
    .gte('end_date', args.startDate)
    .order('start_date', { ascending: true });
  if (error) throw new Error(`existing filing lookup failed: ${error.message}`);

  const rows = (
    (data ?? []) as Array<{
      id: string;
      declaration_type: 'absence' | 'travel';
      status: string;
      start_date: string;
      end_date: string;
      evidence_path: string | null;
      evidence_url: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    declarationType: row.declaration_type,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    hasEvidence: row.evidence_path != null || row.evidence_url != null,
  }));
  if (rows.length === 0) return null;

  return rows.find((r) => r.declarationType === 'absence') ?? rows[0];
}

/**
 * Put the certificate on a filing that is already there.
 *
 * ⚠ `with_medical` MOVES IN THE SAME STATEMENT, and the reason is
 * `student_declarations_medical_needs_evidence_chk`: for an absence, saying
 * `with_medical` is true obliges the row to carry evidence. Read the other
 * way round — which is how this row got here — a filing with no evidence is
 * necessarily `with_medical = false`, because the constraint forbids the other
 * combination from ever existing. So attaching proof and flipping the column
 * are one act, not two, and splitting them would leave the row either refused
 * by the database or silently claiming there is no certificate when there is.
 *
 * ⚠ THE EVIDENCE CONDITION IS IN THE WHERE CLAUSE, not checked beforehand and
 * trusted. Two people can be holding the same certificate — the parent
 * uploading it in the portal while the office scans the paper copy — and the
 * loser of that race must not overwrite the winner by accident. Zero rows back
 * is that race, and the caller says so plainly.
 *
 * ⚠ `replace` INVERTS THAT CONDITION RATHER THAN DROPPING IT. Mr Ace,
 * 2026-08-31: re-uploading in the SIS "will override it but theres a warning".
 * So the first attempt arrives WITHOUT `replace`, is declined because the day
 * already has proof, and that decline is what the screen turns into the
 * warning. Only the attempt a person made after reading it carries `replace`,
 * and that one asserts evidence is STILL there — it is a replacement, so
 * finding an empty row means the thing being replaced went away and the user
 * should look again rather than have this land silently.
 *
 * ⚠ WHAT IT DOES NOT PROTECT, stated rather than implied: two members of staff
 * replacing at the same moment. Both passed a warning, both meant it, and the
 * later write wins. Distinguishing "the certificate I was warned about" from
 * "a different one that replaced it a second ago" needs a version token
 * carried out to the browser and back; that is not built, and the failure it
 * would prevent is two colleagues racing over one child's certificate.
 *
 * ⚠ THE REPLACED FILE IS NOT DELETED FROM STORAGE. Overwriting the column
 * orphans the previous object in the `parent-portal` bucket, and that is the
 * intended trade: losing a child's medical certificate because somebody
 * replaced it is worse than an unreferenced file sitting in a bucket. Nothing
 * in the UI points at it afterwards.
 *
 * ⚠ IT DOES NOT TOUCH `status`, THE LADDER, OR THE REGISTER. A pending filing
 * stays pending and still needs deciding; an approved one already wrote its
 * marks. This only changes the proof attached to the day.
 */
export async function attachEvidenceToFiling(
  service: SupabaseClient,
  args: {
    filingId: string;
    evidencePath: string | null;
    evidenceUrl: string | null;
    /** Overwrite proof that is already on the filing. See the note above. */
    replace?: boolean;
  }
): Promise<
  | { attached: true; status: string; startDate: string; endDate: string }
  | { attached: false }
> {
  const base = service
    .from('student_declarations')
    .update({
      with_medical: true,
      evidence_path: args.evidencePath,
      evidence_url: args.evidenceUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.filingId);

  // Replacing asserts proof is STILL there; a first attach asserts there is
  // none. Either way the condition travels with the UPDATE rather than being
  // read first and believed — see the notes above.
  const guarded = args.replace
    ? base.or('evidence_path.not.is.null,evidence_url.not.is.null')
    : base.is('evidence_path', null).is('evidence_url', null);

  const { data, error } = await guarded.select(
    'id, status, start_date, end_date'
  );
  if (error)
    throw new Error(`attaching the certificate failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    status: string;
    start_date: string;
    end_date: string;
  }>;
  if (rows.length === 0) return { attached: false };
  return {
    attached: true,
    status: rows[0].status,
    startDate: rows[0].start_date,
    endDate: rows[0].end_date,
  };
}

/**
 * What a member of staff reads when the day already has its proof.
 *
 * ⚠ WORDED FOR THE OFFICE, NOT FOR A PARENT. `alreadyFiledMessage` in
 * `filing-window.ts` tells a parent to ring the school; saying that to the
 * school is absurd. And it never names a constraint, a table or a status
 * code — a school admin is not IT.
 */
export function certificateAlreadyOnFileMessage(
  studentName: string,
  existing: { startDate: string; endDate: string }
): string {
  return `${studentName} already has a certificate on file for ${formatRange(existing)}. Nothing was changed.`;
}

/**
 * What they read when the only thing covering those days is a family holiday.
 *
 * ⚠ A travel filing carries no certificate and cannot be made to —
 * `student_declarations_type_shape_chk` forbids evidence on one outright. So
 * this is not a rule the code invented to be tidy; it is the shape of the
 * record, and the likeliest cause of seeing this message is the wrong dates.
 */
export function travelFilingBlocksCertificateMessage(
  studentName: string,
  existing: { startDate: string; endDate: string }
): string {
  return `${studentName} is recorded as away on a family holiday for ${formatRange(existing)}. A medical certificate cannot be added to a holiday — please check the dates.`;
}

/** `2 Sep 2026`, or `2–4 Sep 2026`. */
function formatRange(range: { startDate: string; endDate: string }): string {
  return formatDayRange(range.startDate, range.endDate);
}
