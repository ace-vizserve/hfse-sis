import { z } from 'zod';

import { CHECK_OPTIONS } from '@/lib/sow/check-options';

// Scheme of Work — the shapes every SOW route and writer shares.

/** One scheme of work is a subject x level in one term. */
export const SowKeySchema = z.object({
  termId: z.string().uuid(),
  subjectId: z.string().uuid(),
  levelId: z.string().uuid(),
});

export const CreateSowSchema = z.object({
  key: SowKeySchema,
  sectionIds: z
    .array(z.string().uuid())
    .min(1, 'Tick at least one class.')
    .max(50),
  // 'import' is only valid through POST /api/sow/import, which carries the file.
  start: z.enum(['blank', 'copy', 'import']),
});
export type CreateSowInput = z.infer<typeof CreateSowSchema>;

// ── The Excel import's size limit ───────────────────────────────────────────
//
// 4 MB, not 5: Vercel refuses a request body over 4.5 MB before the route
// runs, so a bigger limit would promise a file the server can never receive.
// Here (not in lib/sow/excel-import.ts) so the New SOW drawer can check it
// without pulling the spreadsheet library into the browser.
export const SOW_IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const SOW_IMPORT_TOO_BIG_MESSAGE =
  'That file is bigger than 4 MB. Choose a smaller Excel file.';

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
export const RICH_CAP = 20000;
const rich = z
  .string()
  .max(RICH_CAP, 'This is too long. Please shorten it.')
  .nullable();

/** Character caps of the plain-text fields; the Excel import warns on these. */
export const SOW_MODULE_CAPS = {
  title: 300,
  syllabus: 2000,
  hoursPerWeek: 300,
  teachingMethods: 2000,
  passRequirement: 1000,
  textbook: 1000,
  references: 2000,
  remarks: 2000,
} as const;
export const SOW_WEEK_PLAIN_CAPS = {
  topic: 300,
  textbookPages: 500,
  assessment: 500,
} as const;

/** Module details. Every key is optional: a save sends only what changed. */
export const SowModuleEditSchema = z
  .object({
    title: plain(SOW_MODULE_CAPS.title),
    syllabus: plain(SOW_MODULE_CAPS.syllabus),
    hoursPerWeek: plain(SOW_MODULE_CAPS.hoursPerWeek),
    teachingMethods: plain(SOW_MODULE_CAPS.teachingMethods),
    passRequirement: plain(SOW_MODULE_CAPS.passRequirement),
    textbook: plain(SOW_MODULE_CAPS.textbook),
    references: plain(SOW_MODULE_CAPS.references),
    remarks: plain(SOW_MODULE_CAPS.remarks),
  })
  .partial()
  .strict();
export type SowModule = z.infer<typeof SowModuleEditSchema>;

/** One week's fields. Only the keys sent are written. */
export const SowWeekFieldsSchema = z
  .object({
    topic: plain(SOW_WEEK_PLAIN_CAPS.topic),
    learningOutcomes: rich,
    textbookPages: plain(SOW_WEEK_PLAIN_CAPS.textbookPages),
    activities: rich,
    assessment: plain(SOW_WEEK_PLAIN_CAPS.assessment),
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

/**
 * One class's weekly check (POST /api/sow/[sowId]/checks). Whether a note is
 * needed, and how long it may be, is `recordCheck`'s to say (422) — the shape
 * only refuses what no screen sends.
 */
export const RecordSowCheckSchema = z.object({
  weekNumber: z.number().int().min(1),
  sectionId: z.string().uuid(),
  option: z.enum(CHECK_OPTIONS),
  note: z.string().max(20000).nullable(),
});

/**
 * "Sign Week N" or "Ask the teacher" (POST /api/sow/[sowId]/signoffs).
 * Whether the remarks are needed, and how long they may be, is
 * `recordSignoff`'s to say (422).
 */
export const RecordSowSignoffSchema = z.object({
  weekNumber: z.number().int().min(1),
  sectionId: z.string().uuid(),
  kind: z.enum(['signed', 'asked']),
  remarks: z.string().max(20000),
});

/**
 * A relief teacher's "What did you cover?" (POST /api/sow/relief-notes).
 * Whether it is empty or too long is `saveReliefNote`'s to say (422).
 */
export const SaveReliefNoteSchema = z.object({
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  note: z.string().max(20000),
});

export const PatchSowWeekSchema = z.object({
  fields: SowWeekFieldsSchema,
  expectedUpdatedAt: ExpectedUpdatedAt,
});
