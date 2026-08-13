import { describe, expect, it, beforeEach } from 'vitest';
import { getUserFootprint, isLastSuperadmin } from '@/lib/sis/user-deletion';

// Records every (table, column) pair queried, and lets each test decide
// which (table, column) pairs should report an existing row.
const queryCalls: Array<{ table: string; column: string }> = [];
const hits = new Set<string>(); // `${table}.${column}` keys that should "match"

function mockClient() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string) => ({
          limit: (_n: number) => {
            queryCalls.push({ table, column });
            const matched = hits.has(`${table}.${column}`);
            return Promise.resolve({
              data: matched ? [{ id: 'row-1' }] : [],
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

describe('getUserFootprint', () => {
  beforeEach(() => {
    queryCalls.length = 0;
    hits.clear();
  });

  it('teacher role only queries teacher-relevant tables', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'teacher');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set([
        // Twice over: the classes they hold, and any they are covering for an
        // absent colleague (migration 117, `relief_teacher_user_id`). Both are
        // columns on the same table, so the deduped set names it once.
        // Migration 117 declares no cross-schema FK — the convention its
        // neighbour teacher_user_id follows — so this footprint check is the
        // only thing stopping a delete from leaving a cover pointing at nobody.
        'teacher_assignments',
        'grade_change_requests',
        'attendance_daily',
        'evaluation_writeups',
      ])
    );
  });

  it('p_file_officer role only queries its 2 tables', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'p_file_officer');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(
      new Set(['p_file_revisions', 'p_file_outreach'])
    );
  });

  it('admissions role only queries p_file_outreach', async () => {
    const client = mockClient();
    await getUserFootprint(client as never, 'user-1', 'admissions');
    const queriedTables = new Set(queryCalls.map((c) => c.table));
    expect(queriedTables).toEqual(new Set(['p_file_outreach']));
  });

  it('returns an empty array when nothing matches', async () => {
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual([]);
  });

  it('returns the matching table name when a row exists', async () => {
    hits.add('evaluation_writeups.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', 'teacher');
    expect(result).toEqual(['evaluation_writeups']);
  });

  it('dedupes when multiple columns on the same table match', async () => {
    hits.add('grade_change_requests.requested_by');
    hits.add('grade_change_requests.reviewed_by');
    const client = mockClient();
    const result = await getUserFootprint(
      client as never,
      'user-1',
      'school_admin'
    );
    expect(result).toEqual(['grade_change_requests']);
  });

  it("a null role checks the union of every role's tables", async () => {
    // level_aliases is only in academic_coordinator/school_admin/superadmin's
    // lists, never teacher's or p_file_officer's/admissions' — proves the
    // null-role fallback is broader than any single role's list.
    hits.add('level_aliases.created_by');
    const client = mockClient();
    const result = await getUserFootprint(client as never, 'user-1', null);
    expect(result).toEqual(['level_aliases']);
  });

  it('treats a query error as a match (fails closed, never silently allows delete)', async () => {
    const erroringClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({ data: null, error: { message: 'boom' } }),
          }),
        }),
      }),
    };
    const result = await getUserFootprint(
      erroringClient as never,
      'user-1',
      'p_file_officer'
    );
    expect(result.sort()).toEqual(['p_file_outreach', 'p_file_revisions']);
  });
});

describe('isLastSuperadmin', () => {
  it('true when the target is the only superadmin', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'teacher' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });

  it('false when another superadmin exists besides the target', () => {
    const users = [
      { id: 'a', role: 'superadmin' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('false when the target itself is not even a superadmin (guard only fires for superadmin targets)', () => {
    const users = [
      { id: 'a', role: 'teacher' },
      { id: 'b', role: 'superadmin' },
    ];
    expect(isLastSuperadmin(users, 'a')).toBe(false);
  });

  it('true when the users list is otherwise empty of superadmins besides the target', () => {
    const users = [{ id: 'a', role: 'superadmin' }];
    expect(isLastSuperadmin(users, 'a')).toBe(true);
  });
});
