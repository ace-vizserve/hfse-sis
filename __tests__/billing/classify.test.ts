import { describe, expect, it } from 'vitest';

import {
  classifyInvoice,
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
});
