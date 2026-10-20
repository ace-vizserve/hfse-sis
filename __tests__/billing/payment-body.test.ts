import { describe, expect, it } from 'vitest';

import { DEPOSIT_REQUIRED, PaymentBody } from '@/lib/billing/payment-body';

const base = {
  amount: 100,
  txnDate: '2026-10-20',
  invoiceIds: ['1'],
  useCredit: false,
  requestId: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
};

describe('PaymentBody deposit account', () => {
  it('rejects a payment with no deposit account', () => {
    for (const depositAccountId of [null, '', undefined]) {
      const r = PaymentBody.safeParse({ ...base, depositAccountId });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toBe(DEPOSIT_REQUIRED);
    }
  });

  it('accepts a payment with a deposit account', () => {
    expect(
      PaymentBody.safeParse({ ...base, depositAccountId: '35' }).success
    ).toBe(true);
  });

  it('allows Use credit (no money) without a deposit account', () => {
    expect(
      PaymentBody.safeParse({
        ...base,
        amount: 0,
        useCredit: true,
        depositAccountId: null,
      }).success
    ).toBe(true);
  });
});
