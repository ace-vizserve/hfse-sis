import { z } from 'zod';

// PATCH /api/sis/admin/subjects/[configId]
//
// Weights in the UI + API are integer percentages (0–100). The DB stores
// them as numeric(4,2) summing to 1.00, so the route converts on write.
// Going integer in the user-facing schema avoids float drift in the sum
// constraint and matches how registrars think about weights ("forty-forty-
// twenty").

export const SubjectConfigUpdateSchema = z
  .object({
    ww_weight: z.number().int().min(0).max(100),
    pt_weight: z.number().int().min(0).max(100),
    qa_weight: z.number().int().min(0).max(100),
    ww_max_slots: z.number().int().min(1).max(5),
    pt_max_slots: z.number().int().min(1).max(5),
    // Max possible QA score for this (subject × level × AY). Default 30
    // per Hard Rule #1 canonical case; registrars can vary (e.g. 50 for
    // Math, 20 for Art).
    qa_max: z.number().int().min(1).max(100),
  })
  .refine((v) => v.ww_weight + v.pt_weight + v.qa_weight === 100, {
    message: 'WW + PT + QA must sum to 100',
    path: ['qa_weight'],
  });

export type SubjectConfigUpdateInput = z.infer<
  typeof SubjectConfigUpdateSchema
>;

// POST /api/sis/admin/subjects — create the per-AY weight config for a
// subject. One row per (subject, academic_year_id) since migration 080
// collapsed subject_configs off the level dimension; which levels the
// subject is taught at is a separate concern (subject_level_offerings).
// Same percent → numeric(4,2) conversion + sum-constraint guard as
// SubjectConfigUpdateSchema, mirrors TemplateSubjectConfigCreateSchema.
export const SubjectConfigCreateSchema = z
  .object({
    academic_year_id: z.string().uuid(),
    subject_id: z.string().uuid(),
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
export type SubjectConfigCreateInput = z.infer<
  typeof SubjectConfigCreateSchema
>;

// PUT /api/sis/admin/subjects/level-offerings — attach/detach a subject
// to/from a level for a specific academic year, via
// `subject_level_offerings` (migration 080). AY-scoped sibling of
// `TemplateSubjectLevelOfferingToggleSchema` (lib/schemas/template.ts),
// which is the AY-agnostic template equivalent.
export const SubjectLevelOfferingToggleSchema = z.object({
  subject_id: z.string().uuid(),
  level_id: z.string().uuid(),
  academic_year_id: z.string().uuid(),
  offered: z.boolean(),
});
export type SubjectLevelOfferingToggleInput = z.infer<
  typeof SubjectLevelOfferingToggleSchema
>;

// PUT /api/sis/admin/subjects/[subjectId]/report-map — which subject's
// report-card column this subject's grades roll up into
// (`subject_report_map`, migration 080 — global, no AY/level dimension).
export const SubjectReportMapUpdateSchema = z.object({
  report_subject_id: z.string().uuid(),
});
export type SubjectReportMapUpdateInput = z.infer<
  typeof SubjectReportMapUpdateSchema
>;
