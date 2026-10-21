import { describe, expect, it } from 'vitest';

import {
  docPageHref,
  docStatus,
  openItemLabel,
  openItemsFromBalanceDetail,
  purchasesFromTransactionList,
  reportRecords,
  type QbReport,
} from '@/lib/billing/sales-docs';

const cols = (keys: string[]) => ({
  Column: keys.map((k) => ({ MetaData: [{ Name: 'ColKey', Value: k }] })),
});

// Shapes as the sandbox returned them on 2026-10-21 (Santos, customer 75).
const balanceDetail: QbReport = {
  Columns: cols([
    'tx_date',
    'txn_type',
    'doc_num',
    'due_date',
    'subt_amount',
    'subt_open_bal',
    'rbal_open_bal',
  ]),
  Rows: {
    Row: [
      {
        type: 'Section',
        Rows: {
          Row: [
            {
              type: 'Data',
              ColData: [
                { value: '2026-10-21' },
                { value: 'Credit Memo', id: '434' },
                { value: 'HFSE069014' },
                { value: '2026-10-21' },
                { value: '-1.00' },
                { value: '-1.00' },
                { value: '-1.00' },
              ],
            },
            {
              type: 'Data',
              ColData: [
                { value: '2026-10-21' },
                { value: 'Expense', id: '435' },
                { value: '' },
                { value: '2026-10-21' },
                { value: '1.00' },
                { value: '1.00' },
                { value: '.00' },
              ],
            },
          ],
        },
      },
    ],
  },
};

const txnList: QbReport = {
  Columns: cols([
    'tx_date',
    'txn_type',
    'doc_num',
    'is_no_post',
    'name',
    'memo',
    'account_name',
    'other_account',
    'subt_nat_amount',
  ]),
  Rows: {
    Row: [
      ['Invoice', '418', 'HFSE069009', '200.00'],
      ['Expense', '428', 'SPK1', '-2.00'],
      ['Cheque', '430', 'SPK2', '-1,003.00'],
      ['Refund', '426', '', '-1.00'],
    ].map(([t, id, doc, amt]) => ({
      type: 'Data',
      ColData: [
        { value: '2026-10-21' },
        { value: t, id },
        { value: doc },
        { value: 'Yes' },
        { value: 'SANTOS, Sean V.', id: '75' },
        { value: t === 'Expense' ? 'refund' : '' },
        { value: 'Bank' },
        { value: 'Accounts Receivable (A/R)' },
        { value: amt },
      ],
    })),
  },
};

describe('reports', () => {
  it('reportRecords walks sections and keys cells by column', () => {
    const r = reportRecords(balanceDetail);
    expect(r).toHaveLength(2);
    expect(r[0].txn_type).toEqual({ value: 'Credit Memo', id: '434' });
  });
  it('open items: credit notes and expenses with their open balance, positive', () => {
    expect(openItemsFromBalanceDetail(balanceDetail)).toEqual([
      expect.objectContaining({
        type: 'credit',
        id: '434',
        open: 1,
        amount: 1,
      }),
      expect.objectContaining({
        type: 'expense',
        id: '435',
        open: 1,
        docNumber: null,
      }),
    ]);
  });
  it('purchases: only expenses and cheques (US "Check" or SG "Cheque"), amounts positive', () => {
    expect(purchasesFromTransactionList(txnList)).toEqual([
      expect.objectContaining({
        kind: 'expense',
        id: '428',
        total: 2,
        memo: 'refund',
      }),
      expect.objectContaining({
        kind: 'check',
        id: '430',
        total: 1003,
        docNumber: 'SPK2',
      }),
    ]);
  });
});

describe('status, labels, links', () => {
  it('credit notes are Unapplied / Partially applied / Applied; the rest Paid', () => {
    expect(docStatus({ kind: 'credit', open: 5, total: 5 }).status).toBe(
      'Unapplied'
    );
    expect(docStatus({ kind: 'credit', open: 2, total: 5 }).status).toBe(
      'Partially applied'
    );
    expect(docStatus({ kind: 'credit', open: 0, total: 5 }).status).toBe(
      'Applied'
    );
    expect(docStatus({ kind: 'refund', open: 0, total: 5 }).status).toBe(
      'Paid'
    );
    expect(docStatus({ kind: 'check', open: 3, total: 3 }).status).toBe('Paid');
  });
  it('uses the Singapore names', () => {
    expect(openItemLabel('credit', 'HFSE1')).toBe('Credit Note # HFSE1');
    expect(openItemLabel('check', 'SPK2')).toBe('Cheque SPK2');
    expect(openItemLabel('expense', null)).toBe('Expense');
  });
  it('refund receipts and credit notes have SIS pages; expenses and cheques do not', () => {
    expect(docPageHref('H230021', 'refund', '426')).toBe(
      '/billing/H230021/refund-receipts/426'
    );
    expect(docPageHref('H230021', 'credit', '434')).toBe(
      '/billing/H230021/credit-notes/434'
    );
    expect(docPageHref('H230021', 'expense', '435')).toBeNull();
  });
});
