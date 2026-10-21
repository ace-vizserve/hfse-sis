import { describe, expect, it } from 'vitest';

import { sameItemsFrom, type SameItemsRow } from '@/lib/billing/same-items';

const line = (o: Partial<NonNullable<SameItemsRow['lines']>[number]>) => ({
  itemId: '7',
  itemName: 'Application Fee',
  accountId: '40',
  description: 'Application Fee for Primary (Non-Refundable)',
  qty: 1,
  amount: 200,
  ...o,
});
const row = (o: Partial<SameItemsRow>): SameItemsRow => ({
  doc_number: 'HFSE069006',
  txn_date: '2026-10-21',
  state: 'open',
  stage_keys: ['registration'],
  lines: [line({})],
  ...o,
});

describe('sameItemsFrom', () => {
  it('copies the newest invoice tied to the stage', () => {
    expect(
      sameItemsFrom(
        [
          row({ doc_number: 'HFSE060001', txn_date: '2026-08-01' }),
          row({
            lines: [line({ qty: 2, amount: 300, description: null })],
          }),
        ],
        'registration'
      )
    ).toEqual({
      from: 'HFSE069006',
      lines: [{ itemId: '7', description: '', qty: 2, unitPrice: 150 }],
      skipped: false,
    });
  });
  it('leaves out discounts and lines with no product, and says so', () => {
    const got = sameItemsFrom(
      [
        row({
          lines: [
            line({}),
            line({ itemId: '9', amount: -50, description: 'Sibling discount' }),
            line({ itemId: null, amount: 10 }),
          ],
        }),
      ],
      'registration'
    );
    expect(got?.lines).toHaveLength(1);
    expect(got?.lines[0].itemId).toBe('7');
    expect(got?.skipped).toBe(true);
  });
  it('skips voided, other stages and lines with no product', () => {
    expect(
      sameItemsFrom(
        [
          row({ state: 'voided', txn_date: '2026-10-30' }),
          row({ stage_keys: ['fees'], txn_date: '2026-10-29' }),
          row({ txn_date: '2026-10-28', lines: [line({ itemId: null })] }),
          row({ doc_number: 'HFSE060001', txn_date: '2026-08-01' }),
        ],
        'registration'
      )?.from
    ).toBe('HFSE060001');
  });
  it('a missing qty counts as 1', () =>
    expect(
      sameItemsFrom([row({ lines: [line({ qty: null })] })], 'registration')
        ?.lines[0]
    ).toMatchObject({ qty: 1, unitPrice: 200 }));
  it('none → null', () => {
    expect(sameItemsFrom([], 'fees')).toBeNull();
    expect(sameItemsFrom([row({})], 'fees')).toBeNull();
  });
});
