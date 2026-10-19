import { describe, expect, it } from 'vitest';

import {
  columnTitle,
  formatReportMoney,
  lineCustomerId,
  lineInvoiceId,
  parseReport,
  reportCsv,
  reportLines,
  sectionKeys,
} from '@/lib/billing/report';

// Shaped like QuickBooks' real answers (sandbox, 2026-10-19).
const col = (title: string, type: string, key: string) => ({
  ColTitle: title,
  ColType: type,
  MetaData: [{ Name: 'ColKey', Value: key }],
});

const agingSummary = {
  Header: {
    ReportName: 'AgedReceivables',
    EndPeriod: '2026-10-19',
    Option: [
      { Name: 'report_date', Value: '2026-10-19' },
      { Name: 'NoReportData', Value: 'false' },
    ],
  },
  Columns: {
    Column: [
      col('', 'Customer', ''),
      col('Current', 'Money', 'current'),
      col('1 - 30', 'Money', '0'),
      col('91 and over', 'Money', '3'),
      col('Total', 'Money', 'total'),
    ],
  },
  Rows: {
    Row: [
      {
        ColData: [
          { value: 'ABAD, Enzo Rose P.', id: '111' },
          { value: '' },
          { value: '' },
          { value: '920.00' },
          { value: '920.00' },
        ],
      },
      {
        Header: {
          ColData: [
            { value: 'Freeman Sporting Goods', id: '7' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '0.00' },
          ],
        },
        Rows: {
          Row: [
            {
              ColData: [
                { value: '0969 Ocean View Road', id: '8' },
                { value: '' },
                { value: '477.50' },
                { value: '' },
                { value: '477.50' },
              ],
              type: 'Data',
            },
            {
              Header: { ColData: [{ value: 'Nested job', id: '9' }] },
              Rows: {
                Row: [
                  {
                    ColData: [
                      { value: 'Shed', id: '10' },
                      { value: '4.00' },
                      { value: '81.00' },
                      { value: '' },
                      { value: '85.00' },
                    ],
                    type: 'Data',
                  },
                ],
              },
              Summary: {
                ColData: [
                  { value: 'Total Nested job' },
                  { value: '4.00' },
                  { value: '81.00' },
                  { value: '' },
                  { value: '85.00' },
                ],
              },
              type: 'Section',
            },
          ],
        },
        Summary: {
          ColData: [
            { value: 'Total Freeman Sporting Goods' },
            { value: '4.00' },
            { value: '558.50' },
            { value: '0.00' },
            { value: '562.50' },
          ],
        },
        type: 'Section',
      },
      {
        Summary: {
          ColData: [
            { value: 'TOTAL' },
            { value: '4.00' },
            { value: '558.50' },
            { value: '920.00' },
            { value: '1482.50' },
          ],
        },
        type: 'Section',
        group: 'GrandTotal',
      },
    ],
  },
};

const openInvoices = {
  Header: {
    ReportName: 'CustomerBalanceDetail',
    EndPeriod: '2026-10-19',
    Option: [{ Name: 'report_date', Value: '2026-10-19' }],
  },
  Columns: {
    Column: [
      col('Date', 'Date', 'tx_date'),
      col('Transaction Type', 'String', 'txn_type'),
      col('Num', 'String', 'doc_num'),
      col('Terms', 'String', 'term_name'),
      col('Due Date', 'Date', 'due_date'),
      col('Open Balance', 'Money', 'subt_open_bal'),
    ],
  },
  Rows: {
    Row: [
      {
        Header: {
          ColData: [
            { value: 'EVANGELISTA, Ian J.', id: '96' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '' },
          ],
        },
        Rows: {
          Row: [
            {
              ColData: [
                { value: '2026-01-05' },
                { value: 'Invoice', id: '269' },
                { value: 'HFSE062373' },
                { value: '', id: '' },
                { value: '2026-02-04' },
                { value: '920.00' },
              ],
              type: 'Data',
            },
            {
              ColData: [
                { value: '2026-10-16' },
                { value: 'Payment', id: '378' },
                { value: '' },
                { value: '', id: '' },
                { value: '2026-10-16' },
                { value: '-55.00' },
              ],
              type: 'Data',
            },
          ],
        },
        Summary: {
          ColData: [
            { value: 'Total for EVANGELISTA, Ian J.' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '865.00' },
          ],
        },
        type: 'Section',
      },
      {
        Summary: {
          ColData: [
            { value: 'TOTAL' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '' },
            { value: '865.00' },
          ],
        },
        type: 'Section',
      },
    ],
  },
};

describe('parseReport', () => {
  it('reads the columns as QuickBooks titles them on the page', () => {
    const r = parseReport(openInvoices);
    expect(r.columns.map((c) => c.title)).toEqual([
      'Date',
      'Transaction type',
      'Num',
      'Term',
      'Due date',
      'Open balance',
    ]);
    expect(r.columns.map((c) => c.kind)).toEqual([
      'date',
      'text',
      'text',
      'text',
      'date',
      'money',
    ]);
    expect(r.reportDate).toBe('2026-10-19');
  });

  it('keeps a blank column title but names it for the CSV', () => {
    const r = parseReport(agingSummary);
    expect(r.columns[0]).toMatchObject({ title: '', label: 'Customer' });
    expect(r.columns[2].title).toBe('1 - 30');
  });

  it('nests sections, counts their rows and reads summary lines', () => {
    const r = parseReport(agingSummary);
    expect(r.rows).toHaveLength(2);
    const [abad, freeman] = r.rows;
    expect(abad).toMatchObject({ kind: 'data' });
    if (freeman.kind !== 'section') throw new Error('expected a section');
    expect(freeman).toMatchObject({
      label: 'Freeman Sporting Goods',
      id: '7',
      count: 2,
    });
    expect(freeman.summary?.[0].value).toBe('Total for Freeman Sporting Goods');
    const nested = freeman.children[1];
    if (nested.kind !== 'section') throw new Error('expected a section');
    expect(nested.key).toBe('1.1');
    expect(nested.summary?.[0].value).toBe('Total for Nested job');
    expect(sectionKeys(r.rows)).toEqual(['1', '1.1']);
  });

  it('lifts the report TOTAL out of the rows', () => {
    expect(parseReport(agingSummary).total?.map((c) => c.value)).toEqual([
      'TOTAL',
      '4.00',
      '558.50',
      '920.00',
      '1482.50',
    ]);
    expect(parseReport(openInvoices).total?.[5].value).toBe('865.00');
  });

  it('turns blank and missing cells into empty strings, ids into null', () => {
    const r = parseReport(openInvoices);
    const sec = r.rows[0];
    if (sec.kind !== 'section') throw new Error('expected a section');
    const row = sec.children[0];
    if (row.kind !== 'data') throw new Error('expected data');
    expect(row.cells[3]).toEqual({ value: '', id: null });
    const nested = parseReport(agingSummary).rows[1];
    if (nested.kind !== 'section') throw new Error('expected a section');
    const deep = nested.children[1];
    if (deep.kind !== 'section') throw new Error('expected a section');
    expect(deep.header).toHaveLength(5);
    expect(deep.header[4]).toEqual({ value: '', id: null });
  });

  it('reads an empty answer as no data', () => {
    expect(parseReport({}).noData).toBe(true);
    expect(
      parseReport({
        Header: { Option: [{ Name: 'NoReportData', Value: 'true' }] },
        Columns: { Column: [col('Date', 'Date', 'tx_date')] },
        Rows: {},
      })
    ).toMatchObject({ noData: true, rows: [], total: null });
  });
});

describe('reportLines', () => {
  it('prints header, rows, summary, total in order', () => {
    const lines = reportLines(parseReport(agingSummary));
    expect(lines.map((l) => `${l.kind}:${l.depth}`)).toEqual([
      'data:0',
      'header:0',
      'data:1',
      'header:1',
      'data:2',
      'summary:2',
      'summary:1',
      'total:0',
    ]);
  });

  it('prints a collapsed group as its header alone', () => {
    const lines = reportLines(parseReport(agingSummary), new Set(['1']));
    expect(lines.map((l) => l.kind)).toEqual(['data', 'header', 'total']);
    expect(lines[1]).toMatchObject({ kind: 'header', collapsed: true });
  });
});

describe('links', () => {
  it('finds the customer from the first column, the group or a column', () => {
    const a = parseReport(agingSummary);
    const al = reportLines(a);
    expect(lineCustomerId(al[0], a.columns, 'firstColumn')).toBe('111');
    expect(lineCustomerId(al[1], a.columns, 'firstColumn')).toBe('7');
    expect(lineCustomerId(al[7], a.columns, 'firstColumn')).toBeNull();

    const o = parseReport(openInvoices);
    const ol = reportLines(o);
    expect(lineCustomerId(ol[1], o.columns, 'section')).toBe('96');
    expect(lineCustomerId(ol[1], o.columns, 'none')).toBeNull();
    expect(lineCustomerId(ol[1], o.columns, 'column')).toBeNull();
  });

  it('finds the invoice id on the Transaction type cell, invoices only', () => {
    const o = parseReport(openInvoices);
    const ol = reportLines(o);
    expect(lineInvoiceId(ol[1], o.columns)).toBe('269');
    expect(lineInvoiceId(ol[2], o.columns)).toBeNull(); // a Payment
    expect(lineInvoiceId(ol[0], o.columns)).toBeNull(); // a header
  });
});

describe('formatting and CSV', () => {
  it('formats money as QuickBooks prints it', () => {
    expect(formatReportMoney('1482.5')).toBe('1,482.50');
    expect(formatReportMoney('-60')).toBe('-60.00');
    expect(formatReportMoney('')).toBe('');
    expect(formatReportMoney('n/a')).toBe('n/a');
  });

  it('sentence-cases API titles', () => {
    expect(columnTitle('Memo/Description')).toBe('Memo/description');
    expect(columnTitle('Terms')).toBe('Term');
    expect(columnTitle('91 and over')).toBe('91 and over');
  });

  it('exports every line with group names and totals', () => {
    const csv = reportCsv(parseReport(openInvoices)).split('\r\n');
    expect(csv[0]).toBe('Date,Transaction type,Num,Term,Due date,Open balance');
    expect(csv[1]).toBe('"EVANGELISTA, Ian J. (2)",,,,,');
    expect(csv[2]).toBe('  2026-01-05,Invoice,HFSE062373,,2026-02-04,920.00');
    expect(csv[4]).toBe('"  Total for EVANGELISTA, Ian J.",,,,,865.00');
    expect(csv[5]).toBe('TOTAL,,,,,865.00');
  });
});
