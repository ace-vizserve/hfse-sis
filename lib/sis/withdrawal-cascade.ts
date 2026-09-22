import { z } from 'zod';

import { isEmptyRichText, proseLength } from '@/lib/rich-text';
import {
  WITHDRAWAL_REASON_MAX,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import {
  APPLICATION_TERMINAL_REASON_LABELS,
  type ApplicationTerminalReason,
} from '@/lib/schemas/sis';

// ──────────────────────────────────────────────────────────────────────────
// Withdrawing a student from their class BECAUSE the admissions application
// was marked Withdrawn or Cancelled.
//
// The class-side withdrawal (PATCH /api/sections/[id]/students/[enrolmentId])
// collects the two dates the school keeps (migration 163). The admissions
// stage route cascades to the same `section_students` rows, and until
// 2026-09-17 it stamped `withdrawal_date = sgToday()` there instead — the
// exact invented date 163 removed from the class route, still arriving through
// the side door. These helpers are what both halves of that path share, so the
// stage dialog and the stage route cannot disagree about what is required.
// ──────────────────────────────────────────────────────────────────────────

/** A `yyyy-MM-dd` date, or null / absent for "not known". */
const optionalDate = z
  .union([z.string().date(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/**
 * The two withdrawal dates as the stage route reads them off the raw request
 * body. Kept OUT of `StageUpdateSchema` on purpose: that schema describes a
 * stage's own columns, and these are written to the class roster instead.
 */
export const StageWithdrawalDatesSchema = z.object({
  withdrawal_date: optionalDate,
  withdrawal_approved_date: optionalDate,
});

export type StageWithdrawalDates = z.infer<typeof StageWithdrawalDatesSchema>;

/**
 * The admissions application's reason list and the class roster's reason list
 * are different lists, written for different moments. Where they name the same
 * thing the roster value is used; where the roster list has no counterpart
 * ("visa denied", "lost interest") the roster records `other`, and
 * `buildCascadeWithdrawalNotes` keeps the admissions wording in the notes so
 * nothing the office chose is lost.
 */
export function mapTerminalReasonToWithdrawalReason(
  reason: string | null | undefined
): WithdrawalReason | null {
  switch (reason) {
    case 'chose_another_school':
      return 'transferred_other_school';
    case 'financial':
      return 'financial';
    case 'family_relocation':
      return 'family_relocation';
    case 'health':
      return 'health';
    case 'visa_denied':
    case 'lost_interest':
    case 'other':
      return 'other';
    default:
      return null;
  }
}

/**
 * Notes for the roster row. When the reason had to fall back to `other`, the
 * admissions label leads, so the roster still says WHY — and the roster's own
 * rule that `other` carries a note is met.
 */
//
// ⚠ THE RESULT MUST PASS THE ROSTER'S OWN NOTES RULE, `optionalRichText(200)`.
// The enrolment sheet re-sends `withdrawal_notes` on every later save, so a
// value this helper writes that the schema would refuse makes that child's
// sheet reject every edit afterwards — a bus number included. Hence: the notes
// are rich text, so "empty" is `isEmptyRichText` (an untouched editor holds
// `<p></p>`), the label goes in its own paragraph rather than being glued in
// front of markup, and when label + notes would pass the 200-character cap the
// office's own words are kept and the label dropped — the reason label is
// still on the admissions record and in the audit row.
export function buildCascadeWithdrawalNotes(
  reason: string | null | undefined,
  notes: string | null | undefined
): string | null {
  const body = isEmptyRichText(notes) ? null : notes!.trim();
  const mapped = mapTerminalReasonToWithdrawalReason(reason);
  if (mapped === 'other' && reason && reason !== 'other') {
    const label =
      APPLICATION_TERMINAL_REASON_LABELS[reason as ApplicationTerminalReason] ??
      reason;
    const labelParagraph = `<p>${escapeHtml(label)}</p>`;
    if (!body) return labelParagraph;
    const bodyHtml = body.startsWith('<') ? body : `<p>${escapeHtml(body)}</p>`;
    const combined = `${labelParagraph}${bodyHtml}`;
    return proseLength(combined) <= WITHDRAWAL_REASON_MAX ? combined : body;
  }
  return body;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The patch written to each class row the cascade withdraws.
 *
 * `withdrawal_date` is the LAST DAY OF ATTENDANCE as the registrar entered it.
 * Never today: the caller refuses the save before reaching here when a class
 * row exists and no last day was given (see `withdrawalDateRequiredError`).
 */
export function buildCascadeSectionPatch(args: {
  dates: StageWithdrawalDates;
  terminalReason: string | null | undefined;
  terminalNotes: string | null | undefined;
}): {
  enrollment_status: 'withdrawn';
  withdrawal_date: string | null;
  withdrawal_approved_date: string | null;
  withdrawal_reason: WithdrawalReason | null;
  withdrawal_notes: string | null;
} {
  return {
    enrollment_status: 'withdrawn',
    withdrawal_date: args.dates.withdrawal_date,
    withdrawal_approved_date: args.dates.withdrawal_approved_date,
    withdrawal_reason: mapTerminalReasonToWithdrawalReason(args.terminalReason),
    withdrawal_notes: buildCascadeWithdrawalNotes(
      args.terminalReason,
      args.terminalNotes
    ),
  };
}

/**
 * Null when the save may go ahead; otherwise the refusal.
 *
 * A last day is needed only when the cascade will take a child out of a class
 * AND that child has actually been marked present or absent at some point — an
 * applicant who never got a seat has no last day, and asking for one would
 * push the registrar to type a made-up date.
 *
 * ⚠ HAVING A CLASS ROW IS NOT THE SAME AS HAVING ATTENDED, and that was this
 * gate's original mistake. Mr Ace, 2026-09-22: withdrawing a student whose
 * application still read "Submitted" demanded "the last day they actually
 * attended" — "this doesnt make sense bruh". Measured: all 15 AY2026 students
 * who trip this gate are in YS Youngstarters, and that section holds **zero**
 * attendance marks while every other section holds 1,000–4,400. So the date
 * was being demanded from precisely the cohort that cannot answer it. See
 * `scripts/probe-youngstarters-attendance.ts`.
 *
 * `hasAttendance` therefore gates the gate. It only ever RELAXES the rule —
 * a student with marks is refused exactly as before — so no withdrawal that
 * used to record a real last day can now skip it.
 *
 * ⚠ A NULL `withdrawal_date` IS A PERMITTED END STATE, not a hole to fill
 * later: Mr Ace, 2026-09-15, on Jannat Ajmal — "no record." The consequence
 * is already known and accepted: the Records Withdrawals count keys on the
 * date, so a student withdrawn without one never appears in it.
 */
export function withdrawalDateRequiredError(args: {
  activeClassRows: number;
  hasAttendance: boolean;
  dates: StageWithdrawalDates;
}): { error: string; code: 'withdrawal_date_required' } | null {
  if (args.activeClassRows === 0) return null;
  if (!args.hasAttendance) return null;
  if (args.dates.withdrawal_date) return null;
  return {
    code: 'withdrawal_date_required',
    error:
      'This student is in a class and has attendance on record. Enter their last day at school before withdrawing them.',
  };
}
