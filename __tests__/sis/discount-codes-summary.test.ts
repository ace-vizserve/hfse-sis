import { describe, expect, it } from 'vitest';
import { classifyCodeStatus } from '@/components/ui/discount-code-status-badge';
import { summarizeDiscountCodeStatuses } from '@/lib/sis/discount-codes-summary';

describe('summarizeDiscountCodeStatuses', () => {
  it('tallies all four real states, including inactive (missing dates)', () => {
    const codes = [
      { startDate: '2020-01-01', endDate: '2020-12-31' }, // expired
      { startDate: '2099-01-01', endDate: '2099-12-31' }, // scheduled
      { startDate: null, endDate: null }, // inactive
    ];
    const counts = summarizeDiscountCodeStatuses(codes, classifyCodeStatus);
    expect(counts).toEqual({
      active: 0,
      scheduled: 1,
      expired: 1,
      inactive: 1,
    });
  });

  it('counts always sum to the input length (the bug being fixed)', () => {
    const codes = [
      { startDate: '2020-01-01', endDate: '2020-12-31' },
      { startDate: null, endDate: '2099-12-31' },
      { startDate: '2020-01-01', endDate: null },
      { startDate: null, endDate: null },
    ];
    const counts = summarizeDiscountCodeStatuses(codes, classifyCodeStatus);
    const total =
      counts.active + counts.scheduled + counts.expired + counts.inactive;
    expect(total).toBe(codes.length);
  });
});
