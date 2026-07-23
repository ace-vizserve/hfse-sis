import type { Role } from '@/lib/auth/roles';

export type StaffFamily = {
  key: string;
  label: string;
  total: number;
  roles: { role: Role; label: string; count: number }[];
};

// Display-only grouping (KD #155) — not a schema/access concept. Each role
// appears in exactly one family; role order within each family matches the
// approved mockup (not necessarily ROLES' declaration order in
// lib/auth/roles.ts — e.g. 'admissions' is listed before 'p_file_officer'
// here to read naturally against the "Admissions & Enrollment" label).
export function computeStaffFamilies(
  accounts: { role: Role | null }[]
): StaffFamily[] {
  const countByRole = new Map<Role, number>();
  for (const a of accounts) {
    if (!a.role) continue;
    countByRole.set(a.role, (countByRole.get(a.role) ?? 0) + 1);
  }

  const families: StaffFamily[] = [
    {
      key: 'academics',
      label: 'Academics',
      total: 0,
      roles: [
        { role: 'teacher', label: 'Teacher', count: 0 },
        {
          role: 'academic_coordinator',
          label: 'Academic Coordinator',
          count: 0,
        },
      ],
    },
    {
      key: 'admissions-enrollment',
      label: 'Admissions & Enrollment',
      total: 0,
      roles: [
        { role: 'admissions', label: 'Admissions', count: 0 },
        { role: 'p_file_officer', label: 'P-File Officer', count: 0 },
      ],
    },
    {
      key: 'admin',
      label: 'Admin',
      total: 0,
      roles: [
        { role: 'school_admin', label: 'School Admin', count: 0 },
        { role: 'superadmin', label: 'Superadmin', count: 0 },
      ],
    },
  ];

  for (const family of families) {
    for (const r of family.roles) {
      r.count = countByRole.get(r.role) ?? 0;
      family.total += r.count;
    }
  }

  return families;
}
