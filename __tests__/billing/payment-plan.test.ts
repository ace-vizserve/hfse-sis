import { describe, expect, it } from 'vitest';

import {
  mergeCreditLines,
  oldestFirst,
  planPayment,
} from '@/lib/billing/payment-plan';

const inv = (id: string, txnDate: string, balance: number, docNumber = id) => ({
  id,
  docNumber,
  txnDate,
  balance,
});

describe('oldestFirst', () => {
  it('sorts by date then number, numerically', () => {
    const xs = [
      inv('b', '2026-09-01', 1, 'HFSE10'),
      inv('a', '2026-09-01', 1, 'HFSE9'),
      inv('c', '2026-08-01', 1),
    ];
    expect(oldestFirst(xs).map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('planPayment', () => {
  const invoices = [
    inv('old', '2026-09-01', 1340),
    inv('new', '2026-10-01', 500),
  ];
  it('pays oldest first up to the amount', () => {
    const p = planPayment({
      invoices,
      credits: [],
      useCredit: false,
      amount: 1500,
    });
    expect(p.cashApply).toEqual([
      { invoiceId: 'old', amount: 1340 },
      { invoiceId: 'new', amount: 160 },
    ]);
    expect(p.leftover).toBe(0);
  });
  it('leftover: more than the ticked invoices owe stays as credit', () => {
    const p = planPayment({
      invoices: [invoices[0]],
      credits: [],
      useCredit: false,
      amount: 1500,
    });
    expect(p.cashApply).toEqual([{ invoiceId: 'old', amount: 1340 }]);
    expect(p.leftover).toBe(160);
  });
  it('no invoice ticked: all of it is credit', () => {
    const p = planPayment({
      invoices: [],
      credits: [],
      useCredit: false,
      amount: 50,
    });
    expect(p.cashApply).toEqual([]);
    expect(p.leftover).toBe(50);
  });
  it('credit is used first, oldest credit first, across invoices', () => {
    const p = planPayment({
      invoices,
      credits: [
        { paymentId: 'p2', txnDate: '2026-10-10', unapplied: 30 },
        { paymentId: 'p1', txnDate: '2026-09-10', unapplied: 1335 },
      ],
      useCredit: true,
      amount: 475,
    });
    expect(p.creditUse).toEqual([
      { paymentId: 'p1', invoiceId: 'old', amount: 1335 },
      { paymentId: 'p2', invoiceId: 'old', amount: 5 },
      { paymentId: 'p2', invoiceId: 'new', amount: 25 },
    ]);
    expect(p.creditUsed).toBe(1365);
    expect(p.cashApply).toEqual([{ invoiceId: 'new', amount: 475 }]);
    expect(p.leftover).toBe(0);
  });
  it('credit off: credit untouched', () => {
    const p = planPayment({
      invoices,
      credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 100 }],
      useCredit: false,
      amount: 0,
    });
    expect(p.creditUse).toEqual([]);
    expect(p.cashApply).toEqual([]);
  });
  it('cents stay exact', () => {
    const p = planPayment({
      invoices: [inv('x', '2026-09-01', 0.3)],
      credits: [],
      useCredit: false,
      amount: 0.1 + 0.2,
    });
    expect(p.cashApply).toEqual([{ invoiceId: 'x', amount: 0.3 }]);
    expect(p.leftover).toBe(0);
  });
});

describe('mergeCreditLines', () => {
  it('keeps every existing line and adds the new ones', () => {
    const out = mergeCreditLines(
      [{ Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] }],
      [{ invoiceId: '300', amount: 10 }]
    );
    expect(out).toEqual([
      { Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] },
      { Amount: 10, LinkedTxn: [{ TxnId: '300', TxnType: 'Invoice' }] },
    ]);
  });
  it('adds to an existing line for the same invoice instead of a second line', () => {
    const out = mergeCreditLines(
      [{ Amount: 20, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] }],
      [{ invoiceId: '257', amount: 5 }]
    );
    expect(out).toEqual([
      { Amount: 25, LinkedTxn: [{ TxnId: '257', TxnType: 'Invoice' }] },
    ]);
  });
});
