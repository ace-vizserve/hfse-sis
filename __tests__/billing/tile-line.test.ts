import { describe, expect, it } from 'vitest';

import type { TileInvoice } from '@/lib/billing/stage-from-invoices';
import { tileInvoiceState, tileLine } from '@/lib/billing/tile-line';

const TODAY = '2026-10-21';
const inv = (o: Partial<TileInvoice>): TileInvoice => ({
  docNumber: 'HFSE062240',
  txnDate: '2026-09-01',
  dueDate: null,
  state: 'open',
  paymentDate: null,
  total: 100,
  balance: 100,
  ...o,
});
const cur = { status: 'Unpaid', startDate: null };

describe('tileLine', () => {
  it('nothing tied', () =>
    expect(tileLine('fees', [], cur, TODAY)).toEqual({
      text: 'Not billed in QuickBooks yet',
      tone: 'none',
    }));
  it('voided only reads Voided with the number', () =>
    expect(
      tileLine('fees', [inv({ state: 'voided', balance: 0 })], cur, TODAY)
    ).toEqual({ text: 'Voided · HFSE062240', tone: 'none' }));
  it('registration paid', () =>
    expect(
      tileLine(
        'registration',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Paid', startDate: null },
        TODAY
      )
    ).toEqual({
      text: 'Paid · HFSE062240 · 12 Oct',
      tone: 'paid',
    }));
  it('open shows Unpaid and what is owed', () =>
    expect(
      tileLine('fees', [inv({ total: 1340, balance: 1340 })], cur, TODAY)
    ).toEqual({
      text: 'Unpaid · HFSE062240 · S$1,340.00 owed',
      tone: 'open',
    }));
  it('part paid, two live invoices: latest number, total owed', () =>
    expect(
      tileLine(
        'fees',
        [
          inv({ docNumber: 'HFSE061904', txnDate: '2026-08-01', balance: 40 }),
          inv({ docNumber: 'HFSE062240', balance: 100 }),
        ],
        cur,
        TODAY
      )
    ).toEqual({
      text: 'Partially paid · HFSE062240 · S$140.00 owed',
      tone: 'open',
    }));
  it('past due reads Overdue, as attention', () =>
    expect(
      tileLine('registration', [inv({ dueDate: '2026-10-01' })], cur, TODAY)
    ).toEqual({
      text: 'Overdue · HFSE062240 · S$100.00 owed',
      tone: 'attention',
    }));
  it('paid, no start date: asks for the start date', () =>
    expect(
      tileLine(
        'fees',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Unpaid', startDate: null },
        TODAY
      )
    ).toEqual({
      text: 'Paid in QuickBooks — add the start date',
      tone: 'attention',
    }));
  it('fees paid with a start date', () =>
    expect(
      tileLine(
        'fees',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Paid', startDate: '2026-08-01' },
        TODAY
      ).text
    ).toBe('Paid · HFSE062240 · 12 Oct'));
});

describe('tileInvoiceState', () => {
  it('paid only when every live invoice is paid', () => {
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'voided' }])).toBe(
      'paid'
    );
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'open' }])).toBe(
      'open'
    );
    expect(tileInvoiceState([{ state: 'voided' }])).toBeNull();
    expect(tileInvoiceState([])).toBeNull();
  });
});
