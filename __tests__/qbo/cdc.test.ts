import { describe, expect, it } from 'vitest';

import { changedIdsFromCdc, notYetRefreshed } from '@/lib/qbo/cdc';

describe('changedIdsFromCdc', () => {
  it('collects invoice and payment ids and their customers, deleted ones included', () => {
    expect(
      changedIdsFromCdc({
        CDCResponse: [
          {
            QueryResponse: [
              {
                Invoice: [
                  { Id: '130', CustomerRef: { value: '58' } },
                  { Id: '131', status: 'Deleted' },
                ],
              },
              { Payment: [{ Id: '201', CustomerRef: { value: '59' } }] },
            ],
          },
        ],
      })
    ).toEqual({
      invoiceIds: ['130', '131'],
      paymentIds: ['201'],
      invoiceCustomers: new Map([['130', '58']]),
      paymentCustomers: new Map([['201', '59']]),
    });
  });

  it('handles an empty response', () => {
    expect(changedIdsFromCdc({})).toEqual({
      invoiceIds: [],
      paymentIds: [],
      invoiceCustomers: new Map(),
      paymentCustomers: new Map(),
    });
  });
});

describe('notYetRefreshed', () => {
  it('skips invoices a payment already refreshed in this run', () => {
    expect(notYetRefreshed(['1', '2', '3'], new Set(['2']))).toEqual([
      '1',
      '3',
    ]);
  });
});
