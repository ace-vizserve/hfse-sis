/**
 * Which weights a grading sheet grades by, and what happens when a term has no
 * exam.
 *
 * Migration 159 let a sheet state its own WW/PT/QA weights, because a term can
 * have no exam — Miss Joann, 2026-09-15: S3 Filipino has an exam in some terms
 * and not others, and Global Perspectives had no exam in Term 3, "those
 * subjects have PT scores only, and the PT score effectively is the exam".
 *
 * Before that, `lib/compute/quarterly.ts` multiplied the missing exam's weight
 * by zero rather than giving it back, so a Filipino student on full marks in a
 * term with no exam scored 87 and a Global Perspectives student scored 72. The
 * case below pins both numbers, so the defect cannot come back quietly.
 */

import { describe, it, expect } from 'vitest';

import { computeQuarterly } from '@/lib/compute/quarterly';
import {
  resolveSheetWeights,
  sheetOverridesWeights,
  redistributeWeights,
} from '@/lib/grading/resolve-sheet-weights';

/** Filipino's real AY2026 weights, verified against production 2026-09-15. */
const FIL_CONFIG = { ww_weight: 0.3, pt_weight: 0.5, qa_weight: 0.2 };

const NO_OVERRIDE = {
  ww_weight: null,
  pt_weight: null,
  qa_weight: null,
};

describe('resolveSheetWeights', () => {
  it('falls back to the subject config when the sheet states nothing', () => {
    expect(resolveSheetWeights(NO_OVERRIDE, FIL_CONFIG)).toEqual({
      ww_weight: 0.3,
      pt_weight: 0.5,
      qa_weight: 0.2,
    });
  });

  it('prefers the sheet when it states its own weights', () => {
    const sheet = { ww_weight: 0.38, pt_weight: 0.62, qa_weight: 0 };
    expect(resolveSheetWeights(sheet, FIL_CONFIG)).toEqual({
      ww_weight: 0.38,
      pt_weight: 0.62,
      qa_weight: 0,
    });
  });

  it('treats a zero exam weight as stated, not as absent', () => {
    // The trap: `qa_weight: 0` is falsy. A truthiness check here would silently
    // fall through to the config's 20% and grade an exam nobody sat.
    const sheet = { ww_weight: 0.38, pt_weight: 0.62, qa_weight: 0 };
    expect(sheetOverridesWeights(sheet)).toBe(true);
    expect(resolveSheetWeights(sheet, FIL_CONFIG).qa_weight).toBe(0);
  });

  it('accepts numeric strings, which is how PostgREST returns numeric', () => {
    const sheet = { ww_weight: '0.38', pt_weight: '0.62', qa_weight: '0.00' };
    expect(resolveSheetWeights(sheet, FIL_CONFIG)).toEqual({
      ww_weight: 0.38,
      pt_weight: 0.62,
      qa_weight: 0,
    });
  });

  it('unwraps an embedded relation, which PostgREST types as an array', () => {
    expect(resolveSheetWeights(NO_OVERRIDE, [FIL_CONFIG])).toEqual({
      ww_weight: 0.3,
      pt_weight: 0.5,
      qa_weight: 0.2,
    });
  });

  it('ignores a half-set sheet rather than mixing the two sources', () => {
    // Migration 159's CHECK forbids this shape; the code does not rely on it.
    const half = { ww_weight: 0.38, pt_weight: null, qa_weight: null };
    expect(sheetOverridesWeights(half)).toBe(false);
    expect(resolveSheetWeights(half, FIL_CONFIG)).toEqual(FIL_CONFIG);
  });

  it('throws rather than guessing when no weights are available anywhere', () => {
    expect(() => resolveSheetWeights(NO_OVERRIDE, null)).toThrow(
      /subject_configs/
    );
  });
});

describe('redistributeWeights', () => {
  it('gives the exam share to the components in use, summing to exactly 1', () => {
    const out = redistributeWeights(FIL_CONFIG, {
      ww: true,
      pt: true,
      qa: false,
    });
    // 30/80 and 50/80 are exactly 37.5 and 62.5 — a genuine tie. The spare
    // point goes to the component already carrying more, so 37/63 and not
    // 38/62. Pinned because the first implementation resolved this tie by
    // floating-point accident (0.3/0.8 is 0.37499999999999994) and happened to
    // disagree with its own comment.
    expect(out).toEqual({ ww_weight: 0.37, pt_weight: 0.63, qa_weight: 0 });
    expect(out.ww_weight + out.pt_weight + out.qa_weight).toBe(1);
  });

  it('gives performance tasks the whole grade when they are the only component', () => {
    // Joann's Global Perspectives case, in her own terms: "those subjects have
    // PT scores only, and the PT score effectively is the exam."
    expect(
      redistributeWeights(FIL_CONFIG, { ww: false, pt: true, qa: false })
    ).toEqual({ ww_weight: 0, pt_weight: 1, qa_weight: 0 });
  });

  it('leaves weights alone when every component is in use', () => {
    expect(
      redistributeWeights(FIL_CONFIG, { ww: true, pt: true, qa: true })
    ).toEqual(FIL_CONFIG);
  });

  it('always sums to exactly 1.00, which migration 159 requires', () => {
    const configs = [
      { ww_weight: 0.4, pt_weight: 0.4, qa_weight: 0.2 },
      { ww_weight: 0.3, pt_weight: 0.5, qa_weight: 0.2 },
      { ww_weight: 0.2, pt_weight: 0.6, qa_weight: 0.2 },
      { ww_weight: 0.35, pt_weight: 0.45, qa_weight: 0.2 },
    ];
    const shapes = [
      { ww: true, pt: true, qa: false },
      { ww: false, pt: true, qa: true },
      { ww: true, pt: false, qa: true },
      { ww: false, pt: true, qa: false },
      { ww: true, pt: false, qa: false },
    ];
    for (const config of configs) {
      for (const inUse of shapes) {
        const out = redistributeWeights(config, inUse);
        const sum = out.ww_weight + out.pt_weight + out.qa_weight;
        expect(Math.round(sum * 100) / 100).toBe(1);
        for (const c of ['ww', 'pt', 'qa'] as const) {
          if (!inUse[c]) expect(out[`${c}_weight`]).toBe(0);
        }
      }
    }
  });

  it('refuses a sheet that uses no components at all', () => {
    expect(() =>
      redistributeWeights(FIL_CONFIG, { ww: false, pt: false, qa: false })
    ).toThrow(/at least one component/);
  });
});

describe('the defect this exists to fix', () => {
  const fullMarks = {
    ww_scores: [10, 10],
    ww_totals: [10, 10],
    pt_scores: [10, 10],
    pt_totals: [10, 10],
  };

  it('scored a Filipino student 87 for full marks in a term with no exam', () => {
    const before = computeQuarterly({
      ...fullMarks,
      qa_score: null,
      qa_total: null,
      ...FIL_CONFIG,
    });
    // 100*0.30 + 100*0.50 + 0*0.20 = 80 -> floor(75 + 25*20/40) = 87
    expect(before.initial_grade).toBe(80);
    expect(before.quarterly_grade).toBe(87);
  });

  it('scores the same student 100 once the exam weight is redistributed', () => {
    const weights = redistributeWeights(FIL_CONFIG, {
      ww: true,
      pt: true,
      qa: false,
    });
    const after = computeQuarterly({
      ...fullMarks,
      qa_score: null,
      qa_total: null,
      ...weights,
    });
    expect(after.quarterly_grade).toBe(100);
  });

  it('scored a Global Perspectives student 72 on performance tasks alone', () => {
    const before = computeQuarterly({
      ww_scores: [null, null],
      ww_totals: [10, 10],
      pt_scores: [10, 10],
      pt_totals: [10, 10],
      qa_score: null,
      qa_total: null,
      ...FIL_CONFIG,
    });
    // 100*0.50 = 50 -> floor(60 + 15*50/60) = 72
    expect(before.initial_grade).toBe(50);
    expect(before.quarterly_grade).toBe(72);
  });

  it('scores that student 100 once performance tasks carry the grade', () => {
    const weights = redistributeWeights(FIL_CONFIG, {
      ww: false,
      pt: true,
      qa: false,
    });
    const after = computeQuarterly({
      ww_scores: [null, null],
      ww_totals: [10, 10],
      pt_scores: [10, 10],
      pt_totals: [10, 10],
      qa_score: null,
      qa_total: null,
      ...weights,
    });
    expect(after.quarterly_grade).toBe(100);
  });

  it('still deflates a grade mid-term when the exam simply has not happened yet', () => {
    // NOT a bug, and NOT what redistribution is for. A component that exists but
    // is unmarked must keep its weight, or a September grade would read high and
    // collapse in November. Redistribution only ever follows a deliberate
    // declaration that the component does not exist this term.
    const midTerm = computeQuarterly({
      ...fullMarks,
      qa_score: null,
      qa_total: 30,
      ...FIL_CONFIG,
    });
    expect(midTerm.quarterly_grade).toBe(87);
  });
});
