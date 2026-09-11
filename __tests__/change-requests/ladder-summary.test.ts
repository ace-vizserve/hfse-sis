import { describe, expect, it } from 'vitest';

import {
  NO_STEPS_CONFIGURED_MESSAGE,
  gradeChangeLadderProblem,
  stepPeopleLabel,
  summariseGradeChangeLadder,
  type ConfiguredLadderStep,
} from '@/lib/change-requests/ladder-summary';

// The filing screen and the filing route read a grade change's steps through
// the same two functions, so the reason a disabled Submit gives is exactly the
// sentence the route answers with.

const NAMES = new Map([
  ['u-chandana', 'Ms Chandana'],
  ['u-gary', 'Mr Gary'],
  ['u-nina', 'Ms Nina'],
  ['u-lhen', 'Ms Lhen'],
]);

const LADDER: ConfiguredLadderStep[] = [
  {
    label: 'Academic coordinator',
    resolver: 'named',
    approvers: [{ userId: 'u-chandana', appliesToLevelType: null }],
  },
  {
    label: 'Form class adviser',
    resolver: 'form_adviser',
    approvers: [],
  },
  {
    label: 'Officer in charge',
    resolver: 'named',
    approvers: [
      { userId: 'u-gary', appliesToLevelType: 'secondary' },
      { userId: 'u-nina', appliesToLevelType: 'secondary' },
      { userId: 'u-lhen', appliesToLevelType: 'primary' },
    ],
  },
];

describe('summariseGradeChangeLadder', () => {
  it('numbers the steps 1..n and keeps only the people covering this half', () => {
    const steps = summariseGradeChangeLadder(LADDER, 'secondary', NAMES);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(steps[0].people).toEqual(['Ms Chandana']);
    expect(steps[1]).toMatchObject({ kind: 'form_adviser', people: [] });
    expect(steps[2].people).toEqual(['Mr Gary', 'Ms Nina']);
  });

  it('never shows a person twice on a step', () => {
    const steps = summariseGradeChangeLadder(
      [
        {
          label: 'Board',
          resolver: 'named',
          approvers: [
            { userId: 'u-gary', appliesToLevelType: null },
            { userId: 'u-gary', appliesToLevelType: 'primary' },
          ],
        },
      ],
      'primary',
      NAMES
    );
    expect(steps[0].people).toEqual(['Mr Gary']);
  });
});

describe('gradeChangeLadderProblem', () => {
  it('refuses when no steps are set up', () => {
    expect(gradeChangeLadderProblem([])).toBe(NO_STEPS_CONFIGURED_MESSAGE);
  });

  it('names the step nobody covers for this class', () => {
    // A primary class: step 3 only has secondary people... and Ms Lhen. Take
    // her away and the step is empty for this class.
    const ladder = LADDER.map((s, i) =>
      i === 2
        ? {
            ...s,
            approvers: s.approvers.filter((a) => a.userId !== 'u-lhen'),
          }
        : s
    );
    expect(
      gradeChangeLadderProblem(
        summariseGradeChangeLadder(ladder, 'primary', NAMES)
      )
    ).toBe(
      'Nobody is set up to approve step 3 (Officer in charge) for this class. Ask the superadmin to add someone in SIS Admin → Approvers.'
    );
  });

  it('does not refuse a form adviser step — its people are worked out when it is reached', () => {
    expect(
      gradeChangeLadderProblem(
        summariseGradeChangeLadder(LADDER, 'secondary', NAMES)
      )
    ).toBeNull();
  });
});

// ── Nobody approves their own request ─────────────────────────────────────

describe('the person filing is left off every step', () => {
  it('drops the filer from a step that has other people on it', () => {
    const ladder: ConfiguredLadderStep[] = [
      {
        label: 'Grade change approvers',
        resolver: 'named',
        approvers: [
          { userId: 'u-gary', appliesToLevelType: null },
          { userId: 'u-nina', appliesToLevelType: null },
        ],
      },
    ];
    const steps = summariseGradeChangeLadder(ladder, 'secondary', NAMES, {
      filerId: 'u-gary',
    });
    expect(steps[0].people).toEqual(['Ms Nina']);
    expect(steps[0].onlyFiler).toBeUndefined();
    expect(gradeChangeLadderProblem(steps)).toBeNull();
  });

  it('refuses in plain words when the filer is the only person on a step', () => {
    // Ms Chandana is the academic coordinator and the only person on step 1.
    const steps = summariseGradeChangeLadder(LADDER, 'secondary', NAMES, {
      filerId: 'u-chandana',
    });
    expect(steps[0]).toMatchObject({ people: [], onlyFiler: true });
    expect(gradeChangeLadderProblem(steps)).toBe(
      "You're the only person on step 1 (Academic coordinator), and you can't approve your own request. Ask the superadmin to add someone else."
    );
    expect(stepPeopleLabel(steps[0])).toBe('Nobody but you');
  });

  it('still says "nobody is set up" for a step that was empty anyway', () => {
    const ladder = LADDER.map((s, i) =>
      i === 0 ? { ...s, approvers: [] } : s
    );
    const steps = summariseGradeChangeLadder(ladder, 'secondary', NAMES, {
      filerId: 'u-chandana',
    });
    expect(steps[0].onlyFiler).toBeUndefined();
    expect(gradeChangeLadderProblem(steps)).toMatch(/^Nobody is set up/);
  });

  it('never refuses a form adviser step on the filer’s account — that is decided when someone acts', () => {
    const steps = summariseGradeChangeLadder(
      [
        {
          label: 'Form class adviser',
          resolver: 'form_adviser',
          approvers: [],
        },
      ],
      'primary',
      NAMES,
      { filerId: 'u-gary' }
    );
    expect(gradeChangeLadderProblem(steps)).toBeNull();
  });

  it('leaves every step alone when no filer is given', () => {
    const steps = summariseGradeChangeLadder(LADDER, 'secondary', NAMES);
    expect(steps[0].people).toEqual(['Ms Chandana']);
  });
});

describe('stepPeopleLabel', () => {
  it('reads the way a person says it', () => {
    const steps = summariseGradeChangeLadder(LADDER, 'secondary', NAMES);
    expect(stepPeopleLabel(steps[0])).toBe('Ms Chandana');
    expect(stepPeopleLabel(steps[1])).toBe('Form class adviser');
    expect(stepPeopleLabel(steps[2])).toBe('Mr Gary or Ms Nina');
    expect(
      stepPeopleLabel({
        order: 1,
        label: 'Board',
        kind: 'named',
        people: ['A', 'B', 'C'],
      })
    ).toBe('A, B or C');
  });

  // Migration 145. The teacher sees, before sending, that a step needs both.
  it('says "and" for a step that needs everyone on it', () => {
    const steps = summariseGradeChangeLadder(
      [
        {
          label: 'Board',
          resolver: 'named',
          approval_rule: 'all',
          approvers: [
            { userId: 'u-gary', appliesToLevelType: null },
            { userId: 'u-nina', appliesToLevelType: null },
          ],
        },
        {
          label: 'Pair',
          resolver: 'named',
          approvers: [
            { userId: 'u-gary', appliesToLevelType: null },
            { userId: 'u-nina', appliesToLevelType: null },
          ],
        },
      ],
      'secondary',
      NAMES
    );
    expect(steps[0].approvalRule).toBe('all');
    expect(stepPeopleLabel(steps[0])).toBe('Mr Gary and Ms Nina');
    // A step from before the setting existed reads as "any one of them".
    expect(steps[1].approvalRule).toBe('any');
    expect(stepPeopleLabel(steps[1])).toBe('Mr Gary or Ms Nina');
  });
});
