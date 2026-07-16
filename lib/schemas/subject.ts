import { z } from 'zod';

// Catalog-level subject CRUD. The subjects table itself is small (a
// catalog of roughly 10–20 subjects per HFSE). Adding a new subject is
// rare — once-per-AY-rollover at most — but doing it via SQL was a
// bottleneck for the AY-rollover workflow.
//
// Code is uppercase + length-bounded + restricted to A-Z 0-9 _ - so the
// existing seed convention (MATH, ENG, FIL, RIZAL, etc.) holds. The route
// uppercases inbound code defensively (the regex passes only uppercase
// already, but a safety net trims user-typed lowercase).

// `grading_method` (migration 082) — a flag on `subjects` distinguishing
// "has a normal WW/PT/QA grading sheet" from "recorded some other way,
// don't generate a sheet." Required at creation (defaults to
// 'standard_sheet' in the UI, matching every subject in the catalog
// today) so it's never silently left unset — the DB column also carries a
// NOT NULL DEFAULT as a structural backstop, but the create form should
// still present the choice explicitly rather than hiding it.
export const GRADING_METHOD_VALUES = ['standard_sheet', 'no_sheet'] as const;
export type GradingMethod = (typeof GRADING_METHOD_VALUES)[number];
export const GRADING_METHOD_LABELS: Record<GradingMethod, string> = {
  standard_sheet: 'Standard sheet',
  no_sheet: 'No sheet — recorded elsewhere',
};

export const SubjectCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code required')
    .max(32, 'Keep code under 32 chars')
    .regex(
      /^[A-Z0-9_-]+$/,
      'Code must be uppercase letters, digits, underscore, or hyphen'
    ),
  name: z
    .string()
    .trim()
    .min(1, 'Name required')
    .max(128, 'Keep name under 128 chars'),
  is_examinable: z.boolean(),
  grading_method: z.enum(GRADING_METHOD_VALUES),
});
export type SubjectCreateInput = z.infer<typeof SubjectCreateSchema>;

// Mother Tongue language codes (migration 081 — MAPEH/language catalog
// corrections). Filipino (`FIL`) and Mandarin (`MANDARIN`) are the real
// gradable subjects; "Mother Tongue" (`MT`) was retargeted to a
// report-only fan-in label (`subject_report_map`) and carries no
// `subject_configs`/`subject_level_offerings` row of its own, so it must
// never be directly attachable. Attach-flow UI presents these two codes
// as one "Mother Tongue" option with a language sub-choice; the actual
// attach always targets the chosen language's real `subjectConfigId`.
export const MOTHER_TONGUE_SUBJECT_CODES = ['FIL', 'MANDARIN'] as const;
