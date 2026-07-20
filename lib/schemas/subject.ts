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
  // What prints on the report card, independent of the catalog `name` —
  // e.g. a subject could be catalogued one way internally but print
  // differently on the card. Empty/absent → null, which falls back to
  // `name` everywhere the report card resolves a subject's label (see
  // lib/report-card/build-report-card.ts).
  report_label: z
    .string()
    .trim()
    .max(128, 'Keep report label under 128 chars')
    .nullable()
    .optional()
    .transform((s) => (s == null || s.length === 0 ? null : s)),
});
export type SubjectCreateInput = z.infer<typeof SubjectCreateSchema>;
// Pre-transform shape — what an RHF form actually holds as field state
// (report_label is optional here; the schema's transform normalizes it to
// `string | null` only in the parsed OUTPUT). Pass this as useForm<T>'s
// first generic when a schema has a transform, per react-hook-form's
// TFieldValues/TTransformedValues split — see components/sis/new-subject-form.tsx.
export type SubjectCreateFormInput = z.input<typeof SubjectCreateSchema>;

// PATCH /api/sis/admin/subjects/catalog/[subjectId] — Task 2 of the
// "Unified Subject Setup page" plan. `is_examinable` (grade type) and
// `grading_method` are the two `subjects`-table fields the Tune step's
// SubjectConfigForm needs to edit that no existing route can reach (the
// subject_configs routes only touch subject_configs; these two live on
// the global subjects row, no AY dimension). Both optional so a caller can
// patch either field independently (mirrors the existing SlotMetaPatchSchema
// partial-merge convention, KD #105) — but at least one must be present,
// otherwise the PATCH is a meaningless no-op the caller almost certainly
// didn't intend.
export const SubjectCatalogUpdateSchema = z
  .object({
    is_examinable: z.boolean().optional(),
    grading_method: z.enum(GRADING_METHOD_VALUES).optional(),
    // See SubjectCreateSchema.report_label for what this is. Deliberately
    // NO `.transform()` here, unlike the create schema — this is a partial-
    // merge schema (the route only patches keys it can tell were actually
    // sent, via `!== undefined`), so an empty-string-means-null transform
    // would fire even when the caller never mentioned this field at all
    // (zod runs `.transform()` on an `.optional()` field's absent value
    // too, turning "don't touch" into "clear it" — silently wiping an
    // existing report_label on every is_examinable/grading_method-only
    // save). The empty-string-to-null normalization happens in the route
    // instead, where "was this key present" is still known.
    report_label: z
      .string()
      .trim()
      .max(128, 'Keep report label under 128 chars')
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      v.is_examinable !== undefined ||
      v.grading_method !== undefined ||
      v.report_label !== undefined,
    {
      message:
        'At least one field (is_examinable, grading_method, or report_label) is required',
    }
  );
export type SubjectCatalogUpdateInput = z.infer<
  typeof SubjectCatalogUpdateSchema
>;

// Mother Tongue language codes (migration 081 — MAPEH/language catalog
// corrections). Filipino (`FIL`) and Mandarin (`MANDARIN`) are the real
// gradable subjects; "Mother Tongue" (`MT`) was retargeted to a
// report-only fan-in label (`subject_report_map`) and carries no
// `subject_configs`/`subject_level_offerings` row of its own, so it must
// never be directly attachable. Attach-flow UI presents these two codes
// as one "Mother Tongue" option with a language sub-choice; the actual
// attach always targets the chosen language's real `subjectConfigId`.
export const MOTHER_TONGUE_SUBJECT_CODES = ['FIL', 'MANDARIN'] as const;

// The Mother Tongue umbrella subject itself (migration 081) — the
// report-card column Filipino/Mandarin fan into via subject_report_map.
// It carries no subject_configs/subject_level_offerings row and is never
// directly attached to a section, so any catalog listing that walks
// `subjects` must exclude this code explicitly rather than assuming a
// subject with no config/offering data is simply "not yet set up" — MT
// is *permanently* config/offering-less by design, unlike a genuinely
// new, unconfirmed subject (which is legitimately catalog-visible).
export const MOTHER_TONGUE_UMBRELLA_CODE = 'MT' as const;
