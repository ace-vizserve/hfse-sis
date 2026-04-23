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
  EX: 'Excused',
  A: 'Absent',
  NC: 'No class',
};

// Codes that count toward `days_present` on the rollup.
export const PRESENT_CODES: ReadonlyArray<AttendanceStatus> = ['P', 'L', 'EX'];

// EX reason subtype. Only 'compassionate' consumes the student's
// `urgent_compassionate_allowance` 5-day-per-year quota.
export const EX_REASON_VALUES = ['mc', 'compassionate', 'school_activity'] as const;
export type ExReason = (typeof EX_REASON_VALUES)[number];

export const EX_REASON_LABELS: Record<ExReason, string> = {
  mc: 'Medical certificate',
  compassionate: 'Urgent / compassionate',
  school_activity: 'School activity',
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

export const DailyEntrySchema = z
  .object({
    sectionStudentId: uuidString,
    termId: uuidString,
    date: dateString,
    status: z.enum(ATTENDANCE_STATUS_VALUES),
    exReason: z.enum(EX_REASON_VALUES).optional().nullable(),
  })
  .refine((v) => v.status === 'EX' || !v.exReason, {
    message: 'exReason may only be set when status = EX',
    path: ['exReason'],
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

export const ENCODABLE_DAY_TYPES: ReadonlyArray<DayType> = ['school_day', 'hbl'];
export function isEncodableDayType(t: DayType | null | undefined): boolean {
  return t === 'school_day' || t === 'hbl';
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  school_day: 'School day',
  public_holiday: 'Public holiday',
  school_holiday: 'School holiday',
  hbl: 'HBL',
  no_class: 'No class',
};

// Schemas for the school-calendar admin surface.
export const SchoolCalendarUpsertSchema = z.object({
  termId: uuidString,
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
        })
        .refine((v) => v.dayType !== undefined || v.isHoliday !== undefined, {
          message: 'Provide dayType (preferred) or isHoliday (legacy)',
          path: ['dayType'],
        }),
    )
    .min(1)
    .max(200),
});
export type SchoolCalendarUpsertInput = z.infer<typeof SchoolCalendarUpsertSchema>;

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
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type CalendarEventCreateInput = z.infer<typeof CalendarEventCreateSchema>;

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

// ─────────────────────────────────────────────────────────────────────────
// Field labels for audit-log context diffs.
// ─────────────────────────────────────────────────────────────────────────

export const ATTENDANCE_FIELD_LABELS = {
  status: 'Status',
  date: 'Date',
  sectionStudentId: 'Student',
  termId: 'Term',
} as const;
