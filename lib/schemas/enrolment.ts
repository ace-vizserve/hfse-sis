import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullable();

export const ENROLLMENT_STATUS_VALUES = [
  'active',
  'late_enrollee',
  'withdrawn',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUS_VALUES)[number];

export const WITHDRAWAL_REASON_VALUES = [
  'transferred_other_school',
  'family_relocation',
  'financial',
  'disciplinary',
  'health',
  'academic_fit',
  'other',
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASON_VALUES)[number];

export const WITHDRAWAL_REASON_LABELS: Record<WithdrawalReason, string> = {
  transferred_other_school: 'Transferred to another school',
  family_relocation: 'Family relocating',
  financial: 'Financial / non-payment',
  disciplinary: 'Disciplinary',
  health: 'Health / medical',
  academic_fit: 'Academic fit / parent decision',
  other: 'Other',
};

// Notes field cap (kept at 200 for backwards compat with existing audit rows).
export const WITHDRAWAL_REASON_MAX = 200;

export const EnrolmentMetadataSchema = z
  .object({
    // `.optional()` so partial PATCHes (e.g. the late-enrollee term override or
    // the mid-term prompt, which send only their own field) validate. The route
    // only writes these when present (`'bus_no' in parsed.data`), so omitting
    // them leaves the stored values untouched.
    bus_no: optionalText(40).optional(),
    classroom_officer_role: optionalText(80).optional(),
    enrollment_status: z.enum(ENROLLMENT_STATUS_VALUES).optional(),
    // Structured withdrawal reason — required on the → withdrawn boundary.
    withdrawal_reason: z.enum(WITHDRAWAL_REASON_VALUES).nullable().optional(),
    // Freetext notes (replaces the old unstructured `reason` field).
    withdrawal_notes: optionalText(WITHDRAWAL_REASON_MAX).optional(),
    // Explicit late-enrollee term override (null = derive from enrollment_date).
    late_enrollee_term_number: z
      .number()
      .int()
      .min(1)
      .max(4)
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.enrollment_status === 'withdrawn' && !data.withdrawal_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withdrawal_reason'],
        message: 'Reason is required when withdrawing a student.',
      });
    }
    if (data.withdrawal_reason === 'other' && !data.withdrawal_notes?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['withdrawal_notes'],
        message: 'Notes are required when reason is "Other".',
      });
    }
  });

export type EnrolmentMetadataInput = z.infer<typeof EnrolmentMetadataSchema>;

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  active: 'Active',
  late_enrollee: 'Late enrollee',
  withdrawn: 'Withdrawn',
};
