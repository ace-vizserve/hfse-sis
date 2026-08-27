import { describe, expect, it } from 'vitest';

import { classifyStagedFlowReadiness } from '@/lib/approvals/readiness';
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';
import type { ApproverLevelScope } from '@/lib/schemas/approval-flows';

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
    // ⚠ The deliberate difference from the pooled flow's rule. One person per
    // step is enough here, because a step is a station and not a quorum.
    expect(classifyStagedFlowReadiness([named(1)]).tone).toBe('mint');
    expect(classifyApproverReadiness(1).tone).toBe('destructive');
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
    const result = classifyStagedFlowReadiness([]);
    expect(result.tone).toBe('destructive');
    expect(result.warning).toContain('sit waiting');
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
