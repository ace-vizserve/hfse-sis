import type { EnrollmentStatus } from '@/lib/schemas/enrolment';

// Client-safe Evaluation roster/write-up rules module. Single source of
// truth for three predicates that `lib/evaluation/dashboard.ts` (rollup
// KPIs) and `lib/evaluation/drill.ts` (display rows) each need to agree on —
// previously each file independently re-derived all three inline, which is
// exactly the silent-drift vector KD #124's "count == drill" principle warns
// against:
//
//   1. T4 exclusion — no FCA write-up ever exists for Term 4; the final
//      report card has no comment block (KD #49).
//   2. Active-roster gate — only students with `enrollment_status !=
//      'withdrawn'` count (active + late_enrollee both count; only
//      withdrawn is excluded) (KD #120).
//   3. "Submitted" derivation — `submitted = true` AND non-empty content
//      after trim; a submitted-but-emptied write-up must read as NOT
//      submitted everywhere (dashboard KPI, drill status, chase worklist)
//      (KD #120).
//
// Runtime-pure: only `import type` for anything server-side (the
// EnrollmentStatus union from lib/schemas/enrolment.ts, itself a zod-only,
// client-safe module), no 'server-only' import, no Supabase client of any
// kind — safe to import from a 'use client' component. Modeled on
// lib/markbook/drill-filter.ts, the equivalent extraction for Markbook.

// ---------------------------------------------------------------------------
// 1. T4 exclusion (KD #49)

/** Term 4 never carries an FCA write-up — the final report card has no
 *  comment block. Every write-up term query/derivation excludes it. */
export const FCA_EXCLUDED_TERM_NUMBER = 4;

export function isFcaEligibleTermNumber(termNumber: number): boolean {
  return termNumber !== FCA_EXCLUDED_TERM_NUMBER;
}

// ---------------------------------------------------------------------------
// 2. Active-roster gate (KD #120)

/** The one `enrollment_status` value that excludes a student from the
 *  active roster for write-up purposes. `late_enrollee` still counts (still
 *  owes a write-up); only `withdrawn` is excluded. */
export const WITHDRAWN_ENROLLMENT_STATUS: EnrollmentStatus = 'withdrawn';

export function isActiveRosterStatus(
  status: string | EnrollmentStatus
): boolean {
  return status !== WITHDRAWN_ENROLLMENT_STATUS;
}

// ---------------------------------------------------------------------------
// 3. Submitted + non-empty derivation (KD #120)

/** Non-empty after trim — an all-whitespace write-up doesn't count as
 *  content. */
export function hasWriteupContent(writeup: string | null | undefined): boolean {
  return !!writeup && writeup.trim().length > 0;
}

/** KD #120: "submitted" requires the submitted flag AND non-empty content —
 *  a submitted-but-emptied write-up must read as not-submitted everywhere
 *  (dashboard KPI numerator, drill row status, chase worklist). Callers that
 *  only have the raw writeup text on hand should derive `hasContent` via
 *  `hasWriteupContent` first. */
export function isSubmittedWriteup(params: {
  submitted: boolean;
  hasContent: boolean;
}): boolean {
  return params.submitted && params.hasContent;
}
