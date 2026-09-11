import { describe, expect, it } from 'vitest';

import {
  canRequireEveryone,
  classifyStagedFlowReadiness,
  describeStepsInOrder,
  joinNames,
} from '@/lib/approvals/readiness';
import {
  DECLARATION_APPROVAL_FLOW,
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type ApproverLevelScope,
} from '@/lib/schemas/approval-flows';

/**
 * Whether a staged flow can actually finish, and how loudly it says otherwise.
 *
 * ⚠ THE EMPTY-STEP CASE IS THE LIVE ONE. Nobody at HFSE holds the "Officer in
 * Charge" post yet, so a declaration will clear the adviser and then stop dead.
 * That is by design — silently stepping over an approval step is the worst
 * possible default — which puts the whole weight on this classifier saying so.
 */

const named = (approvers: number) => ({
  label: 'Officer in charge',
  resolver: 'named' as const,
  // Everyone on the step covers every child unless a test says otherwise —
  // which is what every row meant before migration 128.
  approvers: Array.from({ length: approvers }, () => ({
    appliesToLevelType: null,
  })),
});

/** A named step whose people are each limited to one half of the school. */
const namedScoped = (scopes: Array<ApproverLevelScope | null>) => ({
  label: 'Officer in charge',
  resolver: 'named' as const,
  approvers: scopes.map((appliesToLevelType) => ({ appliesToLevelType })),
});

const BOTH_HALVES: ApproverLevelScope[] = ['primary', 'secondary'];

const derived = () => ({
  label: 'Form class adviser',
  resolver: 'form_adviser' as const,
  approvers: [],
});

describe('classifyStagedFlowReadiness', () => {
  it('is ready when every named step has somebody', () => {
    const result = classifyStagedFlowReadiness([derived(), named(1)]);
    expect(result.tone).toBe('mint');
    expect(result.warning).toBeNull();
  });

  it('does NOT require two people on a step', () => {
    // ⚠ The deliberate difference from the retired two-approver pool. One
    // person per step is enough, because a step is a station and not a quorum.
    expect(classifyStagedFlowReadiness([named(1)]).tone).toBe('mint');
  });

  it('does not treat a derived step with nobody listed as empty', () => {
    // A `form_adviser` step is SUPPOSED to have an empty list — its people come
    // from the class. Flagging it would train the reader to ignore the warning.
    expect(classifyStagedFlowReadiness([derived()]).tone).toBe('mint');
  });

  it('names the empty step, so the fix is obvious', () => {
    const result = classifyStagedFlowReadiness([derived(), named(0)]);
    expect(result.tone).toBe('destructive');
    expect(result.warning).toContain('Officer in charge');
    expect(result.label).toBe('1 step has nobody in it');
  });

  it('counts several empty steps', () => {
    const result = classifyStagedFlowReadiness([named(0), named(0)]);
    expect(result.label).toBe('2 steps have nobody in them');
  });

  it('says a flow with no steps at all cannot approve anything', () => {
    const result = classifyStagedFlowReadiness(
      [],
      undefined,
      DECLARATION_APPROVAL_FLOW
    );
    expect(result.tone).toBe('destructive');
    expect(result.warning).toContain('sit waiting');
  });

  it('names nobody in particular when it is not told which flow', () => {
    const result = classifyStagedFlowReadiness([]);
    expect(result.tone).toBe('destructive');
    expect(result.warning).not.toMatch(/parent|teacher/i);
  });

  it('speaks plainly — no schema words anywhere', () => {
    // Read by a school administrator, not a developer.
    for (const stages of [[], [named(0)], [derived(), named(1)]]) {
      const result = classifyStagedFlowReadiness(stages);
      const text = `${result.label} ${result.warning ?? ''}`;
      expect(text).not.toMatch(
        /resolver|form_adviser|approver_pool|stage_order|null/
      );
    }
  });
});

/**
 * A step can have people on it and still stall for half the school.
 *
 * ⚠ THIS IS THE BUG THAT SHIPPED. Ms Lhen is the officer in charge of PRIMARY
 * and Ms Elaine of SECONDARY, but both were put on one step sharing the job,
 * so either could decide either half's children. Once each is limited to their
 * own half the opposite risk appears: name somebody for Primary and nobody for
 * Secondary, and every secondary child's filing reaches that step and stops.
 * Nothing hands them to the other half's officer and nothing skips the step —
 * so the screen has to say so before a parent asks why nothing happened.
 */
describe('classifyStagedFlowReadiness — halves of the school', () => {
  it('is ready when each half has somebody', () => {
    const result = classifyStagedFlowReadiness(
      [derived(), namedScoped(['primary', 'secondary'])],
      BOTH_HALVES
    );
    expect(result.tone).toBe('mint');
    expect(result.warning).toBeNull();
  });

  it('warns, and names the half, when one half has nobody', () => {
    const result = classifyStagedFlowReadiness(
      [derived(), namedScoped(['primary'])],
      BOTH_HALVES
    );
    expect(result.tone).toBe('destructive');
    expect(result.label).toBe('Nobody covers Secondary');
    expect(result.warning).toContain('Officer in charge');
    expect(result.warning).toContain('Secondary');
    // ⚠ It must NOT suggest the primary officer will pick these up.
    expect(result.warning).toContain('stop there');
  });

  it('treats one person covering every child as covering both halves', () => {
    // A `null` scope is the default and means exactly this. Somebody untagged
    // beside somebody tagged still covers the gap.
    const result = classifyStagedFlowReadiness(
      [namedScoped([null, 'primary'])],
      BOTH_HALVES
    );
    expect(result.tone).toBe('mint');
  });

  it('reports both halves when neither is covered', () => {
    const result = classifyStagedFlowReadiness(
      [namedScoped(['preschool'])],
      BOTH_HALVES
    );
    expect(result.label).toBe('Nobody covers Primary and Secondary');
  });

  it('says nothing about a half the school does not run', () => {
    // HFSE has no preschool classes. Offering a warning about one would be a
    // warning nobody can act on, which teaches people to ignore the badge.
    const result = classifyStagedFlowReadiness(
      [namedScoped(['primary', 'secondary'])],
      BOTH_HALVES
    );
    expect(result.warning).toBeNull();
  });

  it('skips the check entirely when the caller did not say which halves exist', () => {
    // Every other caller of this classifier keeps its old behaviour rather
    // than having a warning invented from an assumed school shape.
    const result = classifyStagedFlowReadiness([namedScoped(['primary'])]);
    expect(result.tone).toBe('mint');
  });

  it('reports a step with nobody at all before a half-coverage gap', () => {
    // An empty step is the bigger problem and the clearer instruction.
    const result = classifyStagedFlowReadiness(
      [named(0), namedScoped(['primary'])],
      BOTH_HALVES
    );
    expect(result.label).toBe('1 step has nobody in it');
  });

  it('speaks plainly about halves too', () => {
    const result = classifyStagedFlowReadiness(
      [namedScoped(['primary'])],
      BOTH_HALVES
    );
    const text = `${result.label} ${result.warning ?? ''}`;
    expect(text).not.toMatch(
      /level_type|applies_to|resolver|approver_pool|null/
    );
  });
});

/**
 * Grade changes are filed by TEACHERS, and a teacher cannot file one at all
 * until its steps are set up — so the declaration wording ("anything parents
 * file will sit waiting") is a wrong instruction over those two cards.
 */
describe('classifyStagedFlowReadiness — grade change requests', () => {
  const GRADE_FLOWS = [
    GRADE_CHANGE_APPROVAL_FLOW,
    GRADE_CHANGE_AEB_APPROVAL_FLOW,
  ] as const;

  it('says teachers cannot file until a step is added', () => {
    for (const flow of GRADE_FLOWS) {
      const result = classifyStagedFlowReadiness([], undefined, flow);
      expect(result.tone).toBe('destructive');
      expect(result.label).toBe('No steps set up');
      expect(result.warning).toContain('Teachers can’t file');
      expect(result.warning).not.toMatch(/parent|sit waiting/i);
    }
  });

  it('says an empty step blocks filing, and names the step', () => {
    for (const flow of GRADE_FLOWS) {
      const result = classifyStagedFlowReadiness(
        [named(1), { ...named(0), label: 'Ms Norma' }],
        undefined,
        flow
      );
      expect(result.tone).toBe('destructive');
      expect(result.label).toBe('1 step has nobody in it');
      expect(result.warning).toContain('Ms Norma');
      expect(result.warning).toContain('can’t file');
      expect(result.warning).not.toMatch(/parent/i);
    }
  });

  it('is ready when every step has someone', () => {
    const result = classifyStagedFlowReadiness(
      [named(1), named(1), named(1), named(2)],
      undefined,
      GRADE_CHANGE_AEB_APPROVAL_FLOW
    );
    expect(result).toEqual({
      tone: 'mint',
      label: 'Ready — 4 steps',
      warning: null,
    });
  });

  // The filing route refuses a request whose step has nobody for the class's
  // half, so a grade change never reaches the gap and stops — the teacher is
  // turned away before sending it.
  it('says a half with nobody blocks filing for that half, not that requests stop', () => {
    for (const flow of GRADE_FLOWS) {
      const result = classifyStagedFlowReadiness(
        [namedScoped(['primary'])],
        BOTH_HALVES,
        flow
      );
      expect(result.tone).toBe('destructive');
      expect(result.label).toBe('Nobody covers Secondary');
      expect(result.warning).toContain('Officer in charge');
      expect(result.warning).toContain(
        'teachers of Secondary classes can’t file'
      );
      expect(result.warning).not.toContain('stop there');
      expect(result.warning).not.toMatch(/parent/i);
      const text = `${result.label} ${result.warning ?? ''}`;
      expect(text).not.toMatch(/flow|stage|pool|resolver|null|level_type/i);
    }
  });

  it('keeps the declaration wording for a half with nobody', () => {
    const result = classifyStagedFlowReadiness(
      [namedScoped(['primary'])],
      BOTH_HALVES,
      DECLARATION_APPROVAL_FLOW
    );
    expect(result.warning).toContain('stop there');
    expect(result.warning).not.toMatch(/teacher/i);
  });

  it('keeps the declaration wording for declarations', () => {
    const result = classifyStagedFlowReadiness(
      [derived(), named(0)],
      undefined,
      DECLARATION_APPROVAL_FLOW
    );
    expect(result.warning).toContain('stop there');
    expect(result.warning).not.toMatch(/teacher/i);
  });

  it('speaks plainly', () => {
    for (const flow of GRADE_FLOWS) {
      for (const stages of [[], [named(0)]]) {
        const result = classifyStagedFlowReadiness(stages, undefined, flow);
        const text = `${result.label} ${result.warning ?? ''}`;
        expect(text).not.toMatch(/flow|stage|pool|resolver|null/i);
      }
    }
  });
});

describe('describeStepsInOrder', () => {
  const person = (
    displayName: string,
    appliesToLevelType: ApproverLevelScope | null = null
  ) => ({ displayName, appliesToLevelType });

  const step = (
    label: string,
    approvers: ReturnType<typeof person>[],
    resolver: 'named' | 'form_adviser' = 'named'
  ) => ({ label, resolver, approvers });

  it('reads the Academic and Examination Board the way the school says it', () => {
    const line = describeStepsInOrder([
      step('Ms Chandana', [person('Chandana Perera')]),
      step('Ms Christina', [person('Christina Lim')]),
      step('Ms Norma', [person('Norma Tan')]),
      step('Mr Gary or Ms Nina', [person('Mr Gary'), person('Ms Nina')]),
    ]).map((s) => s.text);
    expect(line).toEqual([
      'Ms Chandana',
      'Ms Christina',
      'Ms Norma',
      'Mr Gary or Ms Nina',
    ]);
  });

  it('uses the step name for a derived step and for one person', () => {
    const line = describeStepsInOrder([
      step('Form class adviser', [], 'form_adviser'),
      step('Principal', [person('Someone')]),
    ]);
    expect(line).toEqual([
      { text: 'Form class adviser', empty: false },
      { text: 'Principal', empty: false },
    ]);
  });

  it('marks a named step with nobody on it', () => {
    expect(describeStepsInOrder([step('Ms Norma', [])])).toEqual([
      { text: 'Ms Norma', empty: true },
    ]);
  });

  it('never joins people split by half of the school with "or"', () => {
    // Ms Lhen covers Primary and Ms Elaine Secondary. They are not
    // interchangeable, and "or" would say they are.
    const [only] = describeStepsInOrder([
      step('Officer in charge', [
        person('Ms Lhen', 'primary'),
        person('Ms Elaine', 'secondary'),
      ]),
    ]);
    expect(only.text).toBe('Officer in charge');
  });

  it('cuts a long list short', () => {
    const [only] = describeStepsInOrder([
      step('Grade change approvers', [
        person('A'),
        person('B'),
        person('C'),
        person('D'),
        person('E'),
      ]),
    ]);
    expect(only.text).toBe('A, B, C or 2 others');
  });

  // Migration 145. The one word is the whole difference on the summary line.
  it('joins the people of an "Everyone must approve" step with "and"', () => {
    const line = describeStepsInOrder([
      {
        ...step('Board', [person('Mr Gary'), person('Ms Nina')]),
        approvalRule: 'all' as const,
      },
      {
        ...step('Pair', [person('Mr Gary'), person('Ms Nina')]),
        approvalRule: 'any' as const,
      },
    ]).map((s) => s.text);
    expect(line).toEqual(['Mr Gary and Ms Nina', 'Mr Gary or Ms Nina']);
  });

  it('cuts a long "everyone" list short with "and"', () => {
    const [only] = describeStepsInOrder([
      {
        ...step(
          'Board',
          ['A', 'B', 'C', 'D'].map((n) => person(n))
        ),
        approvalRule: 'all' as const,
      },
    ]);
    expect(only.text).toBe('A, B, C and 1 other');
  });

  it('still reads a half-split "everyone" step by its name, never "and"', () => {
    // "Ms Lhen and Ms Elaine" would say a child needs both. They get one.
    const [only] = describeStepsInOrder([
      {
        ...step('Officer in charge', [
          person('Ms Lhen', 'primary'),
          person('Ms Elaine', 'secondary'),
        ]),
        approvalRule: 'all' as const,
      },
    ]);
    expect(only.text).toBe('Officer in charge');
  });
});

describe('joinNames', () => {
  it('reads one, two and several names as a sentence', () => {
    expect(joinNames([], 'or')).toBe('');
    expect(joinNames(['A'], 'and')).toBe('A');
    expect(joinNames(['A', 'B'], 'and')).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'], 'or')).toBe('A, B or C');
  });
});

describe('"Everyone must approve" steps (migration 145)', () => {
  const everyone = (approvers: number) => ({
    ...named(approvers),
    approvalRule: 'all' as const,
  });

  it('is only offered on a step of named people', () => {
    expect(canRequireEveryone('named')).toBe(true);
    // Who advises a class changes with relief cover — "everyone" would move.
    expect(canRequireEveryone('form_adviser')).toBe(false);
  });

  it('flags an empty "everyone" step exactly as it flags any empty step', () => {
    // An empty list is never "everyone has approved". It stalls, and the
    // screen says so in the words a reader already knows.
    for (const flow of [
      DECLARATION_APPROVAL_FLOW,
      GRADE_CHANGE_APPROVAL_FLOW,
      undefined,
    ]) {
      const asAny = classifyStagedFlowReadiness(
        [derived(), named(0)],
        undefined,
        flow
      );
      const asAll = classifyStagedFlowReadiness(
        [derived(), everyone(0)],
        undefined,
        flow
      );
      expect(asAll).toEqual(asAny);
      expect(asAll.tone).toBe('destructive');
      expect(asAll.label).toBe('1 step has nobody in it');
    }
  });

  it('counts an empty "everyone" step alongside an empty "any" one', () => {
    const result = classifyStagedFlowReadiness([everyone(0), named(0)]);
    expect(result.label).toBe('2 steps have nobody in them');
  });

  it('is ready when an "everyone" step has people on it', () => {
    expect(classifyStagedFlowReadiness([derived(), everyone(2)]).tone).toBe(
      'mint'
    );
  });
});

// Migration 146 review. A turned-off account on a step stalls it silently: the
// person can never sign in to approve, and on a step that needs everyone the
// request waits for that yes forever with nothing on screen to say why.
describe('accounts that cannot act', () => {
  const person = (
    displayName: string,
    over: { disabled?: boolean; removed?: boolean } = {}
  ) => ({ appliesToLevelType: null, displayName, ...over });

  const board = (
    approvalRule: 'any' | 'all',
    approvers: ReturnType<typeof person>[]
  ) => ({
    label: 'Academic and Examination Board',
    resolver: 'named' as const,
    approvalRule,
    approvers,
  });

  it('blocks an "everyone" step with one turned-off account, and says how to fix it', () => {
    const result = classifyStagedFlowReadiness([
      derived(),
      board('all', [person('Mr Gary'), person('Ms Nina', { disabled: true })]),
    ]);
    expect(result.tone).toBe('destructive');
    expect(result.label).toBe('“Academic and Examination Board” can’t finish');
    expect(result.warning).toBe(
      'Ms Nina’s account is turned off, so requests at “Academic and Examination Board” can’t finish. Remove them from the step or turn the account back on.'
    );
  });

  it('blocks an "everyone" step with an account that no longer exists', () => {
    const result = classifyStagedFlowReadiness([
      board('all', [
        person('Mr Gary'),
        person('(account removed)', { removed: true }),
      ]),
    ]);
    expect(result.tone).toBe('destructive');
    expect(result.warning).toBe(
      'Someone no longer has a staff account, so requests at “Academic and Examination Board” can’t finish. Remove them from the step.'
    );
  });

  it('only warns on an "any one of them" step while somebody else can still approve', () => {
    const result = classifyStagedFlowReadiness([
      board('any', [person('Mr Gary'), person('Ms Nina', { disabled: true })]),
    ]);
    expect(result.tone).toBe('mint');
    expect(result.label).toBe('Ready — 1 step');
    expect(result.warning).toBe(
      'Ms Nina’s account on “Academic and Examination Board” is turned off, so they can’t approve. Anyone else on the step still can.'
    );
  });

  it('blocks an "any one of them" step when nobody on it can act', () => {
    const result = classifyStagedFlowReadiness([
      board('any', [person('Ms Nina', { disabled: true })]),
    ]);
    expect(result.tone).toBe('destructive');
    expect(result.label).toBe('“Academic and Examination Board” can’t finish');
  });

  it('reports an empty step before a turned-off account', () => {
    const result = classifyStagedFlowReadiness([
      named(0),
      board('all', [person('Ms Nina', { disabled: true })]),
    ]);
    expect(result.label).toBe('1 step has nobody in it');
  });

  it('changes nothing for callers that do not say who is turned off', () => {
    expect(
      classifyStagedFlowReadiness([
        { ...named(2), approvalRule: 'all' as const },
      ])
    ).toEqual({
      tone: 'mint',
      label: 'Ready — 1 step',
      warning: null,
    });
  });

  it('speaks plainly', () => {
    for (const stages of [
      [board('all', [person('Ms Nina', { disabled: true })])],
      [board('any', [person('A'), person('B', { removed: true })])],
    ]) {
      const result = classifyStagedFlowReadiness(stages);
      const text = `${result.label} ${result.warning ?? ''}`;
      expect(text).not.toMatch(
        /disabled|banned|resolver|pool|null|stage|rule/i
      );
    }
  });
});
