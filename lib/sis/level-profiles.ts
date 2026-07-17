// Single source for the canonical WW/PT/QA weight defaults per level type
// (Hard Rule #4 / KD #4 — never hardcode these elsewhere). Primary =
// 40/40/20, Secondary = 30/50/20. Preschool has no examinable grading
// profile (no WW/PT/QA sheets), so it — and any unrecognised level type —
// resolves to null via `weightProfileFor`.
//
// Pure module, no imports beyond types, safe to use from server code,
// client components, and seeders alike.

export type WeightFractions = { ww: number; pt: number; qa: number };

export const LEVEL_WEIGHT_PROFILES: Record<
  'primary' | 'secondary',
  WeightFractions
> = {
  primary: { ww: 0.4, pt: 0.4, qa: 0.2 },
  secondary: { ww: 0.3, pt: 0.5, qa: 0.2 },
};

// Resolves a level type string to its canonical weight fractions.
// Any value other than 'primary'/'secondary' returns null (no profile).
export function weightProfileFor(
  levelType: string | null | undefined
): WeightFractions | null {
  if (levelType === 'primary' || levelType === 'secondary') {
    return LEVEL_WEIGHT_PROFILES[levelType];
  }
  return null;
}
