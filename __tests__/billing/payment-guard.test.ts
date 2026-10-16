import { describe, expect, it } from 'vitest';

import { prePaymentRefusal } from '@/lib/billing/payment-guard';
import { QboError } from '@/lib/qbo/client';

describe('prePaymentRefusal', () => {
  it('does not refuse a payment over tile write problems', () => {
    expect(
      prePaymentRefusal({
        errors: ['AY2027 fees: duplicate key value violates unique constraint'],
      })
    ).toBeNull();
    expect(prePaymentRefusal({ errors: [] })).toBeNull();
  });

  it('refuses when the QuickBooks read itself failed', () => {
    expect(prePaymentRefusal(new Error('fetch failed'))).toBe(
      "QuickBooks couldn't be reached. Nothing was saved — try again in a minute."
    );
    expect(
      prePaymentRefusal(new QboError(400, '6000', 'Business validation error'))
    ).toBe("QuickBooks didn't accept this: Business validation error");
  });
});
