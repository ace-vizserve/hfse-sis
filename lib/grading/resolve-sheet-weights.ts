import type { SheetWeights } from '@/lib/grading/recompute-sheet';

// Which WW/PT/QA weights are in force for one grading sheet.
//
// ── WHY THIS IS ITS OWN FILE ───────────────────────────────────────────────
//
// Until migration 159 there was exactly one answer: `subject_configs`, one row
// per (subject, academic year). Eleven call sites read it directly off a
// `subject_configs` join and every one of them was correct.
//
// They are no longer correct. A sheet may now state its own weights, because a
// term can have no exam — Miss Joann, 2026-09-15: S3 Filipino has an exam in
// some terms and not others, and Global Perspectives had no exam in Term 3,
// "those subjects have PT scores only, and the PT score effectively is the
// exam". A caller that still reads the config will compute a grade out of 80
// while the screen beside it says the exam does not count, and both numbers
// look plausible.
//
// So the precedence lives in one function, and
// `__tests__/grading/sheet-weight-resolution.test.ts` asserts that no file
// outside this one reads `ww_weight` off a `subject_configs` join. That guard
// is the point of the file existing separately — the same shape as
// `__tests__/sis/report-label-scope.test.ts`, which exists because a resolver
// chain leaked a global value onto the wrong academic year once already.
//
// ⚠ THIS RESOLVER DOES NOT CHAIN. It is sheet-or-config, one hop, never
// "sheet ?? config ?? something else". Migration 137's report-label work is the
// cautionary tale: a chain grew a third fallback and leaked a global label onto
// AY2025 markbook screens the moment the sweep gave it callers.
//
// ⚠ `lib/compute/quarterly.ts` IS NOT TOUCHED BY ANY OF THIS, and must not be.
// With `qa_weight` at 0 the term `(qa_ps ?? 0) * 0` is already zero and the
// remaining weights already sum to 1, so the formula was never wrong — it was
// being handed the wrong weights. Hard Rule #1 and Hard Rule #2 stand.

/** Any row carrying the three weight columns, from either table. */
export type WeightColumns = {
  ww_weight: number | string | null;
  pt_weight: number | string | null;
  qa_weight: number | string | null;
};

/**
 * PostgREST types an embedded relation as an array even when the FK makes it at
 * most one row, so joined configs arrive either way depending on the select.
 */
export type MaybeEmbedded<T> = T | T[] | null | undefined;

function firstOf<T>(v: MaybeEmbedded<T>): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Does this sheet state its own weights?
 *
 * Migration 159's CHECK makes the three columns all-null or all-set, so testing
 * one would be enough — all three are tested anyway, because a constraint is
 * the database's promise and this is the code's own reading of the row.
 */
export function sheetOverridesWeights(
  sheet: MaybeEmbedded<Partial<WeightColumns>>
): boolean {
  const row = firstOf(sheet);
  if (!row) return false;
  return (
    toNum(row.ww_weight) != null &&
    toNum(row.pt_weight) != null &&
    toNum(row.qa_weight) != null
  );
}

/**
 * The weights in force for a sheet: its own if it states them, its subject
 * config's otherwise.
 *
 * Throws when neither side can supply a complete set. That is deliberate and it
 * is the safe failure: silently defaulting to 40/40/20 would produce a grade
 * that is wrong in a way nobody can see, and every caller here already has a
 * config in hand — a missing one means the query forgot to select it, which is
 * a bug to fix rather than a case to tolerate.
 */
export function resolveSheetWeights(
  sheet: MaybeEmbedded<Partial<WeightColumns>>,
  config: MaybeEmbedded<Partial<WeightColumns>>
): SheetWeights {
  const sheetRow = firstOf(sheet);
  if (sheetRow && sheetOverridesWeights(sheetRow)) {
    return {
      ww_weight: toNum(sheetRow.ww_weight)!,
      pt_weight: toNum(sheetRow.pt_weight)!,
      qa_weight: toNum(sheetRow.qa_weight)!,
    };
  }

  const configRow = firstOf(config);
  const ww = toNum(configRow?.ww_weight);
  const pt = toNum(configRow?.pt_weight);
  const qa = toNum(configRow?.qa_weight);
  if (ww == null || pt == null || qa == null) {
    throw new Error(
      'resolveSheetWeights: neither the grading sheet nor its subject config carries a complete set of weights. Check that the query selects subject_configs(ww_weight, pt_weight, qa_weight).'
    );
  }
  return { ww_weight: ww, pt_weight: pt, qa_weight: qa };
}

export const GRADE_COMPONENTS = ['ww', 'pt', 'qa'] as const;
export type GradeComponent = (typeof GRADE_COMPONENTS)[number];

/** What each component is called on screen. Plain words — school admins read these. */
export const COMPONENT_LABELS: Record<GradeComponent, string> = {
  ww: 'Written work',
  pt: 'Performance tasks',
  qa: 'Exam',
};

/**
 * Hand the weight of every component NOT in use to the components that are, in
 * proportion to what they already carry.
 *
 * This is the arithmetic behind unticking "Exam" on a sheet. Miss Joann stated
 * the rule herself — "those subjects have PT scores only, and the PT score
 * effectively is the exam" — which is to say the components actually in use
 * carry the whole grade. Nothing is ever computed out of 80.
 *
 * Filipino at 30/50/20 with no exam becomes 37 / 63. Global Perspectives with
 * performance tasks alone becomes 0 / 100 / 0, which is her sentence exactly,
 * reached by arithmetic rather than by a special case for one subject.
 *
 * ⚠ WHOLE PERCENTAGES, NOT 37.5. `subject_configs` weights are integer
 * percentages everywhere that matters — `SubjectConfigUpdateSchema` uses
 * `z.number().int().min(0).max(100)` and every screen renders
 * `Math.round(weight * 100)` — and migration 159 stores numeric(4,2) to match.
 * Filipino's exact proportional share is 37.5 / 62.5, which is neither storable
 * nor how HFSE writes a weight, so the spare point goes to the component that
 * already carries more and it lands on 37 / 63. The effect on a transmuted
 * grade is below one point either way; what matters is that the tie is broken
 * deliberately rather than by floating-point noise. See the apportionment note
 * in the body.
 *
 * ⚠ THIS IS THE POLICY, NOT A DEFAULT (since 2026-09-25). It used to be
 * described as a fallback the coordinator could override by typing a term's
 * own figures. Miss Joann then set the rule: a subject's weights are the same
 * in all four terms; what changes per term is the slots, the max scores and
 * whether there is an exam. So the only weights a term may carry are the
 * subject's own, with any unused component's share handed on by this function
 * — `isSubjectTermSplit` below is the gate both write routes use.
 *
 * Throws when nothing is in use: a sheet graded on no components has no
 * meaningful weights, and returning 0/0/0 would compute every student a zero.
 */
export function redistributeWeights(
  base: SheetWeights,
  inUse: Record<GradeComponent, boolean>
): SheetWeights {
  // ⚠ ALL OF THIS IS INTEGER PERCENTAGE-POINT ARITHMETIC, ON PURPOSE.
  //
  // Doing it in fractions looks simpler and is wrong in a way that is very hard
  // to see: 0.3 / 0.8 is 0.37499999999999994 in binary floating point, not
  // 0.375, so a `Math.round` on it silently resolves a genuine 37.5 tie by
  // whichever way the representation error happens to fall. The first version
  // of this function did exactly that and produced 37/63 while its own comment
  // claimed 38/62 — a coin flip wearing the costume of a decision.
  //
  // Percentage points are also the unit the rest of the system actually uses:
  // `SubjectConfigUpdateSchema` validates `z.number().int().min(0).max(100)`,
  // every screen renders `Math.round(weight * 100)`, and HFSE's own workbooks
  // print whole percentages in the masthead.
  const pctOf: Record<GradeComponent, number> = {
    ww: Math.round(Number(base.ww_weight) * 100),
    pt: Math.round(Number(base.pt_weight) * 100),
    qa: Math.round(Number(base.qa_weight) * 100),
  };

  const kept = GRADE_COMPONENTS.filter((c) => inUse[c]);
  if (kept.length === 0) {
    throw new Error(
      'redistributeWeights: a grading sheet must use at least one component.'
    );
  }

  const keptTotal = kept.reduce((sum, c) => sum + pctOf[c], 0);

  // Every component in use carries zero weight in the config — nothing to scale
  // up proportionally, so split the grade evenly rather than returning zeros.
  // Reachable only from a config nobody has configured.
  const shares = kept.map((c) => ({
    component: c,
    exact: keptTotal <= 0 ? 100 / kept.length : (pctOf[c] * 100) / keptTotal,
  }));

  // Largest-remainder apportionment: floor everything, then hand the leftover
  // points out by biggest fractional part. Guarantees the result sums to exactly
  // 100, which migration 159's CHECK requires.
  //
  // Ties are broken toward the component that already carries more weight, so
  // Filipino's 30/50 with no exam gives the spare point to performance tasks and
  // lands on 37/63 rather than 38/62. Both are defensible; what matters is that
  // it is decided here, in words, and cannot drift.
  const floored = shares.map((s) => ({ ...s, whole: Math.floor(s.exact) }));
  let remaining = 100 - floored.reduce((sum, s) => sum + s.whole, 0);

  const byRemainder = [...floored].sort((a, b) => {
    const fracDiff = b.exact - b.whole - (a.exact - a.whole);
    if (Math.abs(fracDiff) > 1e-9) return fracDiff;
    return pctOf[b.component] - pctOf[a.component];
  });
  for (const s of byRemainder) {
    if (remaining <= 0) break;
    s.whole += 1;
    remaining -= 1;
  }

  const out: Record<GradeComponent, number> = { ww: 0, pt: 0, qa: 0 };
  for (const s of floored) out[s.component] = s.whole / 100;

  return {
    ww_weight: out.ww,
    pt_weight: out.pt,
    qa_weight: out.qa,
  };
}

/**
 * Is this split one a term is allowed to carry?
 *
 * Miss Joann (relayed by Mr Ace, 2026-09-25): a subject's weights are
 * consistent across Terms 1–4. What varies per term is the slots, the max
 * scores and whether there is an exam. So a term's weights must be the
 * subject's own — or the subject's own with some components switched off and
 * their share handed on by `redistributeWeights`. Any other split (a typed
 * 25 / 55 / 20, say) is refused.
 *
 * `pcts` are integer percentages. Which components are "in use" is read off
 * the split itself (a component at 0 is off), so the one comparison covers
 * every combination of switches.
 */
export function isSubjectTermSplit(
  subject: WeightColumns,
  pcts: Record<GradeComponent, number>
): boolean {
  const inUse: Record<GradeComponent, boolean> = {
    ww: pcts.ww > 0,
    pt: pcts.pt > 0,
    qa: pcts.qa > 0,
  };
  if (!inUse.ww && !inUse.pt && !inUse.qa) return false;
  const expected = redistributeWeights(
    {
      ww_weight: Number(subject.ww_weight),
      pt_weight: Number(subject.pt_weight),
      qa_weight: Number(subject.qa_weight),
    },
    inUse
  );
  return GRADE_COMPONENTS.every(
    (c) =>
      Math.round(Number(expected[`${c}_weight` as const]) * 100) === pcts[c]
  );
}
