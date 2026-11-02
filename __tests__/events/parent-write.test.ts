import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let writes = 0;
let failTable: string | null = null;
let email = 'Mum@Example.com';

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
  let pending: Row[] | null = null;
  const b = {
    select: () => b,
    eq: (c: string, v: unknown) => {
      rows = rows.filter((r) => r[c] === v);
      return b;
    },
    in: (c: string, vs: unknown[]) => {
      rows = rows.filter((r) => vs.includes(r[c]));
      return b;
    },
    upsert: (input: Row | Row[], opts: { onConflict: string }) => {
      writes += 1;
      const list = Array.isArray(input) ? input : [input];
      const keys = opts.onConflict.split(',');
      const stored: Row[] = [];
      db[table] ??= [];
      for (const row of list) {
        const at = db[table].findIndex((r) =>
          keys.every((k) => r[k] === row[k])
        );
        if (at >= 0) {
          db[table][at] = { ...db[table][at], ...row };
          stored.push(db[table][at]);
        } else {
          const made = { id: `${table}-${db[table].length + 1}`, ...row };
          db[table].push(made);
          stored.push(made);
        }
      }
      pending = stored;
      return b;
    },
    single: () =>
      Promise.resolve(
        failTable === table
          ? { data: null, error: { message: 'boom' } }
          : { data: (pending ?? rows)[0] ?? null, error: null }
      ),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(
        failTable === table
          ? { data: null, error: { message: 'boom' } }
          : { data: pending ?? rows, error: null }
      ).then(res),
  };
  return b;
}

const CHILDREN = [
  {
    studentNumber: 'H1',
    studentId: 'stu-1',
    sectionStudentId: 'ss-1',
    sectionId: 'sec-p3',
    academicYearId: 'ay-now',
    displayName: 'Ana Reyes',
    levelCode: 'P3',
    levelType: 'primary',
    sectionName: 'Diligence',
  },
  {
    studentNumber: 'H2',
    studentId: 'stu-2',
    sectionStudentId: 'ss-2',
    sectionId: 'sec-p5',
    academicYearId: 'ay-now',
    displayName: 'Ben Reyes',
    levelCode: 'P5',
    levelType: 'primary',
    sectionName: 'Honesty',
  },
];

vi.mock('@/lib/declarations/parent', () => ({
  loadFilableStudents: () => Promise.resolve(CHILDREN),
}));
vi.mock('@/lib/supabase/admissions', () => ({
  getAllStudentsByParentEmail: () =>
    Promise.resolve([{ student_number: 'H1' }, { student_number: 'H2' }]),
  createAdmissionsClient: () => ({ from: builder }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'u1', email } }, error: null }),
    },
    from: builder,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => ({ limited: false }),
  userRateLimit: () => ({ limited: false }),
  tooManyRequests: vi.fn(),
}));
vi.mock('@/lib/cors', () => ({ corsHeaders: () => ({ 'x-cors': '1' }) }));
const logAction = vi.fn();
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (p: unknown) => logAction(p),
}));

import { PUT } from '@/app/api/parent/v2/events/[slug]/registration/route';

const q = (id: string, over: Row = {}): Row => ({
  id,
  type: 'short',
  label: id,
  help: '',
  required: false,
  imageUrl: null,
  choices: [],
  allowOther: false,
  agreement: '',
  showWhen: null,
  ...over,
});

function event(over: Row = {}): Row {
  return {
    id: 'e1',
    academic_year_id: 'ay-now',
    slug: 'trip',
    title: 'Trip',
    description: '',
    starts_on: '2999-01-01',
    ends_on: null,
    time_label: '',
    venue: '',
    audience: 'all',
    levels: [],
    section_ids: [],
    answer_mode: 'consent',
    opens_at: '2020-01-01T00:00:00Z',
    closes_at: '2998-01-01T00:00:00Z',
    form: {
      sections: [
        {
          id: 's-child',
          title: '',
          description: '',
          scope: 'child',
          allowingOnly: true,
          questions: [q('diet', { required: true })],
        },
        {
          id: 's-fam',
          title: '',
          description: '',
          scope: 'family',
          allowingOnly: false,
          questions: [
            q('contact', { required: true }),
            q('sig', { type: 'signature', required: true }),
          ],
        },
      ],
    },
    published_at: '2020-01-01T00:00:00Z',
    closed_early_at: null,
    ...over,
  };
}

const goodBody = (): Row => ({
  parentName: 'Mum Reyes',
  parentPhone: '91234567',
  children: [
    { studentNumber: 'H1', consent: 'allowing', answers: { diet: 'none' } },
    {
      studentNumber: 'H2',
      consent: 'not_allowing',
      reason: 'Away',
      answers: {},
    },
  ],
  familyAnswers: { contact: 'Mum' },
  signatureName: 'Mum Reyes',
});

function put(body: unknown, slug = 'trip') {
  return PUT(
    new Request('http://x/api/parent/v2/events/trip/registration', {
      method: 'PUT',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) }
  );
}

beforeEach(() => {
  writes = 0;
  failTable = null;
  email = 'Mum@Example.com';
  logAction.mockReset();
  db.parent_events = [event()];
  db.parent_event_submissions = [];
  db.parent_event_registrations = [];
  db.academic_years = [{ id: 'ay-now', ay_code: 'AY2027', is_current: true }];
  db.students = [];
});

describe('PUT /api/parent/v2/events/[slug]/registration', () => {
  it('writes one submission and a row per child, and audits counts only', async () => {
    const res = await put(goodBody());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cors')).toBe('1');
    expect((await res.json()).savedAt).toBeTruthy();
    expect(db.parent_event_submissions).toHaveLength(1);
    expect(db.parent_event_submissions[0].parent_email).toBe('mum@example.com');
    expect(db.parent_event_submissions[0].signed_at).toBeTruthy();
    const regs = db.parent_event_registrations;
    expect(regs).toHaveLength(2);
    const h1 = regs.find((r) => r.student_id === 'stu-1');
    const h2 = regs.find((r) => r.student_id === 'stu-2');
    expect(h1).toMatchObject({
      status: 'registered',
      section_id: 'sec-p3',
      answers: { diet: 'none' },
    });
    expect(h2).toMatchObject({
      status: 'not_joining',
      not_joining_reason: 'Away',
      answers: {},
    });
    expect(logAction).toHaveBeenCalledOnce();
    const call = logAction.mock.calls[0][0];
    expect(call.action).toBe('parent_event.register');
    expect(call.context).toEqual({ children: 2, registered: 1, notJoining: 1 });
  });

  it('a second parent updates the same child row and points it at their submission', async () => {
    await put(goodBody());
    email = 'Dad@Example.com';
    const second = goodBody();
    (second.children as Row[])[1] = {
      studentNumber: 'H2',
      consent: 'allowing',
      answers: { diet: 'nuts' },
    };
    expect((await put(second)).status).toBe(200);
    expect(db.parent_event_submissions).toHaveLength(2);
    expect(db.parent_event_registrations).toHaveLength(2);
    const h2 = db.parent_event_registrations.find(
      (r) => r.student_id === 'stu-2'
    );
    expect(h2).toMatchObject({ status: 'registered' });
    const dad = db.parent_event_submissions.find(
      (s) => s.parent_email === 'dad@example.com'
    );
    expect(h2?.submission_id).toBe(dad?.id);
  });

  it('409 and no writes once registration has closed', async () => {
    db.parent_events = [event({ closes_at: '2021-01-01T00:00:00Z' })];
    const res = await put(goodBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'Registration for this event has closed.'
    );
    expect(writes).toBe(0);
  });

  it('409 with the opening date, and no writes, before registration opens', async () => {
    db.parent_events = [event({ opens_at: '2997-11-05T09:00:00Z' })];
    const res = await put(goodBody());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'Registration for this event opens on Sun 5 Nov, 5:00 pm.'
    );
    expect(writes).toBe(0);
  });

  it('400 when a consent event not-allowing child has no reason', async () => {
    const body = goodBody();
    (body.children as Row[])[1] = {
      studentNumber: 'H2',
      consent: 'not_allowing',
      answers: {},
    };
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).errors['H2.reason']).toBeTruthy();
    expect(writes).toBe(0);
  });

  it("403 for a studentNumber that is not this parent's", async () => {
    const body = goodBody();
    (body.children as Row[])[1] = {
      studentNumber: 'X9',
      consent: 'allowing',
      answers: {},
    };
    const res = await put(body);
    expect(res.status).toBe(403);
    expect(writes).toBe(0);
  });

  it('400 when a required family question is missing', async () => {
    const body = goodBody();
    body.familyAnswers = {};
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.contact).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('400 when a currently eligible child is left out', async () => {
    const body = goodBody();
    (body.children as Row[]).pop();
    expect((await put(body)).status).toBe(400);
    expect(writes).toBe(0);
  });

  it('register event: an unticked child needs no reason', async () => {
    db.parent_events = [event({ answer_mode: 'register' })];
    const body = goodBody();
    (body.children as Row[])[1] = {
      studentNumber: 'H2',
      consent: 'not_allowing',
      answers: {},
    };
    const res = await put(body);
    expect(res.status).toBe(200);
    const h2 = db.parent_event_registrations.find(
      (r) => r.student_id === 'stu-2'
    );
    expect(h2).toMatchObject({
      status: 'not_joining',
      not_joining_reason: null,
    });
  });

  it('drops answers to hidden questions before storing', async () => {
    const e = event();
    const form = e.form as { sections: Array<{ questions: Row[] }> };
    form.sections[0].questions.push(
      q('allergy', { showWhen: { questionId: 'diet', equals: 'allergic' } })
    );
    db.parent_events = [e];
    const body = goodBody();
    (body.children as Row[])[0] = {
      studentNumber: 'H1',
      consent: 'allowing',
      answers: { diet: 'none', allergy: 'peanuts' },
    };
    expect((await put(body)).status).toBe(200);
    const h1 = db.parent_event_registrations.find(
      (r) => r.student_id === 'stu-1'
    );
    expect(h1?.answers).toEqual({ diet: 'none' });
  });

  it('every child not joining: no family answers or signature needed, none stored', async () => {
    const body = goodBody();
    body.children = [
      {
        studentNumber: 'H1',
        consent: 'not_allowing',
        reason: 'Ill',
        answers: {},
      },
      {
        studentNumber: 'H2',
        consent: 'not_allowing',
        reason: 'Away',
        answers: {},
      },
    ];
    body.familyAnswers = { contact: 'ignored' };
    delete body.signatureName;
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(db.parent_event_submissions[0]).toMatchObject({
      family_answers: {},
      signature_name: null,
      signed_at: null,
    });
  });

  it('one child registered: the signature is still required', async () => {
    const body = goodBody();
    delete body.signatureName;
    const res = await put(body);
    expect(res.status).toBe(400);
    expect((await res.json()).errors.sig).toBeTruthy();
    expect(writes).toBe(0);
  });

  it('400 when a child is linked but no longer eligible for the event', async () => {
    db.parent_events = [event({ audience: 'primary', levels: ['P3'] })];
    const res = await put(goodBody());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'One of the children can no longer be registered for this event.'
    );
    expect(writes).toBe(0);
  });

  it('signed_at is kept when the signature is unchanged', async () => {
    await put(goodBody());
    db.parent_event_submissions[0].signed_at = '2020-05-05T00:00:00.000Z';
    expect((await put(goodBody())).status).toBe(200);
    expect(db.parent_event_submissions[0].signed_at).toBe(
      '2020-05-05T00:00:00.000Z'
    );
  });

  it('a database failure still answers 500 with CORS headers', async () => {
    failTable = 'parent_event_submissions';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await put(goodBody());
    expect(res.status).toBe(500);
    expect(res.headers.get('x-cors')).toBe('1');
    expect((await res.json()).error).toBe(
      'Something went wrong. Please try again.'
    );
  });
});
