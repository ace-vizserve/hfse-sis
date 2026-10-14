import { describe, expect, it } from 'vitest';

import {
  paidOnStartDate,
  qboLockViolation,
  staffStatusOptions,
} from '@/lib/qbo/stage-lock';

const before = {
  status: 'Invoiced',
  invoice: '1042',
  paymentDate: null as string | null,
};

describe('staffStatusOptions', () => {
  it('current status plus Cancelled', () => {
    expect(staffStatusOptions('Invoiced')).toEqual(['Invoiced', 'Cancelled']);
    expect(staffStatusOptions(null)).toEqual(['Cancelled']);
  });
  it('a Cancelled stage can be reopened as Pending', () => {
    expect(staffStatusOptions('Cancelled')).toEqual(['Cancelled', 'Pending']);
  });
});

describe('qboLockViolation', () => {
  it('allows a save that leaves the QuickBooks fields as they are', () => {
    expect(
      qboLockViolation(before, {
        status: 'Invoiced',
        extras: { invoice: ' 1042 ', paymentDate: '', startDate: '2027-01-05' },
      })
    ).toBeNull();
  });
  it('allows Cancelled, and reopening Cancelled as Pending', () => {
    expect(qboLockViolation(before, { status: 'Cancelled' })).toBeNull();
    expect(
      qboLockViolation(
        { ...before, status: 'Cancelled' },
        { status: 'Pending' }
      )
    ).toBeNull();
  });
  it('refuses a typed invoice number or payment date', () => {
    expect(
      qboLockViolation(before, {
        status: 'Invoiced',
        extras: { invoice: '1050' },
      })
    ).toMatch(/come from QuickBooks/);
    expect(
      qboLockViolation(before, {
        status: 'Invoiced',
        extras: { paymentDate: '2026-10-20' },
      })
    ).toMatch(/come from QuickBooks/);
  });
  it('refuses a money status picked by hand', () => {
    expect(qboLockViolation(before, { status: 'Paid' })).toMatch(
      /follows QuickBooks/
    );
    expect(
      qboLockViolation({ ...before, status: 'Unpaid' }, { status: 'Finished' })
    ).toMatch(/follows QuickBooks/);
  });
});

describe('paidOnStartDate', () => {
  it('Fees paid in QuickBooks turns Paid when the start date is saved', () => {
    expect(
      paidOnStartDate('fees', 'paid', {
        status: 'Invoiced',
        startDate: '2027-01-05',
      })
    ).toBe(true);
  });
  it('not without a start date, not for open invoices, not for Registration, not when Cancelled', () => {
    expect(
      paidOnStartDate('fees', 'paid', { status: 'Invoiced', startDate: null })
    ).toBe(false);
    expect(
      paidOnStartDate('fees', 'open', {
        status: 'Invoiced',
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
