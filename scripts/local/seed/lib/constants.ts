// Fixed anchors for the LOCAL seeder. Every value the seeder GENERATES is
// anchored here or on a seeded RNG, never the wall clock, so it is the same
// whether rebuilt today or in a month. NOT covered: columns the database fills
// from its own defaults — audit_log `id` / `created_at` (and `entity_id`
// where it is a default uuid), other tables' `created_at` / `updated_at`
// stamps — which `logAction` and the app's writers cannot set. Those differ
// on every rebuild; the verify fingerprints leave them out.
//
// ⚠ THE ONE EXCEPTION: DATES TAKEN FROM THE REAL RUN DATE. A cover that is
// "live today" or "starts next week" has to be dated from the day the seeder
// actually runs, or the relief panels are empty on every other day. So:
//   * teachers.ts `runRelativeCoverWindows` — the live cover (the clean
//     three-school-day window containing the run date) and the scheduled
//     cover (the first clean window a week or more out, if any), both from
//     `runDateSg()` and AY2026's school_calendar;
//   * the app's own grade-change approval stamps the run date into the
//     request's approval reference ("… approved by x 2026-10-07") — the
//     markbook phase's change requests are decided through the real
//     `decideApproval`, which reads the clock;
//   * AY2026's daily registers (phases/attendance.ts) are taken up to the
//     run date (capped at Term 4's end), because the app's attendance pages
//     read `sgToday()` and show every earlier school day with no mark as
//     owed. The year is still DRAWN in full and the leave that must be over
//     quota is placed by TODAY, so only the registers after TODAY (and those
//     taken late after TODAY) depend on the run date.
//   * the P-Files promise's `promisedUntil` (phases/pfiles.ts): the promise
//     route refuses a date outside the 90 days after the REAL date, so it is
//     the run date + 30 days — masked as `promised_until` in the
//     `pfile.mark.promised` audit context (RUN_DATE_AUDIT_MASK) and left out
//     of verify-pfiles-houses.ts's outreach fingerprint.
//   * the parent portal's saved drafts (phases/portal-drafts.ts): a draft
//     expires 30 days after its last save, so the saves are dated from the
//     run date; verify-pfiles-houses.ts fingerprints their spacing (and the
//     form state without its `createdAt` copy), never the dates.
// Those values, and only those, are left out of the verify fingerprints —
// by column and key, never by searching for the date string (the run date can
// equal TODAY, and TODAY-anchored values must still count): the cover rows
// that carry a reason (live + scheduled) in verify-teachers.ts, the same
// covers' `assignment.relief.start` dates and every approval reference's
// trailing date in verify.ts's audit_log fingerprint (RUN_DATE_AUDIT_MASK),
// the approval reference in verify-markbook.ts, and the register (class, day)
// keys of `runDependentRegisterKeys` — their attendance_daily rows and audit
// rows, in the counts, audit_log and attendance fingerprints — plus AY2026
// Term 4's rollups in the attendance fingerprint. Two rebuilds on DIFFERENT
// days still print the same fingerprints.

/** "Today" for every generated date. AY2026 Term 4 in progress. */
export const TODAY = '2026-10-07';

/** Every seeded login (staff and, later, parents) uses this domain. */
export const LOCAL_EMAIL_DOMAIN = 'local.test';

/**
 * How a seeded PARENT login is marked (app_metadata). A parent's account must
 * carry the address on the admissions record — that is the parent→child link
 * the app checks — so it cannot be told apart by LOCAL_EMAIL_DOMAIN; the wipe
 * removes accounts with this mark as well.
 */
export const LOCAL_PARENT_MARK = {
  key: 'local_seed',
  value: 'parent',
} as const;

/** Password for every seeded account. Local stack only. */
export const LOCAL_PASSWORD = 'localdev123';

/** The real run date in Singapore (the app's calendar day). The exception above. */
export function runDateSg(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

/**
 * SQL expression over `audit_log` (alias-free: `action`, `context`) giving
 * the context with the run-relative values above removed — used in place of
 * `context` by every audit_log fingerprint. Removes: the dates of a cover
 * that carries a reason (only the live and scheduled ones do), a P-Files
 * promise's `promised_until`, and the date
 * at the end of any "Request #… approved by … YYYY-MM-DD" approval reference.
 */
export const RUN_DATE_AUDIT_MASK = `(
  case when action = 'assignment.relief.start' and coalesce(context->>'relief_reason', '') <> ''
       then context - 'relief_started_on' - 'relief_ended_on'
       when action = 'pfile.mark.promised' then context - 'promised_until'
       else context end)::text`;

/** Strips the trailing approval date, for a SQL text expression `expr`. */
export const maskApprovalDate = (expr: string) =>
  `regexp_replace(${expr}, '(approved by [^ "]+) [0-9]{4}-[0-9]{2}-[0-9]{2}', '\\1 <run-date>', 'g')`;
