import { z } from 'zod';

// Attendance module — zod schemas for /api/attendance/* write surfaces.
//
// Status vocabulary matches the check constraint on `attendance_daily.status`
// and the frozen doc contract (see `docs/context/16-attendance-module.md`).
// Keep in sync with the SQL CHECK and with `ATTENDANCE_STATUS_LABELS` below.

export const ATTENDANCE_STATUS_VALUES = ['P', 'L', 'EX', 'A', 'NC'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS_VALUES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  P: 'Present',
  L: 'Late',
  EX: 'Excused (MC / Excuse leave)',
  A: 'Absent',
  NC: 'No class',
};

// EX reason subtype. Matches HFSE's attendance-sheet legend (verified
// against their T1 workbook): EX = "Excused (MC-Excuse Leave)" plus the two
// quota'd subtypes. 'compassionate' consumes the student's
// `urgent_compassionate_allowance` (5-day-per-year quota by default);
// 'vacation' consumes `vacation_leave_allowance_per_term` (1-per-term
// quota by default). Both defaults live on `school_config` and may be
// overridden per student. See KD #94.
const EX_REASON_VALUES = ['mc', 'compassionate', 'vacation'] as const;
export type ExReason = (typeof EX_REASON_VALUES)[number];

export const EX_REASON_LABELS: Record<ExReason, string> = {
  mc: 'MC / Excuse leave',
  compassionate: 'Urgent / compassionate',
  vacation: 'Vacation leave',
};

// Date-only (yyyy-MM-dd). Mirrors `optionalDate` in lib/schemas/sis.ts but
// required (every attendance row is for a specific date).
const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// UUID — reject anything else. The API routes 400 on bad IDs via this.
const uuidString = z.string().uuid('Invalid id');

// ─────────────────────────────────────────────────────────────────────────
// Live entry (single cell) — PATCH /api/attendance/daily
// ─────────────────────────────────────────────────────────────────────────

/** Mirrors the 300-char DB constraint in migration 109. */
export const EX_NOTE_MAX_LENGTH = 300;

// Shared by the daily register and the term-view marking palette so the two
// cannot drift. It says "optional" outright: the field sits inside a block
// that is otherwise all required choices, and an example alone reads as an
// instruction to fill it in.
export const EX_NOTE_PLACEHOLDER =
  'Add a note (optional) — e.g. medical certificate submitted, returning Monday';

export const DailyEntrySchema = z
  .object({
    sectionStudentId: uuidString,
    termId: uuidString,
    date: dateString,
    // `null` CLEARS the day — it returns the cell to unmarked rather than
    // writing a mark (migration 134). It is appended like any other
    // correction, so the prior mark stays in the ledger and the latest
    // `recorded_at` still wins; a NULL status simply falls out of every
    // rollup aggregate. The two refinements below already forbid a reason or
    // a note alongside it, which is the same rule the DB enforces with
    // `attendance_daily_cleared_has_no_reason_chk`.
    status: z.enum(ATTENDANCE_STATUS_VALUES).nullable(),
    exReason: z.enum(EX_REASON_VALUES).optional().nullable(),
    // Free-text "why" for an EX mark. An explicit null CLEARS it; omitting the
    // key leaves whatever is on file alone, so the two are not interchangeable.
    // `''` normalises to null so an emptied input clears rather than storing
    // a blank string.
    exNote: z
      .string()
      .trim()
      .max(EX_NOTE_MAX_LENGTH)
      .transform((v) => (v === '' ? null : v))
      .optional()
      .nullable(),
  })
  .refine((v) => v.status === 'EX' || !v.exReason, {
    message: 'exReason may only be set when status = EX',
    path: ['exReason'],
  })
  .refine((v) => v.status === 'EX' || !v.exNote, {
    message: 'exNote may only be set when status = EX',
    path: ['exNote'],
  });

export type DailyEntryInput = z.infer<typeof DailyEntrySchema>;

// 5 day-types (KD #50). `school_day` + `hbl` are encodable; the other three
// reject attendance writes.
export const DAY_TYPE_VALUES = [
  'school_day',
  'public_holiday',
  'school_holiday',
  'hbl',
  'no_class',
] as const;
export type DayType = (typeof DAY_TYPE_VALUES)[number];

export function isEncodableDayType(
  t: DayType | null | undefined,
  hblOverlay?: boolean
): boolean {
  if (t === 'school_day' || t === 'hbl') return true;
  // school_holiday with hbl_overlay=true is encodable — teachers deliver
  // home-based learning while the day is officially a school holiday for
  // students (Path B per KD #50, migration 051).
  if (t === 'school_holiday' && hblOverlay === true) return true;
  return false;
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  school_day: 'School day',
  public_holiday: 'Public holiday',
  school_holiday: 'School holiday',
  hbl: 'HBL',
  no_class: 'No class',
};

// Audience scope (migration 037). Mirrors the CHECK on
// school_calendar.audience and calendar_events.audience.
export const AUDIENCE_VALUES = ['all', 'primary', 'secondary'] as const;
export type Audience = (typeof AUDIENCE_VALUES)[number];

export const AUDIENCE_LABELS: Record<Audience, string> = {
  all: 'All',
  primary: 'Primary',
  secondary: 'Secondary',
};

// Event category (migration 037). Drives color-coding + filtering on
// calendar_events. Display-only — does NOT gate attendance.
export const EVENT_CATEGORY_VALUES = [
  'term_exam',
  'term_break',
  'start_of_term',
  'parents_dialogue',
  'subject_week',
  'school_event',
  'pfe',
  'ptc',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORY_VALUES)[number];

export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  term_exam: 'Term examination',
  term_break: 'Term break',
  start_of_term: 'Start of term',
  parents_dialogue: 'Parents dialogue',
  subject_week: 'Subject week',
  school_event: 'School event',
  pfe: 'Partners for Excellence',
  ptc: 'Parent-teacher child conference',
  other: 'Other',
};

// Schemas for the school-calendar admin surface.
export const SchoolCalendarUpsertSchema = z.object({
  termId: uuidString,
  audience: z.enum(AUDIENCE_VALUES).optional().default('all'),
  entries: z
    .array(
      z
        .object({
          date: dateString,
          // `dayType` is the preferred field. `isHoliday` is legacy — if both
          // are omitted it's a bad request; if only `isHoliday` is present it
          // maps to `school_day` / `public_holiday`.
          dayType: z.enum(DAY_TYPE_VALUES).optional(),
          isHoliday: z.boolean().optional(),
          label: z.string().trim().max(200).optional().nullable(),
          // When true, a school_holiday row is also encodable — teachers take
          // attendance. Only meaningful when dayType='school_holiday'.
          hblOverlay: z.boolean().optional().default(false),
        })
        .refine((v) => v.dayType !== undefined || v.isHoliday !== undefined, {
          message: 'Provide dayType (preferred) or isHoliday (legacy)',
          path: ['dayType'],
        })
    )
    .min(1)
    .max(200),
});
export type SchoolCalendarUpsertInput = z.infer<
  typeof SchoolCalendarUpsertSchema
>;

/** Resolves the `day_type` value to persist from either a new-shape or
 *  legacy-shape upsert entry. */
export function resolveDayType(entry: {
  dayType?: DayType;
  isHoliday?: boolean;
}): DayType {
  if (entry.dayType) return entry.dayType;
  return entry.isHoliday ? 'public_holiday' : 'school_day';
}

export const CalendarEventCreateSchema = z
  .object({
    termId: uuidString,
    startDate: dateString,
    endDate: dateString,
    label: z.string().trim().min(1).max(200),
    category: z.enum(EVENT_CATEGORY_VALUES).optional().default('other'),
    audience: z.enum(AUDIENCE_VALUES).optional().default('all'),
    tentative: z.boolean().optional().default(false),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type CalendarEventCreateInput = z.infer<
  typeof CalendarEventCreateSchema
>;

// PATCH /api/attendance/calendar/events — partial update for an existing
// row. Used by the "Confirm dates" affordance (flips tentative=false) and
// for editing category / audience / label after creation.
export const CalendarEventUpdateSchema = z
  .object({
    id: uuidString,
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    label: z.string().trim().min(1).max(200).optional(),
    category: z.enum(EVENT_CATEGORY_VALUES).optional(),
    audience: z.enum(AUDIENCE_VALUES).optional(),
    tentative: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.startDate === undefined ||
      v.endDate === undefined ||
      v.endDate >= v.startDate,
    { message: 'endDate must be on or after startDate', path: ['endDate'] }
  );
export type CalendarEventUpdateInput = z.infer<
  typeof CalendarEventUpdateSchema
>;

// POST /api/attendance/calendar/copy-from-prior-ay
// Bulk copy of school_calendar overrides + calendar_events from a prior
// AY's term to the target term, with year-shifted dates. Default
// tentative=true on every copied row (registrar reviews + locks).
export const CopyFromPriorAyPayloadSchema = z.object({
  targetTermId: uuidString,
  // Source rows the user opted to include. Each entry already carries
  // its already-shifted target date — server validates but does not
  // re-shift (UI is the source of truth for what gets copied).
  dayTypeRows: z
    .array(
      z.object({
        date: dateString, // already year-shifted
        dayType: z.enum(DAY_TYPE_VALUES),
        audience: z.enum(AUDIENCE_VALUES),
        label: z.string().trim().max(200).optional().nullable(),
      })
    )
    .max(500)
    .optional()
    .default([]),
  events: z
    .array(
      z
        .object({
          startDate: dateString, // already year-shifted
          endDate: dateString,
          label: z.string().trim().min(1).max(200),
          category: z.enum(EVENT_CATEGORY_VALUES),
          audience: z.enum(AUDIENCE_VALUES),
        })
        .refine((v) => v.endDate >= v.startDate, {
          message: 'endDate must be on or after startDate',
          path: ['endDate'],
        })
    )
    .max(500)
    .optional()
    .default([]),
  // When true (default), every copied row lands with tentative=true so the
  // registrar reviews each before locking.
  markTentative: z.boolean().optional().default(true),
});
export type CopyFromPriorAyPayload = z.infer<
  typeof CopyFromPriorAyPayloadSchema
>;

// ─────────────────────────────────────────────────────────────────────────
// Bulk daily write (grid paste or multi-cell save)
// ─────────────────────────────────────────────────────────────────────────

export const DailyBulkSchema = z.object({
  entries: z
    .array(DailyEntrySchema)
    .min(1, 'At least one entry required')
    .max(500, 'Cap bulk writes at 500 entries per request'),
});

export type DailyBulkInput = z.infer<typeof DailyBulkSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Bulk import — POST /api/attendance/import
// ─────────────────────────────────────────────────────────────────────────
//
// The Excel file itself arrives as multipart/form-data; this schema
// validates the JSON sidecar (term_id + any operator-supplied overrides).
// Per-sheet parsing happens in the route handler after we see the workbook.

export const ImportConfigSchema = z.object({
  termId: uuidString,
  // Optional: cap import to a specific section (sheet name). When omitted the
  // route imports every sheet whose name matches a known section.
  sectionId: uuidString.optional(),
  // Dry run returns the parse report without writing to the DB.
  dryRun: z.boolean().optional().default(false),
});

export type ImportConfigInput = z.infer<typeof ImportConfigSchema>;
