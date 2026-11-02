import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const token: string | null = 'tok';

function builder(table: string) {
  let rows = [...(db[table] ?? [])];
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
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(res),
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
let filable = CHILDREN;

vi.mock('@/lib/declarations/parent', () => ({
  loadFilableStudents: () => Promise.resolve(filable),
}));
vi.mock('@/lib/supabase/admissions', () => ({
  getAllStudentsByParentEmail: () =>
    Promise.resolve([{ student_number: 'H1' }, { student_number: 'H2' }]),
  createAdmissionsClient: () => ({ from: builder }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      getUser: (t: string) =>
        Promise.resolve(
          t === 'tok'
            ? {
                data: { user: { id: 'u1', email: 'Mum@Example.com' } },
                error: null,
              }
            : { data: { user: null }, error: { message: 'bad' } }
        ),
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
vi.mock('@/lib/cors', () => ({ corsHeaders: () => ({}) }));

import { GET as listGET } from '@/app/api/parent/v2/events/route';
import { GET as oneGET } from '@/app/api/parent/v2/events/[slug]/route';

const FAR = '2999-01-01';
function event(over: Row): Row {
  return {
    id: 'e1',
    academic_year_id: 'ay-now',
    slug: 'trip',
    title: 'Trip',
    description: 'd',
    starts_on: FAR,
    ends_on: null,
    time_label: '',
    venue: '',
    audience: 'all',
    levels: [],
    section_ids: [],
    answer_mode: 'register',
    opens_at: '2020-01-01T00:00:00Z',
    closes_at: '2998-01-01T00:00:00Z',
    form: { sections: [] },
    published_at: '2020-01-01T00:00:00Z',
    closed_early_at: null,
    ...over,
  };
}

function req(url: string, auth = true) {
  return new Request(url, {
    headers: auth && token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  filable = CHILDREN;
  db.academic_years = [
    { id: 'ay-now', ay_code: 'AY2027', is_current: true },
    { id: 'ay-old', ay_code: 'AY2026', is_current: false },
  ];
  db.students = [];
  db.sections = [];
  db.parent_event_registrations = [];
  db.parent_event_submissions = [];
  db.parent_events = [];
  db.ay2027_enrolment_applications = [];
});

describe('GET /api/parent/v2/events', () => {
  it('401 without a Bearer token', async () => {
    const res = await listGET(req('http://x/api/parent/v2/events', false));
    expect(res.status).toBe(401);
  });

  it('hides unpublished events', async () => {
    db.parent_events = [event({ published_at: null })];
    const body = await (
      await listGET(req('http://x/api/parent/v2/events'))
    ).json();
    expect(body.open).toEqual([]);
  });

  it('an event for P3 lists only the P3 child', async () => {
    db.parent_events = [event({ audience: 'primary', levels: ['P3'] })];
    const body = await (
      await listGET(req('http://x/api/parent/v2/events'))
    ).json();
    expect(body.open).toHaveLength(1);
    expect(body.open[0].children).toEqual([
      { studentNumber: 'H1', name: 'Ana Reyes', status: 'not_registered' },
    ]);
    expect(body.open[0].canRegister).toBe(true);
  });

  it('a withdrawn child (not in the filable list) is never offered', async () => {
    filable = [CHILDREN[1]];
    db.parent_events = [event({ audience: 'primary', levels: ['P3'] })];
    const body = await (
      await listGET(req('http://x/api/parent/v2/events'))
    ).json();
    expect(body.open).toEqual([]);
  });

  it('mine keeps a closed event the family answered', async () => {
    db.parent_events = [
      event({
        closes_at: '2021-01-01T00:00:00Z',
        opens_at: '2020-06-01T00:00:00Z',
      }),
    ];
    db.parent_event_registrations = [
      {
        event_id: 'e1',
        student_id: 'stu-1',
        section_id: 'sec-p3',
        status: 'registered',
        not_joining_reason: null,
        answers: {},
      },
    ];
    const body = await (
      await listGET(req('http://x/api/parent/v2/events'))
    ).json();
    expect(body.open).toEqual([]);
    expect(body.mine).toHaveLength(1);
    expect(body.mine[0].canRegister).toBe(false);
    expect(
      body.mine[0].children.map((c: Row) => [c.studentNumber, c.status])
    ).toEqual([
      ['H1', 'registered'],
      ['H2', 'not_registered'],
    ]);
    expect(body.academicYears).toEqual(['AY2027']);
    expect(body.currentAy).toBe('AY2027');
  });
});

describe('GET /api/parent/v2/events/[slug]', () => {
  const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

  it('404 for an unknown slug', async () => {
    const res = await oneGET(req('http://x/e/nope'), ctx('nope'));
    expect(res.status).toBe(404);
  });

  it('404 when unpublished', async () => {
    db.parent_events = [event({ published_at: null })];
    const res = await oneGET(req('http://x/e/trip'), ctx('trip'));
    expect(res.status).toBe(404);
  });

  it('404 when it is not for any of their children', async () => {
    db.parent_events = [event({ audience: 'secondary' })];
    const res = await oneGET(req('http://x/e/trip'), ctx('trip'));
    expect(res.status).toBe(404);
  });

  it('401 without a Bearer token', async () => {
    const res = await oneGET(req('http://x/e/trip', false), ctx('trip'));
    expect(res.status).toBe(401);
  });

  it('returns the form, answers and a prefill from the application', async () => {
    db.parent_events = [event({})];
    db.parent_event_submissions = [
      {
        event_id: 'e1',
        parent_email: 'mum@example.com',
        parent_name: 'Mum R',
        parent_phone: '9111',
        family_answers: {},
        signature_name: null,
        signed_at: null,
      },
    ];
    db.ay2027_enrolment_applications = [
      {
        studentNumber: 'H1',
        motherEmail: 'MUM@example.com',
        motherFullName: 'Maria Reyes',
        // The mobile columns are bigint, so they arrive as numbers.
        motherMobile: 81234567,
        fatherEmail: 'dad@example.com',
        fatherFullName: 'Dan Reyes',
        fatherMobile: 80000000,
      },
    ];
    const res = await oneGET(req('http://x/e/trip'), ctx('trip'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.event.slug).toBe('trip');
    expect(body.children.map((c: Row) => c.studentNumber)).toEqual([
      'H1',
      'H2',
    ]);
    expect(body.submission.parentName).toBe('Mum R');
    expect(body.prefill).toEqual({
      parentName: 'Maria Reyes',
      parentPhone: '81234567',
    });
    expect(body.children.map((c: Row) => c.canRegister)).toEqual([true, true]);
  });

  it('prefills a guardian who signs in, not only a mother or father', async () => {
    db.parent_events = [event({})];
    db.ay2027_enrolment_applications = [
      {
        studentNumber: 'H1',
        motherEmail: 'other@example.com',
        motherFullName: 'Someone Else',
        motherMobile: 81111111,
        guardianEmail: 'mum@example.com',
        guardianFullName: 'Gina Reyes',
        guardianMobile: 82222222,
      },
    ];
    const res = await oneGET(req('http://x/e/trip'), ctx('trip'));
    expect((await res.json()).prefill).toEqual({
      parentName: 'Gina Reyes',
      parentPhone: '82222222',
    });
  });

  it('a child who answered but is no longer eligible is shown with canRegister false', async () => {
    db.parent_events = [event({ audience: 'primary', levels: ['P3'] })];
    db.parent_event_registrations = [
      {
        event_id: 'e1',
        student_id: 'stu-2',
        section_id: 'sec-p5',
        status: 'registered',
        not_joining_reason: null,
        answers: {},
      },
    ];
    const res = await oneGET(req('http://x/e/trip'), ctx('trip'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.children.map((c: Row) => [c.studentNumber, c.canRegister])
    ).toEqual([
      ['H1', true],
      ['H2', false],
    ]);
    expect(body.registrations.H2.status).toBe('registered');
  });
});
