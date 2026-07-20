// lib/sis/backfill/attendance/day-classifier-t2.ts
// Classifies each date in the AY2026 T2 term as a real school day or a
// holiday/no-class day, for populating school_calendar. Pure.
//
// Unlike Phase 2's classifier (day-classifier.ts), which resolves a blank
// date's label by checking whether any parsed date RANGE covers it, T2's
// source prints each event's label directly in the date column it falls
// on (design doc Locked Decision #5) — so this classifier takes a direct
// date -> label lookup instead of a list of ranges, and never parses
// free-text date ranges.
//
// Primary signal is unchanged from Phase 2: a date is school_day if ANY
// roster cell anywhere is non-blank on that date; the caller (see
// build-attendance-import-t2.ts) computes blankDates the same way Phase 2
// did before calling this.

export type DayType =
  | 'school_day'
  | 'public_holiday'
  | 'school_holiday'
  | 'no_class';

export interface DateClassificationT2 {
  date: string;
  dayType: DayType;
  hblOverlay: boolean;
  label: string | null;
  // True only for a blank date whose label is non-empty but matches
  // neither the HBL pattern nor the public-holiday whitelist below — the
  // fallback is still no_class (never guessed as public_holiday without a
  // positive match), but the label is unrecognized, so a human should
  // confirm it isn't an unlisted real public holiday before the apply
  // files run. Never true for a date with no label at all (nothing to
  // confirm) or for a date that matched HBL/the whitelist.
  needsConfirmation: boolean;
}

// Locked Decision #6 — the closed whitelist of genuine Singapore public
// holidays observed in the T2 term window. Every other label found in the
// real workbook (Student Recollection, General PTC, Staff Dev't Day,
// English/Science Week, fieldtrips, Term 2 Exam, Marking Day, In Lieu of
// Family Sportsfest, ...) is an operational closure, not a public
// holiday, and classifies as no_class.
export const PUBLIC_HOLIDAY_WHITELIST = [
  'Good Friday',
  'Labor Day',
  'Vesak Day',
  'Hari Raya Haji',
];

export function classifyDatesT2(
  datesISO: string[],
  blankDates: Set<string>,
  labelByDate: Map<string, string>
): DateClassificationT2[] {
  return datesISO.map((date) => {
    if (!blankDates.has(date)) {
      return {
        date,
        dayType: 'school_day',
        hblOverlay: false,
        label: null,
        needsConfirmation: false,
      };
    }

    const label = labelByDate.get(date) ?? null;

    if (label && /hbl/i.test(label)) {
      return {
        date,
        dayType: 'school_holiday',
        hblOverlay: true,
        label,
        needsConfirmation: false,
      };
    }

    if (label && PUBLIC_HOLIDAY_WHITELIST.includes(label)) {
      return {
        date,
        dayType: 'public_holiday',
        hblOverlay: false,
        label,
        needsConfirmation: false,
      };
    }

    return {
      date,
      dayType: 'no_class',
      hblOverlay: false,
      label,
      needsConfirmation: label !== null,
    };
  });
}
