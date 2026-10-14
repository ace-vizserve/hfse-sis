import { describe, expect, it } from 'vitest';

import {
  needsStartDate,
  stageOnInvoiceChange,
  stageOnNewInvoice,
  type StageSnapshot,
} from '@/lib/qbo/stage-state';

const blank: StageSnapshot = {
  status: 'Pending',
  invoice: null,
  paymentDate: null,
  startDate: null,
};
const open = (docNumber = '1042') =>
  ({ docNumber, state: 'open', paymentDate: null }) as const;
const paid = (docNumber = '1042', paymentDate = '2026-10-20') =>
  ({ docNumber, state: 'paid', paymentDate }) as const;
const voided = (docNumber = '1042') =>
  ({ docNumber, state: 'voided', paymentDate: null }) as const;

describe('a new invoice on the stage', () => {
  it('Registration → Unpaid with the number', () => {
    expect(stageOnNewInvoice('registration', blank, open())).toEqual({
      status: 'Unpaid',
      invoice: '1042',
      paymentDate: null,
    });
  });

  it('a second Registration invoice stays Unpaid with the new number', () => {
    expect(
      stageOnNewInvoice(
        'registration',
        { ...blank, status: 'Unpaid', invoice: '1042' },
        open('1050')
      )
    ).toEqual({ status: 'Unpaid', invoice: '1050', paymentDate: null });
  });

  it('first Fees invoice → Invoiced', () => {
    expect(stageOnNewInvoice('fees', blank, open())).toEqual({
      status: 'Invoiced',
      invoice: '1042',
      paymentDate: null,
    });
  });

  it('Fees that already had an invoice (even one typed by hand) → Re-invoiced', () => {
    expect(
      stageOnNewInvoice(
        'fees',
        { ...blank, status: 'Invoiced', invoice: 'INV-77 ' },
        open('1050')
      )
    ).toEqual({ status: 'Re-invoiced', invoice: '1050', paymentDate: null });
  });

  it('linking an invoice that is already paid goes straight to Finished', () => {
    expect(stageOnNewInvoice('registration', blank, paid())).toEqual({
      status: 'Finished',
      invoice: '1042',
      paymentDate: '2026-10-20',
    });
  });

  it('never touches a Cancelled stage', () => {
    expect(
      stageOnNewInvoice('fees', { ...blank, status: 'Cancelled' }, open())
    ).toBeNull();
  });
});

describe('QuickBooks changed the current invoice', () => {
  const regUnpaid: StageSnapshot = {
    ...blank,
    status: 'Unpaid',
    invoice: '1042',
  };
  const feesInvoiced: StageSnapshot = {
    ...blank,
    status: 'Invoiced',
    invoice: '1042',
  };

  it('part payment changes nothing', () => {
    expect(stageOnInvoiceChange('registration', regUnpaid, open())).toBeNull();
    expect(stageOnInvoiceChange('fees', feesInvoiced, open())).toBeNull();
  });

  it('Registration fully paid → Finished + payment date', () => {
    expect(stageOnInvoiceChange('registration', regUnpaid, paid())).toEqual({
      status: 'Finished',
      paymentDate: '2026-10-20',
    });
  });

  it('Fees fully paid with a start date → Paid + payment date', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, startDate: '2027-01-05' },
        paid()
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-10-20' });
  });

  it('Fees fully paid with no start date → payment date only, status held', () => {
    expect(stageOnInvoiceChange('fees', feesInvoiced, paid())).toEqual({
      paymentDate: '2026-10-20',
    });
  });

  it('Re-invoiced fully paid with a start date → Paid', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, status: 'Re-invoiced', startDate: '2027-01-05' },
        paid()
      )
    ).toEqual({ status: 'Paid', paymentDate: '2026-10-20' });
  });

  it('voided → Pending, number and payment date cleared', () => {
    expect(stageOnInvoiceChange('fees', feesInvoiced, voided())).toEqual({
      status: 'Pending',
      invoice: null,
    });
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        voided()
      )
    ).toEqual({ status: 'Pending', invoice: null, paymentDate: null });
  });

  it('reopened after a payment was deleted: Finished → Unpaid, Paid → Invoiced', () => {
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        open()
      )
    ).toEqual({ status: 'Unpaid', paymentDate: null });
    expect(
      stageOnInvoiceChange(
        'fees',
        {
          ...feesInvoiced,
          status: 'Paid',
          paymentDate: '2026-10-20',
          startDate: '2027-01-05',
        },
        open()
      )
    ).toEqual({ status: 'Invoiced', paymentDate: null });
  });

  it('Fees held at Invoiced with a payment date reopens → payment date cleared, status kept', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, paymentDate: '2026-10-20' },
        open()
      )
    ).toEqual({ paymentDate: null });
  });

  it('already in step with QuickBooks → nothing to write', () => {
    expect(
      stageOnInvoiceChange(
        'registration',
        { ...regUnpaid, status: 'Finished', paymentDate: '2026-10-20' },
        paid()
      )
    ).toBeNull();
  });

  it('never touches a Cancelled stage', () => {
    expect(
      stageOnInvoiceChange(
        'fees',
        { ...feesInvoiced, status: 'Cancelled' },
        paid()
      )
    ).toBeNull();
  });
});

describe('needsStartDate', () => {
  it('is true only for Fees paid in QuickBooks, not yet Paid, with no start date', () => {
    const s: StageSnapshot = {
      status: 'Invoiced',
      invoice: '1042',
      paymentDate: '2026-10-20',
      startDate: null,
    };
    expect(needsStartDate('fees', s, 'paid')).toBe(true);
    expect(
      needsStartDate('fees', { ...s, startDate: '2027-01-05' }, 'paid')
    ).toBe(false);
    expect(needsStartDate('fees', { ...s, status: 'Paid' }, 'paid')).toBe(
      false
    );
    expect(needsStartDate('fees', { ...s, status: 'Cancelled' }, 'paid')).toBe(
      false
    );
    expect(needsStartDate('fees', s, 'open')).toBe(false);
    expect(needsStartDate('registration', s, 'paid')).toBe(false);
    expect(needsStartDate('fees', s, null)).toBe(false);
  });
});
