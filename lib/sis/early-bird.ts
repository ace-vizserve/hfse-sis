// Pure single-select rule for the early-bird AY (KD #77).
// Invariant: at most one upcoming (non-current) AY may accept applications.
// See docs/superpowers/specs/2026-06-02-early-bird-admissions-flow-design.md.

export type AyFlagRow = {
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
};

// Given the AY being opened for early-bird (accepting=true) and the full AY
// list, return the ay_codes of the OTHER non-current AYs that are currently
// accepting and must be closed to keep at most one upcoming AY open.
//
// Returns [] when the target is the current AY (the current AY is never part
// of the single-select pool), when the target is unknown, or when no other
// upcoming AY is open.
export function computeEarlyBirdClosures(
  targetAyCode: string,
  allAys: AyFlagRow[]
): string[] {
  const target = allAys.find((a) => a.ay_code === targetAyCode);
  if (!target || target.is_current) return [];
  return allAys
    .filter(
      (a) =>
        a.ay_code !== targetAyCode && !a.is_current && a.accepting_applications
    )
    .map((a) => a.ay_code);
}
