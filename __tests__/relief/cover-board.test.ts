import { beforeEach, describe, expect, it, vi } from 'vitest';

// The board reads with the service client and resolves names through the staff
// list, so both are stubbed — this suite is about the GROUPING and the DATE
// ARITHMETIC, which is where the bug was.

const rows: unknown[] = [];
let readError: { message: string } | null = null;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.not = () => q;
      q.eq = () => q;
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: readError }).then(resolve);
      return q;
    },
  }),
}));

vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: async () => [
    ['t-away', 'Marrie Juni'],
    ['t-sub', 'Jenny Wong'],
    ['t-other', 'R. Fernandez'],
  ],
}));

import { getCoverBoard } from '@/lib/relief/cover-board';

const TODAY = '2026-08-25';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    teacher_user_id: 't-away',
    relief_teacher_user_id: 't-sub',
    role: 'subject_teacher',
    relief_started_on: '2026-08-24',
    relief_ended_on: '2026-08-28',
    section: { id: 'sec-1', name: 'Respect', level: { code: 'P1' } },
    subject: { name: 'MAPEH' },
    ...over,
  };
}

beforeEach(() => {
  rows.length = 0;
  readError = null;
});

describe('a cover that has finished', () => {
  // ⚠ THE REGRESSION. `Date.UTC` takes a zero-indexed month; the cutoff was
  // built by passing the real month number, which pushed it a MONTH into the
  // future. Every ended cover then tested as older than the cutoff and was
  // dropped — so a one-day cover vanished from the page entirely: not active,
  // not scheduled, not recently ended. Mr Ace found it in the browser.
  it('shows a single-day cover that ended yesterday', async () => {
    rows.push(
      row({ relief_started_on: '2026-08-24', relief_ended_on: '2026-08-24' })
    );

    const board = await getCoverBoard('ay-1', TODAY);

    expect(board.recentlyEnded).toHaveLength(1);
    expect(board.active).toHaveLength(0);
    expect(board.scheduled).toHaveLength(0);
    expect(board.recentlyEnded[0].coveredTeacherName).toBe('Marrie Juni');
  });

  it('keeps one that ended exactly 30 days ago', async () => {
    rows.push(
      row({ relief_started_on: '2026-07-20', relief_ended_on: '2026-07-26' })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.recentlyEnded).toHaveLength(1);
  });

  it('drops one that ended before the window', async () => {
    rows.push(
      row({ relief_started_on: '2026-06-01', relief_ended_on: '2026-06-05' })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.recentlyEnded).toHaveLength(0);
  });
});

describe('which group a cover lands in', () => {
  it('active when today sits inside the window', async () => {
    rows.push(row());
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active).toHaveLength(1);
  });

  it('active for an open-ended cover with no dates at all', async () => {
    rows.push(row({ relief_started_on: null, relief_ended_on: null }));
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active).toHaveLength(1);
    expect(board.active[0].endsInDays).toBeNull();
  });

  it('scheduled when the start has not arrived', async () => {
    rows.push(
      row({ relief_started_on: '2026-09-01', relief_ended_on: '2026-09-05' })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.scheduled).toHaveLength(1);
    expect(board.active).toHaveLength(0);
  });
});

describe('the lapse countdown', () => {
  it('counts the days left, inclusive of the last day', async () => {
    rows.push(
      row({ relief_started_on: '2026-08-24', relief_ended_on: '2026-08-28' })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active[0].endsInDays).toBe(3);
  });

  it('is 0 on the last day', async () => {
    rows.push(row({ relief_started_on: '2026-08-24', relief_ended_on: TODAY }));
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active[0].endsInDays).toBe(0);
  });

  it('counts correctly ACROSS a month boundary', async () => {
    // The same zero-indexed-month bug made this wrong by a day whenever the
    // window crossed into a month of a different length, because the two dates
    // shifted by unequal amounts.
    rows.push(
      row({ relief_started_on: '2026-08-24', relief_ended_on: '2026-09-02' })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active[0].endsInDays).toBe(8);
  });
});

describe('grouping', () => {
  it('puts one teacher’s classes under ONE absence', async () => {
    // The design decision worth protecting: cover is arranged per absence, not
    // per class, so two classes covered by the same person over the same window
    // are one row.
    rows.push(row({ id: 'a-1', subject: { name: 'MAPEH' } }));
    rows.push(row({ id: 'a-2', subject: { name: 'Filipino' } }));

    const board = await getCoverBoard('ay-1', TODAY);

    expect(board.active).toHaveLength(1);
    expect(board.active[0].classes).toHaveLength(2);
    expect(board.active[0].classes.map((c) => c.label)).toEqual([
      'P1 Respect · Filipino',
      'P1 Respect · MAPEH',
    ]);
  });

  it('splits two absences with different windows', async () => {
    rows.push(row({ id: 'a-1' }));
    rows.push(
      row({
        id: 'a-2',
        relief_started_on: '2026-09-01',
        relief_ended_on: '2026-09-05',
      })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active).toHaveLength(1);
    expect(board.scheduled).toHaveLength(1);
  });

  it('labels a form-class cover as the form class', async () => {
    rows.push(row({ role: 'form_adviser', subject: null }));
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active[0].classes[0].label).toBe('P1 Respect · Form class');
  });

  it('sorts active by what lapses soonest', async () => {
    rows.push(row({ id: 'later', relief_ended_on: '2026-09-10' }));
    rows.push(
      row({
        id: 'sooner',
        teacher_user_id: 't-other',
        relief_ended_on: '2026-08-26',
      })
    );
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board.active[0].coveredTeacherName).toBe('R. Fernandez');
  });
});

describe('when the read fails', () => {
  it('returns three empty groups rather than throwing', async () => {
    readError = { message: 'boom' };
    const board = await getCoverBoard('ay-1', TODAY);
    expect(board).toEqual({ active: [], scheduled: [], recentlyEnded: [] });
  });
});
