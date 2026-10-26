import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Editing a scheme of work's module details and weeks (Task 7).
 *
 * Pinned:
 *   1. A teacher of the subject edits a draft week; rich text is sanitised.
 *   2. In review / approved is a 423 with the plain sentence.
 *   3. A stale save (changed updated_at) is a 409 and writes nothing.
 *   4. A surplus week can be deleted; a term week cannot.
 *   5. The audit context names the fields, never the text.
 *   6. Order of refusals: 404, 403, 423, 409.
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

import {
  deleteWeek,
  LOCKED_MESSAGE,
  updateModule,
  updateWeek,
} from '@/lib/sow/edit';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let op: 'select' | 'update' | 'delete' = 'select';
      let patch: Row = {};
      const run = () => {
        const rows = (tables[table] ??= []);
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, patch);
          return { data: hit, error: null };
        }
        if (op === 'delete') {
          tables[table] = rows.filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        return { data: hit, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Row) => {
          op = 'update';
          patch = p;
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
        order: () => q,
        maybeSingle: () => {
          const res = run();
          return Promise.resolve({
            data: (res.data as Row[])[0] ?? null,
            error: null,
          });
        },
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const ME = { id: 'u1', email: 't@x.sg', role: 'teacher' as const };
const T0 = '2026-10-01T00:00:00.000Z';

function world(state = 'draft') {
  const tables: Tables = {
    schemes_of_work: [
      {
        id: 'sow1',
        subject_id: 'math',
        level_id: 'L1',
        term_id: 't1',
        state,
        module: { title: 'Old title', syllabus: 'Keep me' },
        updated_at: T0,
      },
    ],
    scheme_of_work_classes: [{ sow_id: 'sow1', section_id: 'sec1' }],
    scheme_of_work_weeks: [
      { sow_id: 'sow1', week_number: 1, topic: null, updated_at: T0 },
      { sow_id: 'sow1', week_number: 2, topic: null, updated_at: T0 },
      { sow_id: 'sow1', week_number: 3, topic: 'Extra', updated_at: T0 },
    ],
  };
  return { tables, service: fakeService(tables) };
}

beforeEach(() => {
  loadMock.mockReset();
  weeksMock.mockReset();
  logMock.mockReset();
  loadMock.mockResolvedValue([
    {
      teacher_user_id: 'u1',
      role: 'subject_teacher',
      subject_id: 'math',
      section_id: 'sec1',
      via: 'substantive',
    },
  ]);
  // The term has two numbered weeks, so week 3 is surplus.
  weeksMock.mockResolvedValue({
    weeks: [
      {
        kind: 'week',
        weekNumber: 1,
        startsOn: 'a',
        endsOn: 'b',
        schoolDays: [],
      },
      {
        kind: 'week',
        weekNumber: 2,
        startsOn: 'c',
        endsOn: 'd',
        schoolDays: [],
      },
    ],
    eventsByWeek: new Map(),
  });
});

describe('editing a scheme of work', () => {
  it('a teacher edits a draft week', async () => {
    const { service, tables } = world();
    const r = await updateWeek(
      service,
      ME,
      'sow1',
      1,
      {
        topic: '  Fractions ',
        activities: '<p>Group work</p><script>alert(1)</script>',
        remarks: '<p></p>',
      },
      T0
    );
    expect(r.ok).toBe(true);
    const week = tables.scheme_of_work_weeks[0];
    expect(week.topic).toBe('Fractions');
    expect(String(week.activities)).toContain('Group work');
    expect(String(week.activities)).not.toContain('script');
    expect(week.remarks).toBeNull();
    expect(week.updated_at).not.toBe(T0);
    // The other week and the scheme itself are untouched.
    expect(tables.scheme_of_work_weeks[1].updated_at).toBe(T0);
    expect(tables.schemes_of_work[0].updated_at).toBe(T0);
  });

  it('module details merge into what is stored', async () => {
    const { service, tables } = world();
    const r = await updateModule(
      service,
      ME,
      'sow1',
      { title: 'New title', textbook: null },
      T0
    );
    expect(r.ok).toBe(true);
    expect(tables.schemes_of_work[0].module).toEqual({
      title: 'New title',
      syllabus: 'Keep me',
    });
  });

  it('editing in review is a 423 with the plain sentence', async () => {
    for (const state of ['in_review', 'approved']) {
      const { service } = world(state);
      const r = await updateModule(service, ME, 'sow1', { title: 'x' }, T0);
      expect(r).toEqual({ ok: false, status: 423, error: LOCKED_MESSAGE });
    }
    expect(LOCKED_MESSAGE).toBe(
      "It's in review, so it can't be edited. Ask to have it returned if something needs changing."
    );
  });

  it('a stale save is a 409 and writes nothing', async () => {
    const { service, tables } = world();
    const r = await updateWeek(
      service,
      ME,
      'sow1',
      1,
      { topic: 'Mine' },
      '2026-09-01T00:00:00.000Z'
    );
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(tables.scheme_of_work_weeks[0].topic).toBeNull();
    const m = await updateModule(
      service,
      ME,
      'sow1',
      { title: 'Mine' },
      '2026-09-01T00:00:00.000Z'
    );
    expect(m).toMatchObject({ ok: false, status: 409 });
    expect(logMock).not.toHaveBeenCalled();
  });

  it('refuses in order: 404, then 403, then 423', async () => {
    const { service } = world('in_review');
    expect(await updateModule(service, ME, 'nope', {}, T0)).toMatchObject({
      status: 404,
    });
    loadMock.mockResolvedValue([]);
    expect(await updateModule(service, ME, 'sow1', {}, T0)).toMatchObject({
      status: 403,
    });
  });

  it('relief cover cannot edit', async () => {
    const { service } = world();
    loadMock.mockResolvedValue([
      {
        teacher_user_id: 'u1',
        role: 'subject_teacher',
        subject_id: 'math',
        section_id: 'sec1',
        via: 'relief',
      },
    ]);
    expect(await updateWeek(service, ME, 'sow1', 1, {}, T0)).toMatchObject({
      status: 403,
    });
  });

  it('a surplus week can be deleted, a term week cannot', async () => {
    const { service, tables } = world();
    const term = await deleteWeek(service, ME, 'sow1', 2);
    expect(term).toMatchObject({ ok: false, status: 400 });
    expect(tables.scheme_of_work_weeks).toHaveLength(3);

    const surplus = await deleteWeek(service, ME, 'sow1', 3);
    expect(surplus.ok).toBe(true);
    expect(tables.scheme_of_work_weeks.map((w) => w.week_number)).toEqual([
      1, 2,
    ]);
  });

  it('audit context names the fields, not the text', async () => {
    const { service } = world();
    await updateWeek(
      service,
      ME,
      'sow1',
      2,
      { topic: 'Secret topic words', activities: '<p>Secret activity</p>' },
      T0
    );
    await updateModule(service, ME, 'sow1', { title: 'Secret title' }, T0);
    expect(logMock).toHaveBeenCalledTimes(2);
    const [week, mod] = logMock.mock.calls.map((c) => c[0]);
    expect(week).toMatchObject({
      action: 'sow.edit',
      entityId: 'sow1',
      context: {
        target: 'week',
        week_number: 2,
        fields: ['topic', 'activities'],
      },
    });
    expect(mod.context).toEqual({ target: 'module', fields: ['title'] });
    expect(JSON.stringify(logMock.mock.calls)).not.toContain('Secret');
  });
});
