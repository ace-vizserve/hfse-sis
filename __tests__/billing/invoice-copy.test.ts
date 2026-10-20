import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearInvoiceCopy,
  readInvoiceCopy,
  stashInvoiceCopy,
} from '@/lib/billing/invoice-copy';

describe('invoice copy', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('carries both memos through the stash', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      setItem: (k: string, v: string) => void store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    });
    stashInvoiceCopy('H1', {
      from: '1001',
      memo: 'Thank you',
      statementMemo: 'Paid by company',
      lines: [{ itemId: '1', description: '', qty: 1, unitPrice: 5 }],
    });
    const c = readInvoiceCopy('H1');
    expect(c?.memo).toBe('Thank you');
    expect(c?.statementMemo).toBe('Paid by company');
    clearInvoiceCopy('H1');
    expect(readInvoiceCopy('H1')).toBeNull();
  });
});
