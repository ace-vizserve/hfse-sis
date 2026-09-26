// HFSE grading formula — DepEd Order No. 8, s. 2015.
// CLAUDE.md hard rule: this module has one job, and it must return 93 for the
// verified test case. If the self-test below fails, stop and fix — do not
// proceed to build features on top of a broken formula.
//
// Spec (docs/context/02-grading-system.md):
//   1. Per component (WW, PT):
//        PS = (Σ scores) / (Σ ALL slot maxes) × 100
//      The denominator is the component's full total, exactly as HFSE's
//      grading workbooks compute it (`G10 = (F10/$F$9)*100`, where row 9 is
//      the fixed max row — checked across all 38 AY2025 workbooks). A blank
//      slot adds nothing to the numerator and its max still counts, so it
//      scores as zero. A component with NO score at all stays null (it
//      contributes 0 to the weighted sum either way).
//   2. QA_PS = qa_score / qa_total × 100 (null if either side is null).
//   3. Initial = WW_PS × ww_weight + PT_PS × pt_weight + QA_PS × qa_weight.
//      Null PS → 0 in the weighted sum. If ALL components are null, Initial
//      itself is null (nothing entered yet).
//   4. Quarterly = floor(60 + 15·init/60)        if init < 60
//                  floor(75 + 25·(init-60)/40)   if init ≥ 60
//      Always floor — never round-to-nearest.

export type ComputeInput = {
  ww_scores: (number | null)[];
  ww_totals: number[];
  pt_scores: (number | null)[];
  pt_totals: number[];
  qa_score: number | null;
  qa_total: number | null;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
};

export type ComputeOutput = {
  ww_ps: number | null;
  pt_ps: number | null;
  qa_ps: number | null;
  initial_grade: number | null;
  quarterly_grade: number | null;
};

function componentPercentage(
  scores: (number | null)[],
  totals: number[]
): number | null {
  let sumScores = 0;
  let sumMax = 0;
  let anyScored = false;
  for (let i = 0; i < totals.length; i++) {
    const max = totals[i];
    if (max == null) continue; // no max configured for this slot
    sumMax += max; // a blank slot's max still counts — the full total
    const s = scores[i];
    if (s == null) continue; // blank slot: nothing added to the numerator
    sumScores += s;
    anyScored = true;
  }
  if (!anyScored || sumMax === 0) return null;
  return (sumScores / sumMax) * 100;
}

function qaPercentage(
  score: number | null,
  total: number | null
): number | null {
  if (score == null || total == null || total === 0) return null;
  return (score / total) * 100;
}

function transmute(initial: number): number {
  if (initial < 60) return Math.floor(60 + (15 * initial) / 60);
  return Math.floor(75 + (25 * (initial - 60)) / 40);
}

export function computeQuarterly(input: ComputeInput): ComputeOutput {
  const ww_ps = componentPercentage(input.ww_scores, input.ww_totals);
  const pt_ps = componentPercentage(input.pt_scores, input.pt_totals);
  const qa_ps = qaPercentage(input.qa_score, input.qa_total);

  if (ww_ps == null && pt_ps == null && qa_ps == null) {
    return {
      ww_ps: null,
      pt_ps: null,
      qa_ps: null,
      initial_grade: null,
      quarterly_grade: null,
    };
  }

  const initial =
    (ww_ps ?? 0) * input.ww_weight +
    (pt_ps ?? 0) * input.pt_weight +
    (qa_ps ?? 0) * input.qa_weight;

  return {
    ww_ps,
    pt_ps,
    qa_ps,
    initial_grade: initial,
    quarterly_grade: transmute(initial),
  };
}

// ---------- Self-test (runs once on module load) ----------
// Hard rule: the known-good input below must return quarterly=93.
// If this throws, DO NOT ship — the formula is wrong.
(function verifyFormula() {
  const out = computeQuarterly({
    ww_scores: [10, 10],
    ww_totals: [10, 10],
    pt_scores: [6, 10, 10],
    pt_totals: [10, 10, 10],
    qa_score: 22,
    qa_total: 30,
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
  });
  if (out.quarterly_grade !== 93) {
    throw new Error(
      `HFSE formula self-test failed: expected quarterly=93, got ${out.quarterly_grade} (initial=${out.initial_grade})`
    );
  }
})();
