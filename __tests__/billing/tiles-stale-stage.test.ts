import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StageSnapshot } from '@/lib/qbo/stage-state';

// syncTilesForStudent after a relink: the stage of the old student has no
// tied invoice any more, but still shows the moved invoice's number.

const snapshots: Record<string, StageSnapshot> = {};
const writes: Array<{ stage: string; patch: unknown }> = [];

vi.mock('@/lib/qbo/client', () => ({
  connectedRealmId: vi.fn(async () => 'realm-1'),
}));
vi.mock('@/lib/qbo/stage-write', () => ({
  QBO_SYNC_LABEL: 'QuickBooks sync',
  QBO_SYSTEM_ACTOR: { id: null, email: 'system', role: null },
  readStageSnapshot: vi.fn(
    async (_s: unknown, _ay: string, _en: string, stage: string) =>
      snapshots[stage] ?? null
  ),
  writeStageFromQbo: vi.fn(
    async (_s: unknown, args: { stage: string; patch: unknown }) => {
      writes.push({ stage: args.stage, patch: args.patch });
      return { ok: true, changed: 1 };
    }
  ),
}));

import { syncTilesForStudent } from '@/lib/billing/tiles.server';

type Row = Record<string, unknown>;

/** A Supabase stand-in: each table's rows, filtered by .eq(). */
function fakeService(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const result = () => ({
        data: (tables[table] ?? []).filter((r) =>
          filters.every(([k, v]) => r[k] === v)
        ),
        error: null,
      });
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const r = result();
          return { data: r.data[0] ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      };
      return q;
    },
  } as never;
}

const invoice = (doc: string, more: Row = {}): Row => ({
  doc_number: doc,
  txn_date: '2026-09-01',
  due_date: null,
  state: 'open',
  payment_date: null,
  total: 100,
  balance: 100,
  ay_code: 'AY2027',
  stage_keys: ['fees'],
  realm_id: 'realm-1',
  ...more,
});

beforeEach(() => {
  for (const k of Object.keys(snapshots)) delete snapshots[k];
  writes.length = 0;
});

const base = {
  qbo_customers: [
    { student_number: 'S1', realm_id: 'realm-1', qbo_customer_id: 'C2' },
  ],
  ay2027_enrolment_applications: [{ studentNumber: 'S1', enroleeNumber: 'E1' }],
};

describe('syncTilesForStudent — stale stage after a relink', () => {
  it('clears a stage whose invoice now belongs to the old customer', async () => {
    snapshots.fees = {
      status: 'Unpaid',
      invoice: 'HFSE100',
      paymentDate: null,
      startDate: null,
    };
    const service = fakeService({
      ...base,
      // Still S1's row, but of the old customer C1: not counted.
      qbo_invoices: [
        invoice('HFSE100', { student_number: 'S1', qbo_customer_id: 'C1' }),
      ],
    });
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
    });
    expect(writes).toEqual([
      { stage: 'fees', patch: { status: null, invoice: null } },
    ]);
  });

  it('clears a stage whose invoice moved to another student', async () => {
    snapshots.fees = {
      status: 'Unpaid',
      invoice: 'HFSE100',
      paymentDate: null,
      startDate: null,
    };
    const service = fakeService({
      ...base,
      qbo_invoices: [
        invoice('HFSE100', { student_number: 'S2', qbo_customer_id: 'C1' }),
      ],
    });
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
    });
    expect(writes).toHaveLength(1);
  });

  it('leaves Cancelled, and a number that matches no stored invoice', async () => {
    snapshots.fees = {
      status: 'Cancelled',
      invoice: 'HFSE100',
      paymentDate: null,
      startDate: null,
    };
    snapshots.registration = {
      status: 'Paid',
      invoice: 'R-0042',
      paymentDate: '2026-01-05',
      startDate: null,
    };
    const service = fakeService({
      ...base,
      qbo_invoices: [
        invoice('HFSE100', { student_number: 'S2', qbo_customer_id: 'C1' }),
      ],
    });
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
    });
    expect(writes).toEqual([]);
  });

  it('judges Overdue on the day it is given, not the real clock', async () => {
    snapshots.fees = {
      status: 'Unpaid',
      invoice: 'HFSE100',
      paymentDate: null,
      startDate: null,
    };
    const service = fakeService({
      ...base,
      qbo_invoices: [
        invoice('HFSE100', {
          student_number: 'S1',
          qbo_customer_id: 'C2',
          due_date: '2099-01-01',
        }),
      ],
    });
    // Due in 2099: not overdue by the real clock…
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
    });
    expect(writes).toEqual([]);
    // …but overdue on the day after it.
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
      today: '2099-01-02',
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      stage: 'fees',
      patch: { status: 'Overdue' },
    });
  });

  it('a stage with its tied invoice still follows it', async () => {
    snapshots.fees = {
      status: 'Unpaid',
      invoice: 'HFSE100',
      paymentDate: null,
      startDate: null,
    };
    const service = fakeService({
      ...base,
      qbo_invoices: [
        invoice('HFSE100', { student_number: 'S1', qbo_customer_id: 'C2' }),
      ],
    });
    await syncTilesForStudent(service, 'S1', ['AY2027'], {
      realmId: 'realm-1',
    });
    expect(writes).toEqual([]);
  });
});
