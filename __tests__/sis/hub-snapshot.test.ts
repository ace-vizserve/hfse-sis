// __tests__/sis/hub-snapshot.test.ts
import { describe, it, expect } from 'vitest';
import {
  tallyStaffByRole,
  averageRosterSize,
  daysUntil,
} from '@/lib/sis/hub-snapshot';
import type { AdminUserRow } from '@/lib/sis/users/queries';

function makeUser(role: AdminUserRow['role']): AdminUserRow {
  return {
    id: 'x',
    email: 'x@x.com',
    role,
    display_name: 'X',
    disabled: false,
    created_at: '2026-01-01T00:00:00Z',
    last_sign_in_at: null,
  };
}

describe('tallyStaffByRole', () => {
  it('counts users per role, ignoring nulls', () => {
    const users = [
      makeUser('teacher'),
      makeUser('teacher'),
      makeUser('academic_coordinator'),
      makeUser(null),
    ];
    const tally = tallyStaffByRole(users);
    expect(tally.teacher).toBe(2);
    expect(tally.academic_coordinator).toBe(1);
    expect(tally.school_admin).toBe(0);
  });
});

describe('averageRosterSize', () => {
  it('averages a list of section counts', () => {
    expect(averageRosterSize([10, 20, 30])).toBe(20);
  });
  it('returns null for an empty list (no sections)', () => {
    expect(averageRosterSize([])).toBeNull();
  });
});

describe('daysUntil', () => {
  it('computes whole days between two ISO dates via UTC math', () => {
    expect(daysUntil('2026-02-06', '2026-02-24')).toBe(18);
  });
  it('returns 0 for the same date', () => {
    expect(daysUntil('2026-02-06', '2026-02-06')).toBe(0);
  });
});
