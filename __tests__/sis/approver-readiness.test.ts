import { describe, expect, it } from 'vitest';
import { classifyApproverReadiness } from '@/lib/sis/approver-readiness';

describe('classifyApproverReadiness', () => {
  it('2+ approvers is ready (mint), no warning', () => {
    expect(classifyApproverReadiness(3)).toEqual({
      tone: 'mint',
      label: 'Ready — 3 approvers',
      warning: null,
    });
  });

  it('exactly 1 approver is loudly flagged — a request needs two distinct people', () => {
    const r = classifyApproverReadiness(1);
    expect(r.tone).toBe('destructive');
    expect(r.label).toBe('Only 1 approver');
    expect(r.warning).toContain('two different approvers');
  });

  it('0 approvers is loudly flagged with a distinct message', () => {
    const r = classifyApproverReadiness(0);
    expect(r.tone).toBe('destructive');
    expect(r.label).toBe('No approvers assigned');
    expect(r.warning).toContain('No one can file');
  });
});
