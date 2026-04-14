import { z } from 'zod';

export const NewSheetSchema = z.object({
  term_id: z.string().uuid('Pick a term'),
  section_id: z.string().uuid('Pick a section'),
  subject_id: z.string().uuid('Pick a subject'),
  ww_slots: z
    .number()
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(5, 'Max 5 slots per project rules'),
  ww_each: z.number().int('Must be a whole number').min(1, 'Must be at least 1'),
  pt_slots: z
    .number()
    .int('Must be a whole number')
    .min(0, 'Cannot be negative')
    .max(5, 'Max 5 slots per project rules'),
  pt_each: z.number().int('Must be a whole number').min(1, 'Must be at least 1'),
  qa_total: z.number().int('Must be a whole number').min(1, 'Must be at least 1'),
  teacher_name: z.string().trim().optional(),
});

export type NewSheetInput = z.infer<typeof NewSheetSchema>;
