// KD #104 — Non-examinable grading letter-display converter.
// A/B/C/IP are derived from the numeric Quarterly. UG/E are manual
// override codes stored in grade_entries.letter_grade. NA is the is_na flag.
// Self-test runs at module load; any boundary regression throws immediately.

export type DerivedLetter = 'A' | 'B' | 'C' | 'IP';
export type OverrideLetter = 'UG' | 'E';
export type NonExaminableLetter = DerivedLetter | OverrideLetter | 'NA';

export const OVERRIDE_LETTERS: readonly OverrideLetter[] = ['UG', 'E'] as const;

// Allowlist guard for the per-term override codes. A/B/C/IP are never stored
// (always derived), so the only valid stored letter_grade values are UG and E.
export function isOverrideLetter(value: string): value is OverrideLetter {
  return (OVERRIDE_LETTERS as readonly string[]).includes(value);
}

// Annual Final Grade values for non-examinable subjects (KD #100).
// 'Passed' is the standard year-end value; UG/E/NA are override codes.
export const ANNUAL_LETTER_VALUES = ['Passed', 'UG', 'E', 'NA'] as const;
export type AnnualLetterGrade = (typeof ANNUAL_LETTER_VALUES)[number];

export const LEGEND_LEFT = [
  {
    code: 'A',
    desc: 'Fully demonstrated the skills required',
    range: '90–100',
  },
  { code: 'B', desc: 'Demonstrated some skills required', range: '85–89' },
  { code: 'C', desc: 'Fairly demonstrated the skill required', range: '80–84' },
  {
    code: 'IP',
    desc: 'In Progress',
    range: '79 and below',
  },
] as const;

export const LEGEND_RIGHT = [
  { code: 'NA', desc: 'Not Applicable' },
  { code: 'UG', desc: 'Ungraded' },
  { code: 'E', desc: 'Exempted' },
] as const;

export function numericToLetter(quarterly: number): DerivedLetter {
  if (quarterly >= 90) return 'A';
  if (quarterly >= 85) return 'B';
  if (quarterly >= 80) return 'C';
  return 'IP';
}

// Annual final letter for non-examinable: same T1×0.20+T2×0.20+T3×0.20+T4×0.40
// formula as examinable annual grade, but N/A terms are excluded and the
// remaining weights are re-scaled to 1.0.  Returns null when no term has data.
export function deriveAnnualLetterForNonExam(
  cells: Array<{ quarterly: number | null; isNa: boolean }>
): DerivedLetter | null {
  const WEIGHTS = [0.2, 0.2, 0.2, 0.4]; // T1, T2, T3, T4
  const available = cells
    .slice(0, 4)
    .map((c, i) => ({ q: c.quarterly, w: WEIGHTS[i], na: c.isNa }))
    .filter((c) => !c.na && c.q != null) as {
    q: number;
    w: number;
    na: boolean;
  }[];
  if (available.length === 0) return null;
  const totalWeight = available.reduce((s, c) => s + c.w, 0);
  const weightedSum = available.reduce((s, c) => s + c.q * c.w, 0);
  return numericToLetter(weightedSum / totalWeight);
}

// Precedence: is_na → letter_grade override → derived from quarterly → null.
export function resolveNonExaminableLetter({
  isNa,
  letterOverride,
  quarterly,
}: {
  isNa: boolean;
  letterOverride: string | null;
  quarterly: number | null;
}): NonExaminableLetter | null {
  if (isNa) return 'NA';
  if (letterOverride != null) return letterOverride as OverrideLetter;
  if (quarterly != null) return numericToLetter(quarterly);
  return null;
}

// Self-test — mirrors the Hard Rule #1 pattern in lib/compute/quarterly.ts.
(function selfTest() {
  const cases: Array<[number, DerivedLetter]> = [
    [100, 'A'],
    [90, 'A'],
    [89, 'B'],
    [85, 'B'],
    [84, 'C'],
    [80, 'C'],
    [79, 'IP'],
    [0, 'IP'],
  ];
  for (const [q, expected] of cases) {
    const actual = numericToLetter(q);
    if (actual !== expected) {
      throw new Error(
        `[letter-grade] self-test failed: numericToLetter(${q}) = "${actual}", expected "${expected}"`
      );
    }
  }
})();
