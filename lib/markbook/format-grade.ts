// How a grade figure is written down. One copy, imported everywhere.
//
// ⚠ THIS EXISTS BECAUSE THE SAME DEFECT SHIPPED TWICE. Component percentages
// are genuine fractions — 110 out of 120 is 91.666… — so anything that prints
// one raw puts `−40.833299999999994` on screen beside a child's name. The
// grading sheet's lookup had a private `fmt` that handled it; the Classroom
// at-risk panel, written later, used `String(n)` and did not. Two surfaces
// showing the same number two different ways is the bug, so the rule now lives
// in one file and neither surface owns a copy.
//
// Anything that renders a grade, a component percentage or a change in one
// MUST come through here.

/** One decimal, and no trailing `.0`. `91.666…` → `91.7`, `78` → `78`. */
export function fmtGrade(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * A change, with its direction. `+4.5`, `−13`, `0`.
 *
 * Uses a real minus sign (U+2212), not a hyphen: it aligns with digits in a
 * tabular-nums column, where a hyphen does not.
 */
export function signedGrade(n: number): string {
  const v = fmtGrade(Math.abs(n));
  return n > 0 ? `+${v}` : n < 0 ? `−${v}` : '0';
}
