// Is a subject-weights save a genuine no-op?
//
// Extracted from PATCH /api/sis/admin/subjects/[configId] so the one subtle
// rule here is testable in isolation, because getting it wrong is silent in
// both directions:
//
//   • Too loose (treat a real change as unchanged) → the save is dropped and
//     the registrar's edit vanishes with an "ok" response.
//   • Too strict (treat a no-op as a change) → re-saving identical weights
//     re-stamps updated_at on EVERY unlocked grading sheet tied to the config
//     and writes an audit row whose before/after blocks are identical.
//     audit_log is append-only (Hard Rule #6), so that row is permanent.
//
// THE SUBTLETY: `weights_confirmed` must be part of the comparison.
//
// The route sets it `true` unconditionally on every save, deliberately — an
// explicit save means an admin reviewed the numbers, which clears migration
// 082's "needs attention" flag on the GP/COMP/ARTD/PESTD stand-in rows. So a
// save where the six numeric fields are identical but `weights_confirmed` is
// still false is NOT a no-op: it is exactly the flag-clearing save, and
// dropping it would break the "fix the flagged row → the flag clears" loop.
//
// Weights are stored as decimals (0.40) and submitted as percentages (40).

export type SubjectConfigBefore = {
  ww_weight: number | string;
  pt_weight: number | string;
  qa_weight: number | string;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
  weights_confirmed: boolean | null;
  /**
   * The per-year name (migration 137). Part of the row the route selects, and
   * DELIBERATELY not read by subjectConfigUnchanged below — see the sibling
   * subjectDisplayNameUnchanged for why the two verdicts stay apart.
   */
  display_name?: string | null;
};

export type SubjectConfigSubmission = {
  /** Percentage, e.g. 40 for a stored 0.40. */
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

/**
 * Do the six numbers match, ignoring `weights_confirmed` entirely?
 *
 * Split out of subjectConfigUnchanged so the route can ask the narrower
 * question a rename needs: "would this save move anything a grading sheet
 * stores?". A flagged row (weights_confirmed false) answers `true` here and
 * `false` from subjectConfigUnchanged, and both answers are right for their own
 * question — the sheets need nothing, the flag still does.
 *
 * ⚠ Do not use this as the no-op guard. On its own it would drop migration
 * 085's flag-clearing save.
 */
export function subjectNumbersIdentical(
  before: SubjectConfigBefore,
  next: SubjectConfigSubmission
): boolean {
  return (
    Number(before.ww_weight) === next.ww_weight / 100 &&
    Number(before.pt_weight) === next.pt_weight / 100 &&
    Number(before.qa_weight) === next.qa_weight / 100 &&
    before.ww_max_slots === next.ww_max_slots &&
    before.pt_max_slots === next.pt_max_slots &&
    before.qa_max === next.qa_max
  );
}

export function subjectConfigUnchanged(
  before: SubjectConfigBefore,
  next: SubjectConfigSubmission
): boolean {
  return (
    subjectNumbersIdentical(before, next) &&
    // Not optional — see the header. `false` here means the save still has work
    // to do even when every number matches.
    before.weights_confirmed === true
  );
}

// ── The per-year name (migration 137) ────────────────────────────────────────
//
// A SIBLING of the function above, never a seventh field inside it, because the
// two halves have different consequences and the route acts on them
// differently: a weights or slot change has to resync and recompute every
// unlocked grading sheet, while a rename changes words on a screen and nothing
// else. Folding the name in would make a rename-only save drag the whole sheet
// sync behind it, re-stamping updated_at on every sheet for a change no sheet
// stores.
//
// `next === undefined` means the caller never sent the field — "don't touch",
// not "clear it" — so it can never be a change. See the comment on
// SubjectConfigUpdateSchema.display_name for why that distinction survives to
// here instead of being normalised away by a zod transform.
//
// The route hands us the ALREADY-NORMALISED value (blank -> null), so `null`
// here means exactly one thing: clear the override and fall back to the
// catalogue name.

export function subjectDisplayNameUnchanged(
  before: { display_name?: string | null },
  next: string | null | undefined
): boolean {
  if (next === undefined) return true;
  return (before.display_name ?? null) === next;
}
