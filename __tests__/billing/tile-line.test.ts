import { describe, expect, it } from 'vitest';

import { tileInvoiceState, tileLine } from '@/lib/billing/tile-line';

const inv = (
  o: Partial<{
    docNumber: string;
    txnDate: string;
    state: 'open' | 'paid' | 'voided';
    paymentDate: string | null;
    balance: number;
  }>
) => ({
  docNumber: 'HFSE062240',
  txnDate: '2026-09-01',
  state: 'open' as const,
  paymentDate: null,
  balance: 100,
  ...o,
});
const cur = { status: 'Invoiced', startDate: null };

describe('tileLine', () => {
  it('nothing billed', () =>
    expect(tileLine('fees', [], cur)).toEqual({
      text: 'Not billed in QuickBooks yet',
      tone: 'none',
    }));
  it('voided only counts as nothing billed', () =>
    expect(
      tileLine('fees', [inv({ state: 'voided', balance: 0 })], cur).tone
    ).toBe('none'));
  it('registration paid', () =>
    expect(
      tileLine(
        'registration',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Finished', startDate: null }
      )
    ).toEqual({
      text: 'Paid · HFSE062240 · 12 Oct',
      tone: 'paid',
    }));
  it('fees open shows what is owed', () =>
    expect(tileLine('fees', [inv({ balance: 1340 })], cur)).toEqual({
      text: 'Invoiced · HFSE062240 · S$1,340.00 owed',
      tone: 'open',
    }));
  it('fees with two live invoices is Re-invoiced, latest number, total owed', () =>
    expect(
      tileLine(
        'fees',
        [
          inv({ docNumber: 'HFSE061904', txnDate: '2026-08-01', balance: 40 }),
          inv({ docNumber: 'HFSE062240', balance: 100 }),
        ],
        cur
      )
    ).toEqual({
      text: 'Re-invoiced · HFSE062240 · S$140.00 owed',
      tone: 'open',
    }));
  it('registration open says Unpaid', () =>
    expect(
      tileLine('registration', [inv({})], { status: 'Unpaid', startDate: null })
        .text
    ).toBe('Unpaid · HFSE062240 · S$100.00 owed'));
  it('paid, no start date: asks for the start date', () =>
    expect(
      tileLine(
        'fees',
        [inv({ state: 'paid', balance: 0, paymentDate: '2026-10-12' })],
        { status: 'Invoiced', startDate: null }
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
        { status: 'Paid', startDate: '2026-08-01' }
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
