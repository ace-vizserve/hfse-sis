/**
 * getStaffDisplayNameById() — the userId-keyed counterpart to the existing
 * email-keyed getStaffDisplayEntries(), added to resolve a
 * `teacher_assignments.teacher_user_id` to a display name (report card /
 * masterfile form-adviser fix). Shares the same cached listUsers() call.
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
              ],
            },
          })
        ),
      },
    },
  })),
}));

import {
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
