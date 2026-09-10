import { describe, expect, it } from 'vitest';

import * as sis from '@/lib/schemas/sis';

/**
 * KD #147's post-enrolment freeze was removed on 2026-09-10.
 *
 * Mr Ace: *"regarding the prevention of updating admission record in
 * admissions if student is already enrolled we should just enable that its all
 * audit logged anyways"*.
 *
 * The rule froze every funnel stage once `applicationStatus === 'Enrolled'`,
 * for EVERY role including superadmin — it was module ownership, not
 * permissions. A typo in an enrolled child's record was uncorrectable by the
 * people who own that record.
 *
 * ⚠ Every stage edit still writes an audit row. That is what makes removing
 * the freeze safe, and it is the only thing that does.
 */
describe('an enrolled student stays editable', () => {
  it('no longer exports a freeze rule at all', () => {
    expect(
      'isAdmissionsStageFrozen' in sis,
      'the freeze must be deleted, not merely bypassed — a dormant export ' +
        'invites a caller to reintroduce the rule'
    ).toBe(false);
    expect('POST_ENROLMENT_EDITABLE_STAGES' in sis).toBe(false);
    expect('STAGE_FINALIZED_STATUSES' in sis).toBe(false);
  });
});
