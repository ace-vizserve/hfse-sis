import { describe, expect, it } from 'vitest';

import {
  blank,
  isQboStageKey,
  onlyChanges,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';

const current: StageSnapshot = {
  status: 'Invoiced',
  invoice: '1042',
  paymentDate: null,
  startDate: null,
};

describe('stage-state helpers', () => {
  it('isQboStageKey accepts only registration and fees', () => {
    expect(isQboStageKey('registration')).toBe(true);
    expect(isQboStageKey('fees')).toBe(true);
    expect(isQboStageKey('documents')).toBe(false);
  });

  it('blank treats null, empty and whitespace as blank', () => {
    expect(blank(null)).toBe(true);
    expect(blank('  ')).toBe(true);
    expect(blank('1042')).toBe(false);
  });

  it('onlyChanges drops keys that already match and returns null when none differ', () => {
    expect(
      onlyChanges(
        { status: 'Invoiced', invoice: ' 1042 ', paymentDate: null },
        current
      )
    ).toBeNull();
    expect(onlyChanges({ status: 'Paid', invoice: '1042' }, current)).toEqual({
      status: 'Paid',
    });
  });

  it('onlyChanges compares payment dates by day', () => {
    expect(
      onlyChanges(
        { paymentDate: '2026-10-20T00:00:00Z' },
        { ...current, paymentDate: '2026-10-20' }
      )
    ).toBeNull();
  });
});
