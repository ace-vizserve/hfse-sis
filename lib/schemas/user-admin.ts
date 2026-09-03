import { z } from 'zod';

// User-provisioning schemas for /sis/admin/users. Superadmin-only surface.
// `role` values match the `Role` union in lib/auth/roles.ts (KD #2). Kept
// as a literal zod enum here so the runtime value list doesn't drift from
// the type-level union — if you add a role, update both.

const RoleEnum = z.enum([
  'teacher',
  'academic_coordinator',
  'school_admin',
  'superadmin',
  'p_file_officer',
  'admissions',
]);
export type AssignableRole = z.infer<typeof RoleEnum>;

// An account may hold more than one role — a school_admin who also teaches is
// the case this exists for. `role` is therefore a LIST of what the account may
// be, and `active_role` (written by the routes, never by this form) names the
// one in force. There is still exactly one role in force at any moment, which
// is what lets every gate, policy and per-role view stay as it is.
//
// Constraints, both of which protect a person from being locked out:
//   * at least one role — an account with none reads as a parent app-wide and
//     is bounced to the parent portal.
//   * no duplicates — `['teacher','teacher']` is a typo, not a grant, and it
//     would make the "how many roles do you hold" test say two.
const RoleListSchema = z
  .array(RoleEnum)
  .min(1, 'Pick at least one role')
  .max(6)
  .refine((roles) => new Set(roles).size === roles.length, {
    message: 'Each role can only be picked once',
  });

/**
 * Accepts either shape and always answers with a list.
 *
 * The 44 live accounts still store a single role string and there is no
 * backfill — they move to the list as they are edited — so both the API and
 * anything reading a stored value has to cope with both. One spelling of that,
 * here, rather than a ternary at each call site.
 */
const RoleOrRoleListSchema = z
  .union([RoleEnum, RoleListSchema])
  .transform((value): AssignableRole[] =>
    Array.isArray(value) ? value : [value]
  );

// Direct-create provisioning — sole path now that the magic-link invite
// flow has been removed. The invite flow had no dedicated password-setup
// landing page, which left invited users signed in once but unable to
// reauthenticate from /login (which is signInWithPassword-only). The
// direct-create path sets the password upfront + email_confirm: true, so
// the user can sign in immediately with the credentials the superadmin
// shares out-of-band.
export const InviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email required'),
  // One role or several — see `RoleOrRoleListSchema`. Always arrives as a list.
  role: RoleOrRoleListSchema,
  /**
   * Which of those roles the account starts in. Optional: left out, the first
   * one wins, which is the only sensible default for an account nobody has
   * signed into yet.
   *
   * ⚠ NOT NAMED `activeRole`, ON PURPOSE.
   * `__tests__/auth/active-role-never-authorises.test.ts` scans every API route
   * for that identifier — it belongs to the role-switching lens, and a route
   * naming it is how a viewer-chosen value gets inside an access decision. This
   * field is a superadmin's choice at creation time, not the viewer's, so it
   * gets a name that cannot be confused for one.
   */
  startingRole: RoleEnum.optional(),
  displayName: z.string().trim().max(120).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be 72 characters or fewer'),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

// PATCH /api/sis/admin/users/[id] — partial update. All fields optional.
// Passing `role` (one role, or a list of them) replaces the set of roles the
// account may hold; `disabled: true` bans the user indefinitely via
// `ban_duration`; `disabled: false` lifts the ban. `displayName`, `email`, and
// `password` are superadmin-only (enforced in the route handler, not the
// schema).
//
// ⚠ NO `activeRole` HERE, DELIBERATELY. Which of their roles a person is
// working in is their own choice, made from the role switcher; a superadmin
// grants and removes roles. The route keeps the two consistent — if the role
// being used is taken away, it moves the account to one it still holds.
export const UpdateUserSchema = z
  .object({
    role: RoleOrRoleListSchema.optional(),
    disabled: z.boolean().optional(),
    displayName: z.string().trim().max(120).optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Valid email required')
      .optional(),
    password: z.string().min(8).max(72).optional(),
  })
  .refine(
    (v) =>
      v.role !== undefined ||
      v.disabled !== undefined ||
      v.displayName !== undefined ||
      v.email !== undefined ||
      v.password !== undefined,
    { message: 'At least one field required' }
  );
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
