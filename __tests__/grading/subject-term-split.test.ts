import { describe, expect, it } from 'vitest';

import { isSubjectTermSplit } from '@/lib/grading/resolve-sheet-weights';
import { SubjectTermWeightsSchema } from '@/lib/schemas/subject-config';

// A subject's weights are the same in every term (Miss Joann, 2026-09-25).
// A term may switch components off; it may not re-split them.
const FILIPINO = { ww_weight: 0.3, pt_weight: 0.5, qa_weight: 0.2 };

describe('isSubjectTermSplit', () => {
  it("accepts the subject's own weights", () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 30, pt: 50, qa: 20 })).toBe(true);
  });

  it('accepts the no-exam split the switches produce', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 37, pt: 63, qa: 0 })).toBe(true);
  });

  it('accepts performance tasks alone', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 0, pt: 100, qa: 0 })).toBe(true);
  });

  it('refuses a typed re-split, even one that adds to 100', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 25, pt: 55, qa: 20 })).toBe(
      false
    );
    // The other way of rounding 37.5 — not what the switches produce.
    expect(isSubjectTermSplit(FILIPINO, { ww: 38, pt: 62, qa: 0 })).toBe(false);
  });

  it('refuses a sheet graded on nothing', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 0, pt: 0, qa: 0 })).toBe(false);
  });
});

describe('SubjectTermWeightsSchema', () => {
  const term_id = '00000000-0000-4000-8000-000000000000';

  it('takes switches and inherit', () => {
    expect(
      SubjectTermWeightsSchema.safeParse({
        term_id,
        components: { ww: true, pt: true, qa: false },
      }).success
    ).toBe(true);
    expect(
      SubjectTermWeightsSchema.safeParse({ term_id, inherit: true }).success
    ).toBe(true);
  });

  it('no longer takes typed figures', () => {
    expect(
      SubjectTermWeightsSchema.safeParse({
        term_id,
        ww_weight: 30,
        pt_weight: 70,
        qa_weight: 0,
      }).success
    ).toBe(false);
  });
});
