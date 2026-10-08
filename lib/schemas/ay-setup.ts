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
// The client only picks a year. The code (`AY{year}`) and label
// (`Academic Year {year}`) are derived server-side by `ayIdentityForYear`; the
// RPC derives the slug and seeds the static default catalog (migration 090).
export const CreateAySchema = z.object({
  year: z
    .number()
    .int('Pick a year')
    .min(2000, 'Pick a valid year')
    .max(2100, 'Pick a valid year'),
});

export type CreateAyInput = z.infer<typeof CreateAySchema>;

export function ayIdentityForYear(year: number): {
  ay_code: string;
  label: string;
} {
  return { ay_code: `AY${year}`, label: `Academic Year ${year}` };
}

// PATCH /api/sis/ay-setup/accepting-applications — toggle the early-bird
// gate post-creation (KD #77). Lets the registrar open / close the
// upcoming AY's parent-portal channel without touching is_current.
export const ToggleAcceptingApplicationsSchema = z.object({
  ay_code: AyCode,
  accepting: z.boolean(),
  // Which programme's window this flips. 'hfse' (the default, and the only
  // value before migration 176) is `accepting_applications` with the
  // early-bird single-select rule; 'vizschool' is
  // `vizschool_accepting_applications`, a plain switch.
  program: z.enum(['hfse', 'vizschool']).default('hfse'),
});

export type ToggleAcceptingApplicationsInput = z.infer<
  typeof ToggleAcceptingApplicationsSchema
>;

// PATCH /api/sis/ay-setup — switch active AY
export const SwitchActiveAySchema = z
  .object({
    target_ay_code: AyCode,
    confirm_code: AyCode,
  })
  .refine((v) => v.target_ay_code === v.confirm_code, {
    message: 'Confirm code must match target AY code',
    path: ['confirm_code'],
  });

export type SwitchActiveAyInput = z.infer<typeof SwitchActiveAySchema>;

// DELETE /api/sis/ay-setup — delete AY
export const DeleteAySchema = z
  .object({
    ay_code: AyCode,
    confirm_code: AyCode,
  })
  .refine((v) => v.ay_code === v.confirm_code, {
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
    // Grading deadline per term — an exact instant (migration 186). Past it, a
    // term's sheets count as locked for score writes. ISO 8601 with an explicit
    // offset (the editor sends Singapore wall time converted to UTC); stored
    // normalised to UTC. Optional like virtueTheme so a dates-only caller leaves
    // it alone; '' / null clears it.
    // ⚠ Absent stays undefined (the route reads that as "leave it"); only an
    // explicit null / '' clears.
    gradingLockAt: z
      .string()
      .trim()
      .nullable()
      .optional()
      .refine(
        (s) =>
          s == null ||
          s.length === 0 ||
          (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
            s
          ) &&
            !Number.isNaN(Date.parse(s))),
        { message: 'Use a date and time, e.g. 2026-03-20T23:59:00+08:00' }
      )
      .transform((s) =>
        s === undefined
          ? undefined
          : s === null || s.length === 0
            ? null
            : new Date(s).toISOString()
      ),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type TermDatesInput = z.infer<typeof TermDatesSchema>;
