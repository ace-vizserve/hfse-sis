import { describe, expect, it } from 'vitest';

import type { BillingMaps, InvoiceLine } from '@/lib/billing/classify';
import {
  createdByLabel,
  duplicateTileWarning,
  formatDay,
  formatShortDay,
  invoiceStatus,
  itemsSummary,
  mapsFromData,
  mapsToData,
  studentDisplayName,
  tileTag,
  todaySg,
} from '@/lib/billing/view';

const maps: BillingMaps = {
  accounts: new Map([
    ['A-REG', 'registration'],
    ['A-FEES', 'fees'],
    ['A-ADV', 'none'],
  ]),
  applications: new Map([
    [
      'S1',
      [
        { ayCode: 'AY2026', createdOn: '2025-02-10' },
        { ayCode: 'AY2027', createdOn: '2026-05-20' },
      ],
    ],
    ['S2', [{ ayCode: 'AY2027', createdOn: '2026-06-01' }]],
  ]),
};
const line = (accountId: string): InvoiceLine => ({
  itemId: 'I1',
  itemName: 'AY2025 Books',
  accountId,
  description: null,
  qty: 1,
  amount: 300,
});

describe('invoiceStatus', () => {
  const base = { state: 'open' as const, total: 100, dueDate: '2026-10-01' };
  it('voided wins', () =>
    expect(
      invoiceStatus({ ...base, state: 'voided', balance: 0 }, '2026-10-16')
    ).toBe('voided'));
  it('paid when nothing is owed', () =>
    expect(
      invoiceStatus({ ...base, state: 'paid', balance: 0 }, '2026-10-16')
    ).toBe('paid'));
  it('overdue beats part paid', () =>
    expect(invoiceStatus({ ...base, balance: 40 }, '2026-10-16')).toBe(
      'overdue'
    ));
  it('part paid before the due date', () =>
    expect(invoiceStatus({ ...base, balance: 40 }, '2026-09-30')).toBe('part'));
  it('open when untouched and not due', () =>
    expect(invoiceStatus({ ...base, balance: 100 }, '2026-10-01')).toBe(
      'open'
    ));
  it('no due date is never overdue', () =>
    expect(
      invoiceStatus({ ...base, dueDate: null, balance: 100 }, '2030-01-01')
    ).toBe('open'));
});

describe('dates and labels', () => {
  it('todaySg uses Singapore time', () =>
    expect(todaySg(new Date('2026-10-15T17:30:00Z'))).toBe('2026-10-16'));
  it('formatDay', () => {
    expect(formatDay('2026-09-01')).toBe('1 Sep 2026');
    expect(formatDay(null)).toBe('—');
  });
  it('formatShortDay', () => {
    expect(formatShortDay('2026-09-01')).toBe('1 Sep');
    expect(formatShortDay('2026-10-12T00:00:00Z')).toBe('12 Oct');
    expect(formatShortDay(null)).toBeNull();
    expect(formatShortDay('')).toBeNull();
  });
  it('itemsSummary shortens long lists', () => {
    const l = (n: string) => ({ itemName: n });
    expect(itemsSummary([l('A'), l('B')])).toBe('A, B');
    expect(itemsSummary([l('A'), l('B'), l('C'), l('D'), l('E')])).toBe(
      'A, B, C +2'
    );
    expect(itemsSummary([l('A'), l('A')])).toBe('A');
    expect(itemsSummary([])).toBe('No items');
  });
  it('createdByLabel', () => {
    expect(
      createdByLabel({
        source: 'created',
        createdByEmail: 'luz@hfse.edu.sg',
        memo: null,
      })
    ).toBe('luz@hfse.edu.sg');
    expect(
      createdByLabel({
        source: 'synced',
        createdByEmail: null,
        memo: 'Auto-generated via n8n',
      })
    ).toBe('n8n');
    expect(
      createdByLabel({
        source: 'synced',
        createdByEmail: null,
        memo: 'AY2027 Enrolment',
      })
    ).toBe('QuickBooks');
  });
  it('tileTag', () => {
    expect(tileTag(['fees'], 'AY2027')).toBe('Fees · AY2027');
    expect(tileTag(['registration', 'fees'], 'AY2027')).toBe(
      'Registration + Fees · AY2027'
    );
    expect(tileTag([], 'AY2027')).toBeNull();
    expect(tileTag(['fees'], null)).toBeNull();
  });
  it('studentDisplayName is "Surname, Given M."', () => {
    expect(
      studentDisplayName({
        lastName: 'Reyes',
        firstName: 'Marco Andres',
        middleName: 'Lopez',
      })
    ).toBe('Reyes, Marco Andres L.');
    expect(
      studentDisplayName({
        lastName: null,
        firstName: null,
        enroleeFullName: 'Wei Ling Tan',
      })
    ).toBe('Wei Ling Tan');
    expect(studentDisplayName({ lastName: null, firstName: null })).toBe(
      'Unnamed student'
    );
  });
});

describe('maps survive a trip to the client', () => {
  it('round trips', () => {
    const data = JSON.parse(JSON.stringify(mapsToData(maps, 'S1')));
    const back = mapsFromData(data);
    expect(back.accounts.get('A-FEES')).toBe('fees');
    expect(back.applications.get('S1')).toEqual(maps.applications.get('S1'));
  });
  it("ships only the one student's applications", () => {
    const data = mapsToData(maps, 'S1');
    expect(data.applications).toHaveLength(2);
    expect(JSON.stringify(data)).not.toContain('2026-06-01');
    expect(mapsFromData(data).applications.has('S2')).toBe(false);
  });
});

describe('duplicateTileWarning', () => {
  const existing = [
    {
      docNumber: 'HFSE061904',
      ayCode: 'AY2027',
      stageKeys: ['fees'],
      state: 'open' as const,
    },
  ];
  it('warns for the same tile in the same year', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        studentNumber: 'S1',
        existing,
      })
    ).toBe(
      'HFSE061904 already bills Fees for AY2027. A second Fees invoice marks the stage Re-invoiced — carry on only if a new invoice is meant to be sent.'
    ));
  it('previous year: no warning', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        studentNumber: 'S1',
        existing: [{ ...existing[0], ayCode: 'AY2026' }],
      })
    ).toBeNull());
  it('a voided invoice does not count', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-FEES')],
        txnDate: '2026-10-15',
        maps,
        studentNumber: 'S1',
        existing: [{ ...existing[0], state: 'voided' }],
      })
    ).toBeNull());
  it('items on no tile: no warning', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-ADV')],
        txnDate: '2026-10-15',
        maps,
        studentNumber: 'S1',
        existing,
      })
    ).toBeNull());
  it('registration names its own stage', () =>
    expect(
      duplicateTileWarning({
        lines: [line('A-REG')],
        txnDate: '2026-10-15',
        maps,
        studentNumber: 'S1',
        existing: [
          {
            docNumber: 'HFSE061210',
            ayCode: 'AY2027',
            stageKeys: ['registration'],
            state: 'paid',
          },
        ],
      })
    ).toBe(
      'HFSE061210 already bills Registration for AY2027. Carry on only if a new invoice is meant to be sent.'
    ));
});
