import { z } from 'zod';

import {
  DECLARATION_MAX_RANGE_DAYS,
  DECLARATION_URL_MAX,
  inclusiveDayCount,
  shiftIsoDays,
} from '@/lib/schemas/declarations';

// The school's own side of the Student Absence and Travel Declaration:
// a member of staff attaching a medical certificate the parent did not file.
//
// Mr Ace asked for this twice, in the same words both times — staff must be
// able to attach a certificate themselves "if the parent wasn't able to".
// A paper MC handed in at the office is the commonest case in the school
// today, and until now it ended in Mr Hanafi's drawer with nothing on the day.
//
// ⚠ THIS IS A SEPARATE SCHEMA FROM THE PARENT'S, DELIBERATELY.
// `lib/schemas/declarations.ts` says at the top that every message in it is
// read by a PARENT, through a different application, so it must assume no
// knowledge of the school's own vocabulary. These messages are read by a
// teacher or the office, on the attendance sheet, about a child whose register
// they are already marking. Sharing one schema would force one set of wording
// to serve both audiences and the parent's would be the one that suffered.
//
// What IS shared is the arithmetic — the range cap and the day counter come
// from the parent module, because a 60-day typo guard that disagreed between
// the two would let a filing exist that one half of the feature calls illegal.

/**
 * How far back the office may reach.
 *
 * ⚠ DELIBERATELY MUCH WIDER THAN THE PARENT'S 30 DAYS, and that is the point
 * of the setting rather than an oversight. The parent's 30-day message ends
 * "Please contact the school office instead" — this route IS that office, so
 * imposing the same limit here would close the escape hatch the other message
 * points at. A year still refuses the typo the cap exists for: a `2026` typed
 * as `2016` fails, while a certificate handed in three months late does not.
 */
export const STAFF_DECLARATION_MAX_BACKDATE_DAYS = 365;

/** How far ahead. Same guard, same reason — a mistyped year, not a policy. */
export const STAFF_DECLARATION_MAX_FUTURE_DAYS = 365;

/**
 * `https://` and something after it. Same rule as the parent's link, and for
 * the stronger of its two reasons: without a scheme check, `javascript:` or
 * `data:` reaches an `href`. Singapore's digital MCs are `https://mc.gov.sg/…`,
 * so nothing legitimate is turned away.
 *
 * ⚠ The host is NOT checked. `mc.gov.sg` is the common case and not the only
 * one — a clinic's own portal, a hospital discharge summary, a link the parent
 * forwarded — and a hostname allowlist would refuse real certificates while
 * stopping nothing, since the server never fetches the link.
 */
const HTTPS_URL = /^https:\/\/\S+$/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (label: string) =>
  z
    .string()
    .regex(ISO_DATE, `Choose a ${label}.`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
      message: `That ${label} is not a real date.`,
    });

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One child, one date range, one certificate.
 *
 * ⚠ NO STUDENT LIST, unlike the parent's form. The parent picks several
 * children because siblings catch the same thing and they are filing one
 * message about their family. Staff are standing on ONE class's attendance
 * sheet looking at ONE cell, and the certificate in their hand names one
 * child. A multi-child shape here would be a picker nobody asked for on a
 * screen that already knows the answer.
 *
 * ⚠ `sectionStudentId`, not `studentNumber`. Both attendance surfaces already
 * hold the enrolment id — it is what the register itself is keyed on — and it
 * resolves the class and the academic year in one read. The parent endpoints
 * take `studentNumber` because a portal has no idea what an enrolment is.
 *
 * ⚠ NO NOTE FIELD, and that is a decision rather than an omission. The only
 * free-text column on the row is `parent_note`, which every staff screen
 * renders as *the parent's message*; staff text stored there would be read
 * back as words the family never wrote. A note about how a certificate reached
 * the office belongs on the register mark's own `ex_note`, which the marking
 * path already carries.
 *
 * ⚠ ABSENCE ONLY, ALWAYS WITH A CERTIFICATE. The ask is specifically the
 * certificate the parent could not file. Staff recording an absence with
 * nothing attached is what marking the day `EX` already is, and travel is a
 * request a family makes rather than evidence anybody hands in.
 */
const StaffMedicalCertificateShape = z.strictObject({
  sectionStudentId: z
    .string()
    .trim()
    .regex(UUID_RE, 'Choose a student from the class list.'),
  startDate: isoDate('first day'),
  endDate: isoDate('last day'),
  /** Object path returned by the staff evidence upload endpoint. Never a URL. */
  evidencePath: z.string().trim().min(1).max(500).optional(),
  evidenceUrl: z
    .string()
    .trim()
    .max(DECLARATION_URL_MAX, 'That link is too long.')
    .regex(HTTPS_URL, 'That does not look like a web link.')
    .optional(),
  /**
   * Replace a certificate that is ALREADY on the day.
   *
   * ⚠ OPT-IN, AND IT DEFAULTS TO ABSENT SO REPLACING CANNOT HAPPEN BY
   * ACCIDENT. Mr Ace, 2026-08-31: re-uploading in the SIS "will override it
   * but theres a warning". The warning is the whole point, so the two steps
   * are modelled as two different requests: the first arrives WITHOUT this
   * flag, is declined, and that decline is how the screen learns it has
   * something to warn about. Only the second — sent after a person read the
   * warning and agreed — carries it.
   *
   * A single request that overwrote whatever it found would make the warning
   * decorative: any caller that skipped the UI, or any retry, would replace a
   * child's medical certificate silently.
   */
  replaceExisting: z.boolean().optional(),
});

/**
 * Built per request because the backdate and lookahead rules need today's date
 * in Singapore — a module-level schema would freeze whatever day the server
 * happened to start.
 */
export function staffMedicalCertificateSchema(todayIso: string) {
  return StaffMedicalCertificateShape.superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'The last day cannot be before the first day.',
      });
      return;
    }

    const days = inclusiveDayCount(value.startDate, value.endDate);
    if (days > DECLARATION_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `That covers ${days} days. Record up to ${DECLARATION_MAX_RANGE_DAYS} days at a time — check the year on both dates.`,
      });
    }

    if (
      value.startDate <
      shiftIsoDays(todayIso, -STAFF_DECLARATION_MAX_BACKDATE_DAYS)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'That date is more than a year ago — check the year.',
      });
    }

    if (
      value.startDate >
      shiftIsoDays(todayIso, STAFF_DECLARATION_MAX_FUTURE_DAYS)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'That date is too far ahead — check the year.',
      });
    }

    // Mirrors `student_declarations_medical_needs_evidence_chk`. Without this
    // the row is refused by the database with a constraint name nobody outside
    // the code can read; with it, the person is told what to attach.
    if (!value.evidencePath && !value.evidenceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidencePath'],
        message:
          'Attach the medical certificate, or paste a link to it, before saving.',
      });
    }
  });
}

export type StaffMedicalCertificateInput = z.infer<
  ReturnType<typeof staffMedicalCertificateSchema>
>;
