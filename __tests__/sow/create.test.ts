import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creating a scheme of work, blank or copied from last year (Task 6).
 *
 * Pinned:
 *   1. Blank = one empty row per term week, dated from this year's calendar.
 *   2. Copy = last year's APPROVED snapshot by week number, re-dated; a week the
 *      term gained is blank, a week it lost is kept after the last term week.
 *   3. Copy never brings checks.
 *   4. A duplicate key and a class already on another scheme are 409s.
 *   5. Only a teacher holding the subject on a ticked class may create.
 *   6. A failed later insert leaves no half-made scheme.
 */

const { loadMock, weeksMock, logMock } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  weeksMock: vi.fn(),
  logMock: vi.fn(),
}));
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: (...a: unknown[]) => loadMock(...a),
}));
vi.mock('@/lib/sow/weeks', async (orig) => ({
  ...(await orig<typeof import('@/lib/sow/weeks')>()),
  loadTermWeeks: (...a: unknown[]) => weeksMock(...a),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...a: unknown[]) => logMock(...a),
}));

import { createSow, findLastYearSow } from '@/lib/sow/create';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables, opts: { failInsert?: string } = {}) {
  const inserts: Record<string, Row[]> = {};
  let counter = 0;
  const service = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'insert' | 'delete' = 'select';
      let payload: Row[] = [];
      let wantRow = false;
      const run = () => {
        const rows = (tables[table] ??= []);
        if (op === 'insert') {
          if (opts.failInsert === table) {
            return { data: null, error: { message: 'boom', code: 'XX000' } };
          }
          const made: Row[] = [];
          for (const p of payload) {
            if (
              table === 'schemes_of_work' &&
              rows.some(
                (r) =>
                  r.term_id === p.term_id &&
                  r.subject_id === p.subject_id &&
                  r.level_id === p.level_id &&
                  r.track === p.track
              )
            ) {
              return {
                data: null,
                error: { message: 'duplicate key', code: '23505' },
              };
            }
            const row = { id: `${table}-${++counter}`, ...p };
            rows.push(row);
            made.push(row);
            (inserts[table] ??= []).push(row);
          }
          return { data: wantRow ? made[0] : made, error: null };
        }
        if (op === 'delete') {
          const gone = rows.filter((r) => filters.every((f) => f(r)));
          tables[table] = rows.filter((r) => !gone.includes(r));
          if (table === 'schemes_of_work') {
            const ids = gone.map((g) => g.id);
            for (const child of [
              'scheme_of_work_classes',
              'scheme_of_work_weeks',
            ]) {
              tables[child] = (tables[child] ?? []).filter(
                (r) => !ids.includes(r.sow_id)
              );
            }
          }
          return { data: null, error: null };
        }
        return {
          data: rows.filter((r) => filters.every((f) => f(r))),
          error: null,
        };
      };
      const q: Record<string, unknown> = {
        select: () => {
          wantRow = op === 'insert' ? wantRow : false;
          return q;
        },
        insert: (p: Row | Row[]) => {
          op = 'insert';
          payload = Array.isArray(p) ? p : [p];
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
        in: (c: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        order: () => q,
        limit: () => q,
        single: () => {
          wantRow = true;
          const res = run();
          if (op === 'select') {
            const list = res.data as Row[];
            return Promise.resolve({ data: list[0] ?? null, error: null });
          }
          return Promise.resolve(res);
        },
        maybeSingle: () => {
          const res = run();
          const list = res.data as Row[];
          return Promise.resolve({ data: list[0] ?? null, error: res.error });
        },
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  };
  return { service: service as unknown as SupabaseClient, inserts, tables };
}

const KEY = {
  termId: 't27',
  subjectId: 'math',
  levelId: 'L1',
  track: 'Standard' as const,
};
const ACTOR = { id: 'u1', email: 'u1@x.sg', role: 'teacher' as const };

const wk = (n: number, startsOn: string, endsOn: string) => ({
  kind: 'week' as const,
  weekNumber: n,
  startsOn,
  endsOn,
  schoolDays: [startsOn],
});
const TERM_WEEKS = [
  wk(1, '2026-10-05', '2026-10-09'),
  wk(2, '2026-10-12', '2026-10-16'),
  {
    kind: 'break' as const,
    startsOn: '2026-10-19',
    endsOn: '2026-10-23',
    label: 'Break',
  },
  wk(3, '2026-10-26', '2026-10-30'),
  wk(4, '2026-11-02', '2026-11-06'),
];

function world(): Tables {
  return {
    academic_years: [
      { id: 'ay27', ay_code: 'AY2027', label: 'AY2027' },
      { id: 'ay26', ay_code: 'AY2026', label: 'AY2026' },
      { id: 'ay25', ay_code: 'AY2025', label: 'AY2025' },
    ],
    terms: [
      { id: 't27', academic_year_id: 'ay27', term_number: 2, label: 'Term 2' },
      { id: 't26', academic_year_id: 'ay26', term_number: 2, label: 'Term 2' },
      { id: 't26b', academic_year_id: 'ay26', term_number: 1, label: 'Term 1' },
    ],
    sections: [
      {
        id: 's1',
        name: 'P1 Joy',
        level_id: 'L1',
        class_type: null,
        academic_year_id: 'ay27',
      },
      {
        id: 's2',
        name: 'P1 Hope',
        level_id: 'L1',
        class_type: 'Standard',
        academic_year_id: 'ay27',
      },
      {
        id: 's3',
        name: 'P1 Global',
        level_id: 'L1',
        class_type: 'Global',
        academic_year_id: 'ay27',
      },
      {
        id: 's4',
        name: 'P2 Joy',
        level_id: 'L2',
        class_type: null,
        academic_year_id: 'ay27',
      },
    ],
    schemes_of_work: [
      {
        id: 'old',
        academic_year_id: 'ay26',
        term_id: 't26',
        subject_id: 'math',
        level_id: 'L1',
        track: 'Standard',
        state: 'approved',
        approved_snapshot: {
          module: { title: 'Maths P1' },
          weeks: [
            {
              weekNumber: 1,
              topic: 'Counting',
              learningOutcomes: '<p>Count</p>',
              textbookPages: '1-3',
              activities: null,
              assessment: 'Quiz',
              remarks: null,
            },
            {
              weekNumber: 2,
              topic: 'Adding',
              learningOutcomes: null,
              textbookPages: null,
              activities: '<p>Blocks</p>',
              assessment: null,
              remarks: 'Slow',
            },
            {
              weekNumber: 3,
              topic: 'Taking away',
              learningOutcomes: null,
              textbookPages: null,
              activities: null,
              assessment: null,
              remarks: null,
            },
            {
              weekNumber: 6,
              topic: 'Revision',
              learningOutcomes: null,
              textbookPages: null,
              activities: null,
              assessment: null,
              remarks: null,
            },
          ],
        },
      },
      {
        id: 'draft-old',
        academic_year_id: 'ay26',
        term_id: 't26b',
        subject_id: 'math',
        level_id: 'L1',
        track: 'Standard',
        state: 'draft',
        approved_snapshot: null,
      },
    ],
    scheme_of_work_classes: [],
    scheme_of_work_weeks: [],
    scheme_of_work_checks: [
      {
        id: 'c1',
        sow_id: 'old',
        week_number: 1,
        section_id: 's1',
        option: 'delayed',
      },
    ],
  };
}

beforeEach(() => {
  loadMock.mockReset();
  weeksMock.mockReset();
  logMock.mockReset();
  loadMock.mockResolvedValue([
    {
      id: 'a1',
      teacher_user_id: 'u1',
      section_id: 's1',
      subject_id: 'math',
      role: 'subject_teacher',
      via: 'substantive',
    },
    {
      id: 'a2',
      teacher_user_id: 'u1',
      section_id: 's2',
      subject_id: 'math',
      role: 'co_teacher',
      via: 'substantive',
    },
  ]);
  weeksMock.mockResolvedValue({ weeks: TERM_WEEKS, eventsByWeek: new Map() });
});

describe('createSow', () => {
  it("blank creates one row per term week with this year's dates", async () => {
    const { service, tables } = fakeService(world());
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1', 's2'],
      start: 'blank',
    });
    expect(res.ok).toBe(true);
    const weeks = tables.scheme_of_work_weeks;
    expect(weeks.map((w) => [w.week_number, w.starts_on, w.ends_on])).toEqual([
      [1, '2026-10-05', '2026-10-09'],
      [2, '2026-10-12', '2026-10-16'],
      [3, '2026-10-26', '2026-10-30'],
      [4, '2026-11-02', '2026-11-06'],
    ]);
    expect(weeks.every((w) => w.topic == null)).toBe(true);
    const sow = tables.schemes_of_work.find((s) => s.term_id === 't27')!;
    expect(sow).toMatchObject({
      academic_year_id: 'ay27',
      state: 'draft',
      started_from: 'blank',
      created_by: 'u1',
    });
    expect(tables.scheme_of_work_classes.map((c) => c.section_id)).toEqual([
      's1',
      's2',
    ]);
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'sow.create',
        context: {
          started_from: 'blank',
          copied_from_sow_id: null,
          week_count: 4,
          class_count: 2,
        },
      })
    );
  });

  it('copy brings content by week number and re-dates it', async () => {
    const { service, tables } = fakeService(world());
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'copy',
    });
    expect(res.ok).toBe(true);
    const sow = tables.schemes_of_work.find((s) => s.term_id === 't27')!;
    expect(sow).toMatchObject({
      started_from: 'copy',
      copied_from_sow_id: 'old',
      module: { title: 'Maths P1' },
    });
    const byNo = new Map(
      tables.scheme_of_work_weeks.map((w) => [w.week_number, w])
    );
    expect(byNo.get(1)).toMatchObject({
      topic: 'Counting',
      learning_outcomes: '<p>Count</p>',
      textbook_pages: '1-3',
      assessment: 'Quiz',
      starts_on: '2026-10-05',
      ends_on: '2026-10-09',
    });
    expect(byNo.get(2)).toMatchObject({ topic: 'Adding', remarks: 'Slow' });
    expect(byNo.get(3)).toMatchObject({
      topic: 'Taking away',
      starts_on: '2026-10-26',
    });
    // The term gained week 4: blank.
    expect(byNo.get(4)).toMatchObject({ topic: null, starts_on: '2026-11-02' });
    // Last year's week 6 is past this term's 4 weeks: kept as week 5, on the
    // last term week's dates.
    expect(byNo.get(5)).toMatchObject({
      topic: 'Revision',
      starts_on: '2026-11-02',
      ends_on: '2026-11-06',
    });
    expect(byNo.size).toBe(5);
  });

  it('copy never brings checks', async () => {
    const { service, inserts, tables } = fakeService(world());
    await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'copy',
    });
    expect(inserts.scheme_of_work_checks).toBeUndefined();
    expect(tables.scheme_of_work_checks).toHaveLength(1);
  });

  it('copy without an approved scheme from last year is a 400', async () => {
    const t = world();
    t.schemes_of_work = t.schemes_of_work.filter((s) => s.id !== 'old');
    const { service } = fakeService(t);
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'copy',
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it('a duplicate key is a 409 with the plain sentence', async () => {
    const t = world();
    t.schemes_of_work.push({
      id: 'dup',
      academic_year_id: 'ay27',
      term_id: 't27',
      subject_id: 'math',
      level_id: 'L1',
      track: 'Standard',
      state: 'draft',
    });
    const { service } = fakeService(t);
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'blank',
    });
    expect(res).toEqual({
      ok: false,
      status: 409,
      error:
        'A scheme of work already exists for this subject, level and track this term.',
    });
  });

  it('a class already on another SOW for the subject is a 409 naming it', async () => {
    const t = world();
    t.schemes_of_work.push({
      id: 'other',
      academic_year_id: 'ay27',
      term_id: 't27',
      subject_id: 'math',
      level_id: 'L1',
      track: 'Global',
      state: 'draft',
    });
    t.scheme_of_work_classes.push({ sow_id: 'other', section_id: 's2' });
    const { service, tables } = fakeService(t);
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1', 's2'],
      start: 'blank',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toContain('P1 Hope');
    expect(tables.schemes_of_work.some((s) => s.created_by === 'u1')).toBe(
      false
    );
  });

  it('a teacher without an assignment on the classes is refused', async () => {
    loadMock.mockResolvedValue([
      {
        id: 'a1',
        teacher_user_id: 'u1',
        section_id: 's1',
        subject_id: 'science',
        role: 'subject_teacher',
        via: 'substantive',
      },
      {
        id: 'a2',
        teacher_user_id: 'u1',
        section_id: 's2',
        subject_id: 'math',
        role: 'subject_teacher',
        via: 'relief',
      },
    ]);
    const { service, tables } = fakeService(world());
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1', 's2'],
      start: 'blank',
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(tables.schemes_of_work.some((s) => s.created_by === 'u1')).toBe(
      false
    );
  });

  it('a ticked class from another level or track is a 400', async () => {
    const { service } = fakeService(world());
    for (const sectionIds of [['s4'], ['s3']]) {
      loadMock.mockResolvedValue(
        sectionIds.map((section_id) => ({
          id: 'a',
          teacher_user_id: 'u1',
          section_id,
          subject_id: 'math',
          role: 'subject_teacher',
          via: 'substantive',
        }))
      );
      const res = await createSow(service, ACTOR, {
        key: KEY,
        sectionIds,
        start: 'blank',
      });
      expect(res).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('removes the scheme when the weeks cannot be saved', async () => {
    const { service, tables } = fakeService(world(), {
      failInsert: 'scheme_of_work_weeks',
    });
    await expect(
      createSow(service, ACTOR, {
        key: KEY,
        sectionIds: ['s1'],
        start: 'blank',
      })
    ).rejects.toThrow();
    expect(tables.schemes_of_work.some((s) => s.created_by === 'u1')).toBe(
      false
    );
    expect(tables.scheme_of_work_classes).toHaveLength(0);
  });
});

describe('createSow by role', () => {
  const ADMIN = { id: 'u1', email: 'a@x.sg', role: 'school_admin' as const };

  it('a school admin who holds the subject on a class can create', async () => {
    const { service } = fakeService(world());
    const res = await createSow(service, ADMIN, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'blank',
    });
    expect(res.ok).toBe(true);
  });

  it('a school admin with no assignment is refused', async () => {
    loadMock.mockResolvedValue([]);
    const { service } = fakeService(world());
    const res = await createSow(service, ADMIN, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'blank',
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it('a snapshot with a repeated week number cannot be copied (400)', async () => {
    const t = world();
    const old = t.schemes_of_work.find((s) => s.id === 'old')!;
    const snap = old.approved_snapshot as { weeks: Row[] };
    snap.weeks.push({ ...snap.weeks[0] });
    const { service } = fakeService(t);
    const res = await createSow(service, ACTOR, {
      key: KEY,
      sectionIds: ['s1'],
      start: 'copy',
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});

describe('findLastYearSow', () => {
  it("finds last year's approved scheme for the same term number", async () => {
    const { service } = fakeService(world());
    expect(await findLastYearSow(service, KEY)).toEqual({
      id: 'old',
      label: 'AY2026 Term 2',
    });
  });

  it('ignores a scheme that was never approved', async () => {
    const t = world();
    t.terms.push({
      id: 't27b',
      academic_year_id: 'ay27',
      term_number: 1,
      label: 'Term 1',
    });
    const { service } = fakeService(t);
    expect(
      await findLastYearSow(service, { ...KEY, termId: 't27b' })
    ).toBeNull();
  });
});
