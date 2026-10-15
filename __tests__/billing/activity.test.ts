import { describe, expect, it } from 'vitest';

import { buildInvoiceActivity } from '@/lib/billing/activity';

const base = {
  createdAt: '2026-09-01T09:00:00+08:00',
  createdBy: 'Admissions staff',
  sends: [],
  qbDelivery: null,
  payments: [],
  state: 'open' as const,
  balance: 1340,
  voidedAt: null,
};

describe('buildInvoiceActivity', () => {
  it('opened, viewed greyed, still due', () => {
    const a = buildInvoiceActivity(base);
    expect(a.map((e) => [e.label, e.tone])).toEqual([
      ['Opened', 'done'],
      ['Viewed', 'off'],
      ['Paid', 'off'],
    ]);
    expect(a[1].detail).toBe('Shown in QuickBooks only');
    expect(a[2].detail).toBe('S$1,340.00 still due');
  });
  it('SIS sends listed; QuickBooks delivery used when the SIS has none', () => {
    const fromSis = buildInvoiceActivity({
      ...base,
      sends: [
        {
          at: '2026-09-01T09:14:02+08:00',
          to: 'a@example.test',
          by: 'luz@hfse.edu.sg',
        },
      ],
      qbDelivery: { at: '2026-09-01T09:14:05+08:00', to: 'a@example.test' },
    });
    expect(fromSis.filter((e) => e.label === 'Sent')).toHaveLength(1);
    expect(fromSis.find((e) => e.label === 'Sent')?.detail).toBe(
      'a@example.test · by luz@hfse.edu.sg'
    );
    const fromQb = buildInvoiceActivity({
      ...base,
      qbDelivery: { at: '2026-09-01T09:14:05+08:00', to: 'b@example.test' },
    });
    expect(fromQb.find((e) => e.label === 'Sent')?.detail).toBe(
      'b@example.test'
    );
  });
  it('part payments then paid', () => {
    const a = buildInvoiceActivity({
      ...base,
      state: 'paid',
      balance: 0,
      payments: [
        {
          id: 'p2',
          txnDate: '2026-10-01',
          account: 'PayNow',
          reference: null,
          amount: 125,
        },
        {
          id: 'p1',
          txnDate: '2026-09-20',
          account: 'UOB',
          reference: '88312',
          amount: 1215,
        },
      ],
    });
    const labels = a.map((e) => e.label);
    expect(labels).toEqual(['Opened', 'Viewed', 'Partly paid', 'Paid']);
    expect(a[2].detail).toBe('UOB · S$1,215.00 · ref 88312');
    expect(a[3]).toMatchObject({
      tone: 'paid',
      when: '2026-10-01',
      paymentId: 'p2',
    });
  });
  it('voided ends the list', () => {
    const a = buildInvoiceActivity({
      ...base,
      state: 'voided',
      balance: 0,
      voidedAt: '2026-09-03T10:00:00+08:00',
    });
    expect(a.at(-1)).toMatchObject({ label: 'Voided', tone: 'void' });
    expect(a.some((e) => e.label === 'Paid')).toBe(false);
  });
});
