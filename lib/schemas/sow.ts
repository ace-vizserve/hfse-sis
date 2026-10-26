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
  weeks: z.array(SowSnapshotWeekSchema),
});
export type SowSnapshot = z.infer<typeof SowSnapshotSchema>;
