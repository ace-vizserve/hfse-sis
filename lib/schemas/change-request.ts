import { z } from 'zod';

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
// whenever field is ww_scores or pt_scores.
export const ChangeRequestFormSchema = z
  .object({
    grading_sheet_id: z.string().uuid('Missing grading sheet'),
    grade_entry_id: z.string().uuid('Pick a student'),
    field_changed: z.enum(CHANGE_REQUEST_FIELDS, {
      message: 'Pick a field',
    }),
    slot_index: z.number().int().min(0).max(4).nullable(),
    current_value: z.string().nullable(),
    proposed_value: z
      .string()
      .trim()
      .min(1, 'Proposed value is required'),
    reason_category: z.enum(REASON_CATEGORIES, {
      message: 'Pick a reason',
    }),
    justification: z
      .string()
      .trim()
      .min(20, 'Please explain in at least 20 characters')
      .max(2000, 'Justification is too long'),
  })
  .refine(
    (data) =>
      (data.field_changed === 'ww_scores' || data.field_changed === 'pt_scores')
        ? data.slot_index !== null
        : data.slot_index === null,
    {
      message:
        'Slot index is required for WW/PT fields and must be empty otherwise',
      path: ['slot_index'],
    },
  );

export type ChangeRequestFormInput = z.infer<typeof ChangeRequestFormSchema>;

// State-transition payload for admin / teacher actions on an existing request.
export const ChangeRequestActionSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'cancel']),
    decision_note: z.string().trim().max(1000).optional(),
  })
  .refine(
    (data) =>
      data.action !== 'reject' ||
      (typeof data.decision_note === 'string' && data.decision_note.length > 0),
    {
      message: 'A decision note is required when rejecting a request',
      path: ['decision_note'],
    },
  );

export type ChangeRequestActionInput = z.infer<typeof ChangeRequestActionSchema>;

// Data-entry correction payload used by Path B on locked-sheet writes.
export const CorrectionReasonSchema = z.object({
  correction_reason: z.enum(CORRECTION_REASONS),
  correction_justification: z
    .string()
    .trim()
    .min(20, 'Please explain in at least 20 characters')
    .max(2000),
});

export type CorrectionReasonInput = z.infer<typeof CorrectionReasonSchema>;
