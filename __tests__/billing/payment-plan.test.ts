import { describe, expect, it } from 'vitest';

import {
  mergeCreditLines,
  oldestFirst,
  PAYMENT_NOTE_MAX,
  paymentNote,
  planAllocatedPayment,
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

describe('planAllocatedPayment', () => {
  const invoices = [
    inv('old', '2026-09-01', 1340, 'HFSE1'),
    inv('new', '2026-10-01', 500, 'HFSE2'),
  ];
  const ok = (r: ReturnType<typeof planAllocatedPayment>) => {
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };
  it('pays exactly the typed amounts, not oldest first', () => {
    const p = ok(
      planAllocatedPayment({
        invoices,
        credits: [],
        useCredit: false,
        amount: 600,
        allocations: [
          { invoiceId: 'new', amount: 500 },
          { invoiceId: 'old', amount: 100 },
        ],
      })
    );
    expect(p.cashApply).toEqual([
      { invoiceId: 'old', amount: 100 },
      { invoiceId: 'new', amount: 500 },
    ]);
    expect(p.cashApplied).toBe(600);
    expect(p.leftover).toBe(0);
  });
  it('leftover: money beyond the allocations stays as credit', () => {
    const p = ok(
      planAllocatedPayment({
        invoices,
        credits: [],
        useCredit: false,
        amount: 250,
        allocations: [{ invoiceId: 'new', amount: 200 }],
      })
    );
    expect(p.cashApply).toEqual([{ invoiceId: 'new', amount: 200 }]);
    expect(p.leftover).toBe(50);
  });
  it('credit goes to the allocated invoices first; money covers the rest', () => {
    const p = ok(
      planAllocatedPayment({
        invoices,
        credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 150 }],
        useCredit: true,
        amount: 250,
        allocations: [
          { invoiceId: 'old', amount: 100 },
          { invoiceId: 'new', amount: 300 },
        ],
      })
    );
    expect(p.creditUse).toEqual([
      { paymentId: 'p1', invoiceId: 'old', amount: 100 },
      { paymentId: 'p1', invoiceId: 'new', amount: 50 },
    ]);
    expect(p.cashApply).toEqual([{ invoiceId: 'new', amount: 250 }]);
    expect(p.leftover).toBe(0);
  });
  it('credit alone can cover the allocations (no new money)', () => {
    const p = ok(
      planAllocatedPayment({
        invoices,
        credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 900 }],
        useCredit: true,
        amount: 0,
        allocations: [{ invoiceId: 'new', amount: 500 }],
      })
    );
    expect(p.creditUse).toEqual([
      { paymentId: 'p1', invoiceId: 'new', amount: 500 },
    ]);
    expect(p.cashApply).toEqual([]);
    expect(p.leftover).toBe(0);
  });
  it('cents stay exact', () => {
    const p = ok(
      planAllocatedPayment({
        invoices: [inv('x', '2026-09-01', 0.3), inv('y', '2026-09-02', 1)],
        credits: [],
        useCredit: false,
        amount: 0.1 + 0.2 + 0.7,
        allocations: [
          { invoiceId: 'x', amount: 0.1 + 0.2 },
          { invoiceId: 'y', amount: 0.7 },
        ],
      })
    );
    expect(p.cashApply).toEqual([
      { invoiceId: 'x', amount: 0.3 },
      { invoiceId: 'y', amount: 0.7 },
    ]);
    expect(p.leftover).toBe(0);
  });
  it('refuses more than the open balance', () => {
    const r = planAllocatedPayment({
      invoices,
      credits: [],
      useCredit: false,
      amount: 600,
      allocations: [{ invoiceId: 'new', amount: 500.01 }],
    });
    expect(r).toEqual({
      ok: false,
      error: 'The payment for HFSE2 is more than its open balance.',
    });
  });
  it('refuses allocations above the amount plus credit', () => {
    const r = planAllocatedPayment({
      invoices,
      credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 50 }],
      useCredit: true,
      amount: 100,
      allocations: [{ invoiceId: 'old', amount: 150.01 }],
    });
    expect(r.ok).toBe(false);
  });
  it('credit not asked for does not count toward the allocations', () => {
    const r = planAllocatedPayment({
      invoices,
      credits: [{ paymentId: 'p1', txnDate: '2026-09-10', unapplied: 50 }],
      useCredit: false,
      amount: 100,
      allocations: [{ invoiceId: 'old', amount: 150 }],
    });
    expect(r.ok).toBe(false);
  });
  it('refuses unknown, repeated and non-positive allocations', () => {
    const base = { invoices, credits: [], useCredit: false, amount: 1000 };
    expect(
      planAllocatedPayment({
        ...base,
        allocations: [{ invoiceId: 'zzz', amount: 1 }],
      }).ok
    ).toBe(false);
    expect(
      planAllocatedPayment({
        ...base,
        allocations: [
          { invoiceId: 'old', amount: 1 },
          { invoiceId: 'old', amount: 1 },
        ],
      }).ok
    ).toBe(false);
    expect(
      planAllocatedPayment({
        ...base,
        allocations: [{ invoiceId: 'old', amount: 0 }],
      }).ok
    ).toBe(false);
  });
});

describe('paymentNote', () => {
  it('is the SIS line alone without a memo', () => {
    expect(paymentNote('  ', 'Ms A')).toBe('Recorded from SIS by Ms A');
  });
  it('puts the memo first and keeps the SIS line', () => {
    expect(paymentNote('PayNow ref 123', 'Ms A')).toBe(
      'PayNow ref 123\nRecorded from SIS by Ms A'
    );
  });
  it('cuts the memo, never the SIS line, to fit QuickBooks', () => {
    const n = paymentNote('x'.repeat(5000), 'Ms A');
    expect(n.length).toBe(PAYMENT_NOTE_MAX);
    expect(n.endsWith('\nRecorded from SIS by Ms A')).toBe(true);
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
