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

/**
 * The statuses that mean "this student is currently on the roster".
 *
 * THIS EXISTS BECAUSE THE ENUM CONFLATES TWO THINGS. `enrollment_status`
 * answers both "is this student enrolled?" (active vs withdrawn) and "did they
 * join after the year started?" (late_enrollee) in one column — but a late
 * enrollee IS an active student. "Late" is a property of their tenure, and
 * `enrollment_date` is what actually carries it (which is why KD #146 can flip
 * the label back to `active` with byte-identical attendance rollups).
 *
 * So every "is this student active?" query has to remember that "active" has
 * two spellings, and forgetting is silent — the query just returns fewer
 * students. It has already been forgotten repeatedly: KD #126 found a
 * submission KPI using `.eq('active')` while its own drill used
 * `.neq('withdrawn')`, and the section capacity check counted only `active`, so
 * late enrollees didn't count toward the 50-student cap (Hard Rule #5) — 13 of
 * 21 AY2026 sections were mis-counted when that was found.
 *
 * Use these instead of an inline `['active', 'late_enrollee']`, of which the
 * codebase had five copies plus a module-private Set.
 *
 * Prefer `ENROLLED_STATUSES` for a PostgREST `.in(...)` filter, and
 * `isEnrolledStatus` for in-memory checks. `.neq('withdrawn')` is equivalent
 * today and appears throughout; it stays correct only while `withdrawn` is the
 * single non-enrolled status, so new code should state what it wants.
 *
 * Deliberately does NOT redefine the withdrawn constant: `lib/evaluation/
 * roster-rules.ts` already exports `WITHDRAWN_ENROLLMENT_STATUS` plus
 * `isActiveRosterStatus` (a `!== withdrawn` formulation), it is tested, and
 * several modules import it. Adding a second definition of the same string
 * while fixing a "too many spellings" problem would be self-defeating. These
 * two are the ALLOWLIST form, which `.in()` filters need and which states the
 * intent positively.
 */
export const ENROLLED_STATUSES = ['active', 'late_enrollee'] as const;

export function isEnrolledStatus(
  status: string | null | undefined
): status is 'active' | 'late_enrollee' {
  return status === 'active' || status === 'late_enrollee';
}

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
    // Audit-only reason captured when a late enrollee is converted back to a
    // normal (active) enrollee. Required-ness is enforced in the route (it
    // depends on the row's current status). optionalText: '' → null.
    lateRevertReason: optionalText(WITHDRAWAL_REASON_MAX).optional(),
    // Free-text notes for the attendance-sheet Details view (migration 093).
    // Per-field write gating lives in the PATCH route, not here:
    // academics_notes -> academic_coordinator | school_admin | superadmin;
    // admin_notes -> school_admin | superadmin only.
    academics_notes: optionalText(200).optional(),
    admin_notes: optionalText(200).optional(),
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
