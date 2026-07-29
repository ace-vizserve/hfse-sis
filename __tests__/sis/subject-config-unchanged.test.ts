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
  type SubjectConfigBefore,
  type SubjectConfigSubmission,
} from '@/lib/sis/subject-config-unchanged';

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
});
