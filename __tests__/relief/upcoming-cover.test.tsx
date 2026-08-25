import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UpcomingCoverPanel } from '@/components/relief/upcoming-cover';
import { loadUpcomingCoverForUser } from '@/lib/relief/upcoming';
import type { UpcomingCover } from '@/lib/relief/upcoming';

// The "you're covering" heads-up. Its whole job is to show a substitute a class
// they CANNOT open yet, so both halves of that have to hold: the class appears,
// and nothing about it reads or behaves as though access has been granted.

const TODAY = '2026-08-24';

function cover(over: Partial<UpcomingCover> = {}): UpcomingCover {
  return {
    assignmentId: 'a-1',
    sectionId: 'sec-1',
    sectionName: 'P4 Diligence',
    subjectName: 'Mathematics',
    role: 'subject_teacher',
    startedOn: '2026-09-03',
    endedOn: '2026-09-07',
    ...over,
  };
}

describe('the panel', () => {
  it('names the class and when it starts', () => {
    render(<UpcomingCoverPanel covers={[cover()]} />);
    expect(screen.getByText(/P4 Diligence · Mathematics/)).toBeInTheDocument();
    expect(screen.getByText(/covers from 3 Sep/)).toBeInTheDocument();
  });

  it('never says "covering" on its own', () => {
    // ⚠ The word is a claim about today. A teacher who reads it as today's
    // truth walks to a class that is not theirs yet.
    const { container } = render(<UpcomingCoverPanel covers={[cover()]} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/covers from/);
    // The heading is "You're covering", which is about them, not about a class
    // being live — every per-class line must still say "covers from".
    expect(text).not.toMatch(/Mathematics.*is covering/);
  });

  it('renders no links — a link would 403', () => {
    const { container } = render(
      <UpcomingCoverPanel covers={[cover(), cover({ assignmentId: 'a-2' })]} />
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('says a form-class cover is the form class, not a subject', () => {
    render(
      <UpcomingCoverPanel
        covers={[cover({ role: 'form_adviser', subjectName: null })]}
      />
    );
    expect(screen.getByText(/P4 Diligence · Form class/)).toBeInTheDocument();
  });

  it('disappears entirely when nothing is booked', () => {
    // Four pages carry this. An empty state on all four would be a permanent
    // box explaining an absence of news.
    const { container } = render(<UpcomingCoverPanel covers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the loader', () => {
  // A thin PostgREST stub: records the filters and returns whatever rows the
  // test hands it.
  function stub(rows: unknown[], error: { message: string } | null = null) {
    const calls: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => {
      calls[`eq:${col}`] = val;
      return q;
    };
    q.not = (col: string, op: string, val: unknown) => {
      calls[`not:${col}`] = `${op}:${val}`;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error }).then(resolve);
    return {
      client: { from: () => q } as never,
      calls,
    };
  }

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a-1',
    role: 'subject_teacher',
    relief_started_on: '2026-09-03',
    relief_ended_on: '2026-09-07',
    section: {
      id: 'sec-1',
      name: 'Diligence',
      academic_year_id: 'ay-1',
      level: { code: 'P4' },
    },
    subject: { name: 'Mathematics' },
    ...over,
  });

  it('asks only for rows that have a start date', async () => {
    // A cover with no start is already live — it belongs to the access loader,
    // not here.
    const { client, calls } = stub([]);
    await loadUpcomingCoverForUser(client, 'user-1');
    expect(calls['not:relief_started_on']).toBe('is:null');
    expect(calls['eq:relief_teacher_user_id']).toBe('user-1');
  });

  it('builds the section label the way staff say it', async () => {
    const { client } = stub([row()]);
    const out = await loadUpcomingCoverForUser(client, 'user-1');
    expect(out[0].sectionName).toBe('P4 Diligence');
  });

  it('drops anything already live, even if the query let it through', async () => {
    // ⚠ Belt and braces on purpose. If this ever returned a live cover the
    // teacher would see the same class twice — once as theirs to work on and
    // once as "starts later" — and believe the later one.
    vi.setSystemTime(new Date(`${TODAY}T02:00:00Z`));
    const { client } = stub([
      row({ id: 'live', relief_started_on: '2026-08-01' }),
      row({ id: 'future', relief_started_on: '2026-09-03' }),
    ]);
    const out = await loadUpcomingCoverForUser(client, 'user-1');
    expect(out.map((c) => c.assignmentId)).toEqual(['future']);
    vi.useRealTimers();
  });

  it('drops one whose window has already passed', async () => {
    vi.setSystemTime(new Date(`${TODAY}T02:00:00Z`));
    const { client } = stub([
      row({
        id: 'gone',
        relief_started_on: '2026-08-01',
        relief_ended_on: '2026-08-05',
      }),
    ]);
    expect(await loadUpcomingCoverForUser(client, 'user-1')).toEqual([]);
    vi.useRealTimers();
  });

  it('sorts soonest first', async () => {
    const { client } = stub([
      row({ id: 'later', relief_started_on: '2026-10-01' }),
      row({ id: 'sooner', relief_started_on: '2026-09-03' }),
    ]);
    const out = await loadUpcomingCoverForUser(client, 'user-1');
    expect(out.map((c) => c.assignmentId)).toEqual(['sooner', 'later']);
  });

  it('returns nothing rather than throwing when the read fails', async () => {
    // This sits on four pages including the one most roles land on. A failed
    // convenience read must never 500 someone's home page.
    const { client } = stub([], { message: 'boom' });
    expect(await loadUpcomingCoverForUser(client, 'user-1')).toEqual([]);
  });
});
