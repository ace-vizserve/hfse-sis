import { z } from 'zod';

// Scheme of Work — the shapes every SOW route and writer shares.

export const SowTrackSchema = z.enum(['Standard', 'Global']);

/** One scheme of work is a subject x level x track in one term. */
export const SowKeySchema = z.object({
  termId: z.string().uuid(),
  subjectId: z.string().uuid(),
  levelId: z.string().uuid(),
  track: SowTrackSchema,
});

export const CreateSowSchema = z.object({
  key: SowKeySchema,
  sectionIds: z
    .array(z.string().uuid())
    .min(1, 'Tick at least one class.')
    .max(50),
  start: z.enum(['blank', 'copy']),
});
export type CreateSowInput = z.infer<typeof CreateSowSchema>;

// ── The approved snapshot ───────────────────────────────────────────────────
//
// `schemes_of_work.approved_snapshot` is a frozen copy of the module and the
// weeks, taken when a scheme is approved. APPROVAL WRITES IT; "copy from last
// year" READS IT. This schema is the contract between the two, so a change to
// it is a change to both.

const text = z.string().nullish();

/** Module details, keyed by the names the editor uses. */
export const SowModuleSchema = z.record(z.string(), z.unknown());

export const SowSnapshotWeekSchema = z.object({
  weekNumber: z.number().int().min(1),
  topic: text,
  learningOutcomes: text,
  textbookPages: text,
  activities: text,
  assessment: text,
  remarks: text,
});
export type SowSnapshotWeek = z.infer<typeof SowSnapshotWeekSchema>;

export const SowSnapshotSchema = z.object({
  module: SowModuleSchema,
  // Two entries for one week number would collide on the weeks table's unique
  // (sow_id, week_number), so a snapshot like that is unreadable, not a crash.
  weeks: z
    .array(SowSnapshotWeekSchema)
    .refine(
      (weeks) => new Set(weeks.map((w) => w.weekNumber)).size === weeks.length,
      'Week numbers must be unique.'
    ),
});
export type SowSnapshot = z.infer<typeof SowSnapshotSchema>;

// ── Editing ─────────────────────────────────────────────────────────────────

const plain = (max: number) =>
  z.string().max(max, `Keep this under ${max} characters.`).nullable();
// Rich text is stored as sanitised HTML; the cap is on the HTML as sent.
const rich = z
  .string()
  .max(20000, 'This is too long. Please shorten it.')
  .nullable();

/** Module details. Every key is optional: a save sends only what changed. */
export const SowModuleEditSchema = z
  .object({
    title: plain(300),
    syllabus: plain(2000),
    hoursPerWeek: plain(50),
    teachingMethods: plain(2000),
    passRequirement: plain(1000),
    textbook: plain(1000),
    references: plain(2000),
    remarks: plain(2000),
  })
  .partial()
  .strict();
export type SowModule = z.infer<typeof SowModuleEditSchema>;

/** One week's fields. Only the keys sent are written. */
export const SowWeekFieldsSchema = z
  .object({
    topic: plain(300),
    learningOutcomes: rich,
    textbookPages: plain(200),
    activities: rich,
    assessment: plain(500),
    remarks: rich,
  })
  .partial()
  .strict();
export type SowWeekFields = z.infer<typeof SowWeekFieldsSchema>;

const ExpectedUpdatedAt = z.string().min(1, 'Reload the page and try again.');

export const PatchSowModuleSchema = z.object({
  module: SowModuleEditSchema,
  expectedUpdatedAt: ExpectedUpdatedAt,
});

// ── Reopening ───────────────────────────────────────────────────────────────

/** Same 300-character cap as a decision note. */
export const ReopenSowSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Say why it is being reopened.')
    .max(300, 'Keep the note to 300 characters or fewer.'),
});

export const PatchSowWeekSchema = z.object({
  fields: SowWeekFieldsSchema,
  expectedUpdatedAt: ExpectedUpdatedAt,
});
