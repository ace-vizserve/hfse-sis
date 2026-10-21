import { describe, expect, it, vi } from 'vitest';

// sweepOverdueStages picks its targets on the `now` it is given and hands the
// same Singapore day to syncTilesForStudent, so the pass is one consistent day.

const syncCalls: Array<{ studentNumber: string; opts: unknown }> = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/qbo/client', () => ({
  connectedRealmId: vi.fn(async () => 'realm-1'),
}));
vi.mock('@/lib/supabase/paginate', () => ({
  fetchAllPages: vi.fn(async () => [
    {
      id: 'i1',
      student_number: 'S1',
      ay_code: 'AY2027',
      stage_keys: ['fees'],
      state: 'open',
      due_date: '2099-01-01',
    },
  ]),
}));
vi.mock('@/lib/billing/tiles.server', () => ({
  syncTilesForStudent: vi.fn(
    async (
      _s: unknown,
      studentNumber: string,
      _ay: string[],
      opts: unknown
    ) => {
      syncCalls.push({ studentNumber, opts });
      return { changed: 1, errors: [] };
    }
  ),
}));

import { sweepOverdueStages } from '@/lib/billing/overdue.server';

/** A Supabase stand-in for the two stage lookups. */
function fakeService() {
  const tables: Record<string, unknown[]> = {
    ay2027_enrolment_applications: [
      { enroleeNumber: 'E1', studentNumber: 'S1' },
    ],
    ay2027_enrolment_status: [
      { enroleeNumber: 'E1', registrationStatus: null, feeStatus: 'Unpaid' },
    ],
  };
  return {
    from(table: string) {
      const q = {
        select: () => q,
        in: async () => ({ data: tables[table] ?? [], error: null }),
      };
      return q;
    },
  } as never;
}

describe('sweepOverdueStages', () => {
  it('passes its own day to syncTilesForStudent', async () => {
    // 2099-01-02 09:00 in Singapore.
    const r = await sweepOverdueStages(
      fakeService(),
      new Date('2099-01-02T01:00:00Z')
    );
    expect(r).toEqual({ students: 1, changed: 1, errors: [] });
    expect(syncCalls).toEqual([
      {
        studentNumber: 'S1',
        opts: { realmId: 'realm-1', today: '2099-01-02' },
      },
    ]);
  });
});
