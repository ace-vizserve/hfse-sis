/**
 * POST /api/teacher-assignments — staffing a whole year in one save.
 *
 * Staffing AY2026 is roughly 200 assignments. One HTTP request each is the
 * bottleneck the bulk shape exists to remove, and the thing that makes bulk
 * worth having is that it CANNOT half-succeed: one insert, one statement, all
 * or nothing. These tests pin that, the two duplicate rules that would
 * otherwise surface as a database index name, and the single-assignment shape
 * the two existing screens send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'actor-1', email: 'coordinator@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'actor-1', email: 'coordinator@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

type LoggedAction = { entityId: string; context: Record<string, unknown> };
const logActionMock = vi.fn(async (_entry: LoggedAction) => undefined);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: LoggedAction) => logActionMock(entry),
  // The route writes the batch's audit rows with `logActions` (plural), which
  // runs them under one Promise.all instead of awaiting 200 inserts in a row.
  // Forwarded row-by-row here so the assertions below still read one call per
  // assignment, which is the property that matters.
  logActions: (
    _service: unknown,
    _actor: unknown,
    rows: LoggedAction[]
  ): Promise<void> =>
    Promise.all(rows.map((row) => logActionMock(row))).then(() => undefined),
}));

const invalidateMock = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...args: unknown[]) => invalidateMock(...args),
}));

// The staff accounts that exist. PARENT_ACCOUNT is deliberately absent from
// the list below: it stands in for the ~1,000 parent portal uuids that share
// this Supabase project and that this check exists to keep out.
const TEACHER_A = '11111111-1111-4111-8111-111111111111';
const TEACHER_B = '22222222-2222-4222-8222-222222222222';
// A real teacher whose account has been disabled — still assignable on purpose,
// see the `excludeDisabled: false` test at the bottom of this file.
const TEACHER_DISABLED = '33333333-3333-4333-8333-333333333333';
// A school_admin who also teaches. Six real accounts look exactly like this in
// AY2026 and four of them are a form adviser of record; until this phase the
// route refused them and their rows could only be written in SQL.
const TEACHING_ADMIN = '44444444-4444-4444-8444-444444444444';
const PARENT_ACCOUNT = '99999999-9999-4999-8999-999999999999';

const SECTION_1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const SECTION_2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const MATHS = 'cccccccc-3333-4333-8333-333333333333';
const ENGLISH = 'dddddddd-4444-4444-8444-444444444444';

/** Distinct, well-formed uuids for the large-batch test. */
const seqId = (n: number) =>
  `0000${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`;

// Everyone `getTeacherList()` would return: every account holding a
// staff role, of any kind. The teaching admin is in here and the parent is not
// — which is the whole shape of the rule the route enforces.
const ALL_ASSIGNABLE_ACCOUNTS = [
  { id: TEACHER_A, email: 'a@hfse.test', name: 'Ms Tan', disabled: false },
  { id: TEACHER_B, email: 'b@hfse.test', name: 'Mr Lim', disabled: false },
  {
    id: TEACHER_DISABLED,
    email: 'gone@hfse.test',
    name: 'Mrs Ong',
    disabled: true,
  },
  {
    id: TEACHING_ADMIN,
    email: 'kohsuat.hoon@hfse.test',
    name: 'Ms Koh',
    disabled: false,
  },
];

// Honours `excludeDisabled` the way the real helper does, so the route's choice
// of argument is a behaviour the tests can see rather than a call signature.
const getTeacherListMock = vi.fn(
  async (options: { excludeDisabled?: boolean } = {}) => {
    const excludeDisabled = options.excludeDisabled ?? true;
    return ALL_ASSIGNABLE_ACCOUNTS.filter(
      (t) => !excludeDisabled || !t.disabled
    );
  }
);

// `getTeacherList` is still exported by the real module and still means
// "role === 'teacher'". It is mocked here to THROW: the route must not reach
// for it, and a silent fallback to a narrower list would let the teaching
// admin be refused again with every other assertion still green.
vi.mock('@/lib/auth/staff-list', () => ({
  getTeacherList: (options?: { excludeDisabled?: boolean }) =>
    getTeacherListMock(options),
}));

/** Every batch handed to `.insert()`, in order. Length > 1 means it looped. */
let insertCalls: Array<Array<Record<string, unknown>>> = [];
/** Every read, so a lookup that runs once per ROW instead of once per id shows. */
let readCalls: Array<{ table: string; ids: string[] }> = [];
/** Set to make the database reject the write, as a unique index would. */
let insertError: { message: string; code?: string } | null = null;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {};
      let pending: Array<Record<string, unknown>> = [];
      let didInsert = false;
      let requestedIds: string[] = [];

      q.insert = (payload: unknown) => {
        pending = Array.isArray(payload)
          ? (payload as Array<Record<string, unknown>>)
          : [payload as Record<string, unknown>];
        insertCalls.push(pending);
        didInsert = true;
        return q;
      };
      q.select = () => q;
      q.eq = (_column: string, value: string) => {
        requestedIds = [value];
        return q;
      };
      q.in = (_column: string, values: string[]) => {
        requestedIds = values;
        readCalls.push({ table, ids: values });
        return q;
      };
      q.maybeSingle = () => Promise.resolve({ data: null, error: null });
      // Awaiting the builder itself — either the insert…select round trip, or a
      // name lookup, which is a `select(...).in('id', [...])`.
      q.then = (resolve: (v: unknown) => unknown) => {
        if (didInsert) {
          return Promise.resolve(
            insertError
              ? { data: null, error: insertError }
              : {
                  data: pending.map((row, i) => ({
                    id: `assignment-${i}`,
                    ...row,
                  })),
                  error: null,
                }
          ).then(resolve);
        }
        const rows =
          table === 'sections'
            ? requestedIds.map((id) => ({
                id,
                name: 'Diligence',
                level: { code: 'P4', label: 'Primary 4' },
                academic_year: { ay_code: 'AY2026' },
              }))
            : table === 'subjects'
              ? requestedIds.map((id) => ({ id, name: 'Mathematics' }))
              : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return q;
    },
  }),
}));

import { POST } from '@/app/api/teacher-assignments/route';

const ROOT = process.cwd();
const ROUTE = 'app/api/teacher-assignments/route.ts';
const source = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function req(body: unknown): Request {
  return new Request('http://localhost/api/teacher-assignments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Every row written across every insert call. */
const writtenRows = () => insertCalls.flat();

beforeEach(() => {
  insertCalls = [];
  readCalls = [];
  insertError = null;
  logActionMock.mockClear();
  invalidateMock.mockClear();
  getTeacherListMock.mockClear();
});

describe('staffing several classes at once', () => {
  const batch = {
    assignments: [
      {
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        role: 'form_adviser',
      },
      {
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'subject_teacher',
      },
      {
        teacher_user_id: TEACHER_B,
        section_id: SECTION_2,
        subject_id: ENGLISH,
        role: 'subject_teacher',
      },
    ],
  };

  it('writes the whole batch in ONE insert', async () => {
    const res = (await POST(req(batch) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(3);
    expect(body.assignments).toHaveLength(3);
    // One statement, so Postgres makes it all-or-nothing. A loop would leave a
    // year part-staffed with nothing on screen saying which part.
    expect(insertCalls).toHaveLength(1);
  });

  it('spells out every column on every row', async () => {
    // PostgREST takes the union of the keys across a multi-row insert and fills
    // a missing one with NULL instead of using the column default. So the
    // adviser row must carry `subject_id: null` explicitly rather than omitting
    // it and hoping — the same trap that produced a NOT NULL violation in
    // production on migrations 112-116.
    await POST(req(batch) as never);

    for (const row of writtenRows()) {
      for (const column of [
        'teacher_user_id',
        'section_id',
        'subject_id',
        'role',
      ]) {
        expect(Object.keys(row), `${column} missing from a row`).toContain(
          column
        );
      }
    }
    const adviser = writtenRows().find((r) => r.role === 'form_adviser');
    expect(adviser?.subject_id).toBeNull();
  });

  it('records each assignment on its own audit timeline', async () => {
    await POST(req(batch) as never);
    // Each one is removed and changed separately afterwards, so one batch row
    // would leave the others with a history that begins mid-story.
    expect(logActionMock).toHaveBeenCalledTimes(3);
    const ids = logActionMock.mock.calls.map((c) => c[0].entityId);
    expect(new Set(ids).size).toBe(3);
  });

  it('refreshes each class once, not once per assignment', async () => {
    await POST(req(batch) as never);
    // Two sections × the three modules a teaching assignment changes.
    expect(invalidateMock).toHaveBeenCalledTimes(6);
    for (const mod of ['markbook', 'evaluation', 'attendance']) {
      expect(
        invalidateMock.mock.calls.filter((c) => c[0] === mod),
        `${mod} was not refreshed once per class`
      ).toHaveLength(2);
    }
  });

  it('refuses two teachers sharing one subject in one class', async () => {
    // One subject in one class has one teacher — the counterpart of the
    // adviser rule, and what migration 003's header always said even though
    // its index only ever caught the SAME teacher listed twice. Found on the
    // section Teachers tab, 2026-08-13, with Filipino held by two people.
    //
    // Caught here rather than by migration 118's index, because the batch is
    // one statement: an index failure would lose 200 rows of work to a message
    // that does not say which two lines clashed.
    const res = (await POST(
      req({
        assignments: [
          {
            teacher_user_id: TEACHER_A,
            section_id: SECTION_1,
            subject_id: MATHS,
            role: 'subject_teacher',
          },
          {
            teacher_user_id: TEACHER_B,
            section_id: SECTION_1,
            subject_id: MATHS,
            role: 'subject_teacher',
          },
        ],
      }) as never
    )) as Response;

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/only one/i),
    });
  });

  it('lets one teacher take the same subject in two classes', async () => {
    // An ordinary thing: Ms Tan teaches Maths to P4 and to P5. The duplicate
    // rule is keyed on the CLASS as well as the teacher and subject, so
    // dropping the class from that key would refuse a batch every school sends.
    const res = (await POST(
      req({
        assignments: [
          {
            teacher_user_id: TEACHER_A,
            section_id: SECTION_1,
            subject_id: MATHS,
            role: 'subject_teacher',
          },
          {
            teacher_user_id: TEACHER_A,
            section_id: SECTION_2,
            subject_id: MATHS,
            role: 'subject_teacher',
          },
        ],
      }) as never
    )) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(writtenRows()).toHaveLength(2);
  });

  it('rejects an empty list', async () => {
    const res = (await POST(req({ assignments: [] }) as never)) as Response;
    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
  });
});

describe('a year-sized batch', () => {
  // 6 classes × 10 subjects, the two teachers alternating. Staffing AY2026 is
  // about 200 assignments; 60 is well past the point where anything that
  // truncates, paginates or drops rows would show, and past the 3-row batch
  // every other test in this file uses.
  //
  // One teacher per (class, subject), never two — the shape a real year has
  // (migration 118). It used to be 2 teachers × 6 × 5, which meant this
  // fixture quietly staged 30 double-booked slots.
  const SECTIONS = Array.from({ length: 6 }, (_, i) => seqId(100 + i));
  const SUBJECTS = Array.from({ length: 10 }, (_, i) => seqId(200 + i));
  const yearBatch = SECTIONS.flatMap((section_id, s) =>
    SUBJECTS.map((subject_id, j) => ({
      teacher_user_id: (s + j) % 2 === 0 ? TEACHER_A : TEACHER_B,
      section_id,
      subject_id,
      role: 'subject_teacher' as const,
    }))
  );

  it('saves every row, not the first few', async () => {
    expect(yearBatch).toHaveLength(60);
    const res = (await POST(
      req({ assignments: yearBatch }) as never
    )) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    // Silent truncation is one of the two failure shapes KD #183 was written
    // about: a save that reports success having written less than it was given.
    expect(body.count).toBe(60);
    expect(body.assignments).toHaveLength(60);
    expect(writtenRows()).toHaveLength(60);
    expect(insertCalls).toHaveLength(1);
    expect(logActionMock).toHaveBeenCalledTimes(60);
  });

  it('looks each class up once, not once per assignment', async () => {
    await POST(req({ assignments: yearBatch }) as never);

    // 60 rows across 6 classes and 10 subjects. Resolving names row by row read
    // `sections` twice and `subjects` once PER ROW — 180 round trips after an
    // insert that had already committed, which is what ran the function past
    // its time limit and made a fully-staffed year report as a failure.
    const sectionReads = readCalls.filter((c) => c.table === 'sections');
    const subjectReads = readCalls.filter((c) => c.table === 'subjects');
    expect(sectionReads).toHaveLength(1);
    expect(subjectReads).toHaveLength(1);
    expect(sectionReads[0].ids).toHaveLength(6);
    expect(subjectReads[0].ids).toHaveLength(10);
  });

  it('refuses a batch far larger than a whole school', async () => {
    const huge = Array.from({ length: 501 }, (_, i) => ({
      teacher_user_id: TEACHER_A,
      section_id: seqId(1000 + i),
      subject_id: MATHS,
      role: 'subject_teacher' as const,
    }));
    const res = (await POST(req({ assignments: huge }) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
    expect(body.error).toMatch(/smaller batches/i);
  });
});

describe('a batch with something wrong in it', () => {
  const good = {
    teacher_user_id: TEACHER_A,
    section_id: SECTION_1,
    subject_id: MATHS,
    role: 'subject_teacher' as const,
  };

  async function reject(assignments: unknown[]) {
    const res = (await POST(req({ assignments }) as never)) as Response;
    const body = await res.json();
    expect(res.status).toBe(400);
    // The whole point of one insert: one bad line means none of them land.
    expect(writtenRows()).toHaveLength(0);
    return body.error as string;
  }

  it('writes NOTHING when one row is invalid', async () => {
    const error = await reject([good, { ...good, section_id: undefined }]);
    expect(error).toBeTruthy();
  });

  it('names two teachers on one subject in plain English', async () => {
    const error = await reject([good, { ...good, teacher_user_id: TEACHER_B }]);
    expect(error).toMatch(/same subject in the same class/i);
    // Never a database word — no index name, no "constraint", no column names.
    expect(error).not.toMatch(
      /constraint|unique|index|null|uuid|teacher_user_id|subject_id/i
    );
  });

  it('refuses two form class advisers for one class', async () => {
    const error = await reject([
      {
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        role: 'form_adviser',
      },
      {
        teacher_user_id: TEACHER_B,
        section_id: SECTION_1,
        role: 'form_adviser',
      },
    ]);
    expect(error).toMatch(/only one/i);
    expect(error).not.toMatch(/constraint|unique|index|section_id/i);
  });

  it('refuses a form class adviser carrying a subject', async () => {
    const error = await reject([
      {
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'form_adviser',
      },
    ]);
    expect(error).toMatch(/whole class/i);
  });

  it('refuses a subject teacher with no subject', async () => {
    const error = await reject([
      {
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        role: 'subject_teacher',
      },
    ]);
    expect(error).toMatch(/subject/i);
  });

  it('refuses a parent account — the security property, unchanged', async () => {
    // THIS IS THE ONE THAT MATTERS. Widening the rule from "must be a teacher"
    // to "must be staff" must not widen it to "must be an auth user":
    // getStaffDisplayNameById() would accept this id, because it returns every
    // auth user with an email, which in this database is ~1,000 parent portal
    // accounts (KD #1). A parent recorded against a class gains RLS read on
    // that class's students and their grades, and there is no FK to stop the
    // write. A parent carries `role: null`, which is exactly what
    // getTeacherList filters on.
    const error = await reject([{ ...good, teacher_user_id: PARENT_ACCOUNT }]);
    expect(error).toMatch(/staff account/i);
    // Not "refresh the list": the list is cached on the SERVER for five
    // minutes and shared by everyone, so refreshing the page cannot change the
    // answer. Telling an admin to do something that cannot work is worse than
    // telling them nothing.
    expect(error).not.toMatch(/refresh the list/i);
    // And it must not still be stating the rule that no longer exists.
    expect(error).not.toMatch(/teacher account/i);
  });

  it('checks EVERY row against the staff list, not just the first', async () => {
    // The check has to hold for the whole batch. A version that looked only at
    // row 0 passed every other test in this file, because they all name a bad
    // account in a one-row body — so this one puts a real teacher first and the
    // parent uuid second.
    const error = await reject([
      good,
      { ...good, teacher_user_id: PARENT_ACCOUNT, section_id: SECTION_2 },
    ]);
    expect(error).toMatch(/staff account/i);
  });

  it('accepts a school_admin who teaches — the point of the whole phase', async () => {
    // Six such accounts hold AY2026 classes and four are the form adviser of
    // record. Those rows were written straight to the database by the
    // deployment import because this route refused them, which is why a
    // co-teacher change on one of those classes could not be made in the app.
    const res = (await POST(
      req({
        teacher_user_id: TEACHING_ADMIN,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'subject_teacher',
      }) as never
    )) as Response;

    expect(res.status).toBe(200);
    expect(writtenRows()).toHaveLength(1);
    expect(writtenRows()[0].teacher_user_id).toBe(TEACHING_ADMIN);
  });

  it('accepts a school_admin as the form adviser of record', async () => {
    // `teacher_assignments.role` is a different axis from the account's RBAC
    // role, and this is where the two are most easily conflated: being a
    // school_admin says nothing about whether the person may be the FCA, and
    // FCA write-ups hard-gate report-card publishing (KD #138 / #145).
    const res = (await POST(
      req({
        teacher_user_id: TEACHING_ADMIN,
        section_id: SECTION_1,
        subject_id: null,
        role: 'form_adviser',
      }) as never
    )) as Response;

    expect(res.status).toBe(200);
    expect(writtenRows()[0].role).toBe('form_adviser');
  });

  it('says nothing was saved when the database refuses the batch', async () => {
    insertError = {
      message:
        'duplicate key value violates unique constraint "teacher_assignments_form_adviser_unique"',
    };
    const res = (await POST(
      req({
        assignments: [
          {
            teacher_user_id: TEACHER_A,
            section_id: SECTION_1,
            role: 'form_adviser',
          },
        ],
      }) as never
    )) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already has a form adviser/i);
    expect(body.error).toMatch(/nothing was saved/i);
    expect(body.error).not.toMatch(/duplicate key|constraint/i);
  });

  it('explains a class that is no longer there without a table name', async () => {
    // A well-formed uuid for a class someone deleted in another tab. The raw
    // reply is `insert or update on table "teacher_assignments" violates
    // foreign key constraint "teacher_assignments_section_id_fkey"` — and it
    // used to reach the school admin verbatim, with no word on whether any of
    // the batch had landed.
    insertError = {
      code: '23503',
      message:
        'insert or update on table "teacher_assignments" violates foreign key constraint "teacher_assignments_section_id_fkey"',
    };
    const res = (await POST(req({ assignments: [good] }) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/no longer exists/i);
    expect(body.error).toMatch(/nothing was saved/i);
    expect(body.error).not.toMatch(
      /constraint|foreign key|insert or update|teacher_assignments/i
    );
  });

  it('always says whether anything was saved, whatever went wrong', async () => {
    // The tail is the only sentence that answers "do I redo all of this or none
    // of it". It used to be attached only to the two messages that had been
    // written by hand, so every other database failure left the question open.
    for (const message of [
      'insert or update on table "teacher_assignments" violates foreign key constraint "teacher_assignments_subject_id_fkey"',
      'new row for relation "teacher_assignments" violates check constraint "teacher_assignments_role_subject_shape"',
      'some failure nobody has seen before',
    ]) {
      insertCalls = [];
      insertError = { message };
      const res = (await POST(
        req({ assignments: [good] }) as never
      )) as Response;
      const body = await res.json();
      expect(body.error, message).toMatch(/nothing was saved/i);
    }
  });

  it('answers 500, not 400, when the failure is not the admin’s to fix', async () => {
    // A dropped connection is not a form the admin can correct, and 400 told
    // every caller it was.
    insertError = { message: 'fetch failed: connection reset by peer' };
    const res = (await POST(req({ assignments: [good] }) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/try again/i);
    // Never the raw text — that belongs in the server log.
    expect(body.error).not.toMatch(/connection reset|fetch failed/i);
  });

  it('answers a hole in the list of classes in plain English', async () => {
    // A grid that leaves a gap in its array sends exactly this. zod's own reply
    // is "Invalid input: expected object, received null".
    const error = await reject([good, null]);
    expect(error).not.toMatch(/expected|received|object|array/i);
    expect(error).toMatch(/blank/i);
  });

  it('answers a missing list of classes in plain English', async () => {
    // zod's own reply is "Invalid input: expected array, received null".
    const res = (await POST(req({ assignments: null }) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).not.toMatch(/expected|received|array|null/i);
    expect(writtenRows()).toHaveLength(0);
  });

  it('answers a body that is not a form at all in plain English', async () => {
    // zod's reply to a null body is "Invalid input: expected object, received
    // null", which is why this is caught before it gets there.
    for (const body of [null, 'oops', [1, 2]]) {
      const res = (await POST(req(body) as never)) as Response;
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).not.toMatch(/expected|received|object|null/i);
      expect(writtenRows()).toHaveLength(0);
    }
  });
});

describe('adding one assignment', () => {
  // Both existing screens send this shape and read `assignment` back off it.
  it('still works and still answers with a single assignment', async () => {
    const res = (await POST(
      req({
        teacher_user_id: TEACHER_A,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'subject_teacher',
      }) as never
    )) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assignment?.id).toBeTruthy();
    expect(body.assignment.subject_id).toBe(MATHS);
    expect(body.assignments).toBeUndefined();
    expect(insertCalls).toHaveLength(1);
  });

  it('accepts an explicit null subject for a form class adviser', async () => {
    // The section Teachers tab sends `subject_id: null` rather than omitting
    // the key; the staff sheet omits it. Both are the same thing.
    const res = (await POST(
      req({
        teacher_user_id: TEACHER_A,
        section_id: SECTION_2,
        subject_id: null,
        role: 'form_adviser',
      }) as never
    )) as Response;

    expect(res.status).toBe(200);
    expect(writtenRows()[0].subject_id).toBeNull();
  });

  it('reports a half-filled body in words a school admin can act on', async () => {
    const res = (await POST(req({}) as never)) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    // Zod's default is "Invalid input: expected string, received undefined".
    expect(body.error).not.toMatch(/expected|received|uuid|string|undefined/i);
  });

  it('checks the account on the single path too', async () => {
    const res = (await POST(
      req({
        teacher_user_id: PARENT_ACCOUNT,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'subject_teacher',
      }) as never
    )) as Response;

    expect(res.status).toBe(400);
    expect(writtenRows()).toHaveLength(0);
  });
});

describe('who may write', () => {
  it('is unchanged — the same capability as before the batch shape existed', () => {
    // Adding a bulk path is a speed change, not an access change. If this ever
    // moves, it must move as its own decision.
    expect(source(ROUTE)).toContain(
      "requireCapability('staff.edit_assignments')"
    );
  });

  it('still lets a disabled staff account be recorded against a class', async () => {
    // A deliberate decision: the Accounts tab offers "Manage teaching
    // assignments" on any staff row, disabled or not, and who HELD a class is a
    // separate question from who can sign in today. The route asks for the list
    // with `excludeDisabled: false` to allow it. The security property is
    // untouched — the helper filters on role BEFORE it filters on disabled, and
    // a parent account carries no role at all.
    const res = (await POST(
      req({
        teacher_user_id: TEACHER_DISABLED,
        section_id: SECTION_1,
        subject_id: MATHS,
        role: 'subject_teacher',
      }) as never
    )) as Response;

    expect(res.status).toBe(200);
    expect(writtenRows()).toHaveLength(1);
    expect(getTeacherListMock).toHaveBeenCalledWith({
      excludeDisabled: false,
    });
  });

  it('checks against the staff list, never the whole auth table', () => {
    // A grep, because the failure it guards is someone reaching for the more
    // convenient helper. `getStaffDisplayNameById` returns EVERY auth user with
    // an email, ~1,000 of which are parent portal accounts on this project.
    const code = source(ROUTE)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*/, ''))
      .join('\n');
    expect(code).toContain('getTeacherList');
    expect(code).not.toContain('getStaffDisplayNameById');
  });
});
