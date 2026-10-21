import { beforeEach, describe, expect, it, vi } from 'vitest';

// Edit invoice, server side: QuickBooks first, then the stored copy (its tie
// kept — no explicit tie is passed) and the tied stage worked out again.

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let liveInvoice: Record<string, unknown>;
let updateError: unknown = null;

vi.mock('@/lib/qbo/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/qbo/client')>(
      '@/lib/qbo/client'
    );
  return {
    ...actual,
    connectedRealmId: vi.fn(async () => 'realm-1'),
    qboQuery: vi.fn(async () => [
      { Id: '9', Name: 'AY2026 Fees', SalesTaxCodeRef: { value: 'TX' } },
      { Id: '12', Name: 'Fee Protection Scheme' },
    ]),
    qboRequest: vi.fn(
      async (_s: unknown, method: string, path: string, body?: unknown) => {
        calls.push({ method, path, body });
        if (method === 'GET') return { Invoice: liveInvoice };
        if (updateError) throw updateError;
        return {
          Invoice: {
            ...liveInvoice,
            SyncToken: '4',
            TotalAmt: 350,
            Balance: 350,
          },
        };
      }
    ),
  };
});
const upsert = vi.fn(async (_s: unknown, _a: Record<string, unknown>) => ({
  before: { ayCode: 'AY2026' },
  after: { ayCode: 'AY2026' },
}));
vi.mock('@/lib/billing/store.server', () => ({
  upsertInvoice: (s: unknown, a: Record<string, unknown>) => upsert(s, a),
}));
const tiles = vi.fn(async (..._a: unknown[]) => ({ errors: [] as string[] }));
vi.mock('@/lib/billing/tiles.server', () => ({
  syncTilesForStudent: (...a: unknown[]) => tiles(...a),
}));
vi.mock('@/lib/billing/maps.server', () => ({
  loadBillingMaps: vi.fn(async () => ({ typed: new Map() })),
}));
const logged = vi.fn(async (_a: Record<string, unknown>) => {});
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (a: Record<string, unknown>) => logged(a),
}));

import { updateInvoiceForStudent } from '@/lib/billing/invoice-update.server';
import { STALE_EDIT } from '@/lib/billing/invoice-update-body';
import { QboError } from '@/lib/qbo/client';

function fakeService(row: Record<string, unknown> | null) {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => q } as never;
}

const row = {
  qbo_invoice_id: '423',
  student_number: 'H260162',
  qbo_customer_id: 'C1',
};
const input = {
  lines: [
    { lineId: '1', itemId: '9', qty: 1, unitPrice: 300 },
    { itemId: '12', qty: 1, unitPrice: 50 },
  ],
  txnDate: '2026-10-20',
  dueDate: null,
  syncToken: '3',
  requestId: '6f1c1a52-6a43-4b8e-9d55-0a4a3f0f2b11',
};
const actor = { id: 'u1', email: 'admin@local.test', role: 'superadmin' };
const run = (r: Record<string, unknown> | null = row, i = input) =>
  updateInvoiceForStudent(fakeService(r), {
    studentNumber: 'H260162',
    qboInvoiceId: '423',
    actor,
    input: i,
  });

beforeEach(() => {
  calls.length = 0;
  updateError = null;
  upsert.mockClear();
  tiles.mockClear();
  logged.mockClear();
  liveInvoice = {
    Id: '423',
    SyncToken: '3',
    DocNumber: 'HFSE069012',
    TotalAmt: 300,
    Balance: 300,
    CustomerRef: { value: 'C1' },
    Line: [
      {
        Id: '1',
        DetailType: 'SalesItemLineDetail',
        Amount: 300,
        SalesItemLineDetail: {
          ItemRef: { value: '9' },
          TaxCodeRef: { value: 'SR' },
        },
      },
      { DetailType: 'SubTotalLineDetail', Amount: 300 },
    ],
  };
});

describe('updateInvoiceForStudent', () => {
  it('sends a sparse update with every line, keeps the tie and resyncs the stage', async () => {
    const r = await run();
    expect(r).toEqual({
      ok: true,
      docNumber: 'HFSE069012',
      total: 350,
      warnings: [],
    });
    const post = calls.find((c) => c.method === 'POST')!;
    const body = post.body as Record<string, unknown>;
    expect(body).toMatchObject({ Id: '423', SyncToken: '3', sparse: true });
    expect(body.Line).toHaveLength(2);
    // Stored without an explicit tie, so the one it has is kept.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).not.toHaveProperty('tie');
    expect(tiles).toHaveBeenCalledWith(
      expect.anything(),
      'H260162',
      ['AY2026'],
      { realmId: 'realm-1' }
    );
    expect(logged.mock.calls[0][0]).toMatchObject({
      action: 'qbo.invoice.update',
      entityId: '423',
      context: { studentNumber: 'H260162', total: 350 },
    });
  });

  it('refuses another student’s invoice before QuickBooks', async () => {
    const r = await run({ ...row, student_number: 'H999999' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a stale edit without writing', async () => {
    liveInvoice.SyncToken = '5';
    const r = await run();
    expect(r).toMatchObject({ ok: false, error: STALE_EDIT });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('translates a total below what is paid', async () => {
    liveInvoice.Balance = 100;
    updateError = new QboError(
      400,
      '6000',
      'Transaction amount must be greater than the payments applied'
    );
    const r = await run();
    expect(r).toMatchObject({
      ok: false,
      error: 'The new total can’t be less than the S$200.00 already paid.',
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps the request id when QuickBooks gave no answer', async () => {
    updateError = new QboError(503, null, 'Service unavailable');
    const r = await run();
    expect(r).toMatchObject({ ok: false, keepRequestId: true });
  });

  it('once QuickBooks accepted, a stage problem is a note, never a failure', async () => {
    tiles.mockResolvedValueOnce({ errors: ['boom'] });
    const r = await run();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toHaveLength(1);
  });
});
