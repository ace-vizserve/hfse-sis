import { z } from 'zod';

import { isEmptyRichText, proseLength } from '@/lib/rich-text';

export const CHANGE_REQUEST_FIELDS = [
  'ww_scores',
  'pt_scores',
  'qa_score',
  'letter_grade',
  'is_na',
] as const;
export type ChangeRequestField = (typeof CHANGE_REQUEST_FIELDS)[number];

export const REASON_CATEGORIES = [
  'regrading',
  'data_entry_error',
  'late_submission',
  'academic_appeal',
  'other',
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export const REASON_CATEGORY_LABELS: Record<ReasonCategory, string> = {
  regrading: 'Regrading',
  data_entry_error: 'Data entry error',
  late_submission: 'Late submission',
  academic_appeal: 'Academic appeal',
  other: 'Other',
};

export const CORRECTION_REASONS = [
  'typo',
  'wrong_column',
  'formula_fix',
  'other',
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export const CORRECTION_REASON_LABELS: Record<CorrectionReason, string> = {
  typo: 'Typo / mis-keyed score',
  wrong_column: 'Wrong column / swapped fields',
  formula_fix: 'Formula or config fix',
  other: 'Other data integrity fix',
};

// Form payload for teachers filing a new request. slot_index is required
// whenever field is ww_scores or pt_scores. primary/secondary approvers
// must be distinct and neither can be the requesting teacher — the API
// route re-validates these invariants + that both IDs are in the
// `approver_assignments` list for `markbook.change_request`.
export const ChangeRequestFormSchema = z
  .object({
    grading_sheet_id: z.string().uuid('Missing grading sheet'),
    grade_entry_id: z.string().uuid('Pick a student'),
    field_changed: z.enum(CHANGE_REQUEST_FIELDS, {
      message: 'Pick a field',
    }),
    slot_index: z.number().int().min(0).max(4).nullable(),
    current_value: z.string().nullable(),
    proposed_value: z.string().trim().min(1, 'Proposed value is required'),
    reason_category: z.enum(REASON_CATEGORIES, {
      message: 'Pick a reason',
    }),
    // BOTH ENDS MEASURE THE EXPLANATION, NOT THE MARKUP. The box is a
    // formatting editor, so an empty one already stores seven characters and a
    // single bolded word clears twenty without explaining anything. The floor
    // exists to stop "typo" being filed as a reason, so it has to count the
    // words. (`change_requests.justification` also carries a database CHECK of
    // 20 raw characters — left as it is; it can only ever be laxer than this.)
    justification: z
      .string()
      .trim()
      .refine((value) => proseLength(value) >= 20, {
        message: 'Please explain in at least 20 characters',
      })
      .refine((value) => proseLength(value) <= 2000, {
        message: 'Justification is too long',
      }),
    primary_approver_id: z.string().uuid('Pick a primary approver'),
    secondary_approver_id: z.string().uuid('Pick a secondary approver'),
  })
  .refine(
    (data) =>
      data.field_changed === 'ww_scores' || data.field_changed === 'pt_scores'
        ? data.slot_index !== null
        : data.slot_index === null,
    {
      message:
        'Slot index is required for WW/PT fields and must be empty otherwise',
      path: ['slot_index'],
    }
  )
  .refine((data) => data.primary_approver_id !== data.secondary_approver_id, {
    message: 'Primary and secondary approvers must be different people',
    path: ['secondary_approver_id'],
  });

export type ChangeRequestFormInput = z.infer<typeof ChangeRequestFormSchema>;

// State-transition payload for admin / teacher actions on an existing request.
export const ChangeRequestActionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'cancel', 'undo_rejection']),
    // The approver's own words, counted as words — see `justification` above.
    decision_note: z
      .string()
      .trim()
      .refine((value) => proseLength(value) <= 1000, {
        message: 'Keep the decision note under 1,000 characters.',
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.action !== 'reject' ||
      (typeof data.decision_note === 'string' &&
        // An editor opened and left alone is not a reason for a rejection,
        // however many characters `<p></p>` happens to be.
        !isEmptyRichText(data.decision_note)),
    {
      message: 'A decision note is required when rejecting a request',
      path: ['decision_note'],
    }
  );

export type ChangeRequestActionInput = z.infer<
  typeof ChangeRequestActionSchema
>;
