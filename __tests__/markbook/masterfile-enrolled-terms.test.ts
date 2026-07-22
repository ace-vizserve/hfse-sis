/**
 * computeEnrolledTermNumbers() — pure resolver for the masterfile's honesty
 * fix (KD #148, plan finding M1/M2). The masterfile loader never checked a
 * student's per-term enrolment coverage, so a late enrollee's pre-join term
 * (or a withdrawn student's post-leave term) was counted as "missing" grades
 * / comments / attendance instead of the legitimately N.A. it actually is.
 *
 * This mirrors build-report-card.ts's coverage derivation exactly (union of
 * every section_students row's [enrollment_date, withdrawal_date] interval
 * in the AY — KD #67 transfer-safe) via the same
 * lib/report-card/enrolment-coverage.ts primitives, so it is extracted here
 * as a pure function for the same reason resolveLateEnrolleeTerm /
 * buildFormAdviserNameMap are: the surrounding loader is DB-bound
 * (`loadMasterfileUncached`), so direct end-to-end testing isn't reachable
 * without a live Supabase instance (not available in this environment) —
 * this pure extraction is the testable surface for the coverage logic.
 */

import { describe, expect, it } from 'vitest';

import { computeEnrolledTermNumbers } from '@/lib/markbook/masterfile';
import type { EnrolmentInterval } from '@/lib/report-card/enrolment-coverage';

const TERMS = [
  { termNumber: 1, startDate: '2026-01-06', endDate: '2026-03-13' },
  { termNumber: 2, startDate: '2026-03-30', endDate: '2026-05-29' },
  { termNumber: 3, startDate: '2026-06-29', endDate: '2026-09-04' },
  { termNumber: 4, startDate: '2026-09-21', endDate: '2026-11-20' },
];

describe('computeEnrolledTermNumbers', () => {
  it('an on-time student (no enrollment_date, open row) is enrolled every term', () => {
    const coverage: EnrolmentInterval[] = [{ start: null, end: null }];
    expect(computeEnrolledTermNumbers(coverage, TERMS)).toEqual([1, 2, 3, 4]);
  });

  it('a late enrollee joining in T3 is excluded from T1/T2 (pre-join terms)', () => {
    // Joined 2026-07-01 — inside T3, open-ended (still active).
    const coverage: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
    expect(computeEnrolledTermNumbers(coverage, TERMS)).toEqual([3, 4]);
  });

  it('a student withdrawn during T2 is excluded from T3/T4 (post-leave terms)', () => {
    // Enrolled from year start, withdrew 2026-05-01 (inside T2).
    const coverage: EnrolmentInterval[] = [{ start: null, end: '2026-05-01' }];
    expect(computeEnrolledTermNumbers(coverage, TERMS)).toEqual([1, 2]);
  });

  it('a mid-year transfer unions the withdrawn-old + active-new rows (KD #67) — continuous coverage', () => {
    // Old section_students row: enrolled from year start, withdrawn when the
    // transfer happened (2026-04-01, inside T2). New row: active from the
    // same date onward. Union must cover every term — no false N.A. gap
    // introduced by a transfer.
    const coverage: EnrolmentInterval[] = [
      { start: null, end: '2026-04-01' },
      { start: '2026-04-01', end: null },
    ];
    expect(computeEnrolledTermNumbers(coverage, TERMS)).toEqual([1, 2, 3, 4]);
  });

  it('a student both late-joining and later withdrawn is only covered mid-range', () => {
    // Joined 2026-04-15 (T2), withdrew 2026-07-15 (T3).
    const coverage: EnrolmentInterval[] = [
      { start: '2026-04-15', end: '2026-07-15' },
    ];
    expect(computeEnrolledTermNumbers(coverage, TERMS)).toEqual([2, 3]);
  });

  it('a term with unset start/end dates is conservatively treated as covered', () => {
    // A late enrollee (joined T3) but one term (T4) has no dates configured
    // yet — must not fabricate an N.A. from missing calendar data.
    const undated = [
      ...TERMS.slice(0, 3),
      { termNumber: 4, startDate: null, endDate: null },
    ];
    const coverage: EnrolmentInterval[] = [{ start: '2026-07-01', end: null }];
    expect(computeEnrolledTermNumbers(coverage, undated)).toEqual([3, 4]);
  });

  it('no coverage at all (should not happen in practice) yields no enrolled terms', () => {
    expect(computeEnrolledTermNumbers([], TERMS)).toEqual([]);
  });
});
