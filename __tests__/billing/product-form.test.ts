import { describe, expect, it } from 'vitest';

import {
  changedProductFields,
  parsePrice,
  productBody,
  ProductFormBody,
  toProductForm,
  type ProductForm,
} from '@/lib/billing/product-form';

const form: ProductForm = {
  name: 'Tuition Fees',
  sku: 'TF-1',
  categoryId: '',
  description: 'Term fees',
  price: '920',
  incomeAccountId: '84',
  taxable: false,
};

describe('product form', () => {
  it('reads a QuickBooks item; 0 price shows as none, as QuickBooks lists it', () => {
    expect(
      toProductForm({
        Id: '5',
        SyncToken: '2',
        Name: 'Hours',
        UnitPrice: 0,
        IncomeAccountRef: { value: '9' },
        SubItem: true,
        ParentRef: { value: '30' },
        Taxable: true,
      })
    ).toEqual({
      name: 'Hours',
      sku: '',
      categoryId: '30',
      description: '',
      price: '',
      incomeAccountId: '9',
      taxable: true,
    });
  });

  it('parses prices', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('1,500.50')).toBe(1500.5);
    expect(parsePrice('-1')).toBe('invalid');
    expect(parsePrice('abc')).toBe('invalid');
  });

  it('names the changed fields as QuickBooks does', () => {
    expect(changedProductFields(form, { ...form })).toEqual([]);
    expect(changedProductFields(form, { ...form, price: '920.00' })).toEqual(
      []
    );
    expect(
      changedProductFields(form, { ...form, price: '930', taxable: true })
    ).toEqual(['Sales price/rate', 'Taxable']);
  });

  it('builds a Service create body and a sparse update body', () => {
    expect(productBody(form)).toMatchObject({
      Name: 'Tuition Fees',
      Type: 'Service',
      UnitPrice: 920,
      IncomeAccountRef: { value: '84' },
      SubItem: false,
    });
    const upd = productBody(
      { ...form, price: '', categoryId: '30' },
      { Id: '5', SyncToken: '3' }
    );
    expect(upd).toMatchObject({
      Id: '5',
      SyncToken: '3',
      sparse: true,
      UnitPrice: 0,
      SubItem: true,
      ParentRef: { value: '30' },
    });
    expect(upd).not.toHaveProperty('Type');
  });

  it('validates the request body', () => {
    const ok = ProductFormBody.safeParse({
      ...form,
      requestId: '7b0c3c1e-2f7c-4a3e-9d8b-0c1f2e3d4a5b',
    });
    expect(ok.success).toBe(true);
    const bad = ProductFormBody.safeParse({
      ...form,
      incomeAccountId: '',
      requestId: '7b0c3c1e-2f7c-4a3e-9d8b-0c1f2e3d4a5b',
    });
    expect(bad.success).toBe(false);
  });
});
