import { describe, expect, it } from 'vitest';

import {
  buildSalesDocBody,
  REFUND_FROM_REQUIRED,
  SalesDocBody,
} from '@/lib/billing/sales-doc-body';
import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { ApiError } from '@/lib/query/fetcher';

const refund = {
  kind: 'refund_receipt' as const,
  lines: [{ itemId: '25', qty: 1, unitPrice: 50 }],
  txnDate: '2026-10-21',
  refundFromId: '1150040001',
  requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
};
const credit = {
  kind: 'credit_memo' as const,
  lines: [{ itemId: '25', qty: 2, unitPrice: 10 }],
  txnDate: '2026-10-21',
  requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b12',
};

describe('SalesDocBody', () => {
  it('accepts a refund receipt with Refund from', () => {
    expect(SalesDocBody.safeParse(refund).success).toBe(true);
  });
  it('refuses a refund receipt without Refund from (QuickBooks requires it)', () => {
    const r = SalesDocBody.safeParse({ ...refund, refundFromId: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(REFUND_FROM_REQUIRED);
  });
  it('accepts a credit note with no bank account', () => {
    expect(SalesDocBody.safeParse(credit).success).toBe(true);
  });
  it('refuses no lines, a zero total, a bad date, another kind, no request id', () => {
    for (const bad of [
      { ...credit, lines: [] },
      { ...credit, lines: [{ itemId: '25', qty: 1, unitPrice: 0 }] },
      { ...credit, txnDate: '2026-02-30' },
      { ...credit, kind: 'sales_receipt' },
      { ...credit, requestId: 'x' },
      { ...refund, checkNo: 'x'.repeat(22) },
    ])
      expect(SalesDocBody.safeParse(bad).success).toBe(false);
  });
  it('drops blank messages and numbers', () => {
    const r = SalesDocBody.safeParse({
      ...credit,
      message: '  ',
      statementMessage: '',
      docNumber: ' ',
    });
    expect(r.data?.message).toBeUndefined();
    expect(r.data?.statementMessage).toBeUndefined();
    expect(r.data?.docNumber).toBeUndefined();
  });
});

describe('buildSalesDocBody', () => {
  const lines = [{ DetailType: 'SalesItemLineDetail', Amount: 50 }];
  it('a refund receipt carries Refund from, payment method and cheque no.', () => {
    const b = buildSalesDocBody({
      kind: 'refund_receipt',
      customerId: '75',
      customerEmail: 'p@x.sg',
      txnDate: '2026-10-21',
      lines,
      refundFromId: '1150040001',
      paymentMethodId: '1000000001',
      checkNo: ' 000123 ',
      statementMessage: 'Overpaid',
      message: 'Refund for the overcharge',
    });
    expect(b).toMatchObject({
      CustomerRef: { value: '75' },
      DepositToAccountRef: { value: '1150040001' },
      PaymentMethodRef: { value: '1000000001' },
      PaymentRefNum: '000123',
      PrivateNote: 'Overpaid',
      CustomerMemo: { value: 'Refund for the overcharge' },
      BillEmail: { Address: 'p@x.sg' },
      AutoDocNumber: true,
      Line: lines,
    });
  });
  it('a credit note never carries the refund-only fields', () => {
    const b = buildSalesDocBody({
      kind: 'credit_memo',
      customerId: '75',
      customerEmail: null,
      txnDate: '2026-10-21',
      lines,
      refundFromId: '1',
      paymentMethodId: '2',
      checkNo: '3',
      docNumber: 'CN-1',
    });
    expect(b).not.toHaveProperty('DepositToAccountRef');
    expect(b).not.toHaveProperty('PaymentMethodRef');
    expect(b).not.toHaveProperty('PaymentRefNum');
    expect(b).not.toHaveProperty('BillEmail');
    expect(b.DocNumber).toBe('CN-1');
    expect(b).not.toHaveProperty('AutoDocNumber');
  });
});

describe('request id on these forms (idempotency)', () => {
  it('renews only after our own refusal, keeps it when QuickBooks may have saved', () => {
    expect(
      shouldRenewRequestId(new ApiError(422, { error: 'Pick a bank' }, 'x'))
    ).toBe(true);
    expect(
      shouldRenewRequestId(
        new ApiError(502, { error: 'unclear', keepRequestId: true }, 'x')
      )
    ).toBe(false);
  });
});
