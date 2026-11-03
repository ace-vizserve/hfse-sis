import type { User } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  getRoleFromClaims,
  getRoleSetFromClaims,
  getUserRole,
  getUserRoleSet,
} from '@/lib/auth/roles';

// An account holder can write `user_metadata` with the public key. If a role is
// ever read from it, any parent can make themselves a superadmin (KD #236).
const SELF_WRITTEN = {
  app_metadata: {},
  user_metadata: { role: 'superadmin', active_role: 'superadmin' },
};

describe('a role never comes from user_metadata', () => {
  it('ignores it in a login token', () => {
    expect(getRoleFromClaims(SELF_WRITTEN)).toBeNull();
    expect(getRoleSetFromClaims(SELF_WRITTEN)).toEqual([]);
  });

  it('ignores it on a stored account', () => {
    const user = SELF_WRITTEN as unknown as User;
    expect(getUserRole(user)).toBeNull();
    expect(getUserRoleSet(user)).toEqual([]);
  });

  it('still reads a staff role from app_metadata', () => {
    expect(
      getRoleFromClaims({
        app_metadata: { role: 'teacher' },
        user_metadata: { role: 'superadmin' },
      })
    ).toBe('teacher');
  });

  it('is also gone from the database function', () => {
    const sql = readFileSync(
      'supabase/migrations/205_current_user_role_no_user_metadata.sql',
      'utf8'
    );
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->\s*'user_metadata'/);
  });
});
