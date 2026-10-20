import { describe, expect, it } from 'vitest';

import {
  buildInvoiceBody,
  CreateInvoiceBody,
  INVOICE_NOTE_MAX,
  invoiceNote,
  sisCreator,
} from '@/lib/billing/invoice-create-body';

const base = {
  lines: [{ itemId: '1', qty: 1, unitPrice: 100 }],
  txnDate: '2026-10-20',
  dueDate: null,
  send: false,
  requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
};

describe('CreateInvoiceBody — statementMemo', () => {
  it('accepts and trims a memo', () => {
    const r = CreateInvoiceBody.safeParse({
      ...base,
      statementMemo: '  Sibling discount  ',
    });
    expect(r.success).toBe(true);
    expect(r.data?.statementMemo).toBe('Sibling discount');
  });
  it('omits an empty or blank memo', () => {
    for (const statementMemo of ['', '   ', undefined]) {
      const r = CreateInvoiceBody.safeParse({ ...base, statementMemo });
      expect(r.success).toBe(true);
      expect(r.data?.statementMemo).toBeUndefined();
    }
  });
  it('accepts 4000 characters and rejects more', () => {
    expect(
      CreateInvoiceBody.safeParse({
        ...base,
        statementMemo: 'x'.repeat(INVOICE_NOTE_MAX),
      }).success
    ).toBe(true);
    const r = CreateInvoiceBody.safeParse({
      ...base,
      statementMemo: 'x'.repeat(INVOICE_NOTE_MAX + 1),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(
      'A memo is at most 4000 characters in QuickBooks.'
    );
  });
});

describe('buildInvoiceBody', () => {
  const args = {
    customerId: '58',
    customerEmail: 'p@example.com',
    txnDate: '2026-10-20',
    dueDate: null,
    lines: [{ Amount: 100 }],
    docNumber: null,
    staffName: 'Ms A',
  };
  it('puts the memo first in PrivateNote, then the SIS line', () => {
    const b = buildInvoiceBody({ ...args, statementMemo: 'Paid by company' });
    expect(b.PrivateNote).toBe('Paid by company\nCreated from SIS by Ms A');
  });
  it('is the SIS line alone without a memo', () => {
    const b = buildInvoiceBody(args);
    expect(b.PrivateNote).toBe('Created from SIS by Ms A');
  });
  it('keeps Note to customer in CustomerMemo, apart from the memo', () => {
    const b = buildInvoiceBody({
      ...args,
      memo: 'Thank you',
      statementMemo: 'Internal',
    });
    expect(b.CustomerMemo).toEqual({ value: 'Thank you' });
    expect(String(b.PrivateNote)).not.toContain('Thank you');
    expect(buildInvoiceBody(args).CustomerMemo).toBeUndefined();
  });
});

describe('invoiceNote / sisCreator', () => {
  it('cuts the memo, never the SIS line, to fit QuickBooks', () => {
    const n = invoiceNote('x'.repeat(5000), 'Ms A');
    expect(n.length).toBe(INVOICE_NOTE_MAX);
    expect(n.endsWith('\nCreated from SIS by Ms A')).toBe(true);
  });
  it('reads who created it with or without a memo', () => {
    expect(sisCreator('Created from SIS by Ms A')).toBe('Ms A');
    expect(sisCreator('Paid by company\nCreated from SIS by Ms A')).toBe(
      'Ms A'
    );
    expect(sisCreator('Made in QuickBooks')).toBeNull();
    expect(sisCreator(null)).toBeNull();
  });
});
