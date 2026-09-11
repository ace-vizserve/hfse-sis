import { describe, it, expect } from 'vitest';
import { buildApprovalReference } from '@/app/api/grading-sheets/[id]/entries/[entryId]/route';

// Hard Rule #5 — every post-lock edit carries an approval_reference. Since
// migration 144 a change request is either on the legacy two-approver path or
// decided step by step, and the reference has to read correctly for both. The
// apply path itself is unchanged; only this sentence knows the difference.
describe('buildApprovalReference', () => {
  const id = '1a2b3c4d-0000-0000-0000-000000000001';

  it('legacy: names the first designated reviewer, as it always did', () => {
    expect(
      buildApprovalReference({
        id,
        approval_flow: null,
        primary_reviewed_by_email: 'primary@hfse.edu.sg',
        reviewed_by_email: 'fallback@hfse.edu.sg',
        reviewed_at: '2026-09-10T03:00:00.000Z',
      })
    ).toBe('Request #1a2b3c4d approved by primary@hfse.edu.sg 2026-09-10');
  });

  it('legacy: falls back to the single-reviewer column', () => {
    expect(
      buildApprovalReference({
        id,
        primary_reviewed_by_email: null,
        reviewed_by_email: 'fallback@hfse.edu.sg',
        reviewed_at: '2026-09-10T03:00:00.000Z',
      })
    ).toBe('Request #1a2b3c4d approved by fallback@hfse.edu.sg 2026-09-10');
  });

  it('step by step, before publication: names the final approver the engine wrote back', () => {
    expect(
      buildApprovalReference({
        id,
        approval_flow: 'markbook.grade_change',
        // A designee column left over on the row must NOT win — nobody is
        // designated on a step-by-step request.
        primary_reviewed_by_email: 'stale@hfse.edu.sg',
        reviewed_by_email: 'principal@hfse.edu.sg',
        reviewed_at: '2026-09-11T01:30:00.000Z',
      })
    ).toBe('Request #1a2b3c4d approved by principal@hfse.edu.sg 2026-09-11');
  });

  it('step by step, after publication: says the Academic and Examination Board approved it', () => {
    expect(
      buildApprovalReference({
        id,
        approval_flow: 'markbook.grade_change_aeb',
        reviewed_by_email: 'chair@hfse.edu.sg',
        reviewed_at: '2026-09-11T01:30:00.000Z',
      })
    ).toBe(
      'Request #1a2b3c4d approved by chair@hfse.edu.sg 2026-09-11 (Academic and Examination Board)'
    );
  });

  it('step by step: uses the approval date when no review date was written', () => {
    expect(
      buildApprovalReference({
        id,
        approval_flow: 'markbook.grade_change',
        reviewed_by_email: 'principal@hfse.edu.sg',
        reviewed_at: null,
        approved_at: '2026-09-12T01:30:00.000Z',
      })
    ).toBe('Request #1a2b3c4d approved by principal@hfse.edu.sg 2026-09-12');
  });
});
