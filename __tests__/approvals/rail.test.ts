import { describe, it, expect } from 'vitest';

import {
  approvalTally,
  describeLadderPosition,
  ladderStepTally,
  ladderStoppedAt,
  railPeopleForStage,
  viewerApprovedLiveStep,
  withApprovalProgress,
  type ApprovalRailStage,
  type LadderStageProgress,
} from '@/lib/approvals/rail';
import { withStepProgress } from '@/lib/change-requests/step-progress';
import type { StagedGradeChangeView } from '@/lib/change-requests/staged-flows';

const stage = (
  stageOrder: number,
  status: ApprovalRailStage['status'],
  resolver: ApprovalRailStage['resolver'] = 'named'
): ApprovalRailStage => ({
  stageOrder,
  label: `Step ${stageOrder}`,
  resolver,
  status,
  decidedAt: null,
  decisionNote: null,
});

const PEOPLE = { 1: 'Ms Joann', 2: 'Ms Christina', 3: 'Mr Tan', 4: 'Ms Lee' };

describe('describeLadderPosition — the one line a table cell has room for', () => {
  it('names the live step, its position, and who has it', () => {
    expect(
      describeLadderPosition(
        [
          stage(1, 'approved'),
          stage(2, 'pending'),
          stage(3, 'waiting'),
          stage(4, 'waiting'),
        ],
        PEOPLE
      )
    ).toBe('Waiting on step 2 of 4 — Ms Christina');
  });

  it('names a form-adviser step by the post, since it has no fixed list', () => {
    expect(
      describeLadderPosition(
        [stage(1, 'pending', 'form_adviser'), stage(2, 'waiting')],
        {}
      )
    ).toBe("Waiting on step 1 of 2 — the child's form class adviser");
  });

  it('says so when the live step has nobody on it', () => {
    expect(describeLadderPosition([stage(1, 'pending')], {})).toBe(
      'Waiting on step 1 of 1 — nobody yet'
    );
  });

  it('reports where a turn-down stopped it', () => {
    expect(
      describeLadderPosition(
        [stage(1, 'approved'), stage(2, 'rejected'), stage(3, 'waiting')],
        PEOPLE
      )
    ).toBe('Turned down at step 2 of 3');
  });

  it('reports where a withdrawal stopped it', () => {
    expect(
      describeLadderPosition(
        [stage(1, 'cancelled'), stage(2, 'waiting')],
        PEOPLE
      )
    ).toBe('Cancelled at step 1 of 2');
  });

  it('reads a finished ladder as approved', () => {
    expect(
      describeLadderPosition(
        [stage(1, 'approved'), stage(2, 'approved')],
        PEOPLE
      )
    ).toBe('Every step approved');
  });
});

// ── "Everyone must approve" (migration 145) ────────────────────────────────

const NAMES = new Map([
  ['u-gary', 'Mr Gary'],
  ['u-nina', 'Ms Nina'],
  ['u-tan', 'Mr Tan'],
]);

const approve = (userId: string, decidedAt = '2026-09-10T02:00:00.000Z') => ({
  userId,
  email: `${userId}@hfse.test`,
  decision: 'approve' as const,
  decidedAt,
});

const ladderStage = (
  over: Partial<LadderStageProgress> & { stageOrder: number }
): LadderStageProgress => ({
  resolver: 'named',
  status: 'pending',
  approverPool: ['u-gary', 'u-nina', 'u-tan'],
  approvalRule: 'all',
  decisions: [],
  ...over,
});

describe('describeLadderPosition — a step that needs everyone', () => {
  it('gives the count instead of the names', () => {
    expect(
      describeLadderPosition(
        [
          stage(1, 'approved'),
          stage(2, 'approved'),
          {
            ...stage(3, 'pending'),
            approvalRule: 'all',
            people: [
              { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
              { name: 'Ms Nina', approvedAt: null },
            ],
          },
          stage(4, 'waiting'),
        ],
        PEOPLE
      )
    ).toBe('Waiting on step 3 of 4 — 1 of 2 approved');
  });

  it('never reads a step with nobody on it as done', () => {
    const empty: ApprovalRailStage = {
      ...stage(1, 'pending'),
      approvalRule: 'all',
      people: [],
    };
    expect(approvalTally(empty)).toEqual({ approved: 0, total: 0 });
    expect(describeLadderPosition([empty], {})).toBe(
      'Waiting on step 1 of 1 — nobody yet'
    );
  });

  it('leaves an "any one of them" step exactly as it was', () => {
    const any: ApprovalRailStage = {
      ...stage(1, 'pending'),
      approvalRule: 'any',
    };
    expect(approvalTally(any)).toBeNull();
    expect(describeLadderPosition([any], { 1: 'Ms Joann' })).toBe(
      'Waiting on step 1 of 1 — Ms Joann'
    );
  });
});

describe('railPeopleForStage / withApprovalProgress', () => {
  it('names everyone on a live step, ticking who has approved', () => {
    const people = railPeopleForStage(
      ladderStage({ stageOrder: 1, decisions: [approve('u-nina')] }),
      NAMES
    );
    expect(people).toEqual([
      { name: 'Mr Gary', approvedAt: null },
      { name: 'Ms Nina', approvedAt: '2026-09-10T02:00:00.000Z' },
      { name: 'Mr Tan', approvedAt: null },
    ]);
  });

  it('carries each approver’s own note, and nothing for someone who wrote none', () => {
    // Migration 146 review: on a step that needs everyone, only the last
    // approver's words reach the step row; the rest live only here.
    const people = railPeopleForStage(
      ladderStage({
        stageOrder: 1,
        decisions: [
          { ...approve('u-gary'), note: '<p>Checked the script.</p>' },
          { ...approve('u-nina'), note: null },
        ],
      }),
      NAMES
    );
    expect(people).toEqual([
      {
        name: 'Mr Gary',
        approvedAt: '2026-09-10T02:00:00.000Z',
        note: '<p>Checked the script.</p>',
      },
      { name: 'Ms Nina', approvedAt: '2026-09-10T02:00:00.000Z' },
      { name: 'Mr Tan', approvedAt: null },
    ]);
    expect(people?.[1]).not.toHaveProperty('note');
  });

  it('never carries the words of a turn-down as an approver’s note', () => {
    const people = railPeopleForStage(
      ladderStage({
        stageOrder: 1,
        status: 'rejected',
        decisions: [
          approve('u-gary'),
          { ...approve('u-nina'), decision: 'reject', note: '<p>No.</p>' },
        ],
      }),
      NAMES
    );
    expect(people).toEqual([
      { name: 'Mr Gary', approvedAt: '2026-09-10T02:00:00.000Z' },
    ]);
  });

  it('counts only a yes — a turn-down is not an approval', () => {
    const tally = ladderStepTally(
      ladderStage({
        stageOrder: 1,
        status: 'rejected',
        decisions: [
          approve('u-gary'),
          { ...approve('u-nina'), decision: 'reject' },
        ],
      })
    );
    expect(tally).toEqual({ approved: 1, total: 3 });
  });

  it('lists only who approved once a step has been turned down', () => {
    // "Not yet" beside the others would promise a decision that is not coming.
    const people = railPeopleForStage(
      ladderStage({
        stageOrder: 1,
        status: 'rejected',
        decisions: [
          approve('u-gary'),
          { ...approve('u-nina'), decision: 'reject' },
        ],
      }),
      NAMES
    );
    expect(people?.map((p) => p.name)).toEqual(['Mr Gary']);
  });

  it('counts the people on the step now, not someone taken off it', () => {
    const tally = ladderStepTally(
      ladderStage({
        stageOrder: 1,
        approverPool: ['u-gary', 'u-nina'],
        decisions: [approve('u-tan'), approve('u-gary')],
      })
    );
    expect(tally).toEqual({ approved: 1, total: 2 });
  });

  it('adds nothing to an "any one of them" step or a form adviser step', () => {
    expect(
      railPeopleForStage(
        ladderStage({ stageOrder: 1, approvalRule: 'any' }),
        NAMES
      )
    ).toBeUndefined();
    expect(
      ladderStepTally(
        ladderStage({
          stageOrder: 1,
          resolver: 'form_adviser',
          approverPool: [],
        })
      )
    ).toBeNull();
  });

  it('merges the setting and the people onto the rail stages by step number', () => {
    const merged = withApprovalProgress(
      [stage(1, 'approved'), stage(2, 'pending')],
      [
        ladderStage({ stageOrder: 1, status: 'approved', approvalRule: 'any' }),
        ladderStage({ stageOrder: 2, decisions: [approve('u-gary')] }),
      ],
      NAMES
    );
    expect(merged[0].approvalRule).toBe('any');
    expect(merged[0].people).toBeUndefined();
    expect(merged[1].approvalRule).toBe('all');
    expect(approvalTally(merged[1])).toEqual({ approved: 1, total: 3 });
    // No account ids reach what the browser is handed.
    expect(JSON.stringify(merged)).not.toContain('u-gary');
  });
});

describe('viewerApprovedLiveStep', () => {
  const ladder = (
    stages: LadderStageProgress[],
    status = 'pending' as const
  ) => ({
    status,
    stages,
  });

  it('is true for someone who approved a live step that still waits on others', () => {
    const l = ladder([
      ladderStage({ stageOrder: 1, decisions: [approve('u-gary')] }),
    ]);
    expect(viewerApprovedLiveStep(l, 'u-gary')).toBe(true);
    expect(viewerApprovedLiveStep(l, 'u-nina')).toBe(false);
  });

  it('is false on an "any one of them" step, or once the request has closed', () => {
    expect(
      viewerApprovedLiveStep(
        ladder([
          ladderStage({
            stageOrder: 1,
            approvalRule: 'any',
            decisions: [approve('u-gary')],
          }),
        ]),
        'u-gary'
      )
    ).toBe(false);
    expect(
      viewerApprovedLiveStep(
        {
          status: 'approved',
          stages: [
            ladderStage({
              stageOrder: 1,
              status: 'approved',
              decisions: [approve('u-gary')],
            }),
          ],
        },
        'u-gary'
      )
    ).toBe(false);
  });

  it('is false for someone who approved an EARLIER step', () => {
    // For them "it has moved on" is exactly right.
    expect(
      viewerApprovedLiveStep(
        ladder([
          ladderStage({
            stageOrder: 1,
            status: 'approved',
            decisions: [approve('u-gary')],
          }),
          ladderStage({ stageOrder: 2 }),
        ]),
        'u-gary'
      )
    ).toBe(false);
  });
});

describe('withStepProgress — a grade change row', () => {
  const view: StagedGradeChangeView = {
    approvalRequestId: 'req-1',
    flow: 'markbook.grade_change_aeb',
    routeLabel: 'Academic and Examination Board',
    requestStatus: 'pending',
    currentStageOrder: 1,
    stages: [
      {
        ...stage(1, 'pending'),
        decidedBy: null,
        decidedByEmail: null,
      },
    ],
    peopleByStageOrder: { 1: 'Mr Gary, Ms Nina, Mr Tan' },
    decidedByNames: {},
    // What the view builder would say before it learnt about "everyone".
    canDecide: true,
  };

  it('turns the buttons off for someone who has already approved', () => {
    const out = withStepProgress(
      view,
      {
        status: 'pending',
        stages: [
          ladderStage({ stageOrder: 1, decisions: [approve('u-gary')] }),
        ],
      },
      'u-gary',
      NAMES
    );
    expect(out?.viewerApprovedWaiting).toBe(true);
    expect(out?.canDecide).toBe(false);
    expect(approvalTally(out!.stages[0])).toEqual({ approved: 1, total: 3 });
  });

  it('leaves a colleague still to approve able to decide', () => {
    const out = withStepProgress(
      view,
      {
        status: 'pending',
        stages: [
          ladderStage({ stageOrder: 1, decisions: [approve('u-gary')] }),
        ],
      },
      'u-nina',
      NAMES
    );
    expect(out?.viewerApprovedWaiting).toBe(false);
    expect(out?.canDecide).toBe(true);
  });

  it('passes a missing view straight through', () => {
    expect(
      withStepProgress(null, { status: 'pending', stages: [] }, 'u-gary', NAMES)
    ).toBeNull();
  });
});

describe('ladderStoppedAt', () => {
  it('finds a turn-down or a withdrawal, and nothing on a ladder still moving', () => {
    expect(
      ladderStoppedAt([stage(1, 'approved'), stage(2, 'rejected')])?.stageOrder
    ).toBe(2);
    expect(ladderStoppedAt([stage(1, 'cancelled')])?.stageOrder).toBe(1);
    expect(
      ladderStoppedAt([stage(1, 'approved'), stage(2, 'pending')])
    ).toBeUndefined();
  });
});
