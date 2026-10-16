import { describe, expect, it } from 'vitest';

import {
  applicationDate,
  classifyInvoice,
  stageForAccount,
  yearForInvoice,
  type BillingMaps,
  type InvoiceLine,
} from '@/lib/billing/classify';

describe('stageForAccount', () => {
  it('Admissions & Registration fills Registration, leaf or fully qualified', () => {
    expect(stageForAccount('Admissions & Registration')).toBe('registration');
    expect(
      stageForAccount('Service/Fee Revenue:Admissions & Registration')
    ).toBe('registration');
  });
  it('every production Enrolment Fees sub-account fills Fees', () => {
    for (const sub of [
      'Books and Worksheets',
      'School Uniforms',
      'Fee Protection Scheme',
      'H&S Insurance',
      'Online Support and Lesson Plan',
      'PA Insurance',
      'Laboratory / Mapeh Fee',
    ])
      expect(stageForAccount(`Service/Fee Revenue:Enrolment Fees:${sub}`)).toBe(
        'fees'
      );
  });
  it("the sandbox's flat names fill Fees", () => {
    expect(stageForAccount('Enrolment Fees - Books and Worksheets')).toBe(
      'fees'
    );
    expect(stageForAccount('Enrolment Fees - Fee Protection Scheme')).toBe(
      'fees'
    );
  });
  it('everything else fills nothing', () => {
    expect(stageForAccount('Advance customers payment')).toBe('none');
    expect(stageForAccount('Service/Fee Revenue:Tuition')).toBe('none');
    expect(stageForAccount('Landscaping Services:Labor:Installation')).toBe(
      'none'
    );
    // Not the account itself: a name that merely contains the words.
    expect(stageForAccount('Admissions & Registration Refunds')).toBe('none');
    expect(stageForAccount('Re-Enrolment Fees')).toBe('none');
    expect(stageForAccount(null)).toBe('none');
    expect(stageForAccount('')).toBe('none');
  });
});

describe('yearForInvoice', () => {
  const app = (ayCode: string, createdOn: string) => ({ ayCode, createdOn });
  it('the newest application made on or before the invoice date', () => {
    expect(
      yearForInvoice(
        [app('AY2025', '2024-05-02'), app('AY2026', '2025-04-20')],
        '2025-09-01'
      )
    ).toBe('AY2026');
  });
  it('an application made up to 7 days after the invoice still owns it', () => {
    expect(yearForInvoice([app('AY2027', '2026-01-12')], '2026-01-09')).toBe(
      'AY2027'
    );
    expect(yearForInvoice([app('AY2027', '2026-01-16')], '2026-01-09')).toBe(
      'AY2027' // no prior application: falls back to the earliest
    );
    expect(
      yearForInvoice(
        [app('AY2026', '2025-03-01'), app('AY2027', '2026-01-17')],
        '2026-01-09'
      )
    ).toBe('AY2026'); // 8 days later: not that application
    expect(
      yearForInvoice(
        [app('AY2026', '2025-03-01'), app('AY2027', '2026-01-16')],
        '2026-01-09'
      )
    ).toBe('AY2027'); // exactly 7 days later: that application
  });
  it('no application before the invoice: the earliest one', () => {
    expect(
      yearForInvoice(
        [app('AY2027', '2026-03-01'), app('AY2026', '2025-12-01')],
        '2025-01-01'
      )
    ).toBe('AY2026');
  });
  it('no applications or no date: no year', () => {
    expect(yearForInvoice([], '2026-01-09')).toBeNull();
    expect(yearForInvoice([app('AY2027', '2026-01-12')], null)).toBeNull();
  });
  it('a re-enrolling student: before the AY2027 application AY2026, after AY2027', () => {
    const apps = [app('AY2026', '2025-02-10'), app('AY2027', '2026-05-20')];
    expect(yearForInvoice(apps, '2026-05-01')).toBe('AY2026');
    expect(yearForInvoice(apps, '2026-06-15')).toBe('AY2027');
  });
  it('reads only the date part of a timestamp', () => {
    expect(
      yearForInvoice([app('AY2027', '2026-01-12')], '2026-01-09T10:00:00Z')
    ).toBe('AY2027');
  });
});

describe('classifyInvoice', () => {
  const maps: BillingMaps = {
    accounts: new Map([
      ['A-REG', 'registration'],
      ['A-ENROL', 'fees'],
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
    ]),
  };
  const line = (accountId: string | null): InvoiceLine => ({
    itemId: 'I1',
    itemName: 'I1',
    accountId,
    description: null,
    qty: 1,
    amount: 100,
  });
  it('stage from the account, year from the applications', () => {
    expect(classifyInvoice([line('A-REG')], '2026-07-10', maps, 'S1')).toEqual({
      ayCode: 'AY2027',
      stageKeys: ['registration'],
    });
    expect(
      classifyInvoice([line('A-ENROL')], '2025-09-01', maps, 'S1')
    ).toEqual({ ayCode: 'AY2026', stageKeys: ['fees'] });
  });
  it('both tiles, in a fixed order', () => {
    expect(
      classifyInvoice(
        [line('A-ENROL'), line('A-REG')],
        '2026-07-10',
        maps,
        'S1'
      ).stageKeys
    ).toEqual(['registration', 'fees']);
  });
  it('no tile: an unmapped, none or blank account', () => {
    for (const a of ['A-ADV', 'A-UNKNOWN', null])
      expect(classifyInvoice([line(a)], '2026-07-10', maps, 'S1')).toEqual({
        ayCode: null,
        stageKeys: [],
      });
  });
  it('no year: a student with no applications, or no date', () => {
    expect(classifyInvoice([line('A-REG')], '2026-07-10', maps, 'S2')).toEqual({
      ayCode: null,
      stageKeys: [],
    });
    expect(classifyInvoice([line('A-REG')], null, maps, 'S1')).toEqual({
      ayCode: null,
      stageKeys: [],
    });
  });
});

describe('applicationDate', () => {
  it('keeps the stored date: created_at already holds Singapore wall-clock time', () => {
    // An application made at 18:00 Singapore time on 16 Jan is stored as
    // 2026-01-16 18:00+00 — converting it again would read 17 Jan.
    expect(applicationDate('2026-01-16T18:00:00+00:00')).toBe('2026-01-16');
    expect(applicationDate('2026-01-16 23:59:59.123+00')).toBe('2026-01-16');
  });
  it('an evening application exactly 7 days after the invoice still counts', () => {
    expect(
      yearForInvoice(
        [
          { ayCode: 'AY2025', createdOn: '2024-11-11' },
          {
            ayCode: 'AY2026',
            createdOn: applicationDate('2026-01-16T18:00:00+00:00'),
          },
        ],
        '2026-01-09'
      )
    ).toBe('AY2026');
  });
});
