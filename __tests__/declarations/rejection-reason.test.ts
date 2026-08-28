import { describe, expect, it } from 'vitest';

import { rejectionReasonFor } from '@/lib/declarations/parent';
import { DecideApprovalSchema } from '@/lib/schemas/approval-flows';

/**
 * A parent who is turned down has to be told why.
 *
 * Until 2026-08-28 the approver's note reached nobody: not the portal, not an
 * email, and deliberately not `audit_log` (migration 109's rule, restated by
 * 125 and 126). The parent saw "Not approved" and had no way to learn that the
 * school had wanted a medical certificate.
 *
 * Two halves are pinned here — the rule that a reason must exist, and the rule
 * that finds it again afterwards.
 */

type Stage = { status: string; decisionNote: string | null };
const ladder = (stages: Stage[]) => ({ stages });

describe('rejectionReasonFor — which stage holds the reason', () => {
  it('reads the stage that REJECTED, not the last one', () => {
    // ⚠ THE TRAP THIS TEST EXISTS FOR. `approval_advance` stops the ladder
    // where the rejection happened and leaves every later stage `waiting`
    // forever, so "the last stage" is a `waiting` row with no note on it.
    // Taking `stages.at(-1)` would return null and the parent would be told
    // nothing — the exact bug this feature set out to fix.
    const reason = rejectionReasonFor(
      ladder([
        { status: 'approved', decisionNote: 'Looks fine to me.' },
        { status: 'rejected', decisionNote: 'Please attach the MC first.' },
        { status: 'waiting', decisionNote: null },
      ])
    );
    expect(reason).toBe('Please attach the MC first.');
  });

  it('is null when nothing was rejected', () => {
    expect(
      rejectionReasonFor(
        ladder([
          { status: 'approved', decisionNote: 'Fine.' },
          { status: 'pending', decisionNote: null },
        ])
      )
    ).toBeNull();
  });

  it('is null for a filing with no ladder at all', () => {
    expect(rejectionReasonFor(null)).toBeNull();
  });

  it('treats a whitespace-only note as no reason', () => {
    // Not pedantry: the schema trims before it validates, so a note of spaces
    // cannot be stored by the route. This guards the rows that predate the
    // rule, which could hold one.
    expect(
      rejectionReasonFor(ladder([{ status: 'rejected', decisionNote: '   ' }]))
    ).toBeNull();
  });

  it('trims the reason it returns', () => {
    expect(
      rejectionReasonFor(
        ladder([{ status: 'rejected', decisionNote: '  No MC attached.\n' }])
      )
    ).toBe('No MC attached.');
  });
});

describe('DecideApprovalSchema — a reason is required to turn something down', () => {
  it('refuses a rejection with no note', () => {
    const r = DecideApprovalSchema.safeParse({ action: 'reject' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['note']);
      // The message is what the approver reads on screen, so it is part of the
      // contract rather than incidental text.
      expect(r.error.issues[0]?.message).toMatch(
        /why you are turning this down/i
      );
    }
  });

  it('refuses a rejection whose note is only whitespace', () => {
    expect(
      DecideApprovalSchema.safeParse({ action: 'reject', note: '   ' }).success
    ).toBe(false);
  });

  it('accepts a rejection with a reason', () => {
    expect(
      DecideApprovalSchema.safeParse({
        action: 'reject',
        note: 'Please attach the medical certificate and file again.',
      }).success
    ).toBe(true);
  });

  it('still lets an approval carry no note', () => {
    // ⚠ THE ASYMMETRY IS THE DESIGN. On an approval the note travels to the
    // next approver, so it is a convenience; on a rejection there is no next
    // approver and the parent is its only possible reader. Requiring one on
    // approve would be friction with nobody at the other end.
    expect(DecideApprovalSchema.safeParse({ action: 'approve' }).success).toBe(
      true
    );
  });

  it('still accepts an approval that does carry a note', () => {
    expect(
      DecideApprovalSchema.safeParse({
        action: 'approve',
        note: 'Spoke to the parent this morning.',
      }).success
    ).toBe(true);
  });
});
