import { describe, expect, it } from 'vitest';

import {
  advanceApproval,
  canActOn,
  currentStage,
  stageAllows,
  type ApprovalActor,
  type RequestSnapshot,
  type StageSnapshot,
} from '@/lib/approvals/state-machine';

// The approval rules, exercised as a truth table.
//
// The SQL in migration 127 is what actually decides — it holds the lock — and
// `state-machine-parity.test.ts` pins the two together. This file is about the
// rules themselves: what happens on the second click, what a rejection does to
// the steps after it, and who may act.

const ADVISER = 'adviser-1';
const OIC = 'oic-1';
const STRANGER = 'stranger-1';
const SECTION = 'section-1';

function actor(userId: string, advisedSections: string[] = []): ApprovalActor {
  return {
    userId,
    advisesSection: (sectionId) => advisedSections.includes(sectionId),
  };
}

function derivedStage(overrides: Partial<StageSnapshot> = {}): StageSnapshot {
  return {
    stageOrder: 1,
    resolver: 'form_adviser',
    status: 'pending',
    approverPool: [],
    sectionId: SECTION,
    ...overrides,
  };
}

function namedStage(overrides: Partial<StageSnapshot> = {}): StageSnapshot {
  return {
    stageOrder: 2,
    resolver: 'named',
    status: 'waiting',
    approverPool: [OIC],
    sectionId: null,
    ...overrides,
  };
}

/** The flow this build actually wires: the adviser, then the officer. */
function twoStageRequest(
  overrides: Partial<RequestSnapshot> = {}
): RequestSnapshot {
  return {
    status: 'pending',
    currentStageOrder: 1,
    stages: [derivedStage(), namedStage()],
    ...overrides,
  };
}

describe('stageAllows', () => {
  it('lets a named approver act on their own step', () => {
    expect(stageAllows(namedStage(), actor(OIC))).toBe(true);
  });

  it('refuses somebody not on a named step', () => {
    expect(stageAllows(namedStage(), actor(STRANGER))).toBe(false);
  });

  it('resolves a derived step against the section, not a frozen list', () => {
    // The whole reason `form_adviser` exists: nobody maintains a list, and a
    // relief teacher covering this week answers true here without anybody
    // editing anything.
    expect(stageAllows(derivedStage(), actor(ADVISER, [SECTION]))).toBe(true);
    expect(stageAllows(derivedStage(), actor(ADVISER, ['other']))).toBe(false);
  });

  it('refuses a derived step with no section', () => {
    expect(
      stageAllows(derivedStage({ sectionId: null }), actor(ADVISER, [SECTION]))
    ).toBe(false);
  });
});

describe('advanceApproval — the happy path', () => {
  it('moves to the next step when the first approves', () => {
    const result = advanceApproval(
      twoStageRequest(),
      'approve',
      actor(ADVISER, [SECTION])
    );
    expect(result).toEqual({
      outcome: 'advanced',
      requestStatus: 'pending',
      decidedStageOrder: 1,
      nextStageOrder: 2,
    });
  });

  it('completes when the LAST step approves', () => {
    const request = twoStageRequest({
      currentStageOrder: 2,
      stages: [
        derivedStage({ status: 'approved' }),
        namedStage({ status: 'pending' }),
      ],
    });
    const result = advanceApproval(request, 'approve', actor(OIC));
    expect(result.outcome).toBe('completed');
    expect(result.requestStatus).toBe('approved');
    expect(result.nextStageOrder).toBeNull();
  });

  it('completes immediately on a one-step flow', () => {
    const request: RequestSnapshot = {
      status: 'pending',
      currentStageOrder: 1,
      stages: [derivedStage()],
    };
    expect(
      advanceApproval(request, 'approve', actor(ADVISER, [SECTION])).outcome
    ).toBe('completed');
  });
});

describe('advanceApproval — a rejection ends it', () => {
  it('ends the whole request at the first step', () => {
    const result = advanceApproval(
      twoStageRequest(),
      'reject',
      actor(ADVISER, [SECTION])
    );
    expect(result).toEqual({
      outcome: 'rejected',
      requestStatus: 'rejected',
      decidedStageOrder: 1,
      nextStageOrder: null,
    });
  });

  it('ends it at the last step too, and names no next step', () => {
    const request = twoStageRequest({
      currentStageOrder: 2,
      stages: [
        derivedStage({ status: 'approved' }),
        namedStage({ status: 'pending' }),
      ],
    });
    const result = advanceApproval(request, 'reject', actor(OIC));
    expect(result.outcome).toBe('rejected');
    expect(result.nextStageOrder).toBeNull();
  });
});

describe('advanceApproval — the things that are NOT errors', () => {
  it('reports the second person to click, rather than authorising them out', () => {
    // ⚠ THE ORDER OF THE CHECKS IS THE POINT. With several people on a step,
    // being second is the normal case, not an intrusion. Answering
    // "not authorised" here would tell a colleague they may not do something
    // they very much may — it simply no longer needs doing.
    const request = twoStageRequest({
      currentStageOrder: 1,
      stages: [derivedStage({ status: 'approved' }), namedStage()],
    });
    expect(
      advanceApproval(request, 'approve', actor(ADVISER, [SECTION])).outcome
    ).toBe('stage_already_decided');
  });

  it('reports a request that has already finished', () => {
    const request = twoStageRequest({ status: 'approved' });
    expect(
      advanceApproval(request, 'approve', actor(ADVISER, [SECTION])).outcome
    ).toBe('request_closed');
  });

  it('reports a request that does not exist', () => {
    expect(advanceApproval(null, 'approve', actor(ADVISER)).outcome).toBe(
      'request_not_found'
    );
  });
});

describe('advanceApproval — authorisation', () => {
  it('refuses a stranger', () => {
    expect(
      advanceApproval(twoStageRequest(), 'approve', actor(STRANGER)).outcome
    ).toBe('not_authorised');
  });

  it('refuses the SECOND-step approver while the first step is live', () => {
    // The officer in charge is a real approver on this request — just not yet.
    // Ordered means ordered.
    expect(
      advanceApproval(twoStageRequest(), 'approve', actor(OIC)).outcome
    ).toBe('not_authorised');
  });

  it('refuses the first-step adviser once it has moved past them', () => {
    const request = twoStageRequest({
      currentStageOrder: 2,
      stages: [
        derivedStage({ status: 'approved' }),
        namedStage({ status: 'pending' }),
      ],
    });
    expect(
      advanceApproval(request, 'approve', actor(ADVISER, [SECTION])).outcome
    ).toBe('not_authorised');
  });
});

describe('advanceApproval — a step with nobody on it', () => {
  it('stalls rather than skipping, which is the live case today', () => {
    // Nobody at HFSE holds the officer-in-charge post yet. The request must sit
    // there visibly, not slide through: silently stepping over an approval is
    // the worst possible default.
    const request = twoStageRequest({
      currentStageOrder: 2,
      stages: [
        derivedStage({ status: 'approved' }),
        namedStage({ status: 'pending', approverPool: [] }),
      ],
    });
    expect(advanceApproval(request, 'approve', actor(OIC)).outcome).toBe(
      'not_authorised'
    );
    expect(request.status).toBe('pending');
  });
});

describe('currentStage / canActOn', () => {
  it('finds the live step', () => {
    expect(currentStage(twoStageRequest())?.stageOrder).toBe(1);
  });

  it('returns null for a request that is not there', () => {
    expect(currentStage(null)).toBeNull();
    expect(currentStage(undefined)).toBeNull();
  });

  it('is false for a closed request even for the right person', () => {
    expect(
      canActOn(
        twoStageRequest({ status: 'rejected' }),
        actor(ADVISER, [SECTION])
      )
    ).toBe(false);
  });

  it('agrees with advanceApproval about who may act', () => {
    // A screen that offers a button the server then refuses is worse than one
    // that explains. These two must not drift.
    const request = twoStageRequest();
    for (const who of [
      actor(ADVISER, [SECTION]),
      actor(OIC),
      actor(STRANGER),
    ]) {
      const allowed = canActOn(request, who);
      const outcome = advanceApproval(request, 'approve', who).outcome;
      expect(allowed).toBe(outcome !== 'not_authorised');
    }
  });
});
