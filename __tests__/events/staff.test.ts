import { describe, expect, it } from 'vitest';

import { loadEventDetail, loadEventList } from '@/lib/events/staff';

type Tables = Record<string, unknown[]>;

// Chainable stand-in: every filter is a no-op (the fixtures hold only what the
// real query would return); the terminal call yields the table rows.
function mockService(tables: Tables) {
  const make = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    let window: [number, number] | null = null;
    for (const m of ['select', 'eq', 'neq', 'in', 'order']) q[m] = chain;
    q.range = (from: number, to: number) => {
      window = [from, to];
      return q;
    };
    q.maybeSingle = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({
        data: window ? rows.slice(window[0], window[1] + 1) : rows,
        error: null,
      }).then(res);
    return q;
  };
  return { from: (t: string) => make(tables[t] ?? []) } as never;
}

const NOW = new Date('2026-11-01T00:00:00Z');
const form = {
  sections: [
    {
      id: 's1',
      title: 'Kid',
      description: '',
      scope: 'child',
      allowingOnly: false,
      questions: [
        {
          id: 'q1',
          type: 'short',
          label: 'Allergies',
          help: '',
          required: false,
          imageUrl: null,
          choices: [],
          allowOther: false,
          agreement: '',
          showWhen: null,
        },
      ],
    },
  ],
};
const eventRow = (over: Record<string, unknown> = {}) => ({
  id: 'ev1',
  academic_year_id: 'ay1',
  slug: 'trip',
  title: 'Trip',
  description: '',
  starts_on: '2026-11-05',
  ends_on: null,
  time_label: '',
  venue: '',
  audience: 'all',
  levels: [],
  section_ids: [],
  answer_mode: 'register',
  opens_at: '2026-10-01T00:00:00Z',
  closes_at: '2026-11-04T00:00:00Z',
  form,
  published_at: '2026-10-01T00:00:00Z',
  closed_early_at: null,
  ...over,
});
const child = (id: string, level: string, name: string) => ({
  student_id: id,
  section_id: `sec-${level}`,
  students: { student_number: `H${id}`, first_name: name, last_name: 'X' },
  sections: {
    id: `sec-${level}`,
    name: `Class ${level}`,
    levels: { code: level },
  },
});
const reg = (id: string, status: string, answers = {}) => ({
  submission_id: 'sub1',
  student_id: id,
  section_id: 'sec-P4',
  status,
  not_joining_reason: status === 'not_joining' ? 'Away' : null,
  answers,
  updated_at: '2026-10-20T00:00:00Z',
  students: { student_number: `H${id}`, first_name: id, last_name: 'X' },
  sections: { name: 'Class P4' },
});
const sub = {
  id: 'sub1',
  parent_email: 'p@x.com',
  parent_name: 'Pat',
  parent_phone: '9123',
  family_answers: {},
};

describe('loadEventList', () => {
  it('counts registered, not joining and eligible', async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [
        { event_id: 'ev1', status: 'registered' },
        { event_id: 'ev1', status: 'registered' },
        { event_id: 'ev1', status: 'not_joining' },
      ],
      section_students: [
        child('a', 'P4', 'A'),
        child('b', 'P4', 'B'),
        child('c', 'P5', 'C'),
      ],
    });
    const [row] = await loadEventList(svc, 'ay1', NOW);
    expect(row).toMatchObject({
      registered: 2,
      notJoining: 1,
      eligible: 3,
      status: 'open',
      scopeLabel: 'Whole school',
    });
  });
});

describe('paging past the 1000-row cap', () => {
  it('counts every page of enrolments and registrations', async () => {
    const kids = Array.from({ length: 1001 }, (_, i) =>
      child(`k${i}`, 'P4', `K${i}`)
    );
    const regs = Array.from({ length: 1001 }, () => ({
      event_id: 'ev1',
      status: 'registered',
    }));
    const [row] = await loadEventList(
      mockService({
        parent_events: [eventRow()],
        parent_event_registrations: regs,
        section_students: kids,
      }),
      'ay1',
      NOW
    );
    expect(row.eligible).toBe(1001);
    expect(row.registered).toBe(1001);
  });
});

describe('loadEventDetail', () => {
  it('lists unanswered eligible children as not registered', async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [
        reg('a', 'registered'),
        reg('b', 'not_joining'),
      ],
      parent_event_submissions: [sub],
      section_students: [
        child('a', 'P4', 'A'),
        child('b', 'P4', 'B'),
        child('c', 'P4', 'C'),
      ],
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered.map((r) => r.studentNumber)).toEqual(['Ha']);
    expect(d!.notJoining[0].reason).toBe('Away');
    expect(d!.notRegistered.map((r) => r.studentNumber)).toEqual(['Hc']);
    expect(d!.families).toBe(1);
    expect(d!.registered[0].registeredBy).toEqual({
      name: 'Pat',
      email: 'p@x.com',
    });
    expect(d!.registered[0].handphone).toBe('9123');
  });

  it('keeps a registered child who has since withdrawn', async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [reg('w', 'registered')],
      parent_event_submissions: [sub],
      section_students: [child('c', 'P4', 'C')], // w is no longer enrolled
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered).toHaveLength(1);
    expect(d!.registered[0].className).toBe('Class P4');
    expect(d!.notRegistered.map((r) => r.studentNumber)).toEqual(['Hc']);
  });

  it('after narrowing, a registered P5 child stays and an unregistered P5 child leaves', async () => {
    const svc = mockService({
      parent_events: [eventRow({ audience: 'primary', levels: ['P4'] })],
      parent_event_registrations: [reg('r5', 'registered')],
      parent_event_submissions: [sub],
      section_students: [
        child('r5', 'P5', 'R5'),
        child('u5', 'P5', 'U5'),
        child('u4', 'P4', 'U4'),
      ],
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered).toHaveLength(1);
    expect(d!.notRegistered.map((r) => r.studentNumber)).toEqual(['Hu4']);
    expect(d!.eligible).toBe(1);
  });

  it('prunes answers for a question that was deleted', async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [
        reg('a', 'registered', { q1: 'nuts', gone: 'x' }),
      ],
      parent_event_submissions: [sub],
      section_students: [],
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered[0].answers).toEqual({ q1: 'nuts' });
  });

  it("carries the parent's signature from their submission", async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [reg('a', 'registered')],
      parent_event_submissions: [
        {
          ...sub,
          signature_name: 'Pat X',
          signed_at: '2026-10-27T12:14:00Z',
        },
      ],
      section_students: [],
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered[0].signature).toEqual({
      name: 'Pat X',
      signedAt: '2026-10-27T12:14:00Z',
    });
  });

  it('has no signature when the parent did not sign', async () => {
    const svc = mockService({
      parent_events: [eventRow()],
      parent_event_registrations: [reg('a', 'registered')],
      parent_event_submissions: [
        { ...sub, signature_name: null, signed_at: null },
      ],
      section_students: [],
    });
    const d = await loadEventDetail(svc, 'ev1', NOW);
    expect(d!.registered[0].signature).toBeNull();
  });

  it('returns null for an unknown event', async () => {
    expect(await loadEventDetail(mockService({}), 'nope', NOW)).toBeNull();
  });
});
