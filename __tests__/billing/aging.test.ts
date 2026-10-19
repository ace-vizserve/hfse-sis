import { describe, expect, it } from 'vitest';

import { parseAgedReceivables, parseAgingReport } from '@/lib/billing/aging';

// Shape returned by the sandbox, 2026-10-16 (MARQUEZ, Zara Grace A.).
const report = {
  Columns: {
    Column: [
      { ColTitle: '' },
      { ColTitle: 'Current' },
      { ColTitle: '1 - 30' },
      { ColTitle: '31 - 60' },
      { ColTitle: '61 - 90' },
      { ColTitle: '91 and over' },
      { ColTitle: 'Total' },
    ],
  },
  Rows: {
    Row: [
      {
        ColData: [
          { value: 'MARQUEZ, Zara Grace A.', id: '58' },
          { value: '890.00' },
          { value: '80.00' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '970.00' },
        ],
      },
      {
        ColData: [
          { value: 'TAN, Wei Ling' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '' },
          { value: '120.50' },
          { value: '120.50' },
        ],
      },
      {
        type: 'Section',
        Summary: {
          ColData: [
            { value: 'TOTAL' },
            { value: '890.00' },
            { value: '80.00' },
            { value: '0.00' },
            { value: '0.00' },
            { value: '120.50' },
            { value: '1090.50' },
          ],
        },
      },
    ],
  },
};

describe('parseAgedReceivables', () => {
  it('reads each customer, overdue = everything outside Current', () => {
    expect(parseAgedReceivables(report)).toEqual([
      {
        customerId: '58',
        name: 'MARQUEZ, Zara Grace A.',
        current: 890,
        overdue: 80,
        total: 970,
      },
      {
        customerId: null,
        name: 'TAN, Wei Ling',
        current: 0,
        overdue: 120.5,
        total: 120.5,
      },
    ]);
  });
  it('an empty or odd report gives no rows', () => {
    expect(parseAgedReceivables({})).toEqual([]);
    expect(parseAgedReceivables(null)).toEqual([]);
  });
});

describe('parseAgingReport', () => {
  it('keeps every bucket, each customer and the TOTAL row', () => {
    const r = parseAgingReport(report);
    expect(r.buckets).toEqual([
      'Current',
      '1 - 30',
      '31 - 60',
      '61 - 90',
      '91 and over',
    ]);
    expect(r.rows).toEqual([
      {
        customerId: '58',
        name: 'MARQUEZ, Zara Grace A.',
        amounts: [890, 80, 0, 0, 0],
        total: 970,
      },
      {
        customerId: null,
        name: 'TAN, Wei Ling',
        amounts: [0, 0, 0, 0, 120.5],
        total: 120.5,
      },
    ]);
    expect(r.totals).toEqual({
      amounts: [890, 80, 0, 0, 120.5],
      total: 1090.5,
    });
  });

  it('returns nothing for a report without a Total column', () => {
    expect(parseAgingReport({})).toEqual({
      buckets: [],
      rows: [],
      totals: null,
    });
  });
});
