import { describe, expect, it } from 'vitest';

import {
  invoiceLines,
  latestPaymentDates,
  paymentApplied,
} from '@/lib/billing/invoice-row';

describe('invoiceLines', () => {
  it('keeps item lines with their account, skips subtotal lines', () => {
    const lines = invoiceLines(
      {
        Id: '1',
        TotalAmt: 500,
        Balance: 500,
        SyncToken: '0',
        CustomerRef: { value: '9' },
        Line: [
          {
            Amount: 500,
            Description: 'Reg',
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: {
              ItemRef: { value: '30', name: 'AY2027 Registration Fee' },
              Qty: 1,
            },
          },
          { Amount: 500, DetailType: 'SubTotalLineDetail' },
        ],
      },
      new Map([['30', 'A-REG']])
    );
    expect(lines).toEqual([
      {
        itemId: '30',
        itemName: 'AY2027 Registration Fee',
        accountId: 'A-REG',
        description: 'Reg',
        qty: 1,
        amount: 500,
      },
    ]);
  });
  it('an item the SIS has not seen gets no account', () => {
    const [l] = invoiceLines(
      {
        Id: '1',
        TotalAmt: 5,
        Balance: 5,
        SyncToken: '0',
        CustomerRef: { value: '9' },
        Line: [
          {
            Amount: 5,
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: { ItemRef: { value: '99' } },
          },
        ],
      },
      new Map()
    );
    expect(l.accountId).toBeNull();
  });
});

describe('paymentApplied', () => {
  it('lists the invoices a payment pays and how much', () => {
    expect(
      paymentApplied({
        Id: 'P1',
        TotalAmt: 700,
        CustomerRef: { value: '9' },
        Line: [
          { Amount: 500, LinkedTxn: [{ TxnId: '1', TxnType: 'Invoice' }] },
          {
            Amount: 200,
            LinkedTxn: [
              { TxnId: '2', TxnType: 'Invoice' },
              { TxnId: 'C1', TxnType: 'CreditMemo' },
            ],
          },
        ],
      })
    ).toEqual([
      { invoiceId: '1', amount: 500 },
      { invoiceId: '2', amount: 200 },
    ]);
  });
});

describe('latestPaymentDates', () => {
  it('keeps the latest date per invoice and ignores undated payments', () => {
    const m = latestPaymentDates([
      { txnDate: '2026-03-01', applied: [{ invoiceId: '1', amount: 5 }] },
      {
        txnDate: '2026-04-02T00:00:00Z',
        applied: [
          { invoiceId: '1', amount: 5 },
          { invoiceId: '2', amount: 5 },
        ],
      },
      { txnDate: null, applied: [{ invoiceId: '3', amount: 5 }] },
    ]);
    expect([...m.entries()]).toEqual([
      ['1', '2026-04-02'],
      ['2', '2026-04-02'],
    ]);
  });
});
