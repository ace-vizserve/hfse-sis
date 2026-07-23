// __tests__/sis/hub-readiness-summary.test.ts
import { describe, it, expect } from 'vitest';
import {
  ringPercent,
  stepBadgeLabel,
  groupStepsForPopover,
} from '@/lib/sis/hub-readiness-summary';
import type { ReadinessStep } from '@/lib/sis/readiness';

function makeStep(overrides: Partial<ReadinessStep>): ReadinessStep {
  return {
    id: 'sections',
    step: 3,
    label: 'Sections',
    description: 'desc',
    href: '/sis/sections',
    status: 'done',
    required: true,
    ...overrides,
  };
}

describe('ringPercent', () => {
  it('returns 100 for a done step with no fraction (boolean step)', () => {
    expect(ringPercent(makeStep({ status: 'done', fraction: undefined }))).toBe(
      100
    );
  });
  it('returns 0 for a not_started boolean step', () => {
    expect(
      ringPercent(makeStep({ status: 'not_started', fraction: undefined }))
    ).toBe(0);
  });
  it('computes the real done/total percentage for a fractioned step', () => {
    expect(
      ringPercent(
        makeStep({ status: 'partial', fraction: { done: 142, total: 168 } })
      )
    ).toBeCloseTo(84.5, 1);
  });
});

describe('stepBadgeLabel', () => {
  it('reads "Ready" for done', () => {
    expect(stepBadgeLabel(makeStep({ status: 'done' }))).toBe('Ready');
  });
  it('reads the literal fraction for partial', () => {
    expect(
      stepBadgeLabel(
        makeStep({ status: 'partial', fraction: { done: 142, total: 168 } })
      )
    ).toBe('142/168');
  });
  it('reads "Optional" for a not_started optional step', () => {
    expect(
      stepBadgeLabel(makeStep({ status: 'not_started', required: false }))
    ).toBe('Optional');
  });
  it('reads "Not started" for a not_started required step', () => {
    expect(
      stepBadgeLabel(makeStep({ status: 'not_started', required: true }))
    ).toBe('Not started');
  });
});

describe('groupStepsForPopover', () => {
  it('clusters steps into the 4 documented groups, preserving step order within each', () => {
    const steps: ReadinessStep[] = [
      makeStep({ id: 'ay-setup', step: 1 }),
      makeStep({ id: 'calendar', step: 2 }),
      makeStep({ id: 'sections', step: 3 }),
      makeStep({ id: 'app-window', step: 10, required: false }),
    ];
    const groups = groupStepsForPopover(steps);
    expect(groups.map((g) => g.label)).toEqual([
      'Core setup',
      'Grading & staffing',
      'Optional',
    ]);
    expect(groups[0].steps.map((s) => s.id)).toEqual(['ay-setup', 'calendar']);
    expect(groups[2].steps.map((s) => s.id)).toEqual(['app-window']);
  });
});
