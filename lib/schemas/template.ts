import { z } from 'zod';

import { SCHEDULE_VALUES, SECTION_CLASS_TYPES } from '@/lib/schemas/section';

// Master template tables that new AYs copy from. Mirrors the per-AY
// schemas (`section.ts`, `subject-config.ts`) minus `academic_year_id`.

const uuidString = z.string().uuid('Invalid id');

export const TemplateSectionCreateSchema = z.object({
  level_id: uuidString,
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(60, 'Keep it under 60 chars'),
  // Doubles as the Secondary "track" picker — required-for-Secondary is
  // enforced server-side (route resolves the level's level_type) — see
  // POST /api/sis/admin/template/sections.
  class_type: z.enum(SECTION_CLASS_TYPES).nullable().optional(),
  schedule: z.enum(SCHEDULE_VALUES).nullable().optional(),
});
export type TemplateSectionCreateInput = z.infer<
  typeof TemplateSectionCreateSchema
>;

export const TemplateSectionUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(60, 'Keep it under 60 chars'),
  class_type: z.enum(SECTION_CLASS_TYPES).nullable().optional(),
  schedule: z.enum(SCHEDULE_VALUES).nullable().optional(),
});
export type TemplateSectionUpdateInput = z.infer<
  typeof TemplateSectionUpdateSchema
>;

// Same wire shape as `SubjectConfigUpdateSchema` — integer percentages,
// route converts to numeric(4,2) on write.
export const TemplateSubjectConfigUpdateSchema = z
  .object({
    ww_weight: z.number().int().min(0).max(100),
    pt_weight: z.number().int().min(0).max(100),
    qa_weight: z.number().int().min(0).max(100),
    ww_max_slots: z.number().int().min(1).max(5),
    pt_max_slots: z.number().int().min(1).max(5),
    qa_max: z.number().int().min(1).max(100),
  })
  .refine((v) => v.ww_weight + v.pt_weight + v.qa_weight === 100, {
    message: 'WW + PT + QA must sum to 100',
    path: ['qa_weight'],
  });
export type TemplateSubjectConfigUpdateInput = z.infer<
  typeof TemplateSubjectConfigUpdateSchema
>;

// POST /api/sis/admin/template/subject-configs — create the master weight
// config for a subject (migration 080 collapse: one row per subject, no
// level dimension). Mirrors `TemplateSubjectConfigUpdateSchema` but adds the
// foreign-key field the INSERT needs. Same percent → numeric(4,2)
// conversion + sum-constraint guard.
export const TemplateSubjectConfigCreateSchema = z
  .object({
    subject_id: uuidString,
    ww_weight: z.number().int().min(0).max(100),
    pt_weight: z.number().int().min(0).max(100),
    qa_weight: z.number().int().min(0).max(100),
    ww_max_slots: z.number().int().min(1).max(5),
    pt_max_slots: z.number().int().min(1).max(5),
    qa_max: z.number().int().min(1).max(100),
  })
  .refine((v) => v.ww_weight + v.pt_weight + v.qa_weight === 100, {
    message: 'WW + PT + QA must sum to 100',
    path: ['qa_weight'],
  });
export type TemplateSubjectConfigCreateInput = z.infer<
  typeof TemplateSubjectConfigCreateSchema
>;

// PUT /api/sis/admin/template/subject-level-offerings — attach/detach a
// subject to/from a level in the master template
// (`template_subject_level_offerings`, migration 080). AY-agnostic sibling
// of `LevelOfferingSchema` (lib/schemas/level.ts) — no `academicYearId`
// since the template itself has no AY dimension.
export const TemplateSubjectLevelOfferingToggleSchema = z.object({
  subject_id: uuidString,
  level_id: uuidString,
  offered: z.boolean(),
});
export type TemplateSubjectLevelOfferingToggleInput = z.infer<
  typeof TemplateSubjectLevelOfferingToggleSchema
>;

// POST /api/sis/admin/template/apply — propagate template to selected AYs.
export const ApplyTemplateSchema = z.object({
  ay_codes: z
    .array(z.string().regex(/^AY[0-9]{4}$/, 'Expected format AY2027'))
    .min(1, 'Pick at least one AY'),
});
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateSchema>;
