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
  it('no invoice, stage untouched: no change', () => {
    expect(stageFromInvoices('registration', [], snap())).toBeNull();
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
