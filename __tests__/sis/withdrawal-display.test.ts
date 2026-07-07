/**
 * Tests for `resolveWithdrawnDisplay` — the pure source-selection helper in
 * `lib/sis/process.ts` behind the lifecycle timeline's "Withdrawn on
 * {date} / {reason}" pill.
 *
 * KD #150 model: `applicationStatus` is the append-only application OUTCOME —
 * a post-enrolment withdrawal keeps it at 'Enrolled' and stamps
 * `section_students.enrollment_status='withdrawn'` + `withdrawal_date` /
 * `withdrawal_reason` (KD #111, migration 067). The display must therefore:
 *   - pre-enrolment terminal → application-side date/remark (unchanged);
 *   - post-enrolment withdrawal → the section_students row's date + the
 *     WITHDRAWAL_REASON_LABELS humanized reason (the bug: it previously
 *     showed the application stage's updatedDate/remarks = the enrolment
 *     event);
 *   - KD #67 transfer (withdrawn row beside an active/late one) → NOT
 *     withdrawn at all (null).
 */
import { describe, expect, it } from 'vitest';
import {
  resolveWithdrawnDisplay,
  type WithdrawalSsRow,
} from '@/lib/sis/process';
import { WITHDRAWAL_REASON_LABELS } from '@/lib/schemas/enrolment';

const APP_SIDE = { date: '2026-02-01T00:00:00Z', reason: 'App-side remark' };

function ss(
  status: string,
  date: string | null = null,
  reason: string | null = null
): WithdrawalSsRow {
  return {
    enrollment_status: status,
    withdrawal_date: date,
    withdrawal_reason: reason,
  };
}

describe('resolveWithdrawnDisplay', () => {
  it('returns null for a non-withdrawn student (active enrolment)', () => {
    expect(resolveWithdrawnDisplay('Enrolled', APP_SIDE, [ss('active')])).toBe(
      null
    );
  });

  it('returns null for an in-funnel applicant with no section rows', () => {
    expect(resolveWithdrawnDisplay('Processing', APP_SIDE, [])).toBe(null);
  });

  it('pre-enrolment terminal keeps the application-side date/reason', () => {
    expect(resolveWithdrawnDisplay('Withdrawn', APP_SIDE, [])).toEqual(
      APP_SIDE
    );
  });

  it('post-enrolment withdrawal reads the section_students row, not the application stage', () => {
    const result = resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
      ss('withdrawn', '2026-06-15', 'financial'),
    ]);
    expect(result).toEqual({
      date: '2026-06-15',
      reason: WITHDRAWAL_REASON_LABELS['financial'],
    });
    // Explicitly NOT the application-side pair (the pre-fix bug).
    expect(result?.date).not.toBe(APP_SIDE.date);
    expect(result?.reason).not.toBe(APP_SIDE.reason);
  });

  it('a KD #67 transfer (withdrawn row beside an active one) does NOT read as withdrawn', () => {
    expect(
      resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
        ss('withdrawn', '2026-03-10', 'other'),
        ss('active'),
      ])
    ).toBe(null);
  });

  it('a transfer followed by a real withdrawal uses the LATEST withdrawn row', () => {
    const result = resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
      ss('withdrawn', '2026-03-10', null), // transfer-created row
      ss('withdrawn', '2026-08-20', 'family_relocation'), // the real withdrawal
    ]);
    expect(result).toEqual({
      date: '2026-08-20',
      reason: WITHDRAWAL_REASON_LABELS['family_relocation'],
    });
  });

  it('late_enrollee row also blocks the withdrawn reading (dual-signal)', () => {
    expect(
      resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
        ss('withdrawn', '2026-03-10', 'other'),
        ss('late_enrollee'),
      ])
    ).toBe(null);
  });

  it('unknown reason codes fall back to the raw value; null reason stays null', () => {
    expect(
      resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
        ss('withdrawn', '2026-06-15', 'not_a_known_code'),
      ])
    ).toEqual({ date: '2026-06-15', reason: 'not_a_known_code' });
    expect(
      resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
        ss('withdrawn', '2026-06-15', null),
      ])
    ).toEqual({ date: '2026-06-15', reason: null });
  });

  it('a withdrawn row with a null date still resolves (date null, no crash)', () => {
    expect(
      resolveWithdrawnDisplay('Enrolled', APP_SIDE, [
        ss('withdrawn', null, 'health'),
      ])
    ).toEqual({ date: null, reason: WITHDRAWAL_REASON_LABELS['health'] });
  });
});
