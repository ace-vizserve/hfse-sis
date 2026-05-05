import { z } from 'zod';

// User-provisioning schemas for /sis/admin/users. Superadmin-only surface.
// `role` values match the `Role` union in lib/auth/roles.ts (KD #2). Kept
// as a literal zod enum here so the runtime value list doesn't drift from
// the type-level union — if you add a role, update both.

const RoleEnum = z.enum([
  'teacher',
  'registrar',
  'school_admin',
  'superadmin',
  'p-file',
  'admissions',
]);
export type AssignableRole = z.infer<typeof RoleEnum>;

export const InviteUserSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Valid email required'),
  role: RoleEnum,
  displayName: z.string().trim().max(120).optional(),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

// PATCH /api/sis/admin/users/[id] — partial update. All fields optional.
// Passing `role: "x"` updates app_metadata.role; `disabled: true` bans the
// user indefinitely via `ban_duration`; `disabled: false` lifts the ban.
export const UpdateUserSchema = z
  .object({
    role: RoleEnum.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.disabled !== undefined, {
    message: 'At least one field (role or disabled) required',
  });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
