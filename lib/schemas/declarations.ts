import { z } from 'zod';

// Student Absence and Travel Declaration — action item #6, reshaped 2026-08-17
// so the PARENT files it rather than the form class adviser.
//
// ⚠ EVERY MESSAGE HERE IS READ BY A PARENT, not by staff and not by a
// developer. They arrive through the admissions portal, which is a different
// application, so a message that assumes any knowledge of the SIS is useless to
// them. No field names, no "invalid", no jargon.

export const DECLARATION_TYPE_VALUES = ['absence', 'travel'] as const;
export type DeclarationType = (typeof DECLARATION_TYPE_VALUES)[number];

export const DECLARATION_TYPE_LABELS: Record<DeclarationType, string> = {
  absence: 'Absence',
  travel: 'Travel',
};

export const DECLARATION_STATUS_VALUES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUS_VALUES)[number];

/**
 * What the parent sees while they wait. "With the school" rather than
 * "pending", because pending reads as *stuck* to somebody watching a form they
 * filed about their sick child.
 */
export const DECLARATION_STATUS_LABELS: Record<DeclarationStatus, string> = {
  pending: 'With the school',
  approved: 'Approved',
  rejected: 'Not approved',
  cancelled: 'Withdrawn',
};

export const DECLARATION_NOTE_MAX = 300; // matches attendance_daily.ex_note
export const DECLARATION_URL_MAX = 2048;
export const DECLARATION_COUNTRY_MAX = 80;
export const DECLARATION_CITY_MAX = 80;

/**
 * The longest range a single declaration may cover.
 *
 * This is a guard against a typo, not a policy: a mistyped year turns one week
 * into a range that expands into thousands of register rows on approval. Sixty
 * days comfortably clears the longest real absence anyone has described (a term
 * is roughly twelve weeks) while a `2027` typed as `2037` still fails.
 */
export const DECLARATION_MAX_RANGE_DAYS = 60;

/** How many children one submission may cover. HFSE's largest family is far below this. */
export const DECLARATION_MAX_STUDENTS = 10;

/** How far back a parent may file. Beyond this the register is history, not news. */
export const DECLARATION_MAX_BACKDATE_DAYS = 30;

/** How far ahead. Travel gets planned; a year is generous and still refuses a typo'd year. */
export const DECLARATION_MAX_FUTURE_DAYS = 365;

/**
 * `https://` and something after it.
 *
 * ⚠ **`https` only**, unlike the discipline record's link — which accepts
 * `http` because a member of staff pasting an internal SharePoint path is a
 * different risk from a link to a child's medical certificate arriving over the
 * open internet.
 *
 * The scheme check is the security-relevant half either way: without it,
 * `javascript:` or `data:` reaches an `href`. Nothing renders this without the
 * anchor also carrying `rel="noopener noreferrer"`, and the server never
 * fetches it.
 */
const HTTPS_URL = /^https:\/\/\S+$/i;

/**
 * `YYYY-MM-DD`.
 *
 * Compared as strings throughout, never parsed into a `Date`. Building a Date
 * from a bare date drags the caller's timezone into a question that has nothing
 * to do with time of day — the same slip that once moved the relief cover board
 * a whole month (`Date.UTC` takes a zero-indexed month). Every comparison below
 * is lexicographic, which is exact for this format.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isoDate = (label: string) =>
  z
    .string()
    .regex(ISO_DATE, `Choose a ${label}.`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
      message: `That ${label} is not a real date.`,
    });

/** Whole days between two `YYYY-MM-DD` strings, both ends counted. */
export function inclusiveDayCount(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** `todayIso` shifted by whole days, still as `YYYY-MM-DD`. */
export function shiftIsoDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * ⚠ `studentNumber`, never a uuid. Hard Rule #4 — it is the only stable student
 * id — and it is also what the parent→student linkage function returns, so
 * checking a submitted student against the parent's own children is direct set
 * membership with no intermediate lookup to get wrong.
 */
const studentNumbers = z
  .array(z.string().trim().min(1).max(40))
  .min(1, 'Choose at least one child.')
  .max(
    DECLARATION_MAX_STUDENTS,
    `You can include up to ${DECLARATION_MAX_STUDENTS} children at a time.`
  )
  .refine((v) => new Set(v).size === v.length, {
    message: 'The same child is listed more than once.',
  });

const sharedFields = {
  studentNumbers,
  startDate: isoDate('start date'),
  endDate: isoDate('end date'),
  parentNote: z
    .string()
    .trim()
    .max(
      DECLARATION_NOTE_MAX,
      `Keep the note under ${DECLARATION_NOTE_MAX} characters.`
    )
    .optional(),
};

// ⚠ BOTH SHAPES ARE STRICT, and that is for the portal team's benefit rather
// than ours. Zod drops unknown keys silently by default, so a travel filing
// that carried `withMedical` would validate, lose the field, and behave in a
// way nobody could explain from the response. The portal is a separate
// application built by a separate team against this contract; the mistake they
// are most likely to make is sending one type's fields on the other type, and
// an explicit error names it on the spot. The route would have been safe either
// way — it builds each column from `declarationType` — but "safe" and
// "debuggable from the other side of an API" are different things.
const AbsenceSchema = z.strictObject({
  declarationType: z.literal('absence'),
  ...sharedFields,
  withMedical: z.boolean({
    error: 'Say whether you have a medical certificate.',
  }),
  /** Object path returned by the evidence upload endpoint. Never a URL. */
  evidencePath: z.string().trim().min(1).max(500).optional(),
  evidenceUrl: z
    .string()
    .trim()
    .max(DECLARATION_URL_MAX, 'That link is too long.')
    .regex(HTTPS_URL, 'That does not look like a web link.')
    .optional(),
});

const TravelSchema = z.strictObject({
  declarationType: z.literal('travel'),
  ...sharedFields,
  destinationCountry: z
    .string()
    .trim()
    .min(1, 'Enter the country.')
    .max(DECLARATION_COUNTRY_MAX, 'That country name is too long.'),
  destinationCity: z
    .string()
    .trim()
    .max(DECLARATION_CITY_MAX, 'That city name is too long.')
    .optional(),
});

/**
 * Cross-field rules, applied to both shapes.
 *
 * `todayIso` is passed in rather than read here so the caller supplies
 * `sgToday()` — Singapore's day, not the server's. A route computing this from
 * `new Date()` would reject a legitimate filing made late in the evening.
 */
export function refineDeclarationDates(
  value: { startDate: string; endDate: string },
  ctx: z.RefinementCtx,
  todayIso: string
): void {
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
      message: `That covers ${days} days. Please file up to ${DECLARATION_MAX_RANGE_DAYS} days at a time — check the year on both dates.`,
    });
  }

  if (
    value.startDate < shiftIsoDays(todayIso, -DECLARATION_MAX_BACKDATE_DAYS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: `That is more than ${DECLARATION_MAX_BACKDATE_DAYS} days ago. Please contact the school office instead.`,
    });
  }

  if (value.startDate > shiftIsoDays(todayIso, DECLARATION_MAX_FUTURE_DAYS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'That date is too far ahead — check the year.',
    });
  }
}

/**
 * The parent's submission.
 *
 * Built per-request because the date rules need today's date in Singapore, and
 * a module-level schema would freeze whatever day the server started.
 */
export function fileDeclarationSchema(todayIso: string) {
  return z
    .discriminatedUnion('declarationType', [AbsenceSchema, TravelSchema])
    .superRefine((value, ctx) => {
      refineDeclarationDates(value, ctx, todayIso);

      // Saying a certificate exists and attaching nothing leaves the person who
      // has to decide it with nothing to look at. Mirrors
      // `student_declarations_medical_needs_evidence_chk`.
      if (
        value.declarationType === 'absence' &&
        value.withMedical &&
        !value.evidencePath &&
        !value.evidenceUrl
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['evidencePath'],
          message:
            'Attach the medical certificate, or paste a link to it, or choose "without medical certificate".',
        });
      }
    });
}

export type FileDeclarationInput = z.infer<
  ReturnType<typeof fileDeclarationSchema>
>;

/** Query for the parent's own list. Everything optional — the default is "all mine". */
export const ListDeclarationsQuerySchema = z.object({
  studentNumber: z.string().trim().min(1).max(40).optional(),
  status: z.enum(DECLARATION_STATUS_VALUES).optional(),
});
export type ListDeclarationsQuery = z.infer<typeof ListDeclarationsQuerySchema>;
