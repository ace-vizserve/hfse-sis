import { describe, expect, it } from 'vitest';

import { changedFields, toForm } from '@/lib/billing/customer-form';

const qb = {
  Id: '77',
  SyncToken: '3',
  DisplayName: 'ESPIRITU, Amara Rafael R.',
  CompanyName: 'Michael Jimenez Espiritu / Lorna Rahman Espiritu',
  PrimaryEmailAddr: { Address: 'a@example.test' },
  PrimaryPhone: { FreeFormNumber: '62000011' },
  BillAddr: {
    Line1: '21 Example Road',
    City: 'Singapore',
    PostalCode: '000011',
  },
};

describe('customer form', () => {
  it('reads QuickBooks fields, blanks for missing ones', () => {
    const f = toForm(qb);
    expect(f.displayName).toBe('ESPIRITU, Amara Rafael R.');
    expect(f.email).toBe('a@example.test');
    expect(f.billLine1).toBe('21 Example Road');
    expect(f.mobile).toBe('');
    expect(f.notes).toBe('');
  });

  it('names each changed field once, address parts as Billing address', () => {
    const a = toForm(qb);
    const b = { ...a, billCity: 'SG', billPostalCode: '1', notes: 'x ' };
    expect(changedFields(a, b)).toEqual(['Billing address', 'Notes']);
  });

  it('ignores whitespace-only differences', () => {
    const a = toForm(qb);
    expect(changedFields(a, { ...a, phone: ' 62000011 ' })).toEqual([]);
  });
});
