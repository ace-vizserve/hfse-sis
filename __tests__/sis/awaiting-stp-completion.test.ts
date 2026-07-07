import { describe, expect, it } from 'vitest';

import { isAwaitingStpCompletion } from '@/lib/sis/process';

describe('isAwaitingStpCompletion', () => {
  it('non-STP applicant (no stpApplicationType) is never awaiting', () => {
    expect(isAwaitingStpCompletion(null, null)).toBe(false);
    expect(isAwaitingStpCompletion(null, 'Pending')).toBe(false);
    expect(isAwaitingStpCompletion('', 'Submitted')).toBe(false);
  });

  it('STP applicant with null status is awaiting (declared but not progressed)', () => {
    expect(isAwaitingStpCompletion('New STP Application', null)).toBe(true);
  });

  it('STP applicant with a non-terminal status is awaiting', () => {
    expect(isAwaitingStpCompletion('New STP Application', 'Pending')).toBe(
      true
    );
    expect(isAwaitingStpCompletion('New STP Application', 'Submitted')).toBe(
      true
    );
  });

  it('Approved is terminal — not awaiting', () => {
    expect(isAwaitingStpCompletion('New STP Application', 'Approved')).toBe(
      false
    );
  });

  it('Rejected is terminal — not awaiting', () => {
    expect(isAwaitingStpCompletion('New STP Application', 'Rejected')).toBe(
      false
    );
  });
});
