/**
 * PATCH /api/teacher-assignments/[id] — the cover switch.
 *
 * Cover is one nullable column on the assignment (migration 117): set it and a
 * substitute gets the class, clear it and they lose it. There is no window, no
 * lifecycle and no history table, so the only things worth pinning are the ones
 * that would let the wrong person through or leave the change unrecorded:
 *
 *   * the substitute must be a real, active TEACHER account — the check that
 *     keeps a parent uuid from being handed RLS read on students and grades;
 *   * a teacher cannot cover their own class;
 *   * clearing is a first-class operation, not an omission;
 *   * every change writes an audit row, because after a cover ends the audit
 *     log is the ONLY record that it ever happened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const requireCapabilityMock = vi.fn((_capability: string) =>
  Promise.resolve({
    user: { id: 'actor-1', email: 'admin@hfse.test' },
    role: 'school_admin',
  })
);
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: (capability: string) => requireCapabilityMock(capability),
}));

type LoggedAction = {
  action: string;
  entityId: string;
  entityType: string;
  // Who acted, and in what capacity (migration 141).
  actor: { id: string; email: string | null; role: string | null };
  context: Record<string, unknown>;
};
const logActionMock = vi.fn(async (_entry: LoggedAction) => undefined);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: LoggedAction) => logActionMock(entry),
}));

const invalidateMock = vi.fn();
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (...args: unknown[]) => invalidateMock(...args),
}));

const TEACHER_A = '11111111-1111-4111-8111-111111111111';
const TEACHER_B = '22222222-2222-4222-8222-222222222222';
// A real teacher whose account has been disabled. Excluded on purpose here —
// see the test at the bottom for why this route disagrees with its sibling.
const TEACHER_DISABLED = '33333333-3333-4333-8333-333333333333';
// Deliberately not a staff account at all. Stands in for the ~1,000 parent
// portal uuids that `getStaffDisplayNameById` would happily have accepted.
const NOT_A_TEACHER = '99999999-9999-4999-8999-999999999999';
// A school_admin who also teaches, and who may therefore cover a lesson. Six
// accounts look like this in the live year.
const TEACHING_ADMIN = '44444444-4444-4444-8444-444444444444';

const ASSIGNMENT = 'aaaaaaaa-1111-4111-8111-111111111111';
const SECTION = 'bbbbbbbb-2222-4222-8222-222222222222';

const getTeacherListMock = vi.fn(
  async (options: { excludeDisabled?: boolean } = {}) => {
    const excludeDisabled = options.excludeDisabled ?? true;
    return [
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
    ].filter((t) => !excludeDisabled || !t.disabled);
  }
);
// `getTeacherList` throws rather than returning a narrower list: reaching for
// it here would refuse the teaching admin again, and a silent fallback would
// leave every other assertion in this file green.
vi.mock('@/lib/auth/staff-list', () => ({
  getTeacherList: (options?: { excludeDisabled?: boolean }) =>
    getTeacherListMock(options),
  getStaffDisplayNameById: () => Promise.resolve([]),
}));

/** Every `.update()` payload the route sent, in order. */
let updateCalls: Array<Record<string, unknown>> = [];
/** null makes the assignment lookup answer "no such row". */
let existingAssignment: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = {};
      let didUpdate = false;

      q.update = (payload: Record<string, unknown>) => {
        updateCalls.push(payload);
        didUpdate = true;
        return q;
      };
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = () =>
        Promise.resolve({
          data:
            table === 'sections'
              ? { academic_year: { ay_code: 'AY2026' } }
              : existingAssignment,
          error: null,
        });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: didUpdate ? [] : null, error: null }).then(
          resolve
        );
      return q;
    },
  }),
}));

import { PATCH } from '@/app/api/teacher-assignments/[id]/route';

const ROOT = process.cwd();
const ROUTE = 'app/api/teacher-assignments/[id]/route.ts';
/** Source with comments stripped — the assertions below are about what the
 *  route CALLS, and the comments naturally name the helper they warn against. */
const source = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

async function patch(body: unknown): Promise<Response> {
  const res = await PATCH(
    new Request(`http://localhost/api/teacher-assignments/${ASSIGNMENT}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
    { params: Promise.resolve({ id: ASSIGNMENT }) }
  );
  // Every branch of the route answers. A handler that falls off the end would
  // surface to a user as a hung request, so fail here rather than on a
  // confusing property access three lines down.
  if (!res) throw new Error('PATCH returned no response');
  return res;
}

beforeEach(() => {
  updateCalls = [];
  logActionMock.mockClear();
  invalidateMock.mockClear();
  requireCapabilityMock.mockClear();
  getTeacherListMock.mockClear();
  existingAssignment = {
    id: ASSIGNMENT,
    teacher_user_id: TEACHER_A,
    section_id: SECTION,
    subject_id: null,
    role: 'form_adviser',
  };
});

describe('putting someone on cover', () => {
  it('writes the substitute onto the assignment', async () => {
    const res = await patch({ relief_teacher_user_id: TEACHER_B });

    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        relief_teacher_user_id: TEACHER_B,
        relief_started_on: null,
        relief_ended_on: null,
      },
    ]);
  });

  it('gates on staff.manage_relief, not staff.edit_assignments', async () => {
    // Deciding who may act on a class is narrower than editing the timetable:
    // school admin and above, where the coordinator staffs the year.
    await patch({ relief_teacher_user_id: TEACHER_B });
    expect(requireCapabilityMock).toHaveBeenCalledWith('staff.manage_relief');
  });

  it('refuses an id that is not a staff account', async () => {
    // The check that matters most on this route, and the one the widening from
    // teachers to staff must not touch. There is no FK across schemas, so
    // nothing else stops a parent uuid landing in the column — and the RLS
    // helpers in migration 117 would then hand that parent read on the class's
    // students, grading sheets and attendance.
    const res = await patch({ relief_teacher_user_id: NOT_A_TEACHER });

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
    await expect(res.json()).resolves.toEqual({
      error:
        'Choose a member of staff with an active account. Check that person on the Staff page, then try again.',
    });
  });

  it('accepts a school_admin as the substitute', async () => {
    // Teaching admins take lessons here. Refusing them meant the arrangement
    // happened off-system, with the register still showing the absent teacher.
    const res = await patch({ relief_teacher_user_id: TEACHING_ADMIN });

    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        relief_teacher_user_id: TEACHING_ADMIN,
        relief_started_on: null,
        relief_ended_on: null,
      },
    ]);
  });

  it('refuses a teacher covering their own class', async () => {
    const res = await patch({ relief_teacher_user_id: TEACHER_A });

    expect(res.status).toBe(400);
    // A sentence, not a constraint name — this is also a CHECK constraint, and
    // the database's version of the message is unreadable.
    await expect(res.json()).resolves.toEqual({
      error: 'A teacher cannot cover their own class.',
    });
    expect(updateCalls).toEqual([]);
  });

  it('refuses a disabled account', async () => {
    // Deliberately disagrees with POST /api/teacher-assignments, which passes
    // `excludeDisabled: false`. There the question is "whose class is this?" —
    // a teacher on long leave is still the name on the report card. Here it is
    // "who is taking the lesson?", and a disabled account cannot sign in to
    // enter a mark at all.
    const res = await patch({ relief_teacher_user_id: TEACHER_DISABLED });

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
    // Called with no options at all, so `excludeDisabled` takes its default of
    // true. Passing `false` here would silently start admitting them.
    expect(getTeacherListMock.mock.calls[0]![0]).toBeUndefined();
  });

  it('404s when the assignment is gone', async () => {
    existingAssignment = null;

    const res = await patch({ relief_teacher_user_id: TEACHER_B });

    expect(res.status).toBe(404);
    expect(updateCalls).toEqual([]);
  });
});

describe('taking someone off cover', () => {
  it('clears the column when sent null', async () => {
    const res = await patch({ relief_teacher_user_id: null });

    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        relief_teacher_user_id: null,
        relief_started_on: null,
        relief_ended_on: null,
      },
    ]);
  });

  it('rejects a body that omits the key entirely', async () => {
    // `null` is a real value here, not an absence. Treating a missing key as
    // "end the cover" would let an empty or malformed body silently revoke a
    // substitute's access.
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  it('does not check the teacher list when clearing', async () => {
    await patch({ relief_teacher_user_id: null });
    expect(getTeacherListMock).not.toHaveBeenCalled();
  });
});

describe('what survives the change', () => {
  it('records the start and the end as different actions', async () => {
    await patch({ relief_teacher_user_id: TEACHER_B });
    expect(logActionMock.mock.calls[0]![0]).toMatchObject({
      action: 'assignment.relief.start',
      entityType: 'teacher_assignment',
      entityId: ASSIGNMENT,
    });

    logActionMock.mockClear();

    await patch({ relief_teacher_user_id: null });
    expect(logActionMock.mock.calls[0]![0]).toMatchObject({
      action: 'assignment.relief.end',
    });
  });

  it('records the capacity the person acted in, not just who they were', async () => {
    // migration 141. `requireCapability` returns the role and every call site
    // used to throw it away, so the log could say WHO arranged a cover and
    // never in what capacity — and it could not be reconstructed later, since
    // looking somebody up returns the job they hold TODAY.
    await patch({ relief_teacher_user_id: TEACHER_B });
    expect(logActionMock.mock.calls[0]![0].actor).toMatchObject({
      role: 'school_admin',
    });
  });

  it('is the only record a finished cover leaves behind', async () => {
    // Clearing the column deletes the fact from the row. If this ever stops
    // logging, a cover that has ended becomes unrecoverable — nothing else in
    // the system remembers it happened.
    await patch({ relief_teacher_user_id: null });
    expect(logActionMock).toHaveBeenCalledTimes(1);
  });

  it('busts the three teaching modules’ caches', async () => {
    // Cover changes who may act on the section. Without this the drill reads
    // show the wrong person's sheets until the 60s TTL runs out.
    await patch({ relief_teacher_user_id: TEACHER_B });

    const modules = invalidateMock.mock.calls.map((c) => c[0]);
    expect(new Set(modules)).toEqual(
      new Set(['markbook', 'evaluation', 'attendance'])
    );
  });
});

describe('the cover window (migration 123)', () => {
  it('writes both dates when they are given', async () => {
    const res = await patch({
      relief_teacher_user_id: TEACHER_B,
      relief_started_on: '2026-09-01',
      relief_ended_on: '2026-09-05',
    });

    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        relief_teacher_user_id: TEACHER_B,
        relief_started_on: '2026-09-01',
        relief_ended_on: '2026-09-05',
      },
    ]);
  });

  it('keeps the one-step flow working when the dates are omitted', async () => {
    // Every caller written before 123 sends only the teacher, and must still
    // mean "cover this class from now until I say otherwise".
    const res = await patch({ relief_teacher_user_id: TEACHER_B });

    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({
      relief_started_on: null,
      relief_ended_on: null,
    });
  });

  it('accepts an open-ended cover — a start with no end', async () => {
    const res = await patch({
      relief_teacher_user_id: TEACHER_B,
      relief_started_on: '2026-09-01',
      relief_ended_on: null,
    });

    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({
      relief_started_on: '2026-09-01',
      relief_ended_on: null,
    });
  });

  it('rejects an end date before the start date', async () => {
    const res = await patch({
      relief_teacher_user_id: TEACHER_B,
      relief_started_on: '2026-09-05',
      relief_ended_on: '2026-09-01',
    });

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  it('rejects a date that is not yyyy-MM-dd', async () => {
    const res = await patch({
      relief_teacher_user_id: TEACHER_B,
      relief_started_on: '1 Sep 2026',
    });

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  it('clearing the teacher wipes the window rather than backdating it', async () => {
    // Somebody will want to stop a cover today that was booked to run all week.
    // Leaving the dates behind would strand a window on a class nobody covers.
    const res = await patch({ relief_teacher_user_id: null });

    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({
      relief_teacher_user_id: null,
      relief_started_on: null,
      relief_ended_on: null,
    });
  });

  it('refuses dates sent alongside a null teacher', async () => {
    // Nothing is covering, so a window would mean nothing. Rejecting it is
    // louder than silently dropping it.
    const res = await patch({
      relief_teacher_user_id: null,
      relief_started_on: '2026-09-01',
    });

    expect(res.status).toBe(400);
    expect(updateCalls).toEqual([]);
  });

  it('records the window in the audit context', async () => {
    // The row keeps nothing once cover is cleared, so the audit log is the only
    // place a finished cover's dates survive.
    await patch({
      relief_teacher_user_id: TEACHER_B,
      relief_started_on: '2026-09-01',
      relief_ended_on: '2026-09-05',
    });

    expect(logActionMock).toHaveBeenCalledTimes(1);
    const context = logActionMock.mock.calls[0][0].context as Record<
      string,
      unknown
    >;
    expect(context).toMatchObject({
      relief_started_on: '2026-09-01',
      relief_ended_on: '2026-09-05',
    });
  });
});

describe('the route itself', () => {
  it('validates against getTeacherList, never getStaffDisplayNameById', () => {
    // The latter returns every auth user with an email — which in this database
    // means the parent portal accounts too. A grep, because the failure it
    // guards is someone reaching for the more convenient helper.
    const code = source(ROUTE);
    expect(code).toMatch(/getTeacherList/);
    expect(code).not.toMatch(/getStaffDisplayNameById/);
  });
});
