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

describe('CreateInvoiceBody — discount lines', () => {
  it('takes a line with a rate below 0 (Sibling Discount)', () => {
    const r = CreateInvoiceBody.safeParse({
      ...base,
      lines: [...base.lines, { itemId: '9', qty: 1, unitPrice: -50 }],
    });
    expect(r.success).toBe(true);
  });
  it('takes an invoice the discounts bring to 0 (a full scholar)', () => {
    const r = CreateInvoiceBody.safeParse({
      ...base,
      lines: [...base.lines, { itemId: '9', qty: 1, unitPrice: -100 }],
    });
    expect(r.success).toBe(true);
  });
  it('refuses an invoice the discounts bring below 0', () => {
    const r = CreateInvoiceBody.safeParse({
      ...base,
      lines: [...base.lines, { itemId: '9', qty: 1, unitPrice: -100.01 }],
    });
    expect(r.success).toBe(false);
  });
});

describe('CreateInvoiceBody — stage', () => {
  it('is optional', () => {
    const r = CreateInvoiceBody.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.stage).toBeUndefined();
  });
  it('accepts Registration or Fees with an AY code', () => {
    for (const stage of ['registration', 'fees'] as const) {
      const r = CreateInvoiceBody.safeParse({
        ...base,
        stage: { stage, ayCode: 'AY2027' },
      });
      expect(r.success).toBe(true);
      expect(r.data?.stage).toEqual({ stage, ayCode: 'AY2027' });
    }
  });
  it('refuses another stage or a malformed year', () => {
    for (const stage of [
      { stage: 'documents', ayCode: 'AY2027' },
      { stage: 'fees', ayCode: '2027' },
      { stage: 'fees', ayCode: 'AY27' },
      { stage: 'fees' },
    ])
      expect(CreateInvoiceBody.safeParse({ ...base, stage }).success).toBe(
        false
      );
  });
});

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
  };
  it('sends exactly the typed memo as PrivateNote, no SIS line', () => {
    const b = buildInvoiceBody({
      ...args,
      statementMemo: '  Paid by company ',
    });
    expect(b.PrivateNote).toBe('Paid by company');
  });
  it('sends no PrivateNote without a memo', () => {
    expect('PrivateNote' in buildInvoiceBody(args)).toBe(false);
    expect(
      'PrivateNote' in buildInvoiceBody({ ...args, statementMemo: '  ' })
    ).toBe(false);
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
  it('is the typed memo, cut to fit QuickBooks, never a SIS line', () => {
    expect(invoiceNote('x'.repeat(5000))?.length).toBe(INVOICE_NOTE_MAX);
    expect(invoiceNote('  ')).toBeUndefined();
    expect(invoiceNote(null)).toBeUndefined();
  });
  it('still reads who created an old invoice created it with or without a memo', () => {
    expect(sisCreator('Created from SIS by Ms A')).toBe('Ms A');
    expect(sisCreator('Paid by company\nCreated from SIS by Ms A')).toBe(
      'Ms A'
    );
    expect(sisCreator('Made in QuickBooks')).toBeNull();
    expect(sisCreator(null)).toBeNull();
  });
});
