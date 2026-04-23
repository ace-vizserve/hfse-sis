import { z } from 'zod';

// Zod schemas for the Evaluation Phase 2 checklist + responses + PTC
// feedback surfaces. Subject / level referenced by UUID per KD #4.

const uuid = z.string().uuid('Invalid id');

// POST /api/evaluation/checklist-items — superadmin only, registrar's
// checklist-topics editor at /sis/admin/evaluation-checklists.
export const ChecklistItemCreateSchema = z.object({
  termId: uuid,
  subjectId: uuid,
  levelId: uuid,
  itemText: z.string().trim().min(1, 'Item text required').max(500, 'Keep it under 500 chars'),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type ChecklistItemCreateInput = z.infer<typeof ChecklistItemCreateSchema>;

// PATCH /api/evaluation/checklist-items/[id] — rename or reorder an item.
export const ChecklistItemUpdateSchema = z.object({
  itemText: z.string().trim().min(1, 'Item text required').max(500).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type ChecklistItemUpdateInput = z.infer<typeof ChecklistItemUpdateSchema>;

// PATCH /api/evaluation/checklist-responses — subject teacher ticks one
// student's response against one item. Upsert on (term, student, item).
export const ChecklistResponseUpsertSchema = z.object({
  termId: uuid,
  sectionId: uuid,
  studentId: uuid,
  checklistItemId: uuid,
  isChecked: z.boolean(),
});
export type ChecklistResponseUpsertInput = z.infer<typeof ChecklistResponseUpsertSchema>;

// PATCH /api/evaluation/subject-comments — teacher per-subject comment
// per student per term. Upsert on (term, student, subject).
export const SubjectCommentUpsertSchema = z.object({
  termId: uuid,
  sectionId: uuid,
  studentId: uuid,
  subjectId: uuid,
  comment: z.string().max(5000, 'Keep the comment under 5,000 chars').nullable().optional(),
});
export type SubjectCommentUpsertInput = z.infer<typeof SubjectCommentUpsertSchema>;

// PATCH /api/evaluation/ptc-feedback — registrar/school_admin records
// parent feedback. Upsert on (term, student).
export const PtcFeedbackUpsertSchema = z.object({
  termId: uuid,
  sectionId: uuid,
  studentId: uuid,
  feedback: z.string().max(10_000, 'Keep feedback under 10,000 chars').nullable().optional(),
});
export type PtcFeedbackUpsertInput = z.infer<typeof PtcFeedbackUpsertSchema>;
