import { z } from 'zod';
import { optionalText } from '@/lib/schemas/enrolment';

// Why cover was arranged for a class.
//
// Deliberately a SEPARATE list from ASSIGNMENT_CHANGE_REASON_VALUES in
// lib/schemas/teacher-assignment.ts, even though the two overlap on `on_leave`.
// That list explains why a teacher was TAKEN OFF a class — a permanent change,
// where "resigned" and "performance" belong. This one explains why someone is
// standing in while the regular teacher is still the holder of record, where
// those two would be nonsense. Sharing one enum would have offered the school
// admin "Teacher resigned" as a reason for temporary cover.
//
// Small and closed, the same shape as the withdrawal and removal reasons, so
// the audit trail stays filterable instead of turning into prose.
export const RELIEF_REASON_VALUES = [
  'on_leave',
  'medical',
  'training',
  'other',
] as const;
export type ReliefReason = (typeof RELIEF_REASON_VALUES)[number];

export const RELIEF_REASON_LABELS: Record<ReliefReason, string> = {
  on_leave: 'On leave',
  medical: 'Medical leave',
  training: 'Away on training',
  other: 'Other',
};

export const RELIEF_NOTES_MAX = 200;

// Zod's default message for a missing field is "Invalid input: expected string,
// received undefined" — developer words that would reach a school admin
// unedited. Passing `error` sets ONE message for every way the field can fail:
// absent, wrong type, or not a uuid. Setting it only on `.uuid()` (the obvious
// spelling) leaves the missing-field case reporting the default, which is the
// case a half-filled form actually hits.
const requiredId = (message: string) =>
  z.string({ error: message }).uuid(message);

const calendarDate = (message: string) =>
  z.string({ error: message }).regex(/^\d{4}-\d{2}-\d{2}$/, message);

// Body of POST /api/assignment-reliefs.
//
// `started_on` is optional: cover almost always starts today, and making the
// admin pick a date to confirm "today" is ceremony. The route defaults it, and
// the column defaults it again.
export const ReliefCreateSchema = z
  .object({
    assignment_id: requiredId('Choose a class to arrange cover for.'),
    relief_teacher_user_id: requiredId(
      'Choose the teacher who will be covering.'
    ),
    started_on: calendarDate(
      'Enter the start date as a calendar date.'
    ).optional(),
    reason: z.enum(RELIEF_REASON_VALUES, {
      message: 'Choose why cover is needed.',
    }),
    notes: optionalText(RELIEF_NOTES_MAX).optional(),
  })
  .superRefine((data, ctx) => {
    // 'Other' explains nothing on its own — same rule the removal dialog
    // applies (lib/schemas/teacher-assignment.ts).
    if (data.reason === 'other' && !data.notes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Add a short note explaining why cover is needed.',
      });
    }
  });

export type ReliefCreate = z.infer<typeof ReliefCreateSchema>;

// Body of POST /api/assignment-reliefs when arranging cover for a whole
// teacher at once — the morning-someone-called-in-sick flow.
//
// One reason and one start date for the batch, then a substitute per class.
// That shape is the flow: the school decides "Ms Koh is on leave from today"
// once, and then works down her five classes deciding who takes each. Asking
// for the reason five times would be ceremony, and letting the five disagree
// would produce a record nobody could read back.
//
// Classes nobody is covering are simply left out of `covers` rather than sent
// with a null teacher — "not covered" is the absence of an arrangement, not an
// arrangement with nobody in it.
export const ReliefBulkCreateSchema = z
  .object({
    reason: z.enum(RELIEF_REASON_VALUES, {
      message: 'Choose why cover is needed.',
    }),
    started_on: calendarDate(
      'Enter the start date as a calendar date.'
    ).optional(),
    notes: optionalText(RELIEF_NOTES_MAX).optional(),
    covers: z
      .array(
        z.object({
          assignment_id: requiredId('Choose a class to arrange cover for.'),
          relief_teacher_user_id: requiredId(
            'Choose the teacher who will be covering.'
          ),
        })
      )
      .min(1, 'Choose at least one class for someone to cover.'),
  })
  .superRefine((data, ctx) => {
    if (data.reason === 'other' && !data.notes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Add a short note explaining why cover is needed.',
      });
    }
    // The same class twice in one submission would race its own unique index
    // and fail with a database message instead of a readable one.
    const seen = new Set<string>();
    for (const c of data.covers) {
      if (seen.has(c.assignment_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['covers'],
          message: 'A class appears twice. Choose one teacher per class.',
        });
        return;
      }
      seen.add(c.assignment_id);
    }
  });

export type ReliefBulkCreate = z.infer<typeof ReliefBulkCreateSchema>;

// Body of PATCH /api/assignment-reliefs/[id]/end.
//
// Ending cover is a fact worth keeping, not a row to delete, so this is a PATCH
// to a dedicated endpoint rather than a DELETE. `ended_on` is optional for the
// same reason `started_on` is — the teacher is normally back today. The route
// rejects an end date earlier than the start; the database check constraint
// backs that up.
export const ReliefEndSchema = z.object({
  ended_on: calendarDate('Enter the end date as a calendar date.').optional(),
});

export type ReliefEnd = z.infer<typeof ReliefEndSchema>;
