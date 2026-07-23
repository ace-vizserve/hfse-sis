import { describe, it, expect } from 'vitest';

import { computeStaffFamilies } from '@/lib/sis/staff-families';
import type { Role } from '@/lib/auth/roles';

describe('computeStaffFamilies', () => {
  it('groups all 6 roles into exactly 3 families with correct counts', () => {
    const accounts: { role: Role | null }[] = [
      { role: 'teacher' },
      { role: 'teacher' },
      { role: 'academic_coordinator' },
      { role: 'admissions' },
      { role: 'p_file_officer' },
      { role: 'school_admin' },
      { role: 'school_admin' },
      { role: 'superadmin' },
    ];

    const families = computeStaffFamilies(accounts);

    expect(families).toHaveLength(3);

    const academics = families.find((f) => f.key === 'academics')!;
    expect(academics.total).toBe(3);
    expect(academics.roles.find((r) => r.role === 'teacher')!.count).toBe(2);
    expect(
      academics.roles.find((r) => r.role === 'academic_coordinator')!.count
    ).toBe(1);

    const admissionsEnrollment = families.find(
      (f) => f.key === 'admissions-enrollment'
    )!;
    expect(admissionsEnrollment.total).toBe(2);

    const admin = families.find((f) => f.key === 'admin')!;
    expect(admin.total).toBe(3);
    expect(admin.roles.find((r) => r.role === 'school_admin')!.count).toBe(2);
    expect(admin.roles.find((r) => r.role === 'superadmin')!.count).toBe(1);
  });

  it('ignores accounts with a null role', () => {
    const accounts: { role: Role | null }[] = [
      { role: null },
      { role: 'teacher' },
    ];
    const families = computeStaffFamilies(accounts);
    const total = families.reduce((sum, f) => sum + f.total, 0);
    expect(total).toBe(1);
  });

  it('returns zero counts for an empty roster', () => {
    const families = computeStaffFamilies([]);
    expect(families.every((f) => f.total === 0)).toBe(true);
    expect(families.every((f) => f.roles.every((r) => r.count === 0))).toBe(
      true
    );
  });

  it('returns families and roles in the documented display order', () => {
    const families = computeStaffFamilies([]);

    expect(families.map((f) => f.key)).toEqual([
      'academics',
      'admissions-enrollment',
      'admin',
    ]);

    expect(
      families.find((f) => f.key === 'academics')!.roles.map((r) => r.role)
    ).toEqual(['teacher', 'academic_coordinator']);
    // Deliberately NOT ROLES' declaration order (which lists p_file_officer
    // before admissions) — 'admissions' reads first here to match the
    // "Admissions & Enrollment" family label.
    expect(
      families
        .find((f) => f.key === 'admissions-enrollment')!
        .roles.map((r) => r.role)
    ).toEqual(['admissions', 'p_file_officer']);
    expect(
      families.find((f) => f.key === 'admin')!.roles.map((r) => r.role)
    ).toEqual(['school_admin', 'superadmin']);
  });
});
