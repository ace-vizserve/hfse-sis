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
