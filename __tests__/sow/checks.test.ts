import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The weekly check on an approved scheme of work (Task 13, board 7).
 *
 * Pinned:
 *   1. A note is required for anything but "As planned".
 *   2. Nothing can be checked until the scheme has an approved plan.
 *   3. Once the subject head signs a class's week, its check is fixed.
 *   4. Checks are append-only; the newest per week, class and teacher wins.
 *   5. `cellMark` — the mark a class's week shows.
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
  CHECK_NOT_APPROVED,
  cellMark,
  latestChecks,
  recordCheck,
} from '@/lib/sow/checks';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let seq = 0;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let inserted: Row[] | null = null;
      const run = () => {
        if (inserted) return { data: inserted, error: null };
        const rows = tables[table] ?? [];
        return {
          data: rows.filter((r) => filters.every((f) => f(r))),
          error: null,
        };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: Row | Row[]) => {
          const list = Array.isArray(v) ? v : [v];
          inserted = list.map((r) => ({
            id: `${table}-${++seq}`,
            recorded_at: new Date(
              Date.UTC(2026, 9, 1, 0, 0, seq)
            ).toISOString(),
            ...r,
          }));
          (tables[table] ??= []).push(...inserted);
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
        single: () =>
          Promise.resolve({
            data: (run().data as Row[])[0] ?? null,
            error: null,
          }),
        maybeSingle: () =>
          Promise.resolve({
            data: (run().data as Row[])[0] ?? null,
            error: null,
          }),
        then: (resolve: (v: unknown) => unknown) => resolve(run()),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const TEACHER = { id: 'u1', email: 't@x.sg', role: 'teacher' as const };
const SNAPSHOT = {
  module: {},
  weeks: [1, 2, 3].map((n) => ({
    weekNumber: n,
    topic: `Topic ${n}`,
    learningOutcomes: null,
    textbookPages: null,
    activities: null,
    assessment: null,
    remarks: null,
  })),
};
// Week 1 is 5–9 Oct, week 2 is 12–16 Oct, week 3 is 19–23 Oct 2026.
const TERM_WEEKS = [
  {
    kind: 'week',
    weekNumber: 1,
    startsOn: '2026-10-05',
    endsOn: '2026-10-09',
    schoolDays: [],
  },
  {
    kind: 'week',
    weekNumber: 2,
    startsOn: '2026-10-12',
    endsOn: '2026-10-16',
    schoolDays: [],
  },
  {
    kind: 'week',
    weekNumber: 3,
    startsOn: '2026-10-19',
    endsOn: '2026-10-23',
    schoolDays: [],
  },
];
const TODAY = '2026-10-14'; // Wednesday of week 2

function world(over: { state?: string; snapshot?: unknown } = {}) {
  const tables: Tables = {
    schemes_of_work: [
      {
        id: 'sow1',
        subject_id: 'sci',
        level_id: 'L1',
        term_id: 't1',
        state: over.state ?? 'approved',
        approved_snapshot:
          over.snapshot === undefined ? SNAPSHOT : over.snapshot,
      },
    ],
    scheme_of_work_classes: [
      { sow_id: 'sow1', section_id: 'secA' },
      { sow_id: 'sow1', section_id: 'secB' },
    ],
    scheme_of_work_checks: [],
    scheme_of_work_signoffs: [],
  };
  return { tables, service: fakeService(tables) };
}

const input = (over: Partial<Parameters<typeof recordCheck>[2]> = {}) => ({
  sowId: 'sow1',
  weekNumber: 2,
  sectionId: 'secA',
  option: 'as_planned' as const,
  note: null,
  ...over,
});

beforeEach(() => {
  seq = 0;
  loadMock.mockReset();
  weeksMock.mockReset();
  logMock.mockReset();
  loadMock.mockResolvedValue([
    {
      id: 'a1',
      teacher_user_id: 'u1',
      section_id: 'secA',
      subject_id: 'sci',
      role: 'subject_teacher',
      via: 'substantive',
    },
  ]);
  weeksMock.mockResolvedValue({ weeks: TERM_WEEKS, eventsByWeek: new Map() });
});

describe('recordCheck', () => {
  it('a note is required unless as planned', async () => {
    const { service, tables } = world();
    const bad = await recordCheck(
      service,
      TEACHER,
      input({ option: 'delayed', note: '   ' }),
      { today: TODAY }
    );
    expect(bad).toMatchObject({ ok: false, status: 422 });
    expect(tables.scheme_of_work_checks).toHaveLength(0);

    const planned = await recordCheck(service, TEACHER, input(), {
      today: TODAY,
    });
    expect(planned.ok).toBe(true);
    const delayed = await recordCheck(
      service,
      TEACHER,
      input({ option: 'delayed', note: 'PTC days cut two lessons' }),
      { today: TODAY }
    );
    expect(delayed.ok).toBe(true);
    expect(tables.scheme_of_work_checks).toHaveLength(2);
    // The audit row says THAT there was a note, never what it said.
    const ctx = logMock.mock.calls.at(-1)![0].context;
    expect(ctx).toEqual({
      week_number: 2,
      section_id: 'secA',
      option: 'delayed',
      note_present: true,
    });
    expect(logMock.mock.calls.at(-1)![0].action).toBe('sow.check');
  });

  it('cannot check before approval', async () => {
    const { service, tables } = world({ state: 'draft', snapshot: null });
    const r = await recordCheck(service, TEACHER, input(), { today: TODAY });
    expect(r).toEqual({ ok: false, status: 423, error: CHECK_NOT_APPROVED });
    expect(tables.scheme_of_work_checks).toHaveLength(0);

    // Reopened for a revision: the last approved plan is still in force.
    const reopened = world({ state: 'draft' });
    const ok = await recordCheck(reopened.service, TEACHER, input(), {
      today: TODAY,
    });
    expect(ok.ok).toBe(true);
  });

  it('refuses a teacher who does not take that class, and a week not started', async () => {
    const { service } = world();
    const notMine = await recordCheck(
      service,
      TEACHER,
      input({ sectionId: 'secB' }),
      { today: TODAY }
    );
    expect(notMine).toMatchObject({ ok: false, status: 403 });

    loadMock.mockResolvedValueOnce([
      {
        id: 'a1',
        teacher_user_id: 'u1',
        section_id: 'secA',
        subject_id: 'sci',
        role: 'subject_teacher',
        via: 'relief',
      },
    ]);
    const relief = await recordCheck(service, TEACHER, input(), {
      today: TODAY,
    });
    expect(relief).toMatchObject({ ok: false, status: 403 });

    const future = await recordCheck(
      service,
      TEACHER,
      input({ weekNumber: 3 }),
      { today: TODAY }
    );
    expect(future).toEqual({
      ok: false,
      status: 422,
      error: "This week hasn't started yet.",
    });
  });

  it('cannot change a check once the week is signed', async () => {
    const { service, tables } = world();
    tables.scheme_of_work_signoffs.push({
      id: 's1',
      sow_id: 'sow1',
      week_number: 1,
      section_id: 'secA',
      signed_by: 'head1',
      kind: 'signed',
      created_at: '2026-10-10T01:00:00.000Z',
    });
    const r = await recordCheck(service, TEACHER, input({ weekNumber: 1 }), {
      today: TODAY,
    });
    expect(r).toMatchObject({ ok: false, status: 423 });

    // "Ask the teacher" leaves the week unsigned, so it can still change.
    tables.scheme_of_work_signoffs.push({
      id: 's2',
      sow_id: 'sow1',
      week_number: 2,
      section_id: 'secA',
      signed_by: 'head1',
      kind: 'asked',
      created_at: '2026-10-14T01:00:00.000Z',
    });
    const asked = await recordCheck(service, TEACHER, input(), {
      today: TODAY,
    });
    expect(asked.ok).toBe(true);
  });

  it('a later check replaces an earlier one', async () => {
    const { service, tables } = world();
    await recordCheck(
      service,
      TEACHER,
      input({ option: 'adjusted', note: 'Relief day on Wed' }),
      { today: TODAY }
    );
    await recordCheck(service, TEACHER, input(), { today: TODAY });
    // Append-only: both rows are kept.
    expect(tables.scheme_of_work_checks).toHaveLength(2);
    const latest = latestChecks(
      tables.scheme_of_work_checks as Parameters<typeof latestChecks>[0]
    );
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ option: 'as_planned', note: null });
  });
});

describe('cellMark', () => {
  it('cellMark: one of two teachers checked mid-week is todo', () => {
    expect(
      cellMark({
        teacherIds: ['u1', 'u2'],
        latestChecks: [{ teacherUserId: 'u1', option: 'as_planned' }],
        weekEnded: false,
      })
    ).toBe('todo');
  });

  it('cellMark: both as planned is ok', () => {
    expect(
      cellMark({
        teacherIds: ['u1', 'u2'],
        latestChecks: [
          { teacherUserId: 'u1', option: 'as_planned' },
          { teacherUserId: 'u2', option: 'as_planned' },
        ],
        weekEnded: true,
      })
    ).toBe('ok');
  });

  it('cellMark: one delayed is note', () => {
    expect(
      cellMark({
        teacherIds: ['u1', 'u2'],
        latestChecks: [{ teacherUserId: 'u2', option: 'delayed' }],
        weekEnded: true,
      })
    ).toBe('note');
  });

  it('cellMark: week over and one missing is missed', () => {
    expect(
      cellMark({
        teacherIds: ['u1', 'u2'],
        latestChecks: [{ teacherUserId: 'u1', option: 'as_planned' }],
        weekEnded: true,
      })
    ).toBe('missed');
  });
});
