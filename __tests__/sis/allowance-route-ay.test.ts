/**
 * The allowance routes look the enrolee up in the year the caller names, not
 * always the current one. Enrolee numbers reset every year (Hard Rule #4), so
 * a past-year page sending its own number must not be resolved against the
 * current year's table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromCalls: string[] = [];
const invalidate = vi.fn();

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u1', email: 'r@hfse.test' },
      role: 'registrar',
    })
  ),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...a: unknown[]) => invalidate(...a),
}));
vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
  listAyCodes: vi.fn(() => Promise.resolve(['AY2026', 'AY2025'])),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      const obj: Record<string, unknown> = {};
      obj.select = () => obj;
      obj.eq = () => obj;
      obj.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return obj;
    },
  }),
}));

import { PATCH as patchAllowance } from '@/app/api/sis/students/[enroleeNumber]/allowance/route';
import { PATCH as patchVl } from '@/app/api/sis/students/[enroleeNumber]/vl-allowance/route';

function req(body: unknown) {
  return new Request('http://x/api', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as never;
}
const params = { params: Promise.resolve({ enroleeNumber: '123' }) };

describe('allowance routes take the year explicitly', () => {
  beforeEach(() => {
    fromCalls.length = 0;
    invalidate.mockClear();
  });

  it('allowance: looks the enrolee up in the named year', async () => {
    await patchAllowance(req({ allowance: 7, ayCode: 'AY2025' }), params);
    expect(fromCalls).toEqual(['ay2025_enrolment_applications']);
  });

  it('allowance: defaults to the current year', async () => {
    await patchAllowance(req({ allowance: 7 }), params);
    expect(fromCalls).toEqual(['ay2026_enrolment_applications']);
  });

  it('vl-allowance: looks the enrolee up in the named year', async () => {
    await patchVl(req({ vlAllowance: 2, ayCode: 'AY2025' }), params);
    expect(fromCalls).toEqual(['ay2025_enrolment_applications']);
  });

  it('rejects a year that does not exist', async () => {
    const res = await patchAllowance(
      req({ allowance: 7, ayCode: 'AY1999' }),
      params
    );
    expect(res?.status).toBe(400);
    expect(fromCalls).toEqual([]);
  });
});
