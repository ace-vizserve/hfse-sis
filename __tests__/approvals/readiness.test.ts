import { describe, expect, it } from 'vitest';

import { classifyStagedFlowReadiness } from '@/lib/approvals/readiness';
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';

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
  approvers: Array.from({ length: approvers }, (_, i) => i),
});

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
