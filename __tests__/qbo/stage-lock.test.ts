import { describe, expect, it } from 'vitest';

import {
  notRequiredBlock,
  paidOnStartDate,
  qboLockViolation,
  staffStatusOptions,
} from '@/lib/qbo/stage-lock';

const before = {
  status: 'Unpaid',
  invoice: '1042',
  paymentDate: null as string | null,
};

describe('staffStatusOptions', () => {
  it('the current status, then Ready for invoicing, Not required, Cancelled', () => {
    expect(staffStatusOptions('Unpaid')).toEqual([
      'Unpaid',
      'Ready for invoicing',
      'Not required',
      'Cancelled',
    ]);
    expect(staffStatusOptions(null)).toEqual([
      'Ready for invoicing',
      'Not required',
      'Cancelled',
    ]);
  });
  it('a staff status is listed once', () => {
    expect(staffStatusOptions(' Cancelled ')).toEqual([
      'Ready for invoicing',
      'Not required',
      'Cancelled',
    ]);
  });
});

describe('qboLockViolation', () => {
  it('allows a save that leaves the QuickBooks fields as they are', () => {
    expect(
      qboLockViolation(before, {
        status: 'Unpaid',
        extras: { invoice: ' 1042 ', paymentDate: '', startDate: '2027-01-05' },
      })
    ).toBeNull();
  });
  it('allows Cancelled, even with a live invoice', () => {
    expect(
      qboLockViolation(
        before,
        { status: 'Cancelled' },
        { hasLiveInvoice: true }
      )
    ).toBeNull();
  });
  it('allows Not required while no live invoice is tied', () => {
    expect(
      qboLockViolation(
        before,
        { status: 'Not required' },
        { hasLiveInvoice: false }
      )
    ).toBeNull();
    expect(
      qboLockViolation(
        { status: 'Voided', invoice: '1042', paymentDate: null },
        { status: 'Not required' }
      )
    ).toBeNull();
  });
  it('refuses Not required while a tied invoice is open', () => {
    expect(
      qboLockViolation(
        before,
        { status: 'Not required' },
        { hasLiveInvoice: true }
      )
    ).toBe('Void the open invoice in Billing first, then set Not required.');
  });
  it('refuses Not required when the tied invoices are paid', () => {
    expect(
      qboLockViolation(
        { status: 'Paid', invoice: '1042', paymentDate: '2026-10-01' },
        { status: 'Not required' },
        { hasLiveInvoice: true, allPaid: true }
      )
    ).toBe('This stage is already paid.');
  });
  it('keeping Not required is never refused', () => {
    expect(
      qboLockViolation(
        { status: 'Not required', invoice: '1042', paymentDate: null },
        { status: 'Not required' },
        { hasLiveInvoice: true }
      )
    ).toBeNull();
  });
  it('allows Ready for invoicing while no live invoice is tied', () => {
    expect(
      qboLockViolation(
        { status: null, invoice: null, paymentDate: null },
        { status: 'Ready for invoicing' },
        { hasLiveInvoice: false }
      )
    ).toBeNull();
    expect(
      qboLockViolation(
        { status: 'Voided', invoice: '1042', paymentDate: null },
        { status: 'Ready for invoicing' }
      )
    ).toBeNull();
  });
  it('refuses Ready for invoicing when a live invoice is tied', () => {
    expect(
      qboLockViolation(
        before,
        { status: 'Ready for invoicing' },
        { hasLiveInvoice: true }
      )
    ).toMatch(/already has an invoice in QuickBooks/);
  });
  it('keeping Ready for invoicing is never refused', () => {
    expect(
      qboLockViolation(
        { status: 'Ready for invoicing', invoice: null, paymentDate: null },
        { status: 'Ready for invoicing' },
        { hasLiveInvoice: true }
      )
    ).toBeNull();
  });
  it('refuses a typed invoice number or payment date', () => {
    expect(
      qboLockViolation(before, {
        status: 'Unpaid',
        extras: { invoice: '1050' },
      })
    ).toMatch(/come from QuickBooks/);
    expect(
      qboLockViolation(before, {
        status: 'Unpaid',
        extras: { paymentDate: '2026-10-20' },
      })
    ).toMatch(/come from QuickBooks/);
  });
  it('refuses a money status picked by hand, and clearing to blank', () => {
    for (const status of ['Paid', 'Partially paid', 'Overdue', 'Voided', null])
      expect(qboLockViolation(before, { status })).toMatch(
        /follows QuickBooks/
      );
    expect(
      qboLockViolation(
        { ...before, status: 'Not required' },
        { status: 'Unpaid' }
      )
    ).toMatch(/follows QuickBooks/);
  });
});

describe('notRequiredBlock', () => {
  it('null without a live invoice; a reason with an open or paid one', () => {
    expect(notRequiredBlock()).toBeNull();
    expect(
      notRequiredBlock({ hasLiveInvoice: false, allPaid: false })
    ).toBeNull();
    expect(notRequiredBlock({ hasLiveInvoice: true })).toMatch(
      /Void the open invoice/
    );
    expect(notRequiredBlock({ hasLiveInvoice: true, allPaid: true })).toBe(
      'This stage is already paid.'
    );
  });
});

describe('paidOnStartDate', () => {
  it('Fees paid in QuickBooks turns Paid when the start date is saved', () => {
    expect(
      paidOnStartDate('fees', 'paid', {
        status: 'Unpaid',
        startDate: '2027-01-05',
      })
    ).toBe(true);
  });
  it('not without a start date, not for open invoices, not for Registration, not when Cancelled', () => {
    expect(
      paidOnStartDate('fees', 'paid', { status: 'Unpaid', startDate: null })
    ).toBe(false);
    expect(
      paidOnStartDate('fees', 'open', {
        status: 'Unpaid',
        startDate: '2027-01-05',
      })
    ).toBe(false);
    expect(
      paidOnStartDate('registration', 'paid', {
        status: 'Unpaid',
        startDate: '2027-01-05',
      })
    ).toBe(false);
    expect(
      paidOnStartDate('fees', 'paid', {
        status: 'Cancelled',
        startDate: '2027-01-05',
      })
    ).toBe(false);
  });
});
