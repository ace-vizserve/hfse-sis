import { composeFullName } from '@/lib/sis/full-name';

/**
 * Who an admissions audit row is about.
 *
 * An enrolee number resets every academic year (Hard Rule #4), so a row that
 * carries only `enroleeNumber` + `ay_code` cannot be followed across years and
 * reads as a bare code on the audit log. Every admissions write that touches a
 * single student stamps these three keys instead.
 *
 * The keys are camelCase on purpose: `lib/audit/humanize.ts` already knows
 * `studentName` (shown as the student) and suppresses the paired numbers once a
 * name is present, so rows written with them render as a person without any
 * renderer change.
 *
 * The name is composed from the name parts first — those are what the class
 * lists sync from (see lib/sis/full-name.ts) — and falls back to the stored
 * `enroleeFullName` only when the parts are all blank.
 */

/** The application columns this helper reads — select these on the row. */
export const APPLICANT_IDENTITY_COLUMNS =
  'enroleeNumber, studentNumber, enroleeFullName, firstName, middleName, lastName';

export type ApplicantIdentityRow = {
  enroleeNumber?: string | null;
  studentNumber?: string | null;
  enroleeFullName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
};

export type ApplicantAuditIdentity = {
  enroleeNumber: string;
  studentNumber: string | null;
  studentName: string | null;
};

export function applicantAuditIdentity(
  enroleeNumber: string,
  row: ApplicantIdentityRow | null | undefined
): ApplicantAuditIdentity {
  const composed = composeFullName({
    firstName: row?.firstName,
    middleName: row?.middleName,
    lastName: row?.lastName,
  });
  const fallback = row?.enroleeFullName?.trim() ?? '';
  const studentNumber = row?.studentNumber?.trim() ?? '';
  return {
    enroleeNumber,
    studentNumber: studentNumber || null,
    studentName: composed || fallback || null,
  };
}
