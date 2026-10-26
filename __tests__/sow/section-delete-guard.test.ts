import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DELETE /api/sections/[id] and the scheme-of-work tables (final fix wave).
 *
 * Every SOW table points at `sections` with ON DELETE RESTRICT (migration
 * 198). The route deletes the class's grading sheets before the section, so a
 * class on a scheme of work used to lose its sheets and then fail with a 500.
 * Pinned: such a class is refused with a 409 BEFORE anything is deleted.
 */

const { logMock } = vi.hoisted(() => ({ logMock: vi.fn() }));

vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: async () => ({
    user: { id: 'u-admin', email: 'admin@hfse.test' },
    role: 'school_admin',
  }),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...a: unknown[]) => logMock(...a),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: () => {},
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [],
}));

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
let deletes: string[] = [];

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'delete' = 'select';
  let head = false;
  const matching = () =>
    (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const q: Record<string, unknown> = {
    select: (_c?: string, opts?: { head?: boolean }) => {
      head = !!opts?.head;
      return q;
    },
    delete: () => {
      op = 'delete';
      return q;
    },
    eq: (c: string, v: unknown) => {
      filters.push((r) => r[c] === v);
      return q;
    },
    maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      if (op === 'delete') {
        const gone = matching();
        deletes.push(table);
        db[table] = (db[table] ?? []).filter((r) => !gone.includes(r));
        return resolve({ count: gone.length, error: null });
      }
      const m = matching();
      return resolve(
        head ? { count: m.length, error: null } : { data: m, error: null }
      );
    },
  };
  return q;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from }),
}));

import { DELETE } from '@/app/api/sections/[id]/route';

const SEC = 'sec-1';

beforeEach(() => {
  logMock.mockReset();
  deletes = [];
  db = {
    sections: [
      {
        id: SEC,
        name: 'Patience',
        level_id: 'lvl-1',
        academic_year_id: 'ay',
        academic_years: { ay_code: 'AY2027' },
        level: { code: 'P1', label: 'Primary 1' },
      },
    ],
    section_students: [],
    teacher_assignments: [],
    grading_sheets: [{ id: 'gs-1', section_id: SEC }],
  };
});

const del = async () =>
  (await DELETE(new Request('http://x', { method: 'DELETE' }) as never, {
    params: Promise.resolve({ id: SEC }),
  }))!;

describe('DELETE /api/sections/[id] — a class on a scheme of work', () => {
  it.each([
    ['scheme_of_work_classes', { sow_id: 'sow-1', section_id: SEC }],
    ['scheme_of_work_checks', { id: 'c-1', section_id: SEC }],
    ['scheme_of_work_relief_notes', { id: 'r-1', section_id: SEC }],
    ['scheme_of_work_signoffs', { id: 's-1', section_id: SEC }],
  ])('is refused with 409 when it has %s rows', async (table, row) => {
    db[table] = [row];
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'This class is on a scheme of work — take it off the scheme first.'
    );
    expect(deletes).toEqual([]);
    expect(db.grading_sheets).toHaveLength(1);
    expect(db.sections).toHaveLength(1);
    expect(logMock).not.toHaveBeenCalled();
  });

  it('still deletes a class no scheme of work touches', async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(deletes).toEqual(['grading_sheets', 'sections']);
  });
});
