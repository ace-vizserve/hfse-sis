/**
 * Tests for `resolveIsWithdrawn` — the pure withdrawal-detection predicate
 * in `lib/sis/process.ts` used by the lifecycle timeline.
 *
 * Context (Task 1 / KD #147): After the post-enrolment withdrawal fix a student
 * who enrolled and then withdrew keeps applicationStatus='Enrolled' (the OUTCOME
 * is preserved as append-only). The withdrawal is only signalled via
 * section_students.enrollment_status='withdrawn'. The lifecycle page's
 * `isWithdrawn` flag must detect BOTH cases so the withdrawal pill is shown
 * for post-enrolment withdrawals even when applicationStatus remains 'Enrolled'.
 */
import { describe, expect, it } from 'vitest';
import { resolveIsWithdrawn } from '@/lib/sis/process';

describe('resolveIsWithdrawn — dual-signal withdrawal detection', () => {
  // ── Pre-enrolment withdrawal (applicationStatus path) ──────────────────

  it('returns true when applicationStatus is "Withdrawn" (pre-enrolment)', () => {
    expect(resolveIsWithdrawn('Withdrawn', [])).toBe(true);
  });

  it('trims whitespace around applicationStatus before comparing', () => {
    expect(resolveIsWithdrawn('  Withdrawn  ', [])).toBe(true);
  });

  it('returns false when applicationStatus is "Enrolled" and no ss withdrawal', () => {
    expect(resolveIsWithdrawn('Enrolled', [])).toBe(false);
    expect(resolveIsWithdrawn('Enrolled', ['active'])).toBe(false);
    expect(resolveIsWithdrawn('Enrolled', ['late_enrollee'])).toBe(false);
  });

  it('returns false when applicationStatus is null and no ss withdrawal', () => {
    expect(resolveIsWithdrawn(null, [])).toBe(false);
    expect(resolveIsWithdrawn(null, ['active'])).toBe(false);
  });

  // ── Post-enrolment withdrawal (section_students path) ──────────────────

  it('CRITICAL — returns true when applicationStatus is "Enrolled" but ss has "withdrawn"', () => {
    // This is the core bug scenario: Task 1 preserves applicationStatus='Enrolled'
    // (the OUTCOME), so the old check `applicationStatus === 'Withdrawn'` would
    // return false and the withdrawal pill would disappear from the lifecycle page.
    expect(resolveIsWithdrawn('Enrolled', ['withdrawn'])).toBe(true);
  });

  it('returns true when applicationStatus is null but ss has "withdrawn"', () => {
    expect(resolveIsWithdrawn(null, ['withdrawn'])).toBe(true);
  });

  it('returns false when ss has a "withdrawn" row alongside an "active" row (transfer, not withdrawal — KD #67)', () => {
    // A section transfer (KD #67) leaves the old section_students row as
    // 'withdrawn' and inserts a new 'active' row. The student is NOT withdrawn
    // from the school — only moved to a different section. Previously this
    // returned true (the bug); the fix requires no active/late row to coexist.
    expect(resolveIsWithdrawn('Enrolled', ['active', 'withdrawn'])).toBe(false);
  });

  it('returns false when ss has a "withdrawn" row alongside a "late_enrollee" row (transfer of late enrollee — KD #67)', () => {
    // A late enrollee who transfers sections also leaves an old 'withdrawn' row
    // beside the new 'late_enrollee' row. Must not be flagged as withdrawn.
    expect(resolveIsWithdrawn('Enrolled', ['late_enrollee', 'withdrawn'])).toBe(
      false
    );
  });

  it('returns true when ss has ONLY a "withdrawn" row (genuine school withdrawal)', () => {
    // No active or late_enrollee row coexists — this is a real withdrawal.
    expect(resolveIsWithdrawn('Enrolled', ['withdrawn'])).toBe(true);
  });

  it('returns true when BOTH signals are present (belt-and-suspenders)', () => {
    expect(resolveIsWithdrawn('Withdrawn', ['withdrawn'])).toBe(true);
  });

  it('returns false for "Enrolled (Conditional)" with no ss withdrawal', () => {
    expect(resolveIsWithdrawn('Enrolled (Conditional)', [])).toBe(false);
    expect(resolveIsWithdrawn('Enrolled (Conditional)', ['active'])).toBe(
      false
    );
  });

  it('returns false for "Cancelled" (pre-enrolment cancel — separate from withdrawal)', () => {
    // 'Cancelled' is a pre-enrolment terminal but is not the "withdrawn" signal.
    // The lifecycle renderer handles Cancelled separately via bucketForAdmissionsStatus.
    expect(resolveIsWithdrawn('Cancelled', [])).toBe(false);
  });
});
