import { z } from 'zod';

import {
  ADMISSION_SCHEDULES,
  ADMISSION_TRACKS,
} from '@/lib/admissions/options';

// Write payloads for /api/sis/admission-options/** (migration 174) — what the
// enrolment forms offer parents, per academic year.
//
// Labels are trimmed here because the table's CHECK refuses a label with
// surrounding whitespace (`level_label = btrim(level_label)`); trimming first
// turns a stray space from a 500 into a saved row.

const ayCode = z
  .string()
  .trim()
  .regex(/^AY\d{4}$/i, 'Academic year must look like AY2027')
  .transform((v) => v.toUpperCase());

const label = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} is required`)
    .max(200, `Keep the ${what.toLowerCase()} under 200 characters`);

const levelLabel = label('Level name');
const classTypeLabel = label('Class type');
const levelId = z.string().uuid('Choose the level it counts as');
const track = z.enum(ADMISSION_TRACKS, {
  message: 'Choose Global or Standard',
});

/** PATCH /api/sis/admission-options/[id] — open or close one session. */
export const AdmissionOptionToggleSchema = z.object({
  isOpen: z.boolean(),
});
export type AdmissionOptionToggleInput = z.infer<
  typeof AdmissionOptionToggleSchema
>;

/**
 * PATCH /api/sis/admission-options/bulk — open or close many sessions of one
 * year at once (the matrix's bulk bar). Ids are de-duplicated.
 */
export const AdmissionOptionBulkToggleSchema = z.object({
  ayCode,
  optionIds: z
    .array(z.string().uuid('Unknown option'))
    .min(1, 'Choose at least one session')
    .max(200, 'Change at most 200 sessions at a time')
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
  isOpen: z.boolean(),
});
export type AdmissionOptionBulkToggleInput = z.infer<
  typeof AdmissionOptionBulkToggleSchema
>;

/** POST /api/sis/admission-options — one row per chosen session. */
export const AdmissionOptionCreateSchema = z.object({
  ayCode,
  levelLabel,
  levelId,
  classTypeLabel,
  track,
  schedules: z
    .array(z.enum(ADMISSION_SCHEDULES))
    .min(1, 'Choose at least one session')
    .transform((list) => ADMISSION_SCHEDULES.filter((s) => list.includes(s))),
});
export type AdmissionOptionCreateInput = z.infer<
  typeof AdmissionOptionCreateSchema
>;

/**
 * PATCH /api/sis/admission-options/group — edit one (level name, class type)
 * combination: every session row it has changes together.
 */
export const AdmissionOptionGroupEditSchema = z.object({
  ayCode,
  fromLevelLabel: z.string().min(1),
  fromClassTypeLabel: z.string().min(1),
  levelLabel,
  levelId,
  classTypeLabel,
  track,
});
export type AdmissionOptionGroupEditInput = z.infer<
  typeof AdmissionOptionGroupEditSchema
>;

/** POST /api/sis/admission-options/copy — seed an empty year from another. */
export const AdmissionOptionCopySchema = z
  .object({ fromAy: ayCode, toAy: ayCode })
  .refine((v) => v.fromAy !== v.toAy, {
    message: 'Choose a different year to copy from',
    path: ['fromAy'],
  });
export type AdmissionOptionCopyInput = z.infer<
  typeof AdmissionOptionCopySchema
>;
