import { describe, expect, it } from 'vitest';

import {
  buildInvoiceLines,
  createdButNotSaved,
} from '@/lib/qbo/invoice-actions';

describe('createdButNotSaved', () => {
  it('names the QuickBooks number and the way out', () => {
    expect(createdButNotSaved('1042')).toBe(
      "QuickBooks created invoice 1042, but the SIS couldn't save it. Use Link QB invoice to attach it — don't create it again."
    );
  });
});

describe('buildInvoiceLines', () => {
  it("uses the item's own tax code and computes the amount", () => {
    const items = new Map([
      ['5', { Id: '5', Name: 'Tuition Fee', SalesTaxCodeRef: { value: '12' } }],
      ['6', { Id: '6', Name: 'Annual Fee' }],
    ]);
    expect(
      buildInvoiceLines(
        [
          { itemId: '5', qty: 2, unitPrice: 1000.5 },
          { itemId: '6', qty: 1, unitPrice: 800, description: 'AY2027' },
        ],
        items
      )
    ).toEqual([
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 2001,
        SalesItemLineDetail: {
          ItemRef: { value: '5', name: 'Tuition Fee' },
          Qty: 2,
          UnitPrice: 1000.5,
          TaxCodeRef: { value: '12' },
        },
      },
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 800,
        Description: 'AY2027',
        SalesItemLineDetail: {
          ItemRef: { value: '6', name: 'Annual Fee' },
          Qty: 1,
          UnitPrice: 800,
        },
      },
    ]);
  });

  it('throws on an item QuickBooks no longer has', () => {
    expect(() =>
      buildInvoiceLines([{ itemId: '99', qty: 1, unitPrice: 1 }], new Map())
    ).toThrow(
      'One of the items is no longer in QuickBooks. Reopen the drawer and pick again.'
    );
  });
});
