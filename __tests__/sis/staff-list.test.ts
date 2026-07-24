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
  getStaffCount,
  getStaffDisplayEntries,
  getStaffDisplayNameById,
} from '@/lib/auth/staff-list';

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
