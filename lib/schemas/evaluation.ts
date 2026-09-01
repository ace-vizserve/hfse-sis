import { z } from 'zod';

import { proseLength } from '@/lib/rich-text';

// Zod schemas for the Student Evaluation module.
// KD #49: the writeup is the sole source of the "Form Class Adviser's
// Comments" field on T1-T3 report cards. Edits stay permissive (KD #28
// soft gate); `submit` is a marker, not a hard lock.

const uuid = z.string().uuid('Invalid id');

// PATCH /api/evaluation/writeups — upsert a single writeup by (term, student).
// `writeup` is nullable so advisers can clear an in-progress draft.
// `submit = true` marks it finalised and stamps `submitted_at` (server-side).
// `submit = false` leaves existing `submitted` state untouched.
export const EvaluationWriteupUpsertSchema = z.object({
  termId: uuid,
  sectionId: uuid,
  studentId: uuid,
  // THE LIMIT IS ON WHAT THE ADVISER TYPED, NOT ON THE STRING WE STORE.
  // The comment box is a formatting editor, so this column holds HTML: a
  // bolded, bulleted comment can carry hundreds of characters of tags the
  // adviser never typed and cannot see. Counting those would reject a comment
  // that is plainly within the limit on screen, with no way to tell why.
  writeup: z
    .string()
    .refine((value) => proseLength(value) <= 10_000, {
      message: 'Keep the write-up under 10,000 characters',
    })
    .nullable()
    .optional(),
  submit: z.boolean().optional(),
});

export type EvaluationWriteupUpsertInput = z.infer<
  typeof EvaluationWriteupUpsertSchema
>;

// PUT /api/evaluation/terms/[termId]/config — open or close the evaluation
// window for a term. Virtue theme lives on `terms.virtue_theme` (edited in
// SIS Admin); this only toggles the is_open flag.
export const EvaluationTermConfigSchema = z.object({
  isOpen: z.boolean(),
});

export type EvaluationTermConfigInput = z.infer<
  typeof EvaluationTermConfigSchema
>;
