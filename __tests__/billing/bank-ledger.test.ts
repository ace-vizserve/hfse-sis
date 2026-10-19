import { describe, expect, it } from 'vitest';

import { parseBankLedger } from '@/lib/billing/bank-ledger';

// Shape returned by the sandbox, 2026-10-19 (Checking, from 2026-08-10).
const COLS = {
  Column: [
    'tx_date',
    'txn_type',
    'doc_num',
    'name',
    'memo',
    'split_acc',
    'subt_nat_amount',
    'rbal_nat_amount',
  ].map((k) => ({ MetaData: [{ Name: 'ColKey', Value: k }] })),
};

const report = (rows: unknown[]) => ({
  Columns: COLS,
  Rows: {
    Row: [
      {
        Header: { ColData: [{ value: 'Checking', id: '35' }] },
        Rows: { Row: rows },
        Summary: {
          ColData: [{ value: 'Total for Checking' }, {}, {}, {}, {}, {}, {}],
        },
      },
    ],
  },
});

const line = (
  date: string,
  type: string,
  id: string,
  name: string,
  amount: string,
  balance: string
) => ({
  type: 'Data',
  ColData: [
    { value: date },
    { value: type, id },
    { value: '' },
    { value: name, id: '1' },
    { value: '' },
    { value: 'Accounts Receivable (A/R)', id: '84' },
    { value: amount },
    { value: balance },
  ],
});

describe('parseBankLedger', () => {
  it('reads the beginning balance, each line and the closing balance', () => {
    const l = parseBankLedger(
      report([
        {
          type: 'Data',
          ColData: [
            { value: 'Beginning Balance' },
            {},
            {},
            {},
            {},
            {},
            { value: '' },
            { value: '4349.46' },
          ],
        },
        line(
          '2026-08-12',
          'Check',
          '58',
          "Chin's Gas and Oil",
          '-62.01',
          '4287.45'
        ),
        line(
          '2026-10-16',
          'Payment',
          '399',
          'LACSON, Uma A.',
          '400.00',
          '4687.45'
        ),
      ])
    );
    expect(l.opening).toBe(4349.46);
    expect(l.closing).toBe(4687.45);
    expect(l.moneyIn).toBe(400);
    expect(l.moneyOut).toBe(62.01);
    expect(l.rows).toHaveLength(2);
    expect(l.rows[1]).toMatchObject({
      date: '2026-10-16',
      type: 'Payment',
      txnId: '399',
      number: null,
      name: 'LACSON, Uma A.',
      split: 'Accounts Receivable (A/R)',
      amount: 400,
      balance: 4687.45,
    });
  });

  it('opens at zero when the period starts before the first transaction', () => {
    const l = parseBankLedger(
      report([line('2026-05-03', 'Deposit', '4', '', '5,000.00', '5,000.00')])
    );
    expect(l.opening).toBe(0);
    expect(l.closing).toBe(5000);
    expect(l.rows[0].name).toBeNull();
  });

  it('keeps the opening as the closing when the period has no lines', () => {
    const l = parseBankLedger(
      report([
        {
          type: 'Data',
          ColData: [
            { value: 'Beginning Balance' },
            {},
            {},
            {},
            {},
            {},
            {},
            { value: '800.00' },
          ],
        },
      ])
    );
    expect(l.rows).toEqual([]);
    expect(l.opening).toBe(800);
    expect(l.closing).toBe(800);
  });

  it('returns nothing for an empty or unexpected report', () => {
    expect(parseBankLedger({})).toEqual({
      opening: null,
      rows: [],
      moneyIn: 0,
      moneyOut: 0,
      closing: null,
    });
    expect(parseBankLedger(null).rows).toEqual([]);
  });
});

describe('parseBankLedger with the Clr column', () => {
  // Shape returned by the sandbox, 2026-10-19 (UOB, columns incl. is_cleared):
  // the Beginning Balance figure comes back under Amount.
  const cols = [
    'tx_date',
    'txn_type',
    'doc_num',
    'name',
    'memo',
    'split_acc',
    'is_cleared',
    'subt_nat_amount',
    'rbal_nat_amount',
  ];
  const json = {
    Columns: {
      Column: cols.map((k) => ({ MetaData: [{ Name: 'ColKey', Value: k }] })),
    },
    Rows: {
      Row: [
        {
          Header: { ColData: [{ value: 'UOB', id: '1150040010' }] },
          Rows: {
            Row: [
              {
                type: 'Data',
                ColData: [
                  { value: 'Beginning Balance' },
                  ...Array.from({ length: 6 }, () => ({ value: '' })),
                  { value: '45400.00' },
                  { value: '' },
                ],
              },
              {
                type: 'Data',
                ColData: [
                  { value: '2026-10-16' },
                  { value: 'Payment', id: '344' },
                  { value: 'CREDIT-TEST' },
                  { value: 'MARQUEZ, Zara Grace A.', id: '92' },
                  { value: 'Credit test' },
                  { value: 'Accounts Receivable (A/R)', id: '84' },
                  { value: 'C' },
                  { value: '50.00' },
                  { value: '45450.00' },
                ],
              },
            ],
          },
        },
      ],
    },
  };

  it('reads the opening from Amount and the ✓ mark', () => {
    const l = parseBankLedger(json);
    expect(l.opening).toBe(45400);
    expect(l.rows[0]).toMatchObject({
      number: 'CREDIT-TEST',
      cleared: 'C',
      amount: 50,
      balance: 45450,
    });
  });
});
