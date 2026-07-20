// lib/sis/backfill/attendance/day-classifier.ts
// Classifies each date in the AY2026 T1 term as a real school day or a
// holiday/no-class day, for populating school_calendar. Pure — takes
// already-resolved ISO dates and legend ranges (see legend-parser.ts for
// producing those from raw workbook text).
//
// Primary signal: a date is school_day if ANY roster cell anywhere is
// non-blank on that date; it's a holiday only if EVERY roster cell across
// every section is blank. This is the reliable, data-driven classifier —
// verified against the real file, it correctly catches genuine closures
// (e.g. a Marking Day) even when the source's own masthead legend files
// them under "Important dates" rather than "School Holiday".
//
// The legend text is a secondary label-only enrichment layered on top:
// it decides sub-classification (public_holiday vs no_class vs the
// school_holiday+hbl_overlay combo) and supplies a human-readable label,
// but never overrides the primary all-blank signal.

export type DayType =
  | 'school_day'
  | 'public_holiday'
  | 'school_holiday'
  | 'no_class';

export interface LegendRange {
  startDate: string;
  endDate: string;
  label: string;
  column: 'schoolHoliday' | 'importantDates';
}

export interface DateClassification {
  date: string;
  dayType: DayType;
  hblOverlay: boolean;
  label: string | null;
}

function rangesCovering(
  date: string,
  legendRanges: LegendRange[]
): LegendRange[] {
  return legendRanges.filter((r) => date >= r.startDate && date <= r.endDate);
}

export function classifyDates(
  allDatesISO: string[],
  blankDates: Set<string>,
  legendRanges: LegendRange[]
): DateClassification[] {
  return allDatesISO.map((date) => {
    if (!blankDates.has(date)) {
      return { date, dayType: 'school_day', hblOverlay: false, label: null };
    }

    const matches = rangesCovering(date, legendRanges);
    const hblMatch = matches.find((m) => /hbl/i.test(m.label));
    if (hblMatch) {
      return {
        date,
        dayType: 'school_holiday',
        hblOverlay: true,
        label: hblMatch.label,
      };
    }

    const schoolHolidayMatch = matches.find(
      (m) => m.column === 'schoolHoliday'
    );
    if (schoolHolidayMatch) {
      return {
        date,
        dayType: 'public_holiday',
        hblOverlay: false,
        label: schoolHolidayMatch.label,
      };
    }

    const anyMatch = matches[0];
    return {
      date,
      dayType: 'no_class',
      hblOverlay: false,
      label: anyMatch ? anyMatch.label : null,
    };
  });
}
