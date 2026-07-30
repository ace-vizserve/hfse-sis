/**
 * The two guardrails on the permissions editor, and the schema that feeds it.
 *
 * These matter more than most tests here: the surface they protect can, in one
 * save, make the system unusable in a way no other surface can. The
 * last-holder guard is the live one — school_admin is the only role that can
 * approve a grade change, and `decide.ts` rejects even a superadmin, so
 * emptying that permission would leave every locked-sheet change request
 * permanently un-decidable with no break-glass.
 */
import { describe, expect, it } from 'vitest';

import {
  MUST_HAVE_A_HOLDER,
  RolePermissionsUpdateSchema,
  findOrphanedCapabilities,
} from '@/lib/schemas/role-permissions';
import {
  ALL_CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
} from '@/lib/auth/capabilities';
import { ROLES } from '@/lib/auth/roles';

/** The seeded state, in the shape the route reads from the table. */
const SEEDED = ROLES.flatMap((role) =>
  DEFAULT_ROLE_CAPABILITIES[role].map((capability) => ({ role, capability }))
);

describe('RolePermissionsUpdateSchema', () => {
  it('accepts a known role with known capabilities', () => {
    const result = RolePermissionsUpdateSchema.safeParse({
      role: 'p_file_officer',
      capabilities: ['documents_pre_enrolment.validate'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty list — that is how you revoke everything', () => {
    const result = RolePermissionsUpdateSchema.safeParse({
      role: 'teacher',
      capabilities: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a capability nothing gates on', () => {
    // The failure this prevents: a row that looks granted in the editor and
    // enforces nothing anywhere.
    const result = RolePermissionsUpdateSchema.safeParse({
      role: 'teacher',
      capabilities: ['payroll.write'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a role the code does not know', () => {
    const result = RolePermissionsUpdateSchema.safeParse({
      role: 'registrar', // renamed to academic_coordinator in migration 092
      capabilities: [],
    });
    expect(result.success).toBe(false);
  });

  it('collapses duplicates rather than failing on them', () => {
    const result = RolePermissionsUpdateSchema.safeParse({
      role: 'teacher',
      capabilities: ['sections.read', 'sections.read'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(['sections.read']);
    }
  });
});

describe('MUST_HAVE_A_HOLDER', () => {
  it('names only real capabilities', () => {
    // The module throws at import if this drifts; assert it here too so the
    // failure names the constant rather than surfacing as an import error.
    for (const capability of MUST_HAVE_A_HOLDER) {
      expect(isCapability(capability), `${capability} no longer exists`).toBe(
        true
      );
    }
  });

  it('each one currently has a holder', () => {
    // If the seed itself violated this, the guard would be unsatisfiable and
    // every save would fail.
    for (const capability of MUST_HAVE_A_HOLDER) {
      const holders = SEEDED.filter((g) => g.capability === capability);
      expect(holders.length, `nobody holds ${capability}`).toBeGreaterThan(0);
    }
  });
});

describe('findOrphanedCapabilities', () => {
  it('refuses to let the last approver of grade changes go', () => {
    // school_admin is the only holder in the seeded state.
    const holders = SEEDED.filter(
      (g) => g.capability === 'grade_changes.approve'
    );
    expect(holders.map((h) => h.role)).toEqual(['school_admin']);

    const next = DEFAULT_ROLE_CAPABILITIES.school_admin.filter(
      (c) => c !== 'grade_changes.approve'
    );
    expect(findOrphanedCapabilities(SEEDED, 'school_admin', next)).toEqual([
      'grade_changes.approve',
    ]);
  });

  it('allows the removal once another role holds it', () => {
    const withSecondHolder = [
      ...SEEDED,
      { role: 'academic_coordinator', capability: 'grade_changes.approve' },
    ];
    const next = DEFAULT_ROLE_CAPABILITIES.school_admin.filter(
      (c) => c !== 'grade_changes.approve'
    );
    expect(
      findOrphanedCapabilities(withSecondHolder, 'school_admin', next)
    ).toEqual([]);
  });

  it('is satisfied when the role being edited keeps the capability', () => {
    expect(
      findOrphanedCapabilities(
        SEEDED,
        'school_admin',
        DEFAULT_ROLE_CAPABILITIES.school_admin
      )
    ).toEqual([]);
  });

  it('ignores capabilities that are not must-have', () => {
    // Revoking everything from a role with no protected capability is allowed.
    expect(findOrphanedCapabilities(SEEDED, 'teacher', [])).toEqual([]);
  });

  it('does not count the edited role as a holder elsewhere', () => {
    // The bug this pins: reading holders from the WHOLE table, including the
    // rows this save is about to delete, would make the guard never fire.
    const onlyHolder = [
      { role: 'school_admin', capability: 'grade_changes.approve' },
      { role: 'school_admin', capability: 'staff.manage_accounts' },
    ];
    expect(findOrphanedCapabilities(onlyHolder, 'school_admin', [])).toEqual([
      'staff.manage_accounts',
      'grade_changes.approve',
    ]);
  });
});

describe('the editor surface', () => {
  it('is gated on the superadmin ROLE, never on a capability', () => {
    // A capability controlling access to the capability editor could be
    // revoked, locking its holder out of the only surface that could put it
    // back. There is deliberately no `roles.manage` capability.
    expect(ALL_CAPABILITIES.some((c) => c.startsWith('roles.'))).toBe(false);
    expect(ALL_CAPABILITIES.some((c) => c.includes('permission'))).toBe(false);
  });
});
