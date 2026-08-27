import { describe, expect, it } from 'vitest';

import { poolForLevelType } from '@/lib/approvals/materialise';
import type { ConfiguredApprover } from '@/lib/approvals/materialise';

/**
 * Which of a step's people a given child's filing actually goes to.
 *
 * ⚠ THIS IS THE RULE THAT SHIPPED WRONG. HFSE has two officers in charge —
 * Ms Lhen for PRIMARY, Ms Elaine for SECONDARY — and the school's own answer
 * called the post "Officer in Charge (Primary or Secondary)". That `or` was
 * read as *either of two approvers, whoever acts first*, so both were put on
 * one step and each could decide the other half's children: 15 primary and 6
 * secondary classes in AY2026.
 *
 * It means the two HALVES OF THE SCHOOL. One officer per child, decided by the
 * child.
 */

const LHEN = 'user-lhen';
const ELAINE = 'user-elaine';
const ANYBODY = 'user-anybody';

const lhen: ConfiguredApprover = {
  userId: LHEN,
  appliesToLevelType: 'primary',
};
const elaine: ConfiguredApprover = {
  userId: ELAINE,
  appliesToLevelType: 'secondary',
};
const untagged: ConfiguredApprover = {
  userId: ANYBODY,
  appliesToLevelType: null,
};

describe('poolForLevelType', () => {
  it('sends a primary child to the primary officer only', () => {
    expect(poolForLevelType([lhen, elaine], 'primary')).toEqual([LHEN]);
  });

  it('sends a secondary child to the secondary officer only', () => {
    expect(poolForLevelType([lhen, elaine], 'secondary')).toEqual([ELAINE]);
  });

  it('never lets one half’s officer decide the other half’s child', () => {
    // The bug, stated directly. Both directions, because it was wrong both ways.
    expect(poolForLevelType([lhen, elaine], 'primary')).not.toContain(ELAINE);
    expect(poolForLevelType([lhen, elaine], 'secondary')).not.toContain(LHEN);
  });

  it('includes somebody who covers every child, whichever half', () => {
    expect(poolForLevelType([untagged], 'primary')).toEqual([ANYBODY]);
    expect(poolForLevelType([untagged], 'secondary')).toEqual([ANYBODY]);
    expect(poolForLevelType([untagged], 'preschool')).toEqual([ANYBODY]);
  });

  it('puts a person in the pool once even when they hold two rows', () => {
    // ⚠ The unique index deliberately permits somebody holding an untagged row
    // AND a tagged one — redundant rather than wrong. But "first to act carries
    // the step" starts counting one person as two if they land in a pool twice.
    const twice: ConfiguredApprover[] = [
      { userId: LHEN, appliesToLevelType: null },
      { userId: LHEN, appliesToLevelType: 'primary' },
    ];
    expect(poolForLevelType(twice, 'primary')).toEqual([LHEN]);
  });

  it('returns nobody when this child’s half has nobody, and does not fall back', () => {
    // ⚠ THE WHOLE POINT. An empty pool stalls the step visibly. It must NOT
    // quietly hand the child to the officer for the other half, and it must
    // not skip the step — silently stepping over an approval is the worst
    // available default.
    expect(poolForLevelType([lhen], 'secondary')).toEqual([]);
  });

  it('narrows to cover-everyone approvers when the child’s half is unknown', () => {
    // A null half is not "carry on". Putting the primary officer on a child who
    // might be in secondary is the exact mistake this filtering exists to stop.
    expect(poolForLevelType([lhen, elaine, untagged], null)).toEqual([ANYBODY]);
    expect(poolForLevelType([lhen, elaine], null)).toEqual([]);
  });

  it('keeps the configured order, so “first to act” is not reshuffled', () => {
    const pool = poolForLevelType(
      [untagged, { userId: LHEN, appliesToLevelType: 'primary' }],
      'primary'
    );
    expect(pool).toEqual([ANYBODY, LHEN]);
  });

  it('is empty for a step with nobody on it', () => {
    expect(poolForLevelType([], 'primary')).toEqual([]);
  });
});
