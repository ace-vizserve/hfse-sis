/**
 * The reason gate on DELETE /api/teacher-assignments/[id].
 *
 * Removing a teacher mid-year is a disruption to work that already exists, so
 * it has to be explained. Before the year starts it is just staffing and must
 * stay one click. These tests pin both halves, plus the two ways the gate could
 * wrongly fire: a no-op delete, and a body that never arrives.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'actor-1', email: 'coordinator@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

type LoggedAction = { context: Record<string, unknown> };
const logActionMock = vi.fn(async (_entry: LoggedAction) => undefined);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: LoggedAction) => logActionMock(entry),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: vi.fn(async () => [
    ['teacher-1', 'Ms Tan'] as [string, string],
  ]),
}));

vi.mock('@/lib/dates', () => ({ sgToday: () => '2026-08-06' }));

// Rows returned per table. `terms` drives the gate.
let tableRows: Record<string, unknown>;
const deletedIds: string[] = [];

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from(table: string) {
      const q: Record<string, unknown> = { table, isDelete: false };
      q.select = () => q;
      q.order = () => q;
      q.delete = () => {
        q.isDelete = true;
        return q;
      };
      q.eq = (_col: string, val: string) => {
        if (q.isDelete) {
          deletedIds.push(val);
          return Promise.resolve({ error: null });
        }
        return q;
      };
      q.maybeSingle = () =>
        Promise.resolve({ data: tableRows[table] ?? null, error: null });
      // Awaiting the builder itself (e.g. the terms list query).
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: tableRows[table] ?? [], error: null }).then(
          resolve
        );
      return q;
    },
  }),
}));

import { DELETE } from '@/app/api/teacher-assignments/[id]/route';

const params = Promise.resolve({ id: 'assignment-1' });

const ASSIGNMENT = {
  id: 'assignment-1',
  teacher_user_id: 'teacher-1',
  section_id: 'section-1',
  subject_id: 'subject-1',
  role: 'subject_teacher',
};

function setup({
  termStartDates,
  assignment = ASSIGNMENT,
}: {
  termStartDates: Array<{ start_date: string | null }>;
  assignment?: typeof ASSIGNMENT | null;
}) {
  tableRows = {
    teacher_assignments: assignment,
    terms: termStartDates,
    sections: {
      academic_year_id: 'ay-1',
      name: 'Diligence',
      level: { code: 'P4', label: 'Primary 4' },
      academic_year: { ay_code: 'AY2026' },
    },
    subjects: { name: 'Mathematics' },
  };
}

function req(body?: unknown): Request {
  return new Request('http://localhost/api/teacher-assignments/assignment-1', {
    method: 'DELETE',
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

beforeEach(() => {
  logActionMock.mockClear();
  deletedIds.length = 0;
});

describe('before the year starts', () => {
  it('removes with no reason and no body at all', async () => {
    setup({ termStartDates: [{ start_date: '2026-09-01' }] });
    const res = (await DELETE(req() as never, { params })) as Response;

    expect(res.status).toBe(200);
    expect(deletedIds).toContain('assignment-1');
  });

  it('treats a calendar with no dates as not started', async () => {
    setup({ termStartDates: [{ start_date: null }, { start_date: null }] });
    const res = (await DELETE(req() as never, { params })) as Response;
    expect(res.status).toBe(200);
  });
});

describe('once the year is underway', () => {
  const started = [{ start_date: '2026-01-08' }, { start_date: '2026-03-24' }];

  it('refuses a removal with no reason, in plain English', async () => {
    setup({ termStartDates: started });
    const res = (await DELETE(req() as never, { params })) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Tell us why this teacher is being removed.');
    expect(deletedIds).toHaveLength(0);
  });

  it('refuses an unknown reason', async () => {
    setup({ termStartDates: started });
    const res = (await DELETE(
      req({ change_reason: 'because_i_said_so' }) as never,
      { params }
    )) as Response;

    expect(res.status).toBe(400);
    expect(deletedIds).toHaveLength(0);
  });

  it('refuses "Other" with no notes', async () => {
    setup({ termStartDates: started });
    const res = (await DELETE(req({ change_reason: 'other' }) as never, {
      params,
    })) as Response;
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Add a short note explaining the change.');
    expect(deletedIds).toHaveLength(0);
  });

  it('accepts a valid reason and records it with the names', async () => {
    setup({ termStartDates: started });
    const res = (await DELETE(req({ change_reason: 'resigned' }) as never, {
      params,
    })) as Response;

    expect(res.status).toBe(200);
    expect(deletedIds).toContain('assignment-1');

    const logged = logActionMock.mock.calls[0][0].context;
    expect(logged.change_reason).toBe('resigned');
    expect(logged.teacher_name).toBe('Ms Tan');
    expect(logged.section_name).toBe('P4 Diligence');
    expect(logged.subject_name).toBe('Mathematics');
  });

  it('keeps the notes alongside the reason', async () => {
    setup({ termStartDates: started });
    await DELETE(
      req({
        change_reason: 'other',
        change_notes: 'Swapped with Ms Lim for the STEM pilot.',
      }) as never,
      { params }
    );

    const logged = logActionMock.mock.calls[0][0].context;
    expect(logged.change_notes).toBe('Swapped with Ms Lim for the STEM pilot.');
  });

  it('does NOT demand a reason for a row that is already gone', async () => {
    // A double-clicked remove, and the FCA replace-retry path, both re-delete
    // an id that no longer exists. Demanding an explanation for a deletion that
    // is not happening would break the retry.
    setup({ termStartDates: started, assignment: null });
    const res = (await DELETE(req() as never, { params })) as Response;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.changed).toBe(false);
    expect(logActionMock).not.toHaveBeenCalled();
  });
});
