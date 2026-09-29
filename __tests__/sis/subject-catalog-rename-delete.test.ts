/**
 * Rename + delete for an UNUSED catalog subject
 * (PATCH/DELETE /api/sis/admin/subjects/catalog/[id], lib/sis/subjects/usage.ts),
 * and the create path saving the three per-year names with the weights
 * (POST /api/sis/admin/subjects).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type LoggedCall = {
  action: string;
  entityId: string | null;
  context: Record<string, unknown>;
};
const logAction = vi.fn((_call: LoggedCall) => Promise.resolve());

vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: LoggedCall) => logAction(call),
}));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));
vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-1', email: 'admin@hfse.test' },
      role: 'school_admin',
    })
  ),
}));

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};
const inserts: Array<{ table: string; values: Row }> = [];

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'update' | 'delete' | 'insert' = 'select';
  let head = false;
  let values: Row = {};
  const rows = () => (db[table] ??= []);
  const matching = () => rows().filter((r) => filters.every((f) => f(r)));
  const q = {
    select(_cols?: string, opts?: { head?: boolean }) {
      if (op === 'select') head = !!opts?.head;
      return q;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return q;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => r[col] !== val);
      return q;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return q;
    },
    update(v: Row) {
      op = 'update';
      values = v;
      return q;
    },
    delete() {
      op = 'delete';
      return q;
    },
    insert(v: Row) {
      op = 'insert';
      values = { id: `new-${table}`, ...v };
      return q;
    },
    maybeSingle() {
      // A copy, as the real client returns — the route keeps `before`.
      const hit = matching()[0];
      return Promise.resolve({ data: hit ? { ...hit } : null, error: null });
    },
    single() {
      if (op === 'insert') {
        rows().push(values);
        inserts.push({ table, values });
        return Promise.resolve({ data: values, error: null });
      }
      return Promise.resolve({ data: matching()[0] ?? null, error: null });
    },
    then(resolve: (v: unknown) => unknown) {
      if (op === 'update') {
        for (const r of matching()) Object.assign(r, values);
        return resolve({ error: null });
      }
      if (op === 'delete') {
        const keep = rows().filter((r) => !filters.every((f) => f(r)));
        db[table] = keep;
        return resolve({ error: null });
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

const SUBJ = 'subj-1';
const OTHER = 'subj-2';

beforeEach(() => {
  logAction.mockClear();
  inserts.length = 0;
  db = {
    subjects: [
      {
        id: SUBJ,
        code: 'TYPO',
        name: 'Tpyo',
        is_examinable: true,
        grading_method: 'standard_sheet',
      },
      {
        id: OTHER,
        code: 'MATH',
        name: 'Mathematics',
        is_examinable: true,
        grading_method: 'standard_sheet',
      },
    ],
    // Every subject is seeded self-mapped — that does NOT count as use.
    subject_report_map: [
      { subject_id: SUBJ, report_subject_id: SUBJ },
      { subject_id: OTHER, report_subject_id: OTHER },
    ],
    academic_years: [{ id: 'ay-1', ay_code: 'AY2026' }],
  };
});

const params = (id = SUBJ) => ({ params: Promise.resolve({ id }) });

async function patch(body: unknown, id = SUBJ): Promise<Response> {
  const { PATCH } =
    await import('@/app/api/sis/admin/subjects/catalog/[id]/route');
  const res = await PATCH(
    new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as never,
    params(id)
  );
  if (!res) throw new Error('route returned no response');
  return res;
}
async function del(id = SUBJ): Promise<Response> {
  const { DELETE } =
    await import('@/app/api/sis/admin/subjects/catalog/[id]/route');
  const res = await DELETE(
    new Request('http://x', { method: 'DELETE' }) as never,
    params(id)
  );
  if (!res) throw new Error('route returned no response');
  return res;
}

describe('findSubjectUsage / listUnusedSubjectIds', () => {
  it('a subject with only its self-map is unused', async () => {
    const { findSubjectUsage } = await import('@/lib/sis/subjects/usage');
    expect(await findSubjectUsage({ from } as never, SUBJ)).toEqual([]);
  });

  it('names each kind of use', async () => {
    db.grading_sheets = [{ subject_id: SUBJ }];
    db.teacher_assignments = [{ subject_id: SUBJ }];
    db.subject_report_map.push({ subject_id: OTHER, report_subject_id: SUBJ });
    const { findSubjectUsage } = await import('@/lib/sis/subjects/usage');
    expect(await findSubjectUsage({ from } as never, SUBJ)).toEqual([
      'grading sheets',
      'teachers assigned to it',
      'other subjects reported under it',
    ]);
  });

  it('lists only the subjects nothing uses', async () => {
    db.subject_configs = [{ subject_id: OTHER }];
    const { listUnusedSubjectIds } = await import('@/lib/sis/subjects/usage');
    expect(
      await listUnusedSubjectIds({ from } as never, [SUBJ, OTHER])
    ).toEqual([SUBJ]);
  });
});

describe('DELETE', () => {
  it('deletes an unused subject with its self-map, and logs it', async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(db.subjects.map((s) => s.id)).toEqual([OTHER]);
    expect(db.subject_report_map.map((r) => r.subject_id)).toEqual([OTHER]);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'subject.delete',
      entityId: SUBJ,
      context: { code: 'TYPO', name: 'Tpyo' },
    });
  });

  it('refuses a subject in use with 409 and plain words', async () => {
    db.subject_configs = [{ subject_id: SUBJ }];
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(
      /^This subject is already in use — it has weights set for a school year\./
    );
    expect(db.subjects).toHaveLength(2);
    expect(logAction).not.toHaveBeenCalled();
  });

  it('404s an unknown subject', async () => {
    expect((await del('nope')).status).toBe(404);
  });
});

describe('PATCH rename', () => {
  it('renames code + name of an unused subject and logs subject.rename', async () => {
    const res = await patch({ code: 'ICT', name: 'Computing' });
    expect(res.status).toBe(200);
    expect(db.subjects[0]).toMatchObject({ code: 'ICT', name: 'Computing' });
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'subject.rename',
      context: {
        before: { code: 'TYPO', name: 'Tpyo' },
        after: { code: 'ICT', name: 'Computing' },
      },
    });
  });

  it('refuses to rename a subject in use', async () => {
    db.subject_level_offerings = [{ subject_id: SUBJ }];
    const res = await patch({ name: 'Typo' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in use.*renamed\.$/);
    expect(db.subjects[0].name).toBe('Tpyo');
  });

  it('refuses a code another subject already has', async () => {
    const res = await patch({ code: 'MATH' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already uses the code MATH/);
    expect(db.subjects[0].code).toBe('TYPO');
  });

  it('still changes grade type on a subject in use', async () => {
    db.subject_configs = [{ subject_id: SUBJ }];
    const res = await patch({ is_examinable: false });
    expect(res.status).toBe(200);
    expect(db.subjects[0].is_examinable).toBe(false);
    expect(logAction.mock.calls[0][0].action).toBe('subject.catalog.update');
  });
});

describe('POST /api/sis/admin/subjects saves the year names', () => {
  it('stores the three names with the weights, blank as null', async () => {
    db.subjects.push({
      id: '22222222-2222-4222-8222-222222222222',
      code: 'STAR',
      name: 'MAPEH',
    });
    db.academic_years.push({
      id: '11111111-1111-4111-8111-111111111111',
      ay_code: 'AY2027',
    });
    const { POST } = await import('@/app/api/sis/admin/subjects/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({
          academic_year_id: '11111111-1111-4111-8111-111111111111',
          subject_id: '22222222-2222-4222-8222-222222222222',
          ww_weight: 40,
          pt_weight: 40,
          qa_weight: 20,
          ww_max_slots: 5,
          pt_max_slots: 5,
          qa_max: 30,
          display_name: '  STAR ',
          report_label: '',
          description: 'Sports, Talent, Arts and Rhythm',
        }),
      }) as never
    );
    expect(res?.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('subject_configs');
    expect(inserts[0].values).toMatchObject({
      display_name: 'STAR',
      report_label: null,
      description: 'Sports, Talent, Arts and Rhythm',
      ww_weight: '0.40',
    });
  });
});
