/**
 * Rename (any subject's name; a code never changes) + delete for a catalog subject
 * (PATCH/DELETE /api/sis/admin/subjects/catalog/[id], lib/sis/subjects/usage.ts),
 * and the create path saving the year description (never a per-year name) with the weights
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

describe('sectionUseLabels — class use blocks Delete, setup never does', () => {
  it('setup tables alone do not block', async () => {
    const { sectionUseLabels } = await import('@/lib/sis/subjects/usage');
    expect(
      sectionUseLabels({
        subject_configs: 3,
        subject_level_offerings: 5,
        subject_report_map: 2,
      })
    ).toEqual([]);
  });

  it('names each kind of class use, in order', async () => {
    const { sectionUseLabels } = await import('@/lib/sis/subjects/usage');
    expect(
      sectionUseLabels({
        grading_sheets: 1,
        teacher_assignments: 0,
        evaluation_subject_comments: 4,
        evaluation_checklist_items: 2,
        section_subjects: 1,
      })
    ).toEqual([
      'grading sheets',
      'evaluation comments',
      'evaluation checklist items',
      'classes that list it',
    ]);
  });
});

describe('listDeletableSubjects', () => {
  it('offers Delete on a configured subject no class uses, with its summary', async () => {
    db.subject_configs = [
      { id: 'cfg-1', subject_id: SUBJ, academic_year_id: 'ay-1' },
    ];
    db.subject_level_offerings = [
      { id: 'o-1', subject_id: SUBJ, level_id: 'P1', academic_year_id: 'ay-1' },
    ];
    db.grading_sheets = [{ subject_id: OTHER }];
    const { listDeletableSubjects } = await import('@/lib/sis/subjects/usage');
    expect(
      await listDeletableSubjects({ from } as never, [SUBJ, OTHER])
    ).toEqual({
      [SUBJ]: { weightYears: ['AY2026'], levelCount: 1, reportedUnder: [] },
    });
  });
});

describe('describeSubjectSetup — the confirm wording', () => {
  it('lists years, levels and who stops reporting under it', async () => {
    const { describeSubjectSetup } =
      await import('@/lib/sis/subjects/setup-summary');
    expect(
      describeSubjectSetup({
        weightYears: ['AY2025', 'AY2026'],
        levelCount: 3,
        reportedUnder: ['Filipino'],
      })
    ).toEqual({
      removed: [
        'Its weights for AY2025 and AY2026',
        'The 3 levels it’s offered at',
      ],
      repointed:
        'Filipino reports under it on the report card today — it will report as itself instead.',
    });
  });

  it('singular level, several subjects under it, no weights', async () => {
    const { describeSubjectSetup } =
      await import('@/lib/sis/subjects/setup-summary');
    expect(
      describeSubjectSetup({
        weightYears: [],
        levelCount: 1,
        reportedUnder: ['Filipino', 'Mandarin'],
      })
    ).toEqual({
      removed: ['The level it’s offered at'],
      repointed:
        'Filipino and Mandarin report under it on the report card today — each will report as itself instead.',
    });
  });

  it('nothing set up says nothing', async () => {
    const { describeSubjectSetup } =
      await import('@/lib/sis/subjects/setup-summary');
    expect(
      describeSubjectSetup({
        weightYears: [],
        levelCount: 0,
        reportedUnder: [],
      })
    ).toEqual({ removed: [], repointed: null });
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

  it('refuses a subject a class uses with 409 and plain words', async () => {
    db.grading_sheets = [{ subject_id: SUBJ }];
    db.teacher_assignments = [{ subject_id: SUBJ }];
    db.subject_configs = [
      { id: 'cfg-1', subject_id: SUBJ, academic_year_id: 'ay-1' },
    ];
    const res = await del();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe(
      'A class uses this subject — it has grading sheets and teachers assigned to it. A subject a class uses stays in the catalog.'
    );
    expect(db.subjects).toHaveLength(2);
    expect(db.subject_configs).toHaveLength(1);
    expect(logAction).not.toHaveBeenCalled();
  });

  it('refuses when a class lists it through its weights (section_subjects)', async () => {
    db.subject_configs = [
      { id: 'cfg-1', subject_id: SUBJ, academic_year_id: 'ay-1' },
    ];
    db.section_subjects = [{ id: 'ss-1', subject_config_id: 'cfg-1' }];
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/classes that list it/);
    expect(db.subject_configs).toHaveLength(1);
  });

  it('refuses when a class has checklist topics for it', async () => {
    db.evaluation_checklist_items = [{ subject_id: SUBJ, section_id: 's-1' }];
    expect((await del()).status).toBe(409);
  });

  it('deletes a subject with setup only — weights, levels, mapping — and snapshots it first', async () => {
    const THIRD = 'subj-3';
    const FOURTH = 'subj-4';
    db.subjects.push(
      { id: THIRD, code: 'FIL', name: 'Filipino' },
      { id: FOURTH, code: 'MAN', name: 'Mandarin' }
    );
    db.academic_years.push({ id: 'ay-0', ay_code: 'AY2025' });
    db.subject_configs = [
      { id: 'cfg-1', subject_id: SUBJ, academic_year_id: 'ay-1' },
      { id: 'cfg-0', subject_id: SUBJ, academic_year_id: 'ay-0' },
      { id: 'cfg-x', subject_id: OTHER, academic_year_id: 'ay-1' },
    ];
    db.subject_level_offerings = [
      { id: 'o-1', subject_id: SUBJ, level_id: 'P1', academic_year_id: 'ay-1' },
      { id: 'o-2', subject_id: SUBJ, level_id: 'P2', academic_year_id: 'ay-1' },
      { id: 'o-3', subject_id: SUBJ, level_id: 'P1', academic_year_id: 'ay-0' },
      {
        id: 'o-x',
        subject_id: OTHER,
        level_id: 'P1',
        academic_year_id: 'ay-1',
      },
    ];
    // Filipino reports under it (no self-map left); Mandarin does too but
    // still has its own self-map.
    db.subject_report_map.push(
      { subject_id: THIRD, report_subject_id: SUBJ },
      { subject_id: FOURTH, report_subject_id: SUBJ },
      { subject_id: FOURTH, report_subject_id: FOURTH }
    );

    const res = await del();
    expect(res.status).toBe(200);
    expect(db.subjects.map((s) => s.id)).toEqual([OTHER, THIRD, FOURTH]);
    expect(db.subject_configs.map((c) => c.id)).toEqual(['cfg-x']);
    expect(db.subject_level_offerings.map((o) => o.id)).toEqual(['o-x']);
    expect(
      db.subject_report_map.map((r) => `${r.subject_id}>${r.report_subject_id}`)
    ).toEqual([
      `${OTHER}>${OTHER}`,
      `${THIRD}>${THIRD}`,
      `${FOURTH}>${FOURTH}`,
    ]);

    expect(logAction).toHaveBeenCalledTimes(1);
    const ctx = logAction.mock.calls[0][0].context as {
      removed: {
        subject_configs: Array<{ id: string; ay_code: string }>;
        subject_level_offerings: unknown[];
        subject_report_map: unknown[];
      };
      repointed_to_self: Array<{ code: string }>;
    };
    expect(ctx.removed.subject_configs.map((c) => c.ay_code).sort()).toEqual([
      'AY2025',
      'AY2026',
    ]);
    expect(ctx.removed.subject_level_offerings).toHaveLength(3);
    expect(ctx.removed.subject_report_map).toHaveLength(1);
    expect(ctx.repointed_to_self.map((r) => r.code).sort()).toEqual([
      'FIL',
      'MAN',
    ]);
  });

  it('404s an unknown subject', async () => {
    expect((await del('nope')).status).toBe(404);
  });
});

describe('PATCH rename', () => {
  it('renames an unused subject and logs subject.rename', async () => {
    const res = await patch({ name: 'Computing' });
    expect(res.status).toBe(200);
    expect(db.subjects[0]).toMatchObject({ code: 'TYPO', name: 'Computing' });
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'subject.rename',
      context: {
        before: { code: 'TYPO', name: 'Tpyo' },
        after: { code: 'TYPO', name: 'Computing' },
      },
    });
  });

  it('refuses any code change — codes never change (2026-09-29)', async () => {
    const res = await patch({ code: 'ICT', name: 'Computing' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/code can't be changed/);
    expect(db.subjects[0]).toMatchObject({ code: 'TYPO', name: 'Tpyo' });
    expect(logAction).not.toHaveBeenCalled();
  });

  it('renames a subject in use (name only), audited before/after', async () => {
    db.subject_level_offerings = [{ subject_id: SUBJ }];
    db.grading_sheets = [{ subject_id: SUBJ }];
    const res = await patch({ name: 'Typo' });
    expect(res.status).toBe(200);
    expect(db.subjects[0]).toMatchObject({ code: 'TYPO', name: 'Typo' });
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0]).toMatchObject({
      action: 'subject.rename',
      context: {
        before: { code: 'TYPO', name: 'Tpyo' },
        after: { code: 'TYPO', name: 'Typo' },
      },
    });
  });

  it('writes nothing and logs nothing when the name is unchanged', async () => {
    const res = await patch({ name: 'Tpyo' });
    expect(res.status).toBe(200);
    expect(logAction).not.toHaveBeenCalled();
  });

  it('still changes grade type on a subject in use', async () => {
    db.subject_configs = [{ subject_id: SUBJ }];
    const res = await patch({ is_examinable: false });
    expect(res.status).toBe(200);
    expect(db.subjects[0].is_examinable).toBe(false);
    expect(logAction.mock.calls[0][0].action).toBe('subject.catalog.update');
  });
});

describe('POST /api/sis/admin/subjects saves the year description only', () => {
  it('stores the description with the weights and never the per-year names', async () => {
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
      description: 'Sports, Talent, Arts and Rhythm',
      ww_weight: '0.40',
    });
    // One subject name (2026-09-29): the per-year columns are never written.
    expect(inserts[0].values).not.toHaveProperty('display_name');
    expect(inserts[0].values).not.toHaveProperty('report_label');
  });
});

describe('POST /api/sis/admin/subjects/catalog generates the code', () => {
  async function create(body: unknown): Promise<Response> {
    const { POST } = await import('@/app/api/sis/admin/subjects/catalog/route');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as never
    );
    if (!res) throw new Error('route returned no response');
    return res;
  }

  it('derives the code from the name and ignores a code in the body', async () => {
    const res = await create({
      name: 'Global Perspectives',
      code: 'IGNORED',
      is_examinable: true,
      grading_method: 'standard_sheet',
    });
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe('GP');
    expect(inserts[0].values).toMatchObject({
      code: 'GP',
      name: 'Global Perspectives',
    });
  });

  it('appends a number when the code is taken', async () => {
    const res = await create({
      name: 'Mathematics',
      is_examinable: true,
      grading_method: 'standard_sheet',
    });
    expect((await res.json()).code).toBe('MATH2');
  });
});
