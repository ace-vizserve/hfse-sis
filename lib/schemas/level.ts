import { z } from 'zod';

// Level creation schema — used by the admissions-driven level reconciliation
// flow when a new level needs to be created from an observed label.
//
// - `label`: the exact observed level label (e.g., "Primary One", "Form 3").
//   This is the value from `levelApplied` in admissions data, pre-filled but
//   editable by the registrar.
// - `code`: the short internal identifier (e.g., "P1", "S3", "YS-L").
//   Matches the existing LEVEL_CODES pattern.
// - `level_type`: one of three categories (primary, secondary, preschool).
//   Used for audience-scoping (calendar/attendance) and section grouping.

export const LEVEL_TYPE_VALUES = ['primary', 'secondary', 'preschool'] as const;
export type LevelType = (typeof LEVEL_TYPE_VALUES)[number];

const uuidString = z.string().uuid('Invalid id');

export const LevelCreateSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(120, 'Keep label under 120 chars'),
  code: z
    .string()
    .trim()
    .min(1, 'Code required')
    .max(10, 'Keep code under 10 chars')
    .regex(/^[A-Z0-9-]+$/, 'Code must be uppercase letters, digits, or hyphen'),
  level_type: z.enum(LEVEL_TYPE_VALUES),
});

export type LevelCreateInput = z.infer<typeof LevelCreateSchema>;

// Level remap schema — used to remap an observed label to an existing level.
//
// - `fromLabel`: the raw observed label (the exact string from admissions data
//   that needs to be corrected).
// - `toLevelId`: the uuid of the target level in public.levels to remap to.

export const LevelRemapSchema = z.object({
  fromLabel: z.string().trim().min(1, 'Label required'),
  toLevelId: uuidString,
});

export type LevelRemapInput = z.infer<typeof LevelRemapSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Grade-level admin CRUD schemas — Levels & Grade Progression (migration
// 078). Back POST/PATCH/DELETE `/api/sis/admin/levels[...]`, the managed
// `levels` table (sort_order / next_level_id / is_core) + per-AY
// `ay_level_offerings`.
//
// Named with an `Admin` prefix (not `LevelCreateSchema`/`LevelUpdateSchema`)
// to avoid colliding with `LevelCreateSchema` above, which is a DIFFERENT,
// already-shipped schema for the admissions-level-review reconciliation
// flow ({ label, code, level_type }, no sortOrder/nextLevelId — a distinct
// feature that predates this one and has its own tests in
// __tests__/schemas/level.test.ts). Reuses `LEVEL_TYPE_VALUES` from above —
// same three-value vocabulary, no need to redefine.
// ─────────────────────────────────────────────────────────────────────────

// POST /api/sis/admin/levels — create a new VOLATILE level (is_core is
// never accepted from the client; the route always inserts is_core=false).
export const LevelAdminCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code required')
    .max(8, 'Keep code under 8 chars')
    .regex(
      /^[A-Z0-9-]{1,8}$/,
      'Code must be 1-8 uppercase letters, digits, or hyphens'
    ),
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(80, 'Keep label under 80 chars'),
  levelType: z.enum(LEVEL_TYPE_VALUES),
  sortOrder: z
    .number()
    .int('Sort order must be a whole number')
    .min(1, 'Sort order must be at least 1')
    .max(99, 'Sort order must be 99 or less'),
  nextLevelId: z.string().uuid('Invalid id').nullable(),
});
export type LevelAdminCreateInput = z.infer<typeof LevelAdminCreateSchema>;

// PATCH /api/sis/admin/levels/[id] — partial update. `code` and `levelType`
// are intentionally not editable here (code is the stable FK-friendly
// identifier; level_type reclassification isn't a supported operation).
export const LevelAdminUpdateSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, 'Label required')
      .max(80, 'Keep label under 80 chars')
      .optional(),
    sortOrder: z
      .number()
      .int('Sort order must be a whole number')
      .min(1, 'Sort order must be at least 1')
      .max(99, 'Sort order must be 99 or less')
      .optional(),
    nextLevelId: z.string().uuid('Invalid id').nullable().optional(),
  })
  .refine(
    (v) =>
      v.label !== undefined ||
      v.sortOrder !== undefined ||
      v.nextLevelId !== undefined,
    { message: 'At least one field required' }
  );
export type LevelAdminUpdateInput = z.infer<typeof LevelAdminUpdateSchema>;

// PUT /api/sis/admin/levels/[id]/offering — toggle a volatile level's
// per-AY offering row. Core levels reject this at the route (always
// offered, no ay_level_offerings row needed).
export const LevelOfferingSchema = z.object({
  academicYearId: uuidString,
  offered: z.boolean(),
});
export type LevelOfferingInput = z.infer<typeof LevelOfferingSchema>;
