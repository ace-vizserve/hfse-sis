import { describe, expect, it } from 'vitest';

import {
  createdByLabel,
  duplicateTileWarning,
  formatDay,
  formatShortDay,
  invoiceStatus,
  itemsSummary,
  studentDisplayName,
  tileTag,
  todaySg,
} from '@/lib/billing/view';

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
  it('createdByLabel falls back to the old memo line', () => {
    expect(
      createdByLabel({
        source: 'created',
        createdByEmail: null,
        memo: null,
        privateNote: 'Paid by company\nCreated from SIS by Ms A',
      })
    ).toBe('Ms A');
    expect(
      createdByLabel({
        source: 'created',
        createdByEmail: 'luz@hfse.edu.sg',
        memo: null,
        privateNote: 'Created from SIS by Ms A',
      })
    ).toBe('luz@hfse.edu.sg');
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

describe('duplicateTileWarning', () => {
  const existing = [
    {
      docNumber: 'HFSE061904',
      ayCode: 'AY2027',
      stageKeys: ['fees'],
      state: 'open' as const,
    },
  ];
  const fees27 = { stage: 'fees' as const, ayCode: 'AY2027' };
  it('warns when the stage already has a live tied invoice', () =>
    expect(duplicateTileWarning({ target: fees27, existing })).toBe(
      'Fees for AY2027 already has HFSE061904 open.'
    ));
  it('another year: no warning', () =>
    expect(
      duplicateTileWarning({
        target: fees27,
        existing: [{ ...existing[0], ayCode: 'AY2026' }],
      })
    ).toBeNull());
  it('a voided invoice does not count', () =>
    expect(
      duplicateTileWarning({
        target: fees27,
        existing: [{ ...existing[0], state: 'voided' }],
      })
    ).toBeNull());
  it('an untied invoice does not count', () =>
    expect(
      duplicateTileWarning({
        target: fees27,
        existing: [{ ...existing[0], ayCode: null, stageKeys: [] }],
      })
    ).toBeNull());
  it('no stage (customer page): no warning', () =>
    expect(duplicateTileWarning({ target: null, existing })).toBeNull());
  it('an open one is named before a paid one', () =>
    expect(
      duplicateTileWarning({
        target: fees27,
        existing: [
          { ...existing[0], docNumber: 'HFSE1', state: 'paid' },
          { ...existing[0], docNumber: 'HFSE2' },
        ],
      })
    ).toBe('Fees for AY2027 already has HFSE2 open.'));
  it('registration names its own stage', () =>
    expect(
      duplicateTileWarning({
        target: { stage: 'registration', ayCode: 'AY2027' },
        existing: [
          {
            docNumber: 'HFSE061210',
            ayCode: 'AY2027',
            stageKeys: ['registration'],
            state: 'paid',
          },
        ],
      })
    ).toBe('Registration for AY2027 already has HFSE061210 paid.'));
});
