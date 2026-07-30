import { z } from 'zod';

import { ALL_CAPABILITIES, isCapability } from '@/lib/auth/capabilities';
import { ROLES } from '@/lib/auth/roles';

/**
 * Body for `PATCH /api/sis/admin/role-permissions` — replaces ONE role's whole
 * capability set.
 *
 * Replace rather than add/remove-a-single-grant, because the editor shows the
 * role's full set and saves it as one decision: an add/remove API would let two
 * concurrent editors interleave into a state neither of them chose.
 *
 * `capability` is validated against the code's own list, not a free string.
 * A row naming a capability nothing gates on would appear granted in the editor
 * and enforce nothing — the exact failure the code/data split exists to prevent.
 */
export const RolePermissionsUpdateSchema = z.object({
  role: z.enum(ROLES as unknown as [string, ...string[]]),
  capabilities: z
    .array(
      z.string().refine(isCapability, {
        message: 'Unknown capability',
      })
    )
    // A role legitimately holds none (that is how you revoke everything), so
    // an empty array is valid. Duplicates are collapsed rather than rejected —
    // the primary key would reject them anyway, and a duplicate is a client
    // slip, not an attempt at anything.
    .transform((caps) => [...new Set(caps)]),
});

export type RolePermissionsUpdate = z.infer<typeof RolePermissionsUpdateSchema>;

/**
 * Capabilities that must always have at least one holder, checked after a
 * proposed edit. Both would strand the school with no route back:
 *
 *   * staff.manage_accounts — nobody could create or repair a login. Note
 *     superadmin holds it and superadmin is not editable, so in practice this
 *     is a belt; it exists so the invariant is stated rather than inferred from
 *     which row happens to be locked.
 *   * grade_changes.approve — school_admin is the ONLY holder today and IS
 *     editable, so this one is live. Emptying it would leave every locked-sheet
 *     change request permanently un-decidable, and `decide.ts` rejects even a
 *     superadmin, so there would be no break-glass.
 */
export const MUST_HAVE_A_HOLDER = [
  'staff.manage_accounts',
  'grade_changes.approve',
] as const;

// Guards the constant against a rename of either capability.
if (!MUST_HAVE_A_HOLDER.every(isCapability)) {
  throw new Error(
    `MUST_HAVE_A_HOLDER names a capability that no longer exists. Known: ${ALL_CAPABILITIES.join(', ')}`
  );
}

/**
 * Which must-have capabilities a proposed edit would leave with no holder.
 *
 * Pure, and the single implementation — the route calls this rather than
 * inlining the same filter, so the guard the tests exercise is the guard that
 * actually runs. Evaluated against the state the save WOULD produce: every
 * grant except this role's, plus whatever this role is keeping.
 */
export function findOrphanedCapabilities(
  allGrants: ReadonlyArray<{ role: string; capability: string }>,
  role: string,
  next: readonly string[]
): string[] {
  return MUST_HAVE_A_HOLDER.filter((capability) => {
    const heldElsewhere = allGrants.some(
      (g) => g.capability === capability && g.role !== role
    );
    return !heldElsewhere && !next.includes(capability);
  });
}
