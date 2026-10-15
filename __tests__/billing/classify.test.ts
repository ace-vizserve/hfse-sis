import { describe, expect, it } from 'vitest';

import {
  classifyInvoice,
  overlapMessage,
  type BillingMaps,
  type InvoiceLine,
} from '@/lib/billing/classify';

const maps: BillingMaps = {
  accounts: new Map([
    ['A-REG', 'registration'],
    ['A-ENROL', 'fees'],
    ['A-ADV', 'none'],
  ]),
  items: new Map([
    ['I-SDF27', 'fees'], // AY2027 Student Devt Fees, on the shared "Advance customers payment"
  ]),
  ranges: [
    { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-03-31' },
    { ayCode: 'AY2027', startsOn: '2026-06-01', endsOn: '2027-03-31' },
  ],
};
const line = (itemId: string, accountId: string): InvoiceLine => ({
  itemId,
  itemName: itemId,
  accountId,
  description: null,
  qty: 1,
  amount: 100,
});

describe('classifyInvoice', () => {
  it('maps by account', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2026-07-10', maps)
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['registration'] });
  });
  it('an item override beats its account', () => {
    expect(
      classifyInvoice([line('I-SDF27', 'A-ADV')], '2026-09-01', maps)
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['fees'] });
  });
  it('tuition on the shared account is on no tile', () => {
    expect(
      classifyInvoice([line('I-TUI', 'A-ADV')], '2026-10-01', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('unmapped account: no tile', () => {
    expect(
      classifyInvoice([line('I-BOOK', 'A-BOOKS')], '2026-10-01', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('lines for both tiles: counts for both', () => {
    expect(
      classifyInvoice(
        [line('I-REG27', 'A-REG'), line('I-SDF27', 'A-ADV')],
        '2026-09-01',
        maps
      )
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['registration', 'fees'] });
  });
  it('previous year: a returning student’s AY2026 Fees stays on AY2026', () => {
    expect(
      classifyInvoice([line('I-SDF26', 'A-ENROL')], '2025-09-01', maps)
    ).toEqual({ ayCode: 'AY2026', stageKeys: ['fees'] });
  });
  it('outside every range: on no tile', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2026-04-15', maps)
    ).toEqual({ ayCode: null, stageKeys: [] });
  });
  it('range ends are inclusive', () => {
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2027-03-31', maps).ayCode
    ).toBe('AY2027');
  });
  it('no date: on no tile', () => {
    expect(classifyInvoice([line('I-REG27', 'A-REG')], null, maps)).toEqual({
      ayCode: null,
      stageKeys: [],
    });
  });
  it('an item mapped none beats its account mapped fees', () => {
    const m: BillingMaps = {
      ...maps,
      accounts: new Map([['A-X', 'fees']]),
      items: new Map([['I-X', 'none']]),
    };
    expect(classifyInvoice([line('I-X', 'A-X')], '2026-09-01', m)).toEqual({
      ayCode: null,
      stageKeys: [],
    });
  });
  it('a negative discount line on a none account does not remove the fee tile', () => {
    const discount: InvoiceLine = { ...line('I-DISC', 'A-ADV'), amount: -50 };
    expect(
      classifyInvoice(
        [line('I-REG27', 'A-ENROL'), discount],
        '2026-09-01',
        maps
      )
    ).toEqual({ ayCode: 'AY2027', stageKeys: ['fees'] });
  });
  it('a line with no item and no account counts for nothing', () => {
    const blank: InvoiceLine = {
      itemId: null,
      itemName: null,
      accountId: null,
      description: null,
      qty: null,
      amount: 10,
    };
    expect(classifyInvoice([blank], '2026-09-01', maps)).toEqual({
      ayCode: null,
      stageKeys: [],
    });
  });
  it('overlapping ranges: the earlier-starting one wins', () => {
    const m: BillingMaps = {
      ...maps,
      ranges: [
        { ayCode: 'AY2027', startsOn: '2026-05-01', endsOn: '2027-03-31' },
        { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
      ],
    };
    expect(
      classifyInvoice([line('I-REG27', 'A-REG')], '2026-05-15', m).ayCode
    ).toBe('AY2026');
  });
});

describe('overlapMessage', () => {
  it('accepts back-to-back years', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
        { ayCode: 'AY2027', startsOn: '2026-06-01', endsOn: '2027-05-31' },
      ])
    ).toBeNull();
  });
  it('refuses overlap', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2027', startsOn: '2026-05-01', endsOn: '2027-05-31' },
        { ayCode: 'AY2026', startsOn: '2025-06-01', endsOn: '2026-05-31' },
      ])
    ).toBe('AY2026 and AY2027 overlap. A date can only belong to one year.');
  });
  it('refuses a range that ends before it starts', () => {
    expect(
      overlapMessage([
        { ayCode: 'AY2027', startsOn: '2027-06-01', endsOn: '2026-06-01' },
      ])
    ).toBe('AY2027 ends before it starts.');
  });
});
