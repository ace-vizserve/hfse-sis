import { describe, expect, it } from 'vitest';

import {
  amountPaid,
  buildInvoiceUpdateBody,
  editRefusal,
  mergeInvoiceLines,
  STALE_EDIT,
  updateErrorMessage,
  UpdateInvoiceBody,
} from '@/lib/billing/invoice-update-body';
import { QboError } from '@/lib/qbo/client';

const live = (over: Record<string, unknown> = {}) =>
  ({
    Id: '423',
    SyncToken: '3',
    TotalAmt: 300,
    Balance: 300,
    CustomerRef: { value: 'C1' },
    ...over,
  }) as never;

describe('UpdateInvoiceBody', () => {
  const base = {
    lines: [{ lineId: '1', itemId: '9', qty: 1, unitPrice: 300 }],
    txnDate: '2026-10-20',
    dueDate: null,
    syncToken: '3',
    requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
  };
  it('accepts an edit, a new line without a lineId included', () => {
    const r = UpdateInvoiceBody.safeParse({
      ...base,
      lines: [...base.lines, { itemId: '12', qty: 1, unitPrice: 50 }],
    });
    expect(r.success).toBe(true);
  });
  it('needs a line, a SyncToken and a request id', () => {
    expect(UpdateInvoiceBody.safeParse({ ...base, lines: [] }).success).toBe(
      false
    );
    const { syncToken: _s, ...noToken } = base;
    expect(UpdateInvoiceBody.safeParse(noToken).success).toBe(false);
    expect(
      UpdateInvoiceBody.safeParse({ ...base, requestId: 'x' }).success
    ).toBe(false);
  });
  it('keeps the Memo on statement exactly as typed', () => {
    const r = UpdateInvoiceBody.safeParse({
      ...base,
      statementMemo: 'Line one\nLine two',
    });
    expect(r.data?.statementMemo).toBe('Line one\nLine two');
  });
});

describe('buildInvoiceUpdateBody', () => {
  const lines = [{ DetailType: 'SalesItemLineDetail', Amount: 300 }];
  it('is a sparse update with the SyncToken and the full Line list', () => {
    const body = buildInvoiceUpdateBody({
      id: '423',
      syncToken: '3',
      txnDate: '2026-10-20',
      dueDate: '2026-11-20',
      lines,
      memo: ' Thank you ',
      statementMemo: 'Uniform added',
    });
    expect(body).toEqual({
      Id: '423',
      SyncToken: '3',
      sparse: true,
      TxnDate: '2026-10-20',
      DueDate: '2026-11-20',
      Line: lines,
      CustomerMemo: { value: 'Thank you' },
      PrivateNote: 'Uniform added',
    });
  });
  it('blank notes clear them; a blank due date is not sent', () => {
    const body = buildInvoiceUpdateBody({
      id: '423',
      syncToken: '3',
      txnDate: '2026-10-20',
      dueDate: null,
      lines,
    });
    expect(body).not.toHaveProperty('DueDate');
    expect(body.CustomerMemo).toEqual({ value: '' });
    expect(body.PrivateNote).toBe('');
    // Never a customer, number or email change.
    expect(body).not.toHaveProperty('CustomerRef');
    expect(body).not.toHaveProperty('DocNumber');
    expect(body).not.toHaveProperty('BillEmail');
  });
});

describe('mergeInvoiceLines', () => {
  const sales = (item: string, amount: number, code?: string) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: amount,
    SalesItemLineDetail: {
      ItemRef: { value: item },
      Qty: 1,
      UnitPrice: amount,
      ...(code ? { TaxCodeRef: { value: code } } : {}),
    },
  });
  const liveLines = [
    { Id: '1', ...sales('9', 300, 'SR') },
    { Id: '2', DetailType: 'DiscountLineDetail', Amount: 10 },
    { DetailType: 'SubTotalLineDetail', Amount: 290 },
  ];
  it('keeps an existing line’s Id and GST code, adds new lines, keeps the discount, drops the subtotal', () => {
    const out = mergeInvoiceLines({
      built: [sales('9', 300, 'TX'), sales('12', 50, 'TX')],
      lineIds: ['1', undefined],
      live: liveLines,
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      Id: '1',
      SalesItemLineDetail: { TaxCodeRef: { value: 'SR' } },
    });
    expect(out[1]).not.toHaveProperty('Id');
    expect(out[1]).toMatchObject({
      SalesItemLineDetail: { ItemRef: { value: '12' } },
    });
    expect(out[2]).toEqual({
      Id: '2',
      DetailType: 'DiscountLineDetail',
      Amount: 10,
    });
  });
  it('a line whose product changed takes the new product’s GST code', () => {
    const out = mergeInvoiceLines({
      built: [sales('12', 50, 'TX')],
      lineIds: ['1'],
      live: liveLines,
    });
    expect(out[0]).toMatchObject({
      Id: '1',
      SalesItemLineDetail: { TaxCodeRef: { value: 'TX' } },
    });
  });
  it('a removed line is simply not sent', () => {
    const out = mergeInvoiceLines({
      built: [sales('12', 50)],
      lineIds: [undefined],
      live: liveLines,
    });
    expect(out.some((l) => l.Id === '1')).toBe(false);
  });
});

describe('editRefusal', () => {
  const ok = { customerId: 'C1', syncToken: '3' };
  it('lets an open invoice of the customer through', () => {
    expect(editRefusal(live(), ok)).toBeNull();
    // Part-paid is still open.
    expect(editRefusal(live({ Balance: 100 }), ok)).toBeNull();
  });
  it('refuses another customer’s invoice', () => {
    expect(
      editRefusal(live({ CustomerRef: { value: 'C2' } }), ok)?.error
    ).toMatch(/another QuickBooks customer/);
  });
  it('refuses a voided invoice', () => {
    expect(
      editRefusal(live({ TotalAmt: 0, Balance: 0, PrivateNote: 'Voided' }), ok)
        ?.error
    ).toMatch(/voided/i);
  });
  it('refuses a fully paid invoice', () => {
    expect(editRefusal(live({ Balance: 0 }), ok)?.error).toMatch(/fully paid/);
  });
  it('refuses a stale edit', () => {
    expect(editRefusal(live({ SyncToken: '4' }), ok)?.error).toBe(STALE_EDIT);
  });
});

describe('updateErrorMessage', () => {
  it('QuickBooks 5010 is a stale edit', () => {
    expect(
      updateErrorMessage(new QboError(400, '5010', 'Stale Object Error'), 0)
    ).toBe(STALE_EDIT);
  });
  it('a total below what is paid names the amount paid', () => {
    expect(
      updateErrorMessage(
        new QboError(
          400,
          '6000',
          'The amount of the transaction cannot be less than the payments applied.'
        ),
        120
      )
    ).toBe('The new total can’t be less than the S$120.00 already paid.');
  });
  it('anything else is QuickBooks’ own reason', () => {
    expect(updateErrorMessage(new QboError(400, '2020', 'Required'), 0)).toBe(
      "QuickBooks didn't accept this: Required"
    );
  });
});

describe('amountPaid', () => {
  it('is total less balance less deposit, never below zero', () => {
    expect(amountPaid({ TotalAmt: 300, Balance: 100 })).toBe(200);
    expect(amountPaid({ TotalAmt: 300, Balance: 100, Deposit: 50 })).toBe(150);
    expect(amountPaid({ TotalAmt: 300, Balance: 300 })).toBe(0);
  });
});
