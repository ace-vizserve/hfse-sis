import { describe, expect, it } from 'vitest';

import {
  advanceApproval,
  canActOn,
  everyoneApproved,
  reevaluateStage,
  repointStage,
  type ApprovalActor,
  type RequestSnapshot,
  type StageSnapshot,
} from '@/lib/approvals/state-machine';

// A step's rule (migration 145): 'any' — the first to act carries it, the only
// rule there was before — or 'all' — everyone on the step must approve.
//
// The SQL decides; `state-machine-parity.test.ts` pins it to this reducer.
// This file is the truth table for the rule itself.

const CHANDANA = 'u-chandana';
const CHRISTINA = 'u-christina';
const NORMA = 'u-norma';
const STRANGER = 'u-stranger';

function actor(userId: string): ApprovalActor {
  return { userId, advisesSection: () => false };
}

function step(overrides: Partial<StageSnapshot> = {}): StageSnapshot {
  return {
    stageOrder: 1,
    resolver: 'named',
    status: 'pending',
    approverPool: [CHANDANA, CHRISTINA],
    sectionId: null,
    approvalRule: 'all',
    approvedBy: [],
    ...overrides,
  };
}

/** The AEB shape: a step that needs both, then one more person. */
function request(
  first: Partial<StageSnapshot> = {},
  overrides: Partial<RequestSnapshot> = {}
): RequestSnapshot {
  return {
    status: 'pending',
    currentStageOrder: 1,
    stages: [
      step(first),
      step({
        stageOrder: 2,
        status: 'waiting',
        approverPool: [NORMA],
        approvalRule: 'any',
      }),
    ],
    ...overrides,
  };
}

describe("an 'all' step", () => {
  it('waits after the first approval, and keeps the yes', () => {
    expect(advanceApproval(request(), 'approve', actor(CHANDANA))).toEqual({
      outcome: 'recorded',
      requestStatus: 'pending',
      decidedStageOrder: 1,
      nextStageOrder: null,
    });
  });

  it('moves on when the last person on it approves', () => {
    expect(
      advanceApproval(
        request({ approvedBy: [CHANDANA] }),
        'approve',
        actor(CHRISTINA)
      )
    ).toEqual({
      outcome: 'advanced',
      requestStatus: 'pending',
      decidedStageOrder: 1,
      nextStageOrder: 2,
    });
  });

  it('completes the request when it was the last step', () => {
    const oneStep: RequestSnapshot = {
      status: 'pending',
      currentStageOrder: 1,
      stages: [step({ approvedBy: [CHANDANA] })],
    };
    expect(advanceApproval(oneStep, 'approve', actor(CHRISTINA)).outcome).toBe(
      'completed'
    );
  });

  it('answers already_approved to a second yes from the same person', () => {
    const r = request({ approvedBy: [CHANDANA] });
    expect(advanceApproval(r, 'approve', actor(CHANDANA)).outcome).toBe(
      'already_approved'
    );
    // And they are not offered the button again.
    expect(canActOn(r, actor(CHANDANA))).toBe(false);
    expect(canActOn(r, actor(CHRISTINA))).toBe(true);
  });

  it('answers already_approved to a turn-down from somebody who already said yes', () => {
    expect(
      advanceApproval(
        request({ approvedBy: [CHANDANA] }),
        'reject',
        actor(CHANDANA)
      ).outcome
    ).toBe('already_approved');
  });

  it('is ended by one rejection, even after someone else approved', () => {
    expect(
      advanceApproval(
        request({ approvedBy: [CHANDANA] }),
        'reject',
        actor(CHRISTINA)
      )
    ).toEqual({
      outcome: 'rejected',
      requestStatus: 'rejected',
      decidedStageOrder: 1,
      nextStageOrder: null,
    });
  });

  it('still refuses somebody not on it as not_authorised, before already_approved', () => {
    // A person taken off the step keeps their yes on record; they are told it
    // is not theirs, not that they already approved it.
    expect(
      advanceApproval(
        request({ approverPool: [CHRISTINA], approvedBy: [CHANDANA] }),
        'approve',
        actor(CHANDANA)
      ).outcome
    ).toBe('not_authorised');
    expect(advanceApproval(request(), 'approve', actor(STRANGER)).outcome).toBe(
      'not_authorised'
    );
  });
});

describe('an empty pool never counts as everyone approved', () => {
  it('everyoneApproved is false for nobody', () => {
    expect(everyoneApproved([], [])).toBe(false);
    expect(everyoneApproved([], [CHANDANA])).toBe(false);
    expect(everyoneApproved([CHANDANA], [CHANDANA])).toBe(true);
    expect(everyoneApproved([CHANDANA, CHRISTINA], [CHANDANA])).toBe(false);
  });

  it('reevaluating an empty all step leaves it where it is', () => {
    expect(
      reevaluateStage(request({ approverPool: [], approvedBy: [CHANDANA] }), 1)
        .outcome
    ).toBe('unchanged');
  });
});

describe("an 'any' step is exactly what it was", () => {
  it('moves on at the first approval', () => {
    expect(
      advanceApproval(
        request({ approvalRule: 'any' }),
        'approve',
        actor(CHANDANA)
      ).outcome
    ).toBe('advanced');
  });

  it('reads a step with no rule at all as any', () => {
    const noRule = request({ approvalRule: undefined, approvedBy: undefined });
    expect(advanceApproval(noRule, 'approve', actor(CHANDANA)).outcome).toBe(
      'advanced'
    );
    expect(canActOn(noRule, actor(CHANDANA))).toBe(true);
  });

  it('is never reevaluated', () => {
    expect(
      reevaluateStage(
        request({ approvalRule: 'any', approvedBy: [CHANDANA, CHRISTINA] }),
        1
      ).outcome
    ).toBe('unchanged');
  });
});

describe('reevaluating after the people change', () => {
  it('moves the step on once the one hold-out is taken off it', () => {
    // Chandana approved; Christina never did and has left the step.
    expect(
      reevaluateStage(
        request({ approverPool: [CHANDANA], approvedBy: [CHANDANA] }),
        1
      )
    ).toEqual({
      outcome: 'advanced',
      requestStatus: 'pending',
      decidedStageOrder: 1,
      nextStageOrder: 2,
    });
  });

  it('does nothing while somebody on it has still not approved', () => {
    expect(
      reevaluateStage(request({ approvedBy: [CHANDANA] }), 1).outcome
    ).toBe('unchanged');
  });

  it('does nothing to a step that is not the live one, or a closed request', () => {
    const ready = { approverPool: [CHANDANA], approvedBy: [CHANDANA] };
    expect(reevaluateStage(request(ready), 2).outcome).toBe('unchanged');
    expect(
      reevaluateStage(request(ready, { status: 'cancelled' }), 1).outcome
    ).toBe('unchanged');
  });
});

// Migration 146 — `approval_repoint_request_stage`. The people or the rule of a
// step change under requests already on it, live step included, under the lock.
describe('repointing a step already in flight', () => {
  it('tightening a live "any" step to "everyone" closes nothing', () => {
    // A pending 'any' step has no approvals: the first yes would have closed it.
    expect(
      repointStage(
        request({ approvalRule: 'any', approvedBy: [] }),
        1,
        [CHANDANA, CHRISTINA],
        'all'
      )
    ).toMatchObject({ outcome: 'unchanged', closedBy: null });
  });

  it('relaxing a live "everyone" step with one approval closes it in the earliest approver’s name', () => {
    const pool = [CHANDANA, CHRISTINA, NORMA];
    expect(
      repointStage(
        request({ approverPool: pool, approvedBy: [CHRISTINA, CHANDANA] }),
        1,
        pool,
        'any'
      )
    ).toEqual({
      outcome: 'advanced',
      requestStatus: 'pending',
      decidedStageOrder: 1,
      nextStageOrder: 2,
      closedBy: CHRISTINA,
    });
  });

  it('relaxing counts only approvals by people still on the step', () => {
    // Chandana approved and was taken off in the same edit.
    expect(
      repointStage(request({ approvedBy: [CHANDANA] }), 1, [CHRISTINA], 'any')
        .outcome
    ).toBe('unchanged');
  });

  it('relaxing with nobody approved yet leaves it waiting', () => {
    expect(
      repointStage(request(), 1, [CHANDANA, CHRISTINA], 'any').outcome
    ).toBe('unchanged');
  });

  it('taking the one hold-out off an "everyone" step closes it in the latest approver’s name', () => {
    expect(
      repointStage(
        request({ approvedBy: [CHRISTINA, CHANDANA] }),
        1,
        [CHANDANA, CHRISTINA],
        'all'
      )
    ).toMatchObject({ outcome: 'advanced', closedBy: CHANDANA });
    expect(
      repointStage(request({ approvedBy: [CHANDANA] }), 1, [CHANDANA], 'all')
    ).toMatchObject({ outcome: 'advanced', closedBy: CHANDANA });
  });

  it('never closes an "everyone" step that was emptied', () => {
    expect(
      repointStage(request({ approvedBy: [CHANDANA] }), 1, [], 'all').outcome
    ).toBe('unchanged');
  });

  it('completes the request when the live step was the last', () => {
    const oneStep: RequestSnapshot = {
      status: 'pending',
      currentStageOrder: 1,
      stages: [step({ approvedBy: [CHANDANA] })],
    };
    expect(
      repointStage(oneStep, 1, [CHANDANA, CHRISTINA], 'any')
    ).toMatchObject({
      outcome: 'completed',
      requestStatus: 'approved',
      closedBy: CHANDANA,
    });
  });

  it('brings a waiting step in line without closing it, whatever its approvals', () => {
    expect(
      repointStage(request({ approvedBy: [CHANDANA] }), 2, [NORMA], 'any')
        .outcome
    ).toBe('unchanged');
  });

  it('skips a closed request, a decided step, or a step that is not there', () => {
    const ready = { approvedBy: [CHANDANA] };
    expect(
      repointStage(request(ready, { status: 'approved' }), 1, [CHANDANA], 'any')
        .outcome
    ).toBe('skipped');
    expect(
      repointStage(
        request({ ...ready, status: 'approved' }),
        1,
        [CHANDANA],
        'any'
      ).outcome
    ).toBe('skipped');
    expect(repointStage(request(ready), 9, [CHANDANA], 'any').outcome).toBe(
      'skipped'
    );
    expect(repointStage(null, 1, [CHANDANA], 'any').outcome).toBe('skipped');
  });

  it('never closes a form adviser step', () => {
    expect(
      repointStage(
        request({
          resolver: 'form_adviser',
          approverPool: [],
          sectionId: 'sec-1',
          approvalRule: 'any',
          approvedBy: [CHANDANA],
        }),
        1,
        [CHANDANA],
        'all'
      ).outcome
    ).toBe('unchanged');
  });
});
