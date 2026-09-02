/**
 * getStaffDisplayNameById() — the userId-keyed counterpart to the existing
 * email-keyed getStaffDisplayEntries(), added to resolve a
 * `teacher_assignments.teacher_user_id` to a display name (report card /
 * masterfile form-adviser fix). Shares the same cached listUsers() call.
 *
 * getStaffCount() — regression coverage for the "sidebar/Accounts-tab shows
 * a flat 1000" bug: the roster below deliberately mixes staff (various
 * roles), a disabled staff account, and role:null parent accounts (the
 * shared auth.users table also holds parent logins, KD #11) to prove the
 * count only includes non-disabled, real-role staff.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        listUsers: vi.fn(() =>
          Promise.resolve({
            data: {
              users: [
                {
                  id: 'user-1',
                  email: 'maria.t@hfse.edu.sg',
                  app_metadata: { role: 'teacher' },
                  user_metadata: { full_name: 'Maria T.' },
                },
                {
                  id: 'user-2',
                  email: 'daniel.l@hfse.edu.sg',
                  app_metadata: { role: 'teacher' },
                  user_metadata: {},
                },
                {
                  id: 'user-3',
                  email: 'admin.person@hfse.edu.sg',
                  app_metadata: { role: 'school_admin' },
                  user_metadata: { full_name: 'Admin Person' },
                },
                {
                  id: 'user-4-disabled',
                  email: 'disabled.teacher@hfse.edu.sg',
                  app_metadata: { role: 'teacher', disabled: true },
                  user_metadata: { full_name: 'Disabled Teacher' },
                },
                {
                  // A role string from before the migration-092 rename, so
                  // not in the current `ROLES` list. This account is already
                  // inert app-wide — getUserRole/getRoleFromClaims narrow to
                  // ROLES too, so it resolves to null and holds no capability
                  // — and it must not be assignable either.
                  id: 'user-5-legacy-role',
                  email: 'legacy.registrar@hfse.edu.sg',
                  app_metadata: { role: 'registrar' },
                  user_metadata: { full_name: 'Legacy Registrar' },
                },
                {
                  // ⚠ THE ONE THAT WOULD HAVE HURT. The parent portal is a
                  // separate repo that owns parent account creation, and
                  // `loadAllStaffUncached` resolves a role as
                  // `appMeta.role ?? userMeta.role ?? null`. If that repo ever
                  // writes a role of its own into user_metadata, a
                  // `role !== null` filter admits every parent in the school.
                  id: 'parent-3-with-a-role-string',
                  email: 'parent3@gmail.com',
                  app_metadata: {},
                  user_metadata: { role: 'parent', full_name: 'Tagged Parent' },
                },
                {
                  // Empty string: survives `??`, so it reaches the filter as
                  // `''`, which is not null.
                  id: 'parent-4-blank-role',
                  email: 'parent4@gmail.com',
                  app_metadata: { role: '' },
                  user_metadata: {},
                },
                {
                  id: 'parent-1',
                  email: 'parent1@gmail.com',
                  app_metadata: {},
                  user_metadata: { full_name: 'Some Parent' },
                },
                {
                  id: 'parent-2',
                  email: 'parent2@gmail.com',
                  app_metadata: {},
                  user_metadata: {},
                },
              ],
            },
          })
        ),
      },
    },
  })),
}));

import {
  getAssignableStaffList,
  getStaffCount,
  getStaffDisplayEntries,
  getStaffDisplayNameById,
  getTeacherList,
  narrowStaffNamesToRows,
} from '@/lib/auth/staff-list';

describe('getAssignableStaffList', () => {
  // Who may be RECORDED as teaching a class: written into
  // `teacher_assignments.teacher_user_id`, or booked as a substitute. Anyone
  // on staff, because HFSE staffs classes that way — six school_admin accounts
  // hold AY2026 assignments and four are the form adviser of record.

  it('includes staff whose role is not teacher', async () => {
    const ids = (await getAssignableStaffList()).map((u) => u.id);
    // user-3 is a school_admin. `getTeacherList()` leaves them out; this is the
    // whole reason the sibling exists.
    expect(ids).toContain('user-3');
    expect(ids).toContain('user-1');
    expect(ids).toContain('user-2');
  });

  it('EXCLUDES parent accounts — the security property, stated as a test', async () => {
    // Parents authenticate against this same Supabase project (KD #1) and
    // carry no role at all. `teacher_assignments` has no FK to auth.users, so
    // this filter is the only thing keeping a parent uuid out of a column that
    // would hand them RLS read on a class's students and grades.
    const ids = (await getAssignableStaffList({ excludeDisabled: false })).map(
      (u) => u.id
    );
    expect(ids).not.toContain('parent-1');
    expect(ids).not.toContain('parent-2');
    expect(ids.some((id) => id.startsWith('parent-'))).toBe(false);
  });

  it('drops disabled accounts by default and keeps them on request', async () => {
    // Matches getTeacherList's option exactly. POST /api/teacher-assignments
    // passes `false` — who HOLDS a class is a different question from who can
    // sign in today — while the relief routes take the default.
    const active = await getAssignableStaffList();
    const all = await getAssignableStaffList({ excludeDisabled: false });

    expect(active.map((u) => u.id)).not.toContain('user-4-disabled');
    expect(all.map((u) => u.id)).toContain('user-4-disabled');
    expect(all).toHaveLength(active.length + 1);
  });

  it('is a superset of getTeacherList, sorted the same way', async () => {
    const teachers = await getAssignableStaffList({ excludeDisabled: false });
    const teachersOnly = await getTeacherList({ excludeDisabled: false });

    for (const t of teachersOnly) {
      expect(teachers.map((u) => u.id)).toContain(t.id);
    }
    // Sorted by display name, so a picker built from either reads the same.
    expect(teachers.map((u) => u.name)).toEqual(
      [...teachers.map((u) => u.name)].sort((a, b) => a.localeCompare(b))
    );
  });

  it('EXCLUDES a parent carrying a role string in user_metadata', async () => {
    // ⚠ THE CASE THAT MAKES THIS A `ROLES` MEMBERSHIP TEST RATHER THAN
    // `role !== null`. `loadAllStaffUncached` resolves a role as
    // `appMeta.role ?? userMeta.role ?? null`, and the parent portal — a
    // separate repo, which owns parent account creation — could start writing
    // a role of its own into `user_metadata` at any time without us shipping
    // anything. Under `!== null` that single upstream change would admit all
    // ~1,000 parent accounts into `teacher_assignments`, which has no foreign
    // key to stop them, and the RLS helpers would do the rest.
    //
    // Same question, same answer as lib/approvals/config.ts, which built its
    // "any staff account" picker on the ROLES-narrowed `listStaffUsers` for
    // this reason.
    const ids = (await getAssignableStaffList({ excludeDisabled: false })).map(
      (u) => u.id
    );
    expect(ids).not.toContain('parent-3-with-a-role-string');
  });

  it('EXCLUDES an account whose role is an empty string', async () => {
    // `''` survives `??`, so it reaches the filter as a non-null value and
    // passes a `!== null` test. It is not a role.
    const ids = (await getAssignableStaffList({ excludeDisabled: false })).map(
      (u) => u.id
    );
    expect(ids).not.toContain('parent-4-blank-role');
  });

  it('EXCLUDES an account whose role string we no longer recognise', async () => {
    // A `registrar` left over from the migration-092 rename (KD #155). Not a
    // gap: that account is ALREADY inert app-wide, because `getUserRole` and
    // `getRoleFromClaims` narrow to ROLES the same way — it resolves to null,
    // holds no capability, and proxy.ts routes it to the parent portal. Making
    // it assignable here would recover nothing. Fixing the account is what
    // recovers the person.
    const ids = (await getAssignableStaffList({ excludeDisabled: false })).map(
      (u) => u.id
    );
    expect(ids).not.toContain('user-5-legacy-role');
    // And it is still not counted as staff, for the same reason.
    await expect(getStaffCount()).resolves.toBe(3);
  });

  it('matches getStaffCount exactly on the active roster', async () => {
    // Now that both narrow to ROLES and both drop disabled accounts, they are
    // answering the same question and must not drift apart. The mixed roster
    // above — two teachers, a school_admin, a disabled teacher, a legacy role,
    // and four parents of three different shapes — is what makes that
    // agreement worth asserting.
    await expect(getAssignableStaffList()).resolves.toHaveLength(
      await getStaffCount()
    );
  });
});

describe('getStaffDisplayNameById', () => {
  it('returns userId → display-name pairs, falling back to email when no full_name is set', async () => {
    const entries = await getStaffDisplayNameById();
    const map = new Map(entries);
    expect(map.get('user-1')).toBe('Maria T.');
    expect(map.get('user-2')).toBe('daniel.l@hfse.edu.sg');
  });

  it('matches getStaffDisplayEntries in count and name values, keyed differently', async () => {
    const byId = new Map(await getStaffDisplayNameById());
    const byEmail = new Map(await getStaffDisplayEntries());
    expect(byId.size).toBe(byEmail.size);
    expect(Array.from(byId.values()).sort()).toEqual(
      Array.from(byEmail.values()).sort()
    );
  });
});

describe('getStaffCount', () => {
  it('counts only non-disabled, real-role staff — excludes parents and disabled accounts', async () => {
    // Roster: 3 active staff (user-1, user-2, user-3), 1 disabled staff
    // (excluded), 2 parents with role:null (excluded — the exact bug this
    // guards: parents sharing auth.users must never count as "staff").
    await expect(getStaffCount()).resolves.toBe(3);
  });
});

describe('narrowStaffNamesToRows', () => {
  // Fix round 1, F2: getStaffDisplayNameById() returns every auth user with
  // an email — on the real school, ~1,039 rows, almost all parent portal
  // accounts — and both mark-change History dialogs were shipping that
  // whole map into a 'use client' table prop for a lookup that only ever
  // needs a handful of ids per row. This is the narrowing that closes it.
  const entries: Array<[string, string]> = [
    ['user-1', 'Maria T.'],
    ['user-2', 'daniel.l@hfse.edu.sg'],
    ['user-3', 'Admin Person'],
    ['parent-1', 'Some Parent'],
    ['parent-2', 'parent2@gmail.com'],
  ];

  it('keeps only the ids the rows actually reference', () => {
    const rows = [{ requestedBy: 'user-1', reviewedBy: 'user-3' }];

    const narrowed = narrowStaffNamesToRows(entries, rows, (r) => [
      r.requestedBy,
      r.reviewedBy,
    ]);

    expect(new Set(narrowed.map(([id]) => id))).toEqual(
      new Set(['user-1', 'user-3'])
    );
  });

  it('drops every id no row references — the actual leak this closes', () => {
    // Neither parent id is picked by any row, mirroring the real shape:
    // getStaffDisplayNameById() returns the whole auth.users table, most of
    // it parent portal accounts that never appear in a requested_by /
    // reviewed_by / applied_by column.
    const rows = [{ requestedBy: 'user-1', reviewedBy: null }];

    const narrowed = narrowStaffNamesToRows(entries, rows, (r) => [
      r.requestedBy,
      r.reviewedBy,
    ]);

    expect(narrowed.map(([id]) => id)).toEqual(['user-1']);
    expect(narrowed.some(([id]) => id.startsWith('parent-'))).toBe(false);
  });

  it('drops null/undefined picks instead of matching an empty id', () => {
    const rows = [
      { requestedBy: 'user-2', reviewedBy: null },
      { requestedBy: 'user-2', reviewedBy: undefined },
    ];

    const narrowed = narrowStaffNamesToRows(entries, rows, (r) => [
      r.requestedBy,
      r.reviewedBy,
    ]);

    expect(narrowed.map(([id]) => id)).toEqual(['user-2']);
  });

  it('returns nothing when no rows are supplied', () => {
    const narrowed = narrowStaffNamesToRows(
      entries,
      [] as Array<{ requestedBy: string }>,
      (r) => [r.requestedBy]
    );

    expect(narrowed).toEqual([]);
  });
});
