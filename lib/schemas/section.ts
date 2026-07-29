import { z } from 'zod';

// POST /api/sections — create a new section under the current AY.
//
// Scope: mid-year additions (e.g. a late transfer needs a new homeroom).
// AY rollover still happens via `create_academic_year`, which now seeds a
// fixed static default catalog (migration 090) rather than copying from
// the prior AY. Uniqueness constraint: (academic_year_id, level_id, name)
// — API surfaces a friendly 409 on conflict.

export const SECTION_CLASS_TYPES = ['Global', 'Standard'] as const;
export type SectionClassType = (typeof SECTION_CLASS_TYPES)[number];

// Structured daily schedule for a section. Drives future auto-enrollment
// (matching an applicant's preferred schedule against the section's).
// `null` = unspecified.
export const SCHEDULE_VALUES = ['morning', 'afternoon', 'whole_day'] as const;
export type Schedule = (typeof SCHEDULE_VALUES)[number];
export const SCHEDULE_LABELS: Record<Schedule, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  whole_day: 'Whole Day',
};

// Secondary curriculum "track" (Global vs Standard) rides on the EXISTING
// `class_type` field above — there is no separate `track` column. Two
// consumers now share `SECTION_CLASS_TYPES`/`SectionClassType`: (1) the
// admissions auto-enrollment scorer (`lib/sis/class-assignment.ts`), which
// pre-dates this and is untouched; (2) the bulk subject-bundle-apply action
// (`lib/sis/track-bundles.ts` / `POST /api/sections/[id]/track`), added
// alongside the "Config-Driven Subject Registry + Secondary Tracks" plan.
// This is deliberate reuse, not a naming coincidence — a second `track`
// column with the same two values was considered and rejected precisely
// because it would let the two fields silently drift out of sync. Like the
// admissions matcher, the bundle-apply action never gates, filters, or
// restricts what subjects a section can have (`section_subjects`, migration
// 079, stays the sole source of truth for that) — it's a bulk-assignment
// TRIGGER only. `class_type` stays nullable/no-default; required at the
// APPLICATION layer only, and only for Secondary sections — never inferred
// from level code, always an explicit registrar choice (the direct lesson
// from `sections.curriculum_track`, migration 058, ripped out a few weeks
// after shipping for doing the opposite of both of these).

const uuidString = z.string().uuid('Invalid id');

export const SectionCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(60, 'Keep it under 60 chars'),
  level_id: uuidString,
  // Doubles as the Secondary "track" picker — required-for-Secondary is
  // enforced server-side (the route knows the level's level_type; this
  // schema alone doesn't) — see POST /api/sections. Absent/null is valid
  // at the schema layer so a Primary submission genuinely omits the field
  // rather than sending a hidden default.
  class_type: z.enum(SECTION_CLASS_TYPES).nullable().optional(),
  // NOTE: `schedule` is intentionally NOT here. Section schedule is set once
  // at section creation; a new AY's sections instead get their schedule
  // from the fixed static default catalog (`create_academic_year`,
  // migration 090), not carried forward from any prior AY. Per-AY
  // `/sis/sections` shows it read-only. The per-AY `/api/sections`
  // create/rename routes deliberately don't write it, so it's kept off
  // this schema to avoid advertising a field the route drops.
  // SCHEDULE_VALUES/SCHEDULE_LABELS live here for shared display use.
});

export type SectionCreateInput = z.infer<typeof SectionCreateSchema>;

// POST /api/sections/[id]/track — bulk-apply the subject bundle for a
// section's `class_type` (Global/Standard) to an existing section (or
// change its `class_type`, then bulk-apply). Same field/value set as
// SectionCreateSchema's `class_type`, but required here — this route's
// whole purpose is setting one.
export const SectionTrackAssignSchema = z.object({
  class_type: z.enum(SECTION_CLASS_TYPES),
});
export type SectionTrackAssignInput = z.infer<typeof SectionTrackAssignSchema>;

// PATCH /api/sections/[id]/schedule — set (or clear) a section's schedule.
// Deliberately its own route rather than a field on SectionUpdateSchema: see
// the note on SectionCreateSchema above for why `schedule` is kept off the
// create/rename path. `null` is a real, reachable value — a section created
// by hand starts null (the create route doesn't write the field), and the
// registrar must be able to undo a wrong pick, not just overwrite it.
export const SectionScheduleAssignSchema = z.object({
  schedule: z.enum(SCHEDULE_VALUES).nullable(),
});
export type SectionScheduleAssignInput = z.infer<
  typeof SectionScheduleAssignSchema
>;

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
