import { z } from 'zod';
import { optionalText } from '@/lib/schemas/enrolment';

// Why a teacher was taken off a class.
//
// Required only once the academic year is underway — a removal during initial
// setup or AY rollover is just staffing, not a change worth explaining. That
// gate is `hasTermStarted` (lib/sis/current-term.ts), and it is enforced in the
// DELETE route rather than here, because required-ness depends on the section's
// academic year and a schema can't see that. Same split as `lateRevertReason`
// in lib/schemas/enrolment.ts.
//
// Shape mirrors WITHDRAWAL_REASON_* deliberately: a small closed list plus a
// notes field, so the audit log stays filterable instead of turning into prose.

export const ASSIGNMENT_CHANGE_REASON_VALUES = [
  'resigned',
  'on_leave',
  'workload_rebalance',
  'performance',
  'class_restructured',
  'other',
] as const;
export type AssignmentChangeReason =
  (typeof ASSIGNMENT_CHANGE_REASON_VALUES)[number];

export const ASSIGNMENT_CHANGE_REASON_LABELS: Record<
  AssignmentChangeReason,
  string
> = {
  resigned: 'Teacher resigned / left HFSE',
  on_leave: 'On leave — cover needed',
  workload_rebalance: 'Workload rebalanced',
  performance: 'Performance / parent concern',
  class_restructured: 'Class restructured or merged',
  other: 'Other',
};

export const ASSIGNMENT_CHANGE_NOTES_MAX = 200;

// Plain-English names for the two assignment roles. The raw values are database
// words; nothing a school admin reads should show them.
export const ASSIGNMENT_ROLE_LABELS: Record<
  'form_adviser' | 'subject_teacher',
  string
> = {
  form_adviser: 'Form class adviser',
  subject_teacher: 'Subject teacher',
};

// Body of DELETE /api/teacher-assignments/[id]. Every field is optional here;
// the route decides whether a reason was actually required.
export const AssignmentRemovalSchema = z
  .object({
    change_reason: z
      .enum(ASSIGNMENT_CHANGE_REASON_VALUES)
      .nullable()
      .optional(),
    change_notes: optionalText(ASSIGNMENT_CHANGE_NOTES_MAX).optional(),
  })
  .superRefine((data, ctx) => {
    // 'Other' explains nothing on its own, so it carries its own requirement
    // regardless of the term gate.
    if (data.change_reason === 'other' && !data.change_notes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['change_notes'],
        message: 'Add a short note explaining the change.',
      });
    }
  });

export type AssignmentRemoval = z.infer<typeof AssignmentRemovalSchema>;

// ---------------------------------------------------------------------------
// Creating assignments — POST /api/teacher-assignments
// ---------------------------------------------------------------------------

// Zod's default message for a missing field is "Invalid input: expected string,
// received undefined" — developer words that would reach a school admin
// unedited. Passing `error` sets ONE message for every way the field can fail:
// absent, wrong type, or not a uuid. Setting it only on `.uuid()` (the obvious
// spelling) leaves the missing-field case reporting the default, which is the
// case a half-filled form actually hits.
const requiredId = (message: string) =>
  z.string({ error: message }).uuid(message);

// ---------------------------------------------------------------------------
// Relief teachers — PATCH /api/teacher-assignments/[id]
// ---------------------------------------------------------------------------

/**
 * Body of the cover switch: a teacher's id to put them on cover, or null to
 * take them off.
 *
 * `null` is a real value here, not an omission — clearing cover is half of what
 * this endpoint does. So the key is required and the value is nullable, which
 * makes "end the cover" explicit rather than something an empty body could do
 * by accident.
 *
 * No reason and no notes — the audit log records who changed it and when.
 *
 * DATES ARE OPTIONAL, and both nulls are meaningful (migration 123):
 *   start null → live from whenever it was set (the original one-step flow);
 *   end   null → open-ended, "until she is back".
 * Omitting the keys entirely is also fine, which is what keeps every caller
 * written before 123 working unchanged.
 */
const optionalReliefDate = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), {
    message: 'Use YYYY-MM-DD',
  })
  .nullable()
  .optional();

export const AssignmentReliefSchema = z
  .object({
    relief_teacher_user_id: z
      .string({ error: 'Choose a teacher to cover this class.' })
      .uuid('Choose a teacher to cover this class.')
      .nullable(),
    relief_started_on: optionalReliefDate,
    relief_ended_on: optionalReliefDate,
  })
  .superRefine((val, ctx) => {
    // Mirrors `teacher_assignments_relief_dates_ordered` (migration 123). Said
    // here too so the answer arrives as a sentence rather than a constraint
    // name, and before anything is written.
    if (
      val.relief_started_on &&
      val.relief_ended_on &&
      val.relief_ended_on < val.relief_started_on
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relief_ended_on'],
        message: 'The last day cannot be before the first day.',
      });
    }

    // Ending a cover clears it outright. Leaving a window behind on a class
    // nobody is covering would sit in the table waiting to mean something.
    if (
      val.relief_teacher_user_id === null &&
      (val.relief_started_on || val.relief_ended_on)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relief_teacher_user_id'],
        message: 'Removing the relief teacher clears its dates too.',
      });
    }
  });

export type AssignmentRelief = z.infer<typeof AssignmentReliefSchema>;

/**
 * One substitute across EVERY class a teacher holds — the Cover page's booking
 * form (POST /api/relief/book).
 *
 * Deliberately does not take a list of classes. The caller names the absent
 * teacher and the route works out which classes that means, so the page cannot
 * send a stale set after somebody edited the timetable in another tab.
 */
export const ReliefBookingSchema = z
  .object({
    covered_teacher_user_id: z
      .string({ error: 'Choose the teacher who is away.' })
      .uuid('Choose the teacher who is away.'),
    // Nullable for the same reason the per-class PATCH is: `null` ENDS the
    // cover on every class that teacher holds. "She is back early" is one
    // decision about one absence, so it should not be N trips through N rows.
    relief_teacher_user_id: z
      .string({ error: 'Choose a teacher to cover.' })
      .uuid('Choose a teacher to cover.')
      .nullable(),
    relief_started_on: optionalReliefDate,
    relief_ended_on: optionalReliefDate,
  })
  .superRefine((val, ctx) => {
    if (
      val.relief_started_on &&
      val.relief_ended_on &&
      val.relief_ended_on < val.relief_started_on
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relief_ended_on'],
        message: 'The last day cannot be before the first day.',
      });
    }
  });

export type ReliefBooking = z.infer<typeof ReliefBookingSchema>;

/**
 * One teacher against one class — the shape both the single and the bulk body
 * are made of.
 *
 * The two role rules below are database constraints as well
 * (`teacher_assignments_role_subject_shape`, migration 003). They are restated
 * here so the answer arrives as a sentence a school admin can act on instead of
 * a constraint name, and — for a batch — before anything is written.
 */
const AssignmentRowShape = z.object(
  {
    teacher_user_id: requiredId('Choose a teacher for this class.'),
    section_id: requiredId('Choose a class.'),
    // Absent and null both mean "no subject" — a form class adviser advises the
    // whole class, not one subject. The section Teachers tab sends an explicit
    // null for advisers, the staff sheet omits the key; both are correct.
    subject_id: z
      .string({ error: 'Choose a subject for this class.' })
      .uuid('Choose a subject for this class.')
      .nullish(),
    role: z.enum(['form_adviser', 'subject_teacher'], {
      message:
        'Choose whether this is the form class adviser or a subject teacher.',
    }),
  },
  // The fields above all carry their own wording, but the OBJECT did not — so a
  // hole in the grid's array (`assignments: [ {...}, null ]`, which is what a
  // row removed from the UI without being spliced out looks like) answered
  // "Invalid input: expected object, received null". Same reasoning as
  // `requiredId`, one level up.
  { error: 'One of the lines is blank. Remove it and try again.' }
);

// Applied to the row schema in both bodies, rather than written twice — the
// two copies would drift, and a rule that holds for a single add but not for a
// batch is exactly the kind of gap a bulk save is supposed to close.
const withRoleShapeRules = (schema: typeof AssignmentRowShape) =>
  schema.superRefine((row, ctx) => {
    if (row.role === 'form_adviser' && row.subject_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject_id'],
        message:
          'A form class adviser covers the whole class, so leave the subject blank.',
      });
    }
    if (row.role === 'subject_teacher' && !row.subject_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subject_id'],
        message: 'Choose which subject this teacher takes.',
      });
    }
  });

/**
 * Body of POST /api/teacher-assignments when adding ONE assignment.
 *
 * Kept because it is what the section Teachers tab and the per-teacher staff
 * sheet already send, and because "add one subject teacher to this class" is a
 * real thing staff do all year — not only at set-up time.
 */
export const AssignmentCreateSchema = withRoleShapeRules(AssignmentRowShape);

export type AssignmentCreate = z.infer<typeof AssignmentCreateSchema>;

/**
 * Body of POST /api/teacher-assignments when staffing many classes at once —
 * the reason this endpoint exists in bulk form. A year is about 200
 * assignments; one HTTP request each is the bottleneck.
 *
 * Every row carries its own four fields, with nothing hoisted to the batch.
 * Each row IS its own decision — this teacher, this class, this subject — so
 * there is nothing true of the whole batch worth hoisting out of it.
 */
/**
 * The most assignments one save may carry.
 *
 * A whole school's staffing is about 200 rows (26 teachers, ~147 assignments in
 * the year being set up now), so 500 is more than twice the largest real save
 * and refuses nothing a school would ever send. It exists because the array had
 * no upper bound at all: a 5,000-row body was accepted, and everything the
 * route does per row afterwards — the duplicate scan, the audit rows — is work
 * the caller could ask for without limit.
 */
export const ASSIGNMENT_BULK_MAX = 500;

export const AssignmentBulkCreateSchema = z
  .object({
    assignments: z
      .array(withRoleShapeRules(AssignmentRowShape), {
        // Without this, `{"assignments": null}` answers "Invalid input:
        // expected array, received null".
        error: 'No classes arrived to staff. Refresh the page and try again.',
      })
      .min(1, 'Choose at least one class to staff.')
      .max(
        ASSIGNMENT_BULK_MAX,
        `That is more than ${ASSIGNMENT_BULK_MAX} assignments in one save. Save them in smaller batches.`
      ),
  })
  .superRefine((data, ctx) => {
    // Both checks below have a unique index behind them (003 for the adviser,
    // 118 for the subject). Left
    // to the database, a duplicate inside one batch would fail the whole insert
    // with an index name in the message — and because the insert is
    // all-or-nothing, the admin would lose 200 rows of work to a message that
    // does not say which two lines clashed.
    const advisedSections = new Set<string>();
    const subjectSlots = new Set<string>();

    for (const row of data.assignments) {
      if (row.role === 'form_adviser') {
        if (advisedSections.has(row.section_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['assignments'],
            message:
              'Two form class advisers are listed for the same class. A class can have only one.',
          });
          return;
        }
        advisedSections.add(row.section_id);
        continue;
      }

      // Keyed on the CLASS and SUBJECT, not on the teacher. One subject in one
      // class has one teacher — the exact counterpart of the adviser rule
      // above, and what migration 003's header always said the rule was even
      // though its index only ever caught the same teacher listed twice.
      //
      // The reason it is the class and subject: a grading sheet resolves its
      // teacher live from this table (KD #158) and has room for one name. Two
      // rows leave "whose mark sheet is this" answered by row order.
      const slot = `${row.section_id}|${row.subject_id}`;
      if (subjectSlots.has(slot)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['assignments'],
          message:
            'Two teachers are listed for the same subject in the same class. A subject can have only one.',
        });
        return;
      }
      subjectSlots.add(slot);
    }
  });

export type AssignmentBulkCreate = z.infer<typeof AssignmentBulkCreateSchema>;
