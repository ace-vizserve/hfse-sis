import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "This week's lessons" and the SOW to-dos on a teacher's Classroom home
 * (Task 16, board 15).
 *
 * Pinned:
 *   1. One lesson per class x subject, with this week's topic from the APPROVED
 *      snapshot and the state chip the brief names.
 *   2. To-dos, in order: returned, asked, unchecked week, not started.
 *   3. A week is a to-do until every one of the teacher's classes is checked.
 *   4. The whole home is a handful of queries however many classes there are.
 */

const { assignMock, rowsMock, weeksMock } = vi.hoisted(() => ({
  assignMock: vi.fn(),
  rowsMock: vi.fn(),
  weeksMock: vi.fn(),
}));
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: (...a: unknown[]) => assignMock(...a),
}));
vi.mock('@/lib/sow/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/sow/access')>()),
  listMySowRows: (...a: unknown[]) => rowsMock(...a),
}));
vi.mock('@/lib/sow/weeks', async (orig) => ({
  ...(await orig<typeof import('@/lib/sow/weeks')>()),
  loadTermWeeksForLevels: (...a: unknown[]) => weeksMock(...a),
}));

import { loadSowHome } from '@/lib/sow/home';
import type { MySowRow } from '@/lib/sow/access';
import type { TermWeek } from '@/lib/sow/weeks';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let queries = 0;

/** A just-enough chainable fake of the Supabase query builder. */
function fakeService(tables: Tables) {
  return {
    from(table: string) {
      queries += 1;
      const filters: Array<(r: Row) => boolean> = [];
      const run = () => ({
        data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))),
        error: null,
      });
      const q: Record<string, unknown> = {
        select: () => q,
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

const ME = 'me';
// Wednesday of Week 3.
const TODAY = '2026-10-21';

const weeks: TermWeek[] = [
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
  {
    kind: 'week',
    weekNumber: 4,
    startsOn: '2026-10-26',
    endsOn: '2026-10-30',
    schoolDays: [],
  },
];

const snapshot = {
  module: {},
  weeks: [
    { weekNumber: 3, topic: 'Ch 3.4 Elements, compounds and mixtures' },
    { weekNumber: 4, topic: 'Ch 3.5 Separation' },
  ],
};

function sowRow(over: Partial<MySowRow> & Pick<MySowRow, 'sow'>): MySowRow {
  return {
    termId: 't2',
    subjectId: 'sci',
    levelId: 'L1',
    track: 'Standard',
    subjectName: 'Science',
    levelLabel: 'Secondary 1',
    classes: [
      { sectionId: 'd1', name: 'Discipline 1' },
      { sectionId: 'd2', name: 'Discipline 2' },
    ],
    myClassesNotOnSow: [],
    ...over,
  };
}

const mine = (sectionId: string, subjectId = 'sci', extra: Row = {}) => ({
  id: `a-${sectionId}-${subjectId}`,
  teacher_user_id: ME,
  section_id: sectionId,
  subject_id: subjectId,
  role: 'subject_teacher',
  via: 'substantive',
  ...extra,
});

function world(over: Partial<Tables> = {}): Tables {
  return {
    academic_years: [{ id: 'ay', is_current: true }],
    terms: [
      {
        id: 't2',
        academic_year_id: 'ay',
        term_number: 2,
        start_date: '2026-07-01',
        end_date: '2026-12-01',
        is_current: true,
      },
    ],
    schemes_of_work: [
      { id: 'sow-sci', state: 'approved', approved_snapshot: snapshot },
    ],
    scheme_of_work_checks: [],
    scheme_of_work_signoffs: [],
    ...over,
  };
}

const check = (sectionId: string, at: string, week = 3, who = ME) => ({
  sow_id: 'sow-sci',
  week_number: week,
  section_id: sectionId,
  teacher_user_id: who,
  option: 'as_planned',
  note: null,
  recorded_at: at,
});

beforeEach(() => {
  queries = 0;
  assignMock.mockReset();
  rowsMock.mockReset();
  weeksMock.mockReset();
  weeksMock.mockResolvedValue(
    new Map([['L1', { weeks, eventsByWeek: new Map() }]])
  );
  assignMock.mockResolvedValue([mine('d1'), mine('d2')]);
});

describe('loadSowHome', () => {
  it("lists a lesson per class with this week's topic", async () => {
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
    ]);
    const home = await loadSowHome(fakeService(world()), ME, TODAY);

    expect(home.lessons.map((l) => l.className)).toEqual([
      'Secondary 1 Discipline 1 · Science',
      'Secondary 1 Discipline 2 · Science',
    ]);
    expect(home.lessons[0].topic).toBe(
      'Ch 3.4 Elements, compounds and mixtures'
    );
    expect(home.lessons[0].state?.label).toBe('Check due Fri');
    expect(home.lessons[0].href).toBe('/classroom/sow/sow-sci');
  });

  it('says Checked once this teacher has checked the class, and Relief on a cover week', async () => {
    assignMock.mockResolvedValue([
      mine('d1'),
      mine('d2', 'sci', {
        relief_teacher_user_id: 'sub',
        relief_started_on: '2026-10-21',
        relief_ended_on: '2026-10-21',
      }),
    ]);
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
    ]);
    const home = await loadSowHome(
      fakeService(
        world({ scheme_of_work_checks: [check('d1', '2026-10-21T01:00:00Z')] })
      ),
      ME,
      TODAY
    );
    expect(home.lessons[0].state?.label).toBe('Checked');
    expect(home.lessons[1].state?.label).toBe('Relief Wed');
  });

  it('shows the state of a SOW that has no approved plan', async () => {
    rowsMock.mockResolvedValue([
      sowRow({
        subjectId: 'eng',
        subjectName: 'English',
        classes: [{ sectionId: 'e1', name: 'Integrity 1' }],
        sow: { id: 'sow-eng', state: 'in_review' },
      }),
      sowRow({
        subjectId: 'mth',
        subjectName: 'Math',
        classes: [{ sectionId: 'm1', name: 'Consistency' }],
        sow: { id: 'sow-mth', state: 'returned' },
      }),
    ]);
    assignMock.mockResolvedValue([mine('e1', 'eng'), mine('m1', 'mth')]);
    const home = await loadSowHome(
      fakeService(
        world({
          schemes_of_work: [
            { id: 'sow-eng', state: 'in_review', approved_snapshot: null },
            { id: 'sow-mth', state: 'returned', approved_snapshot: null },
          ],
        })
      ),
      ME,
      TODAY
    );
    expect(home.lessons.map((l) => [l.topic, l.state?.label])).toEqual([
      ['SOW in review, no lessons to show yet', 'In review'],
      ['SOW returned by the subject head', 'Returned'],
    ]);
  });

  it('a returned SOW is the first to-do', async () => {
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
      sowRow({
        subjectId: 'mth',
        subjectName: 'Math',
        classes: [{ sectionId: 'm1', name: 'Consistency' }],
        sow: { id: 'sow-mth', state: 'returned' },
      }),
    ]);
    assignMock.mockResolvedValue([mine('d1'), mine('d2'), mine('m1', 'mth')]);
    const home = await loadSowHome(
      fakeService(
        world({
          schemes_of_work: [
            { id: 'sow-sci', state: 'approved', approved_snapshot: snapshot },
            { id: 'sow-mth', state: 'returned', approved_snapshot: null },
          ],
        })
      ),
      ME,
      TODAY
    );
    expect(home.todos[0]).toMatchObject({
      kind: 'returned',
      text: 'Fix and resend Secondary 1 Math SOW',
      href: '/classroom/sow/sow-mth',
    });
    expect(home.todos[1].kind).toBe('check');
  });

  it('an unchecked week is a to-do until every class is checked', async () => {
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
    ]);
    const oneChecked = await loadSowHome(
      fakeService(
        world({ scheme_of_work_checks: [check('d1', '2026-10-21T01:00:00Z')] })
      ),
      ME,
      TODAY
    );
    expect(oneChecked.todos.map((t) => t.text)).toEqual([
      'Check Week 3 for Secondary 1 Science (1 class)',
    ]);

    const noneChecked = await loadSowHome(fakeService(world()), ME, TODAY);
    expect(noneChecked.todos.map((t) => t.text)).toEqual([
      'Check Week 3 for Secondary 1 Science (2 classes)',
    ]);

    const allChecked = await loadSowHome(
      fakeService(
        world({
          scheme_of_work_checks: [
            check('d1', '2026-10-21T01:00:00Z'),
            check('d2', '2026-10-21T01:00:00Z'),
          ],
        })
      ),
      ME,
      TODAY
    );
    expect(allChecked.todos).toEqual([]);
  });

  it('a check recorded after the signature is not what was signed', async () => {
    rowsMock.mockResolvedValue([
      sowRow({
        classes: [{ sectionId: 'd1', name: 'Discipline 1' }],
        sow: { id: 'sow-sci', state: 'approved' },
      }),
    ]);
    assignMock.mockResolvedValue([mine('d1')]);
    const home = await loadSowHome(
      fakeService(
        world({
          scheme_of_work_checks: [check('d1', '2026-10-21T05:00:00Z')],
          scheme_of_work_signoffs: [
            {
              sow_id: 'sow-sci',
              week_number: 3,
              section_id: 'd1',
              kind: 'signed',
              created_at: '2026-10-21T04:00:00Z',
            },
          ],
        })
      ),
      ME,
      TODAY
    );
    // Signed: nothing left for this teacher to check, and no to-do.
    expect(home.todos).toEqual([]);
    expect(home.lessons[0].state?.label).toBe('Checked');
  });

  it('a not-started SOW is a to-do', async () => {
    rowsMock.mockResolvedValue([
      sowRow({
        levelId: 'L2',
        levelLabel: 'Secondary 2',
        track: 'Global',
        classes: [{ sectionId: 'g1', name: 'Integrity 1' }],
        sow: null,
      }),
    ]);
    assignMock.mockResolvedValue([mine('g1')]);
    weeksMock.mockResolvedValue(
      new Map([['L2', { weeks, eventsByWeek: new Map() }]])
    );
    const home = await loadSowHome(fakeService(world()), ME, TODAY);
    expect(home.todos).toEqual([
      expect.objectContaining({
        kind: 'start',
        text: 'Start the Secondary 2 Global Science SOW',
        href: '/classroom/sow',
      }),
    ]);
    expect(home.lessons[0]).toMatchObject({
      topic: 'SOW not started',
      state: { label: 'Not started' },
    });
  });

  it("an open 'asked' sign-off is a to-do until the teacher checks again", async () => {
    rowsMock.mockResolvedValue([
      sowRow({
        classes: [{ sectionId: 'd1', name: 'Discipline 1' }],
        sow: { id: 'sow-sci', state: 'approved' },
      }),
    ]);
    assignMock.mockResolvedValue([mine('d1')]);
    const asked = {
      sow_id: 'sow-sci',
      week_number: 2,
      section_id: 'd1',
      kind: 'asked',
      remarks: '<p>Why delayed?</p>',
      created_at: '2026-10-20T04:00:00Z',
    };
    const open = await loadSowHome(
      fakeService(
        world({
          scheme_of_work_signoffs: [asked],
          scheme_of_work_checks: [check('d1', '2026-10-21T01:00:00Z')],
        })
      ),
      ME,
      TODAY
    );
    // Week 3 is checked, so the only to-do is the ask about week 2.
    expect(open.todos).toEqual([
      expect.objectContaining({
        kind: 'asked',
        text: 'Your subject head asked about Week 2 for Secondary 1 Discipline 1',
        href: '/classroom/sow/sow-sci',
      }),
    ]);

    const answered = await loadSowHome(
      fakeService(
        world({
          scheme_of_work_signoffs: [asked],
          scheme_of_work_checks: [
            check('d1', '2026-10-21T01:00:00Z'),
            check('d1', '2026-10-21T02:00:00Z', 2),
          ],
        })
      ),
      ME,
      TODAY
    );
    expect(answered.todos).toEqual([]);
  });

  it('orders to-dos returned, asked, check, start', async () => {
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
      sowRow({
        subjectId: 'mth',
        subjectName: 'Math',
        classes: [{ sectionId: 'm1', name: 'Consistency' }],
        sow: { id: 'sow-mth', state: 'returned' },
      }),
      sowRow({
        subjectId: 'eng',
        subjectName: 'English',
        classes: [{ sectionId: 'e1', name: 'Integrity 1' }],
        sow: null,
      }),
    ]);
    assignMock.mockResolvedValue([
      mine('d1'),
      mine('d2'),
      mine('m1', 'mth'),
      mine('e1', 'eng'),
    ]);
    const home = await loadSowHome(
      fakeService(
        world({
          schemes_of_work: [
            { id: 'sow-sci', state: 'approved', approved_snapshot: snapshot },
            { id: 'sow-mth', state: 'returned', approved_snapshot: null },
          ],
          scheme_of_work_signoffs: [
            {
              sow_id: 'sow-sci',
              week_number: 2,
              section_id: 'd1',
              kind: 'asked',
              remarks: 'Why?',
              created_at: '2026-10-20T04:00:00Z',
            },
          ],
        })
      ),
      ME,
      TODAY
    );
    expect(home.todos.map((t) => t.kind)).toEqual([
      'returned',
      'asked',
      'check',
      'start',
    ]);
  });

  it('shows no chip when the week has no plan (the topic line already says so)', async () => {
    rowsMock.mockResolvedValue([
      sowRow({
        classes: [{ sectionId: 'd1', name: 'Discipline 1' }],
        sow: { id: 'sow-sci', state: 'approved' },
      }),
    ]);
    assignMock.mockResolvedValue([mine('d1')]);
    // Week 2 is not in the approved plan.
    const home = await loadSowHome(fakeService(world()), ME, '2026-10-14');
    expect(home.lessons[0]).toMatchObject({
      topic: 'Nothing planned for this week',
      state: null,
    });
    expect(home.todos).toEqual([]);
  });

  it('is empty for someone who teaches nothing', async () => {
    rowsMock.mockResolvedValue([]);
    assignMock.mockResolvedValue([]);
    const home = await loadSowHome(fakeService(world()), ME, TODAY);
    expect(home).toEqual({ lessons: [], todos: [] });
  });

  it('runs no query at all when the passed assignments hold no subject seat', async () => {
    const formAdviser = {
      id: 'a-fa',
      teacher_user_id: ME,
      section_id: 'd1',
      subject_id: null,
      role: 'form_adviser',
      via: 'substantive',
    };
    const covering = mine('d2', 'sci', { via: 'relief' });
    for (const assignments of [[], [formAdviser], [covering]]) {
      const home = await loadSowHome(fakeService(world()), ME, TODAY, {
        assignments: assignments as never,
        ayId: 'ay',
      });
      expect(home).toEqual({ lessons: [], todos: [] });
    }
    expect(queries).toBe(0);
    expect(assignMock).not.toHaveBeenCalled();
    expect(rowsMock).not.toHaveBeenCalled();
    expect(weeksMock).not.toHaveBeenCalled();
  });

  it('passed assignments and year are not read again', async () => {
    rowsMock.mockResolvedValue([
      sowRow({ sow: { id: 'sow-sci', state: 'approved' } }),
    ]);
    await loadSowHome(fakeService(world()), ME, TODAY, {
      assignments: [mine('d1'), mine('d2')] as never,
      ayId: 'ay',
    });
    expect(assignMock).not.toHaveBeenCalled();
    // The rows loader is handed what the page holds, so it reads neither.
    expect(rowsMock).toHaveBeenCalledTimes(1);
    expect(rowsMock.mock.calls[0][3]).toMatchObject({ ayId: 'ay' });
    expect(weeksMock).toHaveBeenCalledTimes(1);
    // terms, schemes, checks, sign-offs: no academic_years read.
    expect(queries).toBe(4);
  });

  it('reads in a fixed number of queries however many classes there are', async () => {
    const run = async (n: number) => {
      const cls = Array.from({ length: n }, (_, i) => ({
        sectionId: `c${i}`,
        name: `Class ${i}`,
      }));
      queries = 0;
      assignMock.mockClear();
      rowsMock.mockReset();
      weeksMock.mockClear();
      rowsMock.mockResolvedValue([
        sowRow({ classes: cls, sow: { id: 'sow-sci', state: 'approved' } }),
      ]);
      await loadSowHome(fakeService(world()), ME, TODAY, {
        assignments: cls.map((c) => mine(c.sectionId)) as never,
        ayId: 'ay',
      });
      // Each mocked loader is called once however many classes there are, so
      // the table count below is the whole of the home's reads.
      expect(rowsMock).toHaveBeenCalledTimes(1);
      expect(weeksMock).toHaveBeenCalledTimes(1);
      return queries;
    };
    expect(await run(12)).toBe(await run(2));
  });
});
