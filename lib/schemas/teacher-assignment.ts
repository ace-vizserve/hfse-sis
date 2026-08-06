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
