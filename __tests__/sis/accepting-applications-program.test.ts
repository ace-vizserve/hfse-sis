/**
 * The `program` branch of PATCH /api/sis/ay-setup/accepting-applications
 * (migration 176). VizSchool's switch is a plain single-row flip: it writes
 * only `vizschool_accepting_applications`, never closes another year, logs its
 * own action, and busts the portal's year picker. Omitting `program` keeps the
 * HFSE behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type LoggedCall = {
  action: string;
  entityId: string | null;
  context: Record<string, unknown>;
};
const logAction = vi.fn((_call: LoggedCall) => Promise.resolve());
const revalidateTag = vi.fn();

vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: LoggedCall) => logAction(call),
}));
vi.mock('next/cache', () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-1', email: 'admin@hfse.test' },
      role: 'school_admin',
    })
  ),
}));

type Row = {
  id: string;
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
  vizschool_accepting_applications: boolean;
};
let rows: Row[] = [];
const updates: Array<{ values: Record<string, unknown>; ay_code: unknown }> =
  [];

function chain() {
  const filters: Record<string, unknown> = {};
  let pending: Record<string, unknown> | null = null;
  const matching = () =>
    rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) => (r as Record<string, unknown>)[k] === v
      )
    );
  const q = {
    select() {
      return q;
    },
    update(values: Record<string, unknown>) {
      pending = values;
      return q;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return q;
    },
    maybeSingle() {
      return Promise.resolve({ data: matching()[0] ?? null, error: null });
    },
    then(resolve: (v: unknown) => unknown) {
      if (pending) {
        updates.push({ values: pending, ay_code: filters.ay_code });
        return resolve({ error: null });
      }
      return resolve({ data: matching(), error: null });
    },
  };
  return q;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => chain() }),
}));

const row = (
  ay_code: string,
  is_current: boolean,
  accepting_applications: boolean,
  vizschool_accepting_applications: boolean
): Row => ({
  id: `id-${ay_code}`,
  ay_code,
  is_current,
  accepting_applications,
  vizschool_accepting_applications,
});

async function patch(body: Record<string, unknown>): Promise<Response> {
  const { PATCH } =
    await import('@/app/api/sis/ay-setup/accepting-applications/route');
  const res = await PATCH(
    new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) })
  );
  if (!res) throw new Error('route returned no response');
  return res;
}

beforeEach(() => {
  logAction.mockClear();
  revalidateTag.mockClear();
  updates.length = 0;
  rows = [
    row('AY2026', true, true, true),
    row('AY2027', false, true, false),
    row('AY2028', false, false, false),
  ];
});

describe('program: vizschool', () => {
  it('opens only the VizSchool switch and closes no other year', async () => {
    const res = await patch({
      ay_code: 'AY2028',
      accepting: true,
      program: 'vizschool',
    });
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      { values: { vizschool_accepting_applications: true }, ay_code: 'AY2028' },
    ]);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'ay.vizschool_applications.toggle',
      entityId: 'id-AY2028',
      context: { ay_code: 'AY2028', before: false, after: true },
    });
    expect(revalidateTag).toHaveBeenCalledWith('sis:AY2028', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('parent-academic-years', 'max');
  });

  it('closes it', async () => {
    await patch({ ay_code: 'AY2026', accepting: false, program: 'vizschool' });
    expect(updates).toEqual([
      {
        values: { vizschool_accepting_applications: false },
        ay_code: 'AY2026',
      },
    ]);
    expect(logAction.mock.calls[0][0].context).toEqual({
      ay_code: 'AY2026',
      before: true,
      after: false,
    });
  });

  it('writes and logs nothing when the switch is already where it was asked to be', async () => {
    const res = await patch({
      ay_code: 'AY2026',
      accepting: true,
      program: 'vizschool',
    });
    expect(await res.json()).toMatchObject({ ok: true, unchanged: true });
    expect(updates).toEqual([]);
    expect(logAction).not.toHaveBeenCalled();
  });

  it('404s an unknown year', async () => {
    const res = await patch({
      ay_code: 'AY2031',
      accepting: true,
      program: 'vizschool',
    });
    expect(res.status).toBe(404);
  });

  it('refuses an unknown program', async () => {
    const res = await patch({
      ay_code: 'AY2028',
      accepting: true,
      program: 'cambridge',
    });
    expect(res.status).toBe(400);
  });
});

describe('program omitted (HFSE)', () => {
  it('keeps the early-bird single-select and its own action', async () => {
    await patch({ ay_code: 'AY2028', accepting: true });
    // AY2027 (the other open upcoming year) is closed, then AY2028 opened.
    expect(updates).toEqual([
      { values: { accepting_applications: false }, ay_code: 'AY2027' },
      { values: { accepting_applications: true }, ay_code: 'AY2028' },
    ]);
    expect(logAction.mock.calls.map((c) => c[0].action)).toEqual([
      'ay.accepting_applications.toggle',
      'ay.accepting_applications.toggle',
    ]);
    expect(revalidateTag).toHaveBeenCalledWith('parent-academic-years', 'max');
  });
});
