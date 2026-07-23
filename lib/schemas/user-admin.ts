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

// Direct-create provisioning — sole path now that the magic-link invite
// flow has been removed. The invite flow had no dedicated password-setup
// landing page, which left invited users signed in once but unable to
// reauthenticate from /login (which is signInWithPassword-only). The
// direct-create path sets the password upfront + email_confirm: true, so
// the user can sign in immediately with the credentials the superadmin
// shares out-of-band.
export const InviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Valid email required'),
  role: RoleEnum,
  displayName: z.string().trim().max(120).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be 72 characters or fewer'),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

// PATCH /api/sis/admin/users/[id] — partial update. All fields optional.
// Passing `role: "x"` updates app_metadata.role; `disabled: true` bans the
// user indefinitely via `ban_duration`; `disabled: false` lifts the ban.
// `displayName`, `email`, and `password` are superadmin-only (enforced in
// the route handler, not the schema).
export const UpdateUserSchema = z
  .object({
    role: RoleEnum.optional(),
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
