import { z } from 'zod';

// POST /api/sections — create a new section under the current AY.
//
// Scope: mid-year additions (e.g. a late transfer needs a new homeroom).
// AY rollover still happens via `create_academic_year` (copy-forward from
// prior AY). Uniqueness constraint: (academic_year_id, level_id, name) —
// API surfaces a friendly 409 on conflict.

export const SECTION_CLASS_TYPES = ['Global', 'Standard'] as const;
export type SectionClassType = (typeof SECTION_CLASS_TYPES)[number];

// Structured daily schedule for a section. Drives future auto-enrollment
// (matching an applicant's preferred schedule against the section's). YS
// (preschool) deferred. `null` = unspecified.
export const SCHEDULE_VALUES = ['morning', 'afternoon', 'whole_day'] as const;
export type Schedule = (typeof SCHEDULE_VALUES)[number];
export const SCHEDULE_LABELS: Record<Schedule, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  whole_day: 'Whole Day',
};

const uuidString = z.string().uuid('Invalid id');

export const SectionCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(60, 'Keep it under 60 chars'),
  level_id: uuidString,
  class_type: z.enum(SECTION_CLASS_TYPES).nullable().optional(),
  // NOTE: `schedule` is intentionally NOT here. Section schedule is owned by the
  // class template (set in the SIS Admin template editor → propagated via
  // apply_template_to_ay); per-AY `/sis/sections` shows it read-only. The
  // per-AY `/api/sections` create/rename routes deliberately don't write it, so
  // it's kept off this schema to avoid advertising a field the route drops.
  // SCHEDULE_VALUES/SCHEDULE_LABELS live here for the template schema + display.
});

export type SectionCreateInput = z.infer<typeof SectionCreateSchema>;

// PATCH /api/sections/[id] — rename only (see the schedule note above).
// `level_id` and `academic_year_id` are load-bearing joins and can't be
// edited without cascade concerns; class_type is set at creation for now.
export const SectionUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(60, 'Keep it under 60 chars')
    .optional(),
});

export type SectionUpdateInput = z.infer<typeof SectionUpdateSchema>;
