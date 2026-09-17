/**
 * What the admissions writers put in their audit rows.
 *
 * Each case pins a gap found in the 2026-09-17 audit-log sweep:
 *  - rows about one student named only an enrolee number, which resets every
 *    year (Hard Rule #4);
 *  - re-pointing a level alias was logged as a CREATE with the old level as a
 *    bare uuid;
 *  - opening an already-open year while closing another wrote a
 *    before:true/after:true row for a change that never happened;
 *  - a discount code edit that did not rename it carried no name at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applicantAuditIdentity } from '@/lib/admissions/audit-identity';

type LoggedCall = {
  action: string;
  entityId: string | null;
  context: Record<string, unknown>;
};
const logAction = vi.fn((_call: LoggedCall) => Promise.resolve());

vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: LoggedCall) => logAction(call),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-1', email: 'coord@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-1', email: 'admin@hfse.test' },
      role: 'school_admin',
    })
  ),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateAllOperationalDrills: vi.fn(),
  invalidateDrillTags: vi.fn(),
}));
vi.mock('@/lib/academic-year', () => ({
  getCurrentAcademicYear: vi.fn(() => Promise.resolve({ ay_code: 'AY2026' })),
}));

// ── A chainable Supabase stand-in keyed by table ────────────────────────────
type Handler = {
  select?: (cols: string, filters: Record<string, unknown>) => unknown;
  update?: () => { error: null };
  upsert?: () => { error: null };
};
let tables: Record<string, Handler> = {};

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  let cols = '';
  let mode: 'select' | 'update' | 'upsert' = 'select';
  const q = {
    select(c: string) {
      cols = c;
      return q;
    },
    update() {
      mode = 'update';
      return q;
    },
    upsert() {
      return Promise.resolve(tables[table]?.upsert?.() ?? { error: null });
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return q;
    },
    maybeSingle() {
      return Promise.resolve({
        data: tables[table]?.select?.(cols, filters) ?? null,
        error: null,
      });
    },
    then(resolve: (v: unknown) => unknown) {
      if (mode === 'update') return resolve({ error: null });
      return resolve({
        data: tables[table]?.select?.(cols, filters) ?? null,
        error: null,
      });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: (t: string) => chain(t) }),
}));

beforeEach(() => {
  logAction.mockClear();
  tables = {};
});

describe('applicantAuditIdentity', () => {
  it('names the student from the name parts and keeps the student number', () => {
    expect(
      applicantAuditIdentity('E260001', {
        studentNumber: ' S2026001 ',
        firstName: 'Ana',
        middleName: 'Reyes',
        lastName: 'DELA CRUZ',
        enroleeFullName: 'stale name',
      })
    ).toEqual({
      enroleeNumber: 'E260001',
      studentNumber: 'S2026001',
      studentName: 'DELA CRUZ, Ana Reyes',
    });
  });

  it('falls back to the stored full name, and to null when nothing is known', () => {
    expect(
      applicantAuditIdentity('E260002', { enroleeFullName: 'Cruz, Ana' })
    ).toEqual({
      enroleeNumber: 'E260002',
      studentNumber: null,
      studentName: 'Cruz, Ana',
    });
    expect(applicantAuditIdentity('E260003', null)).toEqual({
      enroleeNumber: 'E260003',
      studentNumber: null,
      studentName: null,
    });
  });
});

describe('POST /api/sis/level-aliases', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const levels: Record<string, { id: string; code: string; label: string }> = {
    [P1]: { id: P1, code: 'P1', label: 'Primary 1' },
    [P2]: { id: P2, code: 'P2', label: 'Primary 2' },
  };

  async function post(priorLevelId: string | null) {
    tables = {
      levels: { select: (_c, f) => levels[f.id as string] ?? null },
      level_aliases: {
        select: () => (priorLevelId ? { level_id: priorLevelId } : null),
      },
    };
    const { POST } = await import('@/app/api/sis/level-aliases/route');
    return POST(
      new Request('http://x/api/sis/level-aliases', {
        method: 'POST',
        body: JSON.stringify({ fromLabel: 'Primary Two', toLevelId: P2 }),
      })
    );
  }

  it('logs a first mapping as create, naming the level by code and label', async () => {
    await post(null);
    expect(logAction).toHaveBeenCalledTimes(1);
    const call = logAction.mock.calls[0][0];
    expect(call.action).toBe('level.alias.create');
    expect(call.context).toEqual({
      raw_label: 'Primary Two',
      mapped_to_code: 'P2',
      mapped_to_label: 'Primary 2',
    });
  });

  it('logs a re-point as remap, naming the old level too', async () => {
    await post(P1);
    const call = logAction.mock.calls[0][0];
    expect(call.action).toBe('level.alias.remap');
    expect(call.context).toMatchObject({
      raw_label: 'Primary Two',
      mapped_to_code: 'P2',
      mapped_to_label: 'Primary 2',
      remapped_from_level_id: P1,
      remapped_from_code: 'P1',
      remapped_from_label: 'Primary 1',
    });
  });

  it('writes nothing when the mapping is unchanged', async () => {
    await post(P2);
    expect(logAction).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/sis/ay-setup/accepting-applications', () => {
  async function patch(
    rows: Array<{
      ay_code: string;
      is_current: boolean;
      accepting_applications: boolean;
    }>,
    ayCode: string
  ) {
    tables = {
      academic_years: {
        select: () => rows.map((r) => ({ id: `id-${r.ay_code}`, ...r })),
      },
    };
    const { PATCH } =
      await import('@/app/api/sis/ay-setup/accepting-applications/route');
    return PATCH(
      new Request('http://x', {
        method: 'PATCH',
        body: JSON.stringify({ ay_code: ayCode, accepting: true }),
      })
    );
  }

  it('does not log a no-op row for a year that was already open', async () => {
    await patch(
      [
        { ay_code: 'AY2026', is_current: true, accepting_applications: true },
        { ay_code: 'AY2027', is_current: false, accepting_applications: true },
        { ay_code: 'AY2028', is_current: false, accepting_applications: true },
      ],
      'AY2027'
    );
    expect(logAction).toHaveBeenCalledTimes(1);
    const call = logAction.mock.calls[0][0];
    expect(call.context).toEqual({
      ay_code: 'AY2028',
      before: true,
      after: false,
      auto_closed_by: 'AY2027',
    });
  });

  it('records the years it closed as a flat list of codes', async () => {
    await patch(
      [
        { ay_code: 'AY2026', is_current: true, accepting_applications: true },
        { ay_code: 'AY2027', is_current: false, accepting_applications: false },
        { ay_code: 'AY2028', is_current: false, accepting_applications: true },
      ],
      'AY2027'
    );
    expect(logAction).toHaveBeenCalledTimes(2);
    expect(logAction.mock.calls[1][0].context).toEqual({
      ay_code: 'AY2027',
      before: false,
      after: true,
      auto_closed_previous: ['AY2028'],
    });
  });
});

describe('PATCH /api/sis/discount-codes/[id]', () => {
  it('names the code even when only its dates changed', async () => {
    tables = {
      ay2026_discount_codes: {
        select: () => ({
          discountCode: 'SIBLING10',
          enroleeType: 'New',
          startDate: '2026-01-01',
          endDate: '2026-06-30',
        }),
      },
    };
    const { PATCH } = await import('@/app/api/sis/discount-codes/[id]/route');
    await PATCH(
      new Request('http://x/api/sis/discount-codes/7?ay=AY2026', {
        method: 'PATCH',
        body: JSON.stringify({ endDate: '2026-07-31' }),
      }),
      { params: Promise.resolve({ id: '7' }) }
    );
    expect(logAction).toHaveBeenCalledTimes(1);
    const call = logAction.mock.calls[0][0];
    expect(call.action).toBe('sis.discount_code.update');
    expect(call.context).toEqual({
      ay_code: 'AY2026',
      discount_code: 'SIBLING10',
      previous_discount_code: null,
      enrolee_type: 'New',
      end_date: '2026-07-31',
      changes: [{ field: 'endDate', from: '2026-06-30', to: '2026-07-31' }],
    });
  });
});
