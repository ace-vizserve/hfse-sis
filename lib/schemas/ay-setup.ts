import { z } from 'zod';

// Shared regex for validating AY codes. Used across the wizard API route
// and client forms. Runtime "does this AY exist?" checks go through
// `listAyCodes()` in lib/academic-year.ts (DB-backed) — this regex only
// validates format.
const AY_CODE_RE = /^AY\d{4}$/;

const AyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(AY_CODE_RE, { message: 'Use format AY2027' });

// POST /api/sis/ay-setup — create AY
//
// The RPC derives the slug and handles copy-forward server-side;
// the client only supplies identity + label + the early-bird gate.
export const CreateAySchema = z.object({
  ay_code: AyCode,
  label: z
    .string()
    .trim()
    .min(1, 'Label required')
    .max(120, 'Label too long (120 char max)'),
  // KD #77: when true, the new AY immediately accepts applications via the
  // parent portal AND surfaces in the admissions sidebar's "Upcoming AY
  // applications" entry. The wizard's initial form state defaults this to
  // false so the registrar can stage an AY weeks ahead of opening early-bird.
  accepting_applications: z.boolean(),
});

export type CreateAyInput = z.infer<typeof CreateAySchema>;

// PATCH /api/sis/ay-setup/accepting-applications — toggle the early-bird
// gate post-creation (KD #77). Lets the registrar open / close the
// upcoming AY's parent-portal channel without touching is_current.
export const ToggleAcceptingApplicationsSchema = z.object({
  ay_code: AyCode,
  accepting: z.boolean(),
});

export type ToggleAcceptingApplicationsInput = z.infer<typeof ToggleAcceptingApplicationsSchema>;

// PATCH /api/sis/ay-setup — switch active AY
export const SwitchActiveAySchema = z.object({
  target_ay_code: AyCode,
  confirm_code: AyCode,
}).refine((v) => v.target_ay_code === v.confirm_code, {
  message: 'Confirm code must match target AY code',
  path: ['confirm_code'],
});

export type SwitchActiveAyInput = z.infer<typeof SwitchActiveAySchema>;

// DELETE /api/sis/ay-setup — delete AY
export const DeleteAySchema = z.object({
  ay_code: AyCode,
  confirm_code: AyCode,
}).refine((v) => v.ay_code === v.confirm_code, {
  message: 'Confirm code must match AY code',
  path: ['confirm_code'],
});

export type DeleteAyInput = z.infer<typeof DeleteAySchema>;

// PATCH /api/sis/ay-setup/terms/[termId] — set start/end dates on a term.
// Either field may be null (clear the value); if both are set, end must be ≥ start.
const termDate = z
  .string()
  .trim()
  .transform((s) => (s.length === 0 ? null : s))
  .refine((s) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s), {
    message: 'Use YYYY-MM-DD',
  })
  .nullable();

export const TermDatesSchema = z
  .object({
    startDate: termDate,
    endDate: termDate,
    // Free-text virtue theme set by the registrar (e.g. "Faith, Hope, Love").
    // Optional for backward compatibility with the dates-only payload shape.
    // `null` or empty string clears it. Appears as a prompt in the Evaluation
    // module and on T1–T3 report cards (KD #49).
    virtueTheme: z
      .string()
      .trim()
      .max(200, 'Keep the virtue theme under 200 chars')
      .nullable()
      .optional()
      .transform((s) => (s == null || s.length === 0 ? null : s)),
    // Advisory grading cutoff per term. Purely informational — the actual
    // per-sheet lock is independent. Same optional shape as virtueTheme so
    // pre-existing callers keep working.
    gradingLockDate: termDate.optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type TermDatesInput = z.infer<typeof TermDatesSchema>;
