import { describe, expect, it } from 'vitest';

import {
  missingIds,
  rowsOfCustomer,
  voidedMatch,
} from '@/lib/billing/sync-helpers';

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

describe('voidedMatch', () => {
  it('returns the voided invoice with the stage’s number', () => {
    const rows = [{ doc_number: ' 1040 ', state: 'voided' as const }];
    expect(voidedMatch(rows, '1040')).toBe(rows[0]);
  });
  it('leaves a live invoice that is simply not on this tile', () => {
    expect(
      voidedMatch([{ doc_number: '1040', state: 'open' as const }], '1040')
    ).toBeUndefined();
    expect(
      voidedMatch([{ doc_number: '1040', state: 'paid' as const }], '1040')
    ).toBeUndefined();
  });
  it('leaves it when a live copy of the number exists beside a voided one', () => {
    expect(
      voidedMatch(
        [
          { doc_number: '1040', state: 'voided' as const },
          { doc_number: '1040', state: 'open' as const },
        ],
        '1040'
      )
    ).toBeUndefined();
  });
  it('leaves a typed number no stored invoice has', () => {
    expect(
      voidedMatch([{ doc_number: '1', state: 'voided' as const }], '2')
    ).toBeUndefined();
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
