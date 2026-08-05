// ──────────────────────────────────────────────────────────────────────────
// Who belongs in a document-chase lens.
//
// The four chase targets are mounted on two surfaces with opposite
// populations: /admissions chases NOT-YET-enrolled funnel applicants,
// /records + /p-files chase ENROLLED students.
//
// This predicate is the SINGLE definition, imported by both the counts
// (`lib/sis/document-chase-queue.ts`) and the drill rows
// (`lib/sis/drill.ts`). It used to be two mirrored code blocks kept in step
// by a comment; KD #124 requires the count to equal the drill, so one
// function is the only way to guarantee it rather than hope for it.
//
// No lens → no scope, for back-compat with lens-less callers.
// ──────────────────────────────────────────────────────────────────────────

export type ChaseQueueLens = 'admissions' | 'p-files';

export const ADMISSIONS_FUNNEL_STATUSES = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
] as const;

export const CHASE_ENROLLED_STATUSES = [
  'Enrolled',
  'Enrolled (Conditional)',
] as const;

const ADMISSIONS_FUNNEL_SET: ReadonlySet<string> = new Set(
  ADMISSIONS_FUNNEL_STATUSES
);
const ENROLLED_SET: ReadonlySet<string> = new Set(CHASE_ENROLLED_STATUSES);

/**
 * Is this student inside the given chase lens?
 *
 * `classSection` is accepted but only consulted for the p-files lens, which
 * currently requires one (KD #31/#71).
 */
export function inChaseLensScope(
  lens: ChaseQueueLens | undefined,
  appStatus: string | null | undefined,
  classSection: string | null | undefined
): boolean {
  if (!lens) return true;
  const status = (appStatus ?? '').trim();
  if (lens === 'admissions') return ADMISSIONS_FUNNEL_SET.has(status);
  return (
    ENROLLED_SET.has(status) &&
    (classSection ?? '').toString().trim().length > 0
  );
}
