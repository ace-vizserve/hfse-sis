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

// Secondary curriculum track (migration 084) — a bulk-assignment TRIGGER
// only, never authoritative over what subjects a section actually carries
// (`section_subjects`, migration 079, stays the sole source of truth for
// that). Nullable/no-default at the DB level; Primary sections and any
// section predating this feature simply have `track = null`. Required at
// the APPLICATION layer only, and only for Secondary sections — never
// inferred from level code, always an explicit registrar choice (the
// direct lesson from `sections.curriculum_track`, migration 058, ripped
// out a few weeks after shipping for doing the opposite of both of these).
export const TRACK_VALUES = ['global', 'standard'] as const;
export type Track = (typeof TRACK_VALUES)[number];
export const TRACK_LABELS: Record<Track, string> = {
  global: 'Global',
  standard: 'Standard',
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
  // Required-for-Secondary is enforced server-side (the route knows the
  // level's level_type; this schema alone doesn't) — see
  // POST /api/sections. Absent/null is valid at the schema layer so a
  // Primary submission genuinely omits the field rather than sending a
  // hidden default.
  track: z.enum(TRACK_VALUES).nullable().optional(),
  // NOTE: `schedule` is intentionally NOT here. Section schedule is owned by the
  // class template (set in the SIS Admin template editor → propagated via
  // apply_template_to_ay); per-AY `/sis/sections` shows it read-only. The
  // per-AY `/api/sections` create/rename routes deliberately don't write it, so
  // it's kept off this schema to avoid advertising a field the route drops.
  // SCHEDULE_VALUES/SCHEDULE_LABELS live here for the template schema + display.
});

export type SectionCreateInput = z.infer<typeof SectionCreateSchema>;

// POST /api/sections/[id]/track — bulk-apply a track bundle to an
// existing section (or change it). Same value set as SectionCreateSchema's
// `track`, but required here — this route's whole purpose is setting one.
export const SectionTrackAssignSchema = z.object({
  track: z.enum(TRACK_VALUES),
});
export type SectionTrackAssignInput = z.infer<typeof SectionTrackAssignSchema>;

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
