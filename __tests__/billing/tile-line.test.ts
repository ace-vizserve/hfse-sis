import { describe, expect, it } from 'vitest';

import { tileInvoiceState } from '@/lib/billing/tile-line';

describe('tileInvoiceState', () => {
  it('paid only when every live invoice is paid', () => {
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'voided' }])).toBe(
      'paid'
    );
    expect(tileInvoiceState([{ state: 'paid' }, { state: 'open' }])).toBe(
      'open'
    );
    expect(tileInvoiceState([{ state: 'voided' }])).toBeNull();
    expect(tileInvoiceState([])).toBeNull();
  });
});
