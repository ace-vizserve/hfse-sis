import { describe, expect, it } from 'vitest';

import { creditRequestId } from '@/lib/billing/credit-request-id';

const RID = '3f2b8c1e-9a4d-4e6f-b7a2-1c5d8e9f0a3b';

describe('creditRequestId', () => {
  it('keys a numeric QuickBooks payment id directly', () => {
    expect(creditRequestId(RID, '383')).toBe(`${RID}-p383`);
  });

  it('hashes an id too long to fit, stably, within 50 characters', () => {
    const long = '1234567890123456';
    const a = creditRequestId(RID, long);
    expect(a.length).toBeLessThanOrEqual(50);
    expect(a).toMatch(new RegExp(`^${RID}-p[0-9a-f]{8}$`));
    expect(creditRequestId(RID, long)).toBe(a);
    expect(creditRequestId(RID, `${long}7`)).not.toBe(a);
  });
});
