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

export type SubjectConfigUpdateInput = z.infer<typeof SubjectConfigUpdateSchema>;
