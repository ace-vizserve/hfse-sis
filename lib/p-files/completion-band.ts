/**
 * How complete one student's (or applicant's) document file is, as a band.
 *
 * The inputs are the `total` / `complete` pair every completeness row already
 * carries, so the band means exactly what the percentage beside it means:
 *
 *   - `total` counts only the slots that APPLY to this child — a Current
 *     student is not held to the five New-student school forms (KD #219).
 *   - `complete` counts only `valid` slots — approved and not expired. A file
 *     a parent has sent that nobody has reviewed yet is not done.
 *
 * Mr Ace set the cut-offs (2026-09-25): 100% is complete, 80% and above is
 * nearly complete. The threshold is a fraction of the file, not a count, so a
 * New student with more slots can be two or three documents short and still
 * read as nearly complete — accepted, this is a monitoring lens.
 *
 * A child with nothing applicable (`total === 0`) has no band: "0 of 0" is
 * neither complete nor anything else, and calling it complete would let an
 * empty row pass as a finished file.
 */
export type CompletionBand = 'complete' | 'nearly-complete' | 'incomplete';

export const NEARLY_COMPLETE_THRESHOLD = 0.8;

export function completionBand(
  total: number,
  complete: number
): CompletionBand | null {
  if (total <= 0) return null;
  if (complete >= total) return 'complete';
  if (complete / total >= NEARLY_COMPLETE_THRESHOLD) return 'nearly-complete';
  return 'incomplete';
}
