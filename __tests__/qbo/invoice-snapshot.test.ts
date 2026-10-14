import { describe, expect, it } from 'vitest';

import {
  invoiceState,
  latestDate,
  linkedPaymentIds,
  type QbInvoice,
} from '@/lib/qbo/invoice-snapshot';

const inv = (over: Partial<QbInvoice>): QbInvoice => ({
  Id: '130',
  DocNumber: '1042',
  TotalAmt: 2800,
  Balance: 2800,
  SyncToken: '0',
  CustomerRef: { value: '58' },
  ...over,
});

describe('invoiceState', () => {
  it('open while a balance remains', () => {
    expect(invoiceState(inv({ Balance: 1800 }))).toBe('open');
  });
  it('paid when the balance reaches 0 on a non-zero invoice', () => {
    expect(invoiceState(inv({ Balance: 0 }))).toBe('paid');
  });
  it('voided: QuickBooks zeroes it and prefixes the note', () => {
    expect(
      invoiceState(
        inv({
          TotalAmt: 0,
          Balance: 0,
          PrivateNote: 'Voided - Created from SIS by X',
        })
      )
    ).toBe('voided');
  });
  it('a deleted invoice (not found) counts as voided', () => {
    expect(invoiceState(null)).toBe('voided');
  });
});

describe('payments on an invoice', () => {
  it('lists only linked Payment ids', () => {
    expect(
      linkedPaymentIds(
        inv({
          LinkedTxn: [
            { TxnId: '201', TxnType: 'Payment' },
            { TxnId: '9', TxnType: 'Estimate' },
            { TxnId: '205', TxnType: 'Payment' },
          ],
        })
      )
    ).toEqual(['201', '205']);
  });
  it('latestDate picks the newest YYYY-MM-DD and ignores blanks', () => {
    expect(
      latestDate(['2026-10-01', null, '2026-10-20', undefined, '2026-09-30'])
    ).toBe('2026-10-20');
    expect(latestDate([null])).toBeNull();
  });
});
