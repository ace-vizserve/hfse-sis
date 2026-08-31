/**
 * The no-op guard on PATCH /api/sis/admin/subjects/[configId].
 *
 * Getting this wrong is silent in BOTH directions, which is why it has its own
 * tests rather than living inline in the route:
 *
 *   Too loose  — a real change is treated as unchanged, so the registrar's edit
 *                is dropped and the response still says ok.
 *   Too strict — re-saving identical weights re-stamps updated_at on every
 *                unlocked grading sheet tied to the config and writes an
 *                append-only audit row whose before/after blocks are identical.
 *
 * The load-bearing case is `weights_confirmed`. The route sets it true on every
 * save on purpose, to clear migration 082's "needs attention" flag on the
 * GP/COMP/ARTD/PESTD stand-in rows. A future "simplification" that compares
 * only the six numbers would look obviously correct and would silently break
 * that flag-clearing loop — so it is pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
  subjectConfigUnchanged,
  subjectPerYearTextUnchanged,
  subjectNumbersIdentical,
  type SubjectConfigBefore,
  type SubjectConfigSubmission,
} from '@/lib/sis/subject-config-unchanged';
import { SubjectConfigUpdateSchema } from '@/lib/schemas/subject-config';

// Stored form: decimals, flag already cleared.
const STORED: SubjectConfigBefore = {
  ww_weight: 0.4,
  pt_weight: 0.4,
  qa_weight: 0.2,
  ww_max_slots: 5,
  pt_max_slots: 5,
  qa_max: 30,
  weights_confirmed: true,
};

// Submitted form: the same values as percentages.
const SAME: SubjectConfigSubmission = {
  ww_weight: 40,
  pt_weight: 40,
  qa_weight: 20,
  ww_max_slots: 5,
  pt_max_slots: 5,
  qa_max: 30,
};

describe('subjectConfigUnchanged — the weights_confirmed rule', () => {
  it('is NOT a no-op when the flag is still false, even if every number matches', () => {
    // The flag-clearing save. Treating this as a no-op would break the
    // documented "fix the flagged row's weights → the flag clears" loop
    // (migration 085) and leave the row flagged forever.
    expect(
      subjectConfigUnchanged({ ...STORED, weights_confirmed: false }, SAME)
    ).toBe(false);
  });

  it('is NOT a no-op when the flag is null (never set)', () => {
    expect(
      subjectConfigUnchanged({ ...STORED, weights_confirmed: null }, SAME)
    ).toBe(false);
  });

  it('IS a no-op once the flag is true and the numbers match', () => {
    expect(subjectConfigUnchanged(STORED, SAME)).toBe(true);
  });
});

describe('subjectConfigUnchanged — percentage/decimal conversion', () => {
  it('treats 40 as equal to a stored 0.40', () => {
    expect(subjectConfigUnchanged(STORED, SAME)).toBe(true);
  });

  it('handles weights stored as numeric strings', () => {
    // Postgres `numeric` comes back as a string through PostgREST, which is
    // why the helper coerces with Number() rather than comparing directly.
    expect(
      subjectConfigUnchanged(
        { ...STORED, ww_weight: '0.40', pt_weight: '0.40', qa_weight: '0.20' },
        SAME
      )
    ).toBe(true);
  });

  it('detects a real weight change', () => {
    expect(
      subjectConfigUnchanged(STORED, { ...SAME, ww_weight: 30, pt_weight: 50 })
    ).toBe(false);
  });
});

describe('subjectConfigUnchanged — every field participates', () => {
  const cases: Array<[string, Partial<SubjectConfigSubmission>]> = [
    ['ww_weight', { ww_weight: 30, pt_weight: 50 }],
    ['pt_weight', { pt_weight: 30, ww_weight: 50 }],
    ['qa_weight', { qa_weight: 30, ww_weight: 30 }],
    ['ww_max_slots', { ww_max_slots: 4 }],
    ['pt_max_slots', { pt_max_slots: 4 }],
    ['qa_max', { qa_max: 40 }],
  ];

  it.each(cases)('a change to %s is not a no-op', (_field, patch) => {
    expect(subjectConfigUnchanged(STORED, { ...SAME, ...patch })).toBe(false);
  });

  it('a slot-count change alone still counts, even with identical weights', () => {
    // ww/pt/qa max slots are denormalized onto every unlocked grading sheet by
    // sync_grading_sheets_from_config, so missing this would leave sheets
    // holding stale maxima with no audit trail explaining why.
    expect(subjectConfigUnchanged(STORED, { ...SAME, pt_max_slots: 3 })).toBe(
      false
    );
  });

  it('ignores the per-year name — that is the sibling guard, not this one', () => {
    // Pinned so nobody "completes" this function by folding display_name in.
    // A rename must not drag the grading-sheet sync behind it; the route
    // branches on the two verdicts separately.
    expect(
      subjectConfigUnchanged({ ...STORED, display_name: 'STAR' }, SAME)
    ).toBe(true);
  });
});

/**
 * subjectNumbersIdentical — the narrower question the rename path asks.
 *
 * Measured against production 2026-08-31: 5 of 35 subject_configs still carry
 * weights_confirmed = false (migration 082's stand-in rows — GP, COMP, ARTD and
 * PESTD in AY2025, CL in AY2026). Routing a rename on one of those through the
 * full save would flip the flag true, recording that somebody reviewed weights
 * they never looked at because they typed a name. So the route gates its
 * rename-only path on THIS function, and the flag-clearing save — which carries
 * no name change — still goes the long way.
 */
describe('subjectNumbersIdentical', () => {
  it('is true on a flagged row whose numbers match, where the no-op guard is false', () => {
    const flagged = { ...STORED, weights_confirmed: false };
    expect(subjectNumbersIdentical(flagged, SAME)).toBe(true);
    expect(subjectConfigUnchanged(flagged, SAME)).toBe(false);
  });

  it('still detects a real number change on a flagged row', () => {
    expect(
      subjectNumbersIdentical(
        { ...STORED, weights_confirmed: false },
        { ...SAME, qa_max: 50 }
      )
    ).toBe(false);
  });

  it('agrees with the no-op guard once the flag is true', () => {
    expect(subjectNumbersIdentical(STORED, SAME)).toBe(
      subjectConfigUnchanged(STORED, SAME)
    );
  });
});

/**
 * The per-year TEXT fields (migrations 137 + 138). One function answers for all
 * three — the subject name, the report-card name and the description — because
 * "did this save change anything" is the same question for each.
 *
 * Three input states have to stay distinguishable all the way from the request
 * body to this comparison, and two of them look identical if anything upstream
 * normalises too early:
 *
 *   undefined — the caller never mentioned the field. Don't touch the name.
 *   null / '' — clear the override; fall back to the catalogue name.
 *   'STAR'    — the name for this academic year.
 *
 * Collapsing the first two is the failure this is here to catch: it would wipe
 * an existing rename on every weights-only save, silently, with the response
 * still saying ok.
 */
describe('subjectPerYearTextUnchanged', () => {
  it('an absent field is never a change', () => {
    expect(subjectPerYearTextUnchanged('STAR', undefined)).toBe(true);
    expect(subjectPerYearTextUnchanged(null, undefined)).toBe(true);
  });

  it('setting a name on a row that had none is a change', () => {
    expect(subjectPerYearTextUnchanged(null, 'STAR')).toBe(false);
  });

  it('clearing an existing name is a change', () => {
    // The route normalises '' to null before it gets here, so null means
    // exactly one thing: go back to the catalogue name.
    expect(subjectPerYearTextUnchanged('STAR', null)).toBe(false);
  });

  it('re-saving the same name is not a change', () => {
    expect(subjectPerYearTextUnchanged('STAR', 'STAR')).toBe(true);
  });

  it('treats a missing column and a stored null identically', () => {
    expect(subjectPerYearTextUnchanged(undefined, null)).toBe(true);
  });

  it('renaming one name to another is a change', () => {
    expect(subjectPerYearTextUnchanged('MAPEH', 'STAR')).toBe(false);
  });
});

describe('SubjectConfigUpdateSchema — display_name', () => {
  const WEIGHTS = {
    ww_weight: 40,
    pt_weight: 40,
    qa_weight: 20,
    ww_max_slots: 5,
    pt_max_slots: 5,
    qa_max: 30,
  };

  it('accepts a save with no display_name at all', () => {
    const parsed = SubjectConfigUpdateSchema.parse(WEIGHTS);
    // Absent must stay absent. A `.transform()` on the optional field would
    // turn this into `null` and clear the stored rename — the exact reason the
    // normalisation lives in the route instead.
    expect('display_name' in parsed && parsed.display_name !== undefined).toBe(
      false
    );
  });

  it('accepts a name and trims it', () => {
    expect(
      SubjectConfigUpdateSchema.parse({ ...WEIGHTS, display_name: '  STAR  ' })
        .display_name
    ).toBe('STAR');
  });

  it('accepts an explicit null (clear the override)', () => {
    expect(
      SubjectConfigUpdateSchema.parse({ ...WEIGHTS, display_name: null })
        .display_name
    ).toBeNull();
  });

  it('leaves a blank string for the route to normalise, rather than rejecting it', () => {
    // Migration 137's CHECK refuses a blank string, so the route turns '' into
    // null. Rejecting here instead would make "clear the name" impossible from
    // a text input the user simply emptied.
    expect(
      SubjectConfigUpdateSchema.parse({ ...WEIGHTS, display_name: '   ' })
        .display_name
    ).toBe('');
  });

  it('refuses a name longer than the column allows', () => {
    expect(
      SubjectConfigUpdateSchema.safeParse({
        ...WEIGHTS,
        display_name: 'x'.repeat(129),
      }).success
    ).toBe(false);
  });
});
