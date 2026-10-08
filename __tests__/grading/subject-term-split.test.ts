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

  it('refuses a typed three-part re-split, even one that adds to 100', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 25, pt: 55, qa: 20 })).toBe(
      false
    );
  });

  it('accepts a typed split once a part is switched off', () => {
    // 40/60 with the exam off, and the other way of rounding 37.5.
    expect(isSubjectTermSplit(FILIPINO, { ww: 40, pt: 60, qa: 0 })).toBe(true);
    expect(isSubjectTermSplit(FILIPINO, { ww: 38, pt: 62, qa: 0 })).toBe(true);
    expect(isSubjectTermSplit(FILIPINO, { ww: 0, pt: 70, qa: 30 })).toBe(true);
  });

  it('refuses a typed split that does not add to 100', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 40, pt: 59, qa: 0 })).toBe(false);
    expect(isSubjectTermSplit(FILIPINO, { ww: 40, pt: 61, qa: 0 })).toBe(false);
  });

  it('refuses fractions', () => {
    expect(isSubjectTermSplit(FILIPINO, { ww: 37.5, pt: 62.5, qa: 0 })).toBe(
      false
    );
  });

  it('refuses a 0 on a part that is still switched on', () => {
    const on = { ww: true, pt: true, qa: true };
    expect(isSubjectTermSplit(FILIPINO, { ww: 0, pt: 100, qa: 0 }, on)).toBe(
      false
    );
    expect(
      isSubjectTermSplit(
        FILIPINO,
        { ww: 0, pt: 100, qa: 0 },
        { ww: true, pt: true, qa: false }
      )
    ).toBe(false);
  });

  it('refuses a share on a part that is switched off', () => {
    expect(
      isSubjectTermSplit(
        FILIPINO,
        { ww: 40, pt: 50, qa: 10 },
        { ww: true, pt: true, qa: false }
      )
    ).toBe(false);
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

  it('no longer takes the old loose figures', () => {
    expect(
      SubjectTermWeightsSchema.safeParse({
        term_id,
        ww_weight: 30,
        pt_weight: 70,
        qa_weight: 0,
      }).success
    ).toBe(false);
  });

  it('takes a typed split alongside the switches', () => {
    expect(
      SubjectTermWeightsSchema.safeParse({
        term_id,
        components: { ww: true, pt: true, qa: false },
        weights: { ww: 40, pt: 60, qa: 0 },
      }).success
    ).toBe(true);
  });
});
