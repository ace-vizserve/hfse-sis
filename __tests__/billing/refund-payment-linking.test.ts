import { describe, expect, it } from 'vitest';

import { PaymentBody } from '@/lib/billing/payment-body';
import {
  mergeCreditLines,
  newPaymentLines,
  planWithCreditNotes,
  type OpenInvoice,
} from '@/lib/billing/payment-plan';
import {
  buildPurchaseBody,
  PAY_ACCOUNT_REQUIRED,
  RefundExpenseBody,
} from '@/lib/billing/refund-expense-body';

// The shapes QuickBooks accepted in the sandbox spike (2026-10-21).

const expense: OpenInvoice = {
  id: '435',
  docNumber: null,
  txnDate: '2026-10-21',
  balance: 1,
  txnType: 'Expense',
};
const invoice: OpenInvoice = {
  id: '67',
  docNumber: '1021',
  txnDate: '2026-09-01',
  balance: 238,
};
const note = {
  id: '434',
  docNumber: 'HFSE069014',
  txnDate: '2026-10-21',
  total: 1,
  open: 1,
};
const typeOf = (id: string): 'Expense' | 'Invoice' =>
  id === '435' ? 'Expense' : 'Invoice';

describe('planWithCreditNotes — paying a credit note back (step 2)', () => {
  it('a credit note and an expense net to 0.00: no money, one line each', () => {
    const r = planWithCreditNotes({
      invoices: [expense],
      credits: [],
      useCredit: false,
      amount: 0,
      creditNotes: [note],
      memoUse: [{ creditMemoId: '434', amount: 1 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.cashApply).toEqual([{ invoiceId: '435', amount: 1 }]);
    expect(r.plan.memoUsed).toBe(1);
    expect(r.plan.leftover).toBe(0);
    expect(newPaymentLines(r.plan.cashApply, r.plan.memoUse, typeOf)).toEqual([
      { Amount: 1, LinkedTxn: [{ TxnId: '435', TxnType: 'Expense' }] },
      { Amount: 1, LinkedTxn: [{ TxnId: '434', TxnType: 'CreditMemo' }] },
    ]);
  });

  it('a credit note correcting an invoice lowers it; money pays the rest', () => {
    const r = planWithCreditNotes({
      invoices: [invoice],
      credits: [],
      useCredit: false,
      amount: 100,
      creditNotes: [{ ...note, open: 38, total: 38 }],
      memoUse: [{ creditMemoId: '434', amount: 38 }],
    });
    expect(r.ok && r.plan.cashApply).toEqual([
      { invoiceId: '67', amount: 138 },
    ]);
    expect(r.ok && r.plan.leftover).toBe(0);
  });

  it('typed Payment cells work with a credit note', () => {
    const r = planWithCreditNotes({
      invoices: [invoice],
      credits: [],
      useCredit: false,
      amount: 0,
      allocations: [{ invoiceId: '67', amount: 1 }],
      creditNotes: [note],
      memoUse: [{ creditMemoId: '434', amount: 1 }],
    });
    expect(r.ok && r.plan.cashApply).toEqual([{ invoiceId: '67', amount: 1 }]);
  });

  it('refuses credits beyond what they pay, beyond unused credit, unknown or repeated', () => {
    const base = {
      invoices: [expense],
      credits: [],
      useCredit: false,
      amount: 0,
      creditNotes: [{ ...note, open: 5, total: 5 }],
    };
    expect(
      planWithCreditNotes({
        ...base,
        memoUse: [{ creditMemoId: '434', amount: 2 }],
      }).ok
    ).toBe(false);
    expect(
      planWithCreditNotes({
        ...base,
        memoUse: [{ creditMemoId: '434', amount: 6 }],
      }).ok
    ).toBe(false);
    expect(
      planWithCreditNotes({
        ...base,
        memoUse: [{ creditMemoId: '999', amount: 1 }],
      }).ok
    ).toBe(false);
    expect(
      planWithCreditNotes({
        ...base,
        memoUse: [
          { creditMemoId: '434', amount: 0.5 },
          { creditMemoId: '434', amount: 0.5 },
        ],
      }).ok
    ).toBe(false);
  });

  it('without credit notes it is the old plan', () => {
    const r = planWithCreditNotes({
      invoices: [invoice],
      credits: [],
      useCredit: false,
      amount: 50,
      creditNotes: [],
      memoUse: [],
    });
    expect(r.ok && r.plan.cashApply).toEqual([{ invoiceId: '67', amount: 50 }]);
    expect(r.ok && r.plan.memoUsed).toBe(0);
  });
});

describe('mergeCreditLines — overpayment refund', () => {
  it('links the cheque to the unused payment by its own type, keeping old lines', () => {
    expect(
      mergeCreditLines(
        [{ Amount: 5, LinkedTxn: [{ TxnId: '67', TxnType: 'Invoice' }] }],
        [{ invoiceId: '430', amount: 3 }],
        () => 'Check'
      )
    ).toEqual([
      { Amount: 5, LinkedTxn: [{ TxnId: '67', TxnType: 'Invoice' }] },
      { Amount: 3, LinkedTxn: [{ TxnId: '430', TxnType: 'Check' }] },
    ]);
  });
  it('still defaults to Invoice', () => {
    expect(mergeCreditLines([], [{ invoiceId: '67', amount: 1 }])).toEqual([
      { Amount: 1, LinkedTxn: [{ TxnId: '67', TxnType: 'Invoice' }] },
    ]);
  });
});

describe('RefundExpenseBody / buildPurchaseBody (step 1)', () => {
  const ok = {
    kind: 'expense' as const,
    accountId: '1150040001',
    txnDate: '2026-10-21',
    amount: 2,
    requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
  };
  it('accepts an expense and a cheque; refuses no account / zero / bad id', () => {
    expect(RefundExpenseBody.safeParse(ok).success).toBe(true);
    expect(RefundExpenseBody.safeParse({ ...ok, kind: 'check' }).success).toBe(
      true
    );
    const noAcc = RefundExpenseBody.safeParse({ ...ok, accountId: ' ' });
    expect(noAcc.error?.issues[0]?.message).toBe(PAY_ACCOUNT_REQUIRED);
    expect(RefundExpenseBody.safeParse({ ...ok, amount: 0 }).success).toBe(
      false
    );
    expect(RefundExpenseBody.safeParse({ ...ok, requestId: 'x' }).success).toBe(
      false
    );
    expect(RefundExpenseBody.safeParse({ ...ok, kind: 'bill' }).success).toBe(
      false
    );
  });
  it('Expense = PaymentType Cash; the customer is payee and the A/R line customer', () => {
    expect(
      buildPurchaseBody({
        kind: 'expense',
        customerId: '75',
        arAccountId: '84',
        accountId: '1150040001',
        txnDate: '2026-10-21',
        amount: 2,
        paymentMethodId: '1000000001',
        refNo: 'SPK1',
        memo: 'Refund',
      })
    ).toEqual({
      PaymentType: 'Cash',
      AccountRef: { value: '1150040001' },
      TxnDate: '2026-10-21',
      EntityRef: { value: '75', type: 'Customer' },
      PaymentMethodRef: { value: '1000000001' },
      DocNumber: 'SPK1',
      PrivateNote: 'Refund',
      Line: [
        {
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount: 2,
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: '84' },
            CustomerRef: { value: '75' },
          },
        },
      ],
    });
  });
  it('Cheque = PaymentType Check, never a payment method', () => {
    const b = buildPurchaseBody({
      kind: 'check',
      customerId: '75',
      arAccountId: '84',
      accountId: '1',
      txnDate: '2026-10-21',
      amount: 3,
      paymentMethodId: '2',
    });
    expect(b.PaymentType).toBe('Check');
    expect(b).not.toHaveProperty('PaymentMethodRef');
  });
});

describe('PaymentBody — credit notes', () => {
  const body = {
    amount: 0,
    txnDate: '2026-10-21',
    invoiceIds: ['435'],
    useCredit: false,
    requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
  };
  it('takes credit notes with no money and no bank account', () => {
    expect(
      PaymentBody.safeParse({
        ...body,
        creditNotes: [{ creditMemoId: '434', amount: 1 }],
      }).success
    ).toBe(true);
  });
  it('refuses a credit note of 0', () => {
    expect(
      PaymentBody.safeParse({
        ...body,
        creditNotes: [{ creditMemoId: '434', amount: 0 }],
      }).success
    ).toBe(false);
  });
});
