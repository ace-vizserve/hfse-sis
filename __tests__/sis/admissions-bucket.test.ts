/**
 * Tests for `bucketForAdmissionsStatus` — the pure stage-status → semantic
 * bucket classifier in `lib/sis/process.ts`. Exported (was module-private)
 * for reuse by the admissions applications-table pipeline strip
 * (components/sis/pipeline-strip.tsx).
 *
 * Covers the STAGE_DISPLAY_DONE fix: class/supplies/orientation's own
 * terminal values (Finished/Claimed/Finished) previously fell through to
 * `in_progress` because STAGE_TERMINAL_STATUS only covers the
 * ENROLLED_PREREQ_STAGES (registration/documents/assessment/contract/fees) —
 * class/supplies/orientation are deliberately absent from that map since
 * they aren't enrollment prereqs, but they still have their own "done" state
 * for display purposes.
 */
import { describe, expect, it } from 'vitest';
import { bucketForAdmissionsStatus } from '@/lib/sis/process';

describe('bucketForAdmissionsStatus', () => {
  it('returns not_started for null/empty/whitespace status', () => {
    expect(bucketForAdmissionsStatus('documents', null)).toBe('not_started');
    expect(bucketForAdmissionsStatus('documents', '')).toBe('not_started');
    expect(bucketForAdmissionsStatus('documents', '   ')).toBe('not_started');
  });

  it('returns blocked for Cancelled/Withdrawn/Rejected on any stage', () => {
    expect(bucketForAdmissionsStatus('registration', 'Cancelled')).toBe(
      'blocked'
    );
    expect(bucketForAdmissionsStatus('application', 'Withdrawn')).toBe(
      'blocked'
    );
    expect(bucketForAdmissionsStatus('documents', 'Rejected')).toBe('blocked');
  });

  it('returns blocked for Incomplete', () => {
    expect(bucketForAdmissionsStatus('documents', 'Incomplete')).toBe(
      'blocked'
    );
    expect(bucketForAdmissionsStatus('class', 'Incomplete')).toBe('blocked');
  });

  it('returns done for the ENROLLED_PREREQ_STAGES terminal values', () => {
    expect(bucketForAdmissionsStatus('registration', 'Finished')).toBe('done');
    expect(bucketForAdmissionsStatus('documents', 'Finished')).toBe('done');
    expect(bucketForAdmissionsStatus('assessment', 'Finished')).toBe('done');
    expect(bucketForAdmissionsStatus('contract', 'Signed')).toBe('done');
    expect(bucketForAdmissionsStatus('fees', 'Paid')).toBe('done');
  });

  it('returns done for application Enrolled / Enrolled (Conditional)', () => {
    expect(bucketForAdmissionsStatus('application', 'Enrolled')).toBe('done');
    expect(
      bucketForAdmissionsStatus('application', 'Enrolled (Conditional)')
    ).toBe('done');
  });

  it('returns done for class/supplies/orientation own terminal values (the fix)', () => {
    expect(bucketForAdmissionsStatus('class', 'Finished')).toBe('done');
    expect(bucketForAdmissionsStatus('supplies', 'Claimed')).toBe('done');
    expect(bucketForAdmissionsStatus('orientation', 'Finished')).toBe('done');
  });

  it('returns in_progress for mid-pipeline values', () => {
    expect(bucketForAdmissionsStatus('contract', 'Sent')).toBe('in_progress');
    expect(bucketForAdmissionsStatus('contract', 'Generated')).toBe(
      'in_progress'
    );
    expect(bucketForAdmissionsStatus('assessment', 'Ongoing Assessment')).toBe(
      'in_progress'
    );
    expect(bucketForAdmissionsStatus('fees', 'Invoiced')).toBe('in_progress');
    expect(bucketForAdmissionsStatus('application', 'Processing')).toBe(
      'in_progress'
    );
  });

  it('trims whitespace before comparing', () => {
    expect(bucketForAdmissionsStatus('contract', '  Signed  ')).toBe('done');
    expect(bucketForAdmissionsStatus('supplies', '  Claimed ')).toBe('done');
  });
});
