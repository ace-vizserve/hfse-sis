import { describe, expect, it } from 'vitest';

import { pickDefaultDeposit } from '@/lib/billing/deposit-default';

const banks = [
  { id: '35', label: 'Checking' },
  { id: '36', label: 'PayNow' },
];

describe('pickDefaultDeposit', () => {
  it('uses the last-used account when it is offered', () => {
    expect(pickDefaultDeposit(banks, '36')?.id).toBe('36');
  });
  it('falls back to the first bank when the last-used one is not offered', () => {
    expect(pickDefaultDeposit(banks, '4')?.id).toBe('35');
  });
  it('falls back to the first bank when there is none or the query failed', () => {
    expect(pickDefaultDeposit(banks, null)?.id).toBe('35');
    expect(pickDefaultDeposit(banks, undefined)?.id).toBe('35');
  });
  it('is undefined with no banks', () => {
    expect(pickDefaultDeposit([], '36')).toBeUndefined();
  });
});
