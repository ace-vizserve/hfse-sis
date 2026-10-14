import { describe, expect, it } from 'vitest';

import { changedIdsFromCdc } from '@/lib/qbo/cdc';

describe('changedIdsFromCdc', () => {
  it('collects invoice and payment ids, deleted ones included', () => {
    expect(
      changedIdsFromCdc({
        CDCResponse: [
          {
            QueryResponse: [
              { Invoice: [{ Id: '130' }, { Id: '131', status: 'Deleted' }] },
              { Payment: [{ Id: '201' }] },
            ],
          },
        ],
      })
    ).toEqual({ invoiceIds: ['130', '131'], paymentIds: ['201'] });
  });

  it('handles an empty response', () => {
    expect(changedIdsFromCdc({})).toEqual({ invoiceIds: [], paymentIds: [] });
  });
});
