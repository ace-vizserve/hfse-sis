import { describe, expect, it } from 'vitest';

import {
  stageFromInvoices,
  tileNeedsStartDate,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import type { StageSnapshot } from '@/lib/qbo/stage-state';

const snap = (s: Partial<StageSnapshot> = {}): StageSnapshot => ({
  status: 'Pending',
  invoice: null,
  paymentDate: null,
  startDate: null,
  ...s,
});
const inv = (
  docNumber: string,
  txnDate: string,
  state: TileInvoice['state'],
  paymentDate: string | null = null
): TileInvoice => ({ docNumber, txnDate, state, paymentDate });

describe('stageFromInvoices — Registration', () => {
  it('empty invoice list: stage left alone, even when staff set it', () => {
    expect(stageFromInvoices('registration', [], snap())).toBeNull();
    expect(
      stageFromInvoices(
        'registration',
        [],
        snap({
          status: 'Finished',
          invoice: 'HFSE062301',
          paymentDate: '2026-07-15',
        })
      )
    ).toBeNull();
  });
  it('one open invoice: Unpaid + number', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap()
      )
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE062301' });
  });
  it('part paid: no change from Unpaid', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toBeNull();
  });
  it('fully paid: Finished + payment date', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'paid', '2026-07-15')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toEqual({ status: 'Finished', paymentDate: '2026-07-15' });
  });
  it('voided only: back to Pending, cleared', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'voided')],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toEqual({ status: 'Pending', invoice: null });
  });
  it('reopened after Finished: Unpaid, payment date cleared', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'open')],
        snap({
          status: 'Finished',
          invoice: 'HFSE062301',
          paymentDate: '2026-07-15',
        })
      )
    ).toEqual({ status: 'Unpaid', paymentDate: null });
  });
  it('Cancelled is never touched', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'paid', '2026-07-15')],
        snap({ status: 'Cancelled' })
      )
    ).toBeNull();
  });
});

describe('stageFromInvoices — Fees', () => {
  it('first invoice: Invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'open')],
        snap()
      )
    ).toEqual({ status: 'Invoiced', invoice: 'HFSE062302' });
  });
  it('a further invoice: Re-invoiced, latest number', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'open'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap({ status: 'Invoiced', invoice: 'HFSE062302' })
      )
    ).toEqual({ status: 'Re-invoiced', invoice: 'HFSE062310' });
  });
  it('older paid, newer open: Re-invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Re-invoiced', invoice: 'HFSE062310' });
  });
  it('all paid with a start date: Paid + latest payment date', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05'),
          inv('HFSE062310', '2026-09-20', 'paid', '2026-09-25'),
        ],
        snap({
          status: 'Re-invoiced',
          invoice: 'HFSE062310',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-09-25' });
  });
  it('all paid, no start date: payment date only, status waits', () => {
    const current = snap({ status: 'Invoiced', invoice: 'HFSE062302' });
    const invoices = [inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05')];
    expect(stageFromInvoices('fees', invoices, current)).toEqual({
      paymentDate: '2026-09-05',
    });
    expect(tileNeedsStartDate('fees', invoices, current)).toBe(true);
  });
  it('reopened after Paid: Invoiced, payment date cleared', () => {
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'open')],
        snap({
          status: 'Paid',
          invoice: 'HFSE062302',
          paymentDate: '2026-09-05',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ status: 'Invoiced', paymentDate: null });
  });
  it('voided invoice is not counted toward Re-invoiced', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'voided'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Invoiced', invoice: 'HFSE062310' });
  });
  it('same date: the higher number is the latest', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062311', '2026-09-20', 'open'),
          inv('HFSE062310', '2026-09-20', 'open'),
        ],
        snap()
      )?.invoice
    ).toBe('HFSE062311');
  });
});

const noNumber = (
  txnDate: string,
  state: TileInvoice['state'],
  paymentDate: string | null = null
): TileInvoice => ({ docNumber: null, txnDate, state, paymentDate });

describe('stageFromInvoices — invoice number and payment date rules', () => {
  it('latest invoice with no number: the earlier numbered one is used', () => {
    expect(
      stageFromInvoices(
        'registration',
        [
          inv('HFSE062301', '2026-07-10', 'open'),
          noNumber('2026-07-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Unpaid', invoice: 'HFSE062301' });
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE062302', '2026-09-01', 'open'),
          noNumber('2026-09-20', 'open'),
        ],
        snap()
      )
    ).toEqual({ status: 'Re-invoiced', invoice: 'HFSE062302' });
  });
  it('no live invoice has a number: status and invoice untouched', () => {
    expect(
      stageFromInvoices(
        'registration',
        [noNumber('2026-07-10', 'open')],
        snap()
      )
    ).toBeNull();
    expect(
      stageFromInvoices(
        'fees',
        [noNumber('2026-09-01', 'paid', '2026-09-05')],
        snap({ status: 'Invoiced', invoice: 'HFSE062302' })
      )
    ).toBeNull();
  });
  it('all paid with no payment dates: status held, number set, date not cleared', () => {
    expect(
      stageFromInvoices(
        'registration',
        [inv('HFSE062301', '2026-07-10', 'paid', null)],
        snap({ status: 'Unpaid', invoice: 'OLD000' })
      )
    ).toEqual({ invoice: 'HFSE062301' });
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'paid', null)],
        snap({
          status: 'Invoiced',
          invoice: 'OLD000',
          paymentDate: '2026-09-05',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ invoice: 'HFSE062302' });
  });
  it('payment date with a time part: first 10 characters are used', () => {
    expect(
      stageFromInvoices(
        'registration',
        [
          inv(
            'HFSE062301',
            '2026-07-10T09:00:00',
            'paid',
            '2026-07-15T08:30:00Z'
          ),
        ],
        snap({ status: 'Unpaid', invoice: 'HFSE062301' })
      )
    ).toEqual({ status: 'Finished', paymentDate: '2026-07-15' });
  });
  it('numeric tie-break on the same date: HFSE10 is later than HFSE9', () => {
    expect(
      stageFromInvoices(
        'fees',
        [
          inv('HFSE9', '2026-09-20', 'open'),
          inv('HFSE10', '2026-09-20', 'open'),
        ],
        snap()
      )?.invoice
    ).toBe('HFSE10');
  });
});

describe('stageFromInvoices — voided only', () => {
  it('voided only still clears to Pending, number and date cleared', () => {
    expect(
      stageFromInvoices(
        'fees',
        [inv('HFSE062302', '2026-09-01', 'voided')],
        snap({
          status: 'Paid',
          invoice: 'HFSE062302',
          paymentDate: '2026-09-05',
          startDate: '2027-01-05',
        })
      )
    ).toEqual({ status: 'Pending', invoice: null, paymentDate: null });
  });
});

describe('tileNeedsStartDate — false branches', () => {
  const paid = [inv('HFSE062302', '2026-09-01', 'paid', '2026-09-05')];
  it('stage already Paid: false', () => {
    expect(tileNeedsStartDate('fees', paid, snap({ status: 'Paid' }))).toBe(
      false
    );
  });
  it('stage Cancelled: false', () => {
    expect(
      tileNeedsStartDate('fees', paid, snap({ status: 'Cancelled' }))
    ).toBe(false);
  });
  it('start date already set: false', () => {
    expect(
      tileNeedsStartDate(
        'fees',
        paid,
        snap({ status: 'Invoiced', startDate: '2027-01-05' })
      )
    ).toBe(false);
  });
  it('an open invoice on the tile: false', () => {
    expect(
      tileNeedsStartDate(
        'fees',
        [...paid, inv('HFSE062310', '2026-09-20', 'open')],
        snap({ status: 'Re-invoiced' })
      )
    ).toBe(false);
  });
  it('no invoices: false', () => {
    expect(tileNeedsStartDate('fees', [], snap())).toBe(false);
  });
});
