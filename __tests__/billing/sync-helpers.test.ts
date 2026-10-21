import { describe, expect, it } from 'vitest';

import { missingIds, rowsOfCustomer } from '@/lib/billing/sync-helpers';

describe('rowsOfCustomer', () => {
  const rows = [
    { id: 1, qbo_customer_id: 'c1' },
    { id: 2, qbo_customer_id: 'c2' },
    { id: 3, qbo_customer_id: null },
  ];
  it('keeps the linked customer and rows not re-read yet', () => {
    expect(rowsOfCustomer(rows, 'c1').map((r) => r.id)).toEqual([1, 3]);
  });
  it('drops another customer’s rows after a relink', () => {
    expect(rowsOfCustomer(rows, 'c2').map((r) => r.id)).toEqual([2, 3]);
  });
});

describe('missingIds', () => {
  it('lists stored ids QuickBooks no longer returned', () => {
    expect(missingIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('empty when all came back', () => {
    expect(missingIds(['a'], ['a', 'z'])).toEqual([]);
    expect(missingIds([], ['a'])).toEqual([]);
  });
});
