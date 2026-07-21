// lib/sis/backfill/attendance/day-classifier-t3.ts
// Classifies each date in the AY2026 T3 term as a real school day or a
// holiday/no-class day, for populating school_calendar + calendar_events.
// Pure. Unlike T1/T2's classifiers, day-type comes directly from the
// row-11 tag (design doc §3) rather than being guessed from blank cells
// — guessing is only needed for the untagged case, to distinguish an
// ordinary school day from a weekend/gap (no tag exists for either).

export type DayType =
  | 'school_day'
  | 'public_holiday'
  | 'school_holiday'
  | 'no_class';

export type EventCategoryT3 = 'school_event' | 'term_exam';

export interface DateClassificationT3 {
  date: string;
  dayType: DayType;
  // Informational label for school_calendar.label — populated for any
  // tagged date (SH/PH/SE/EX) from the matching legend entry; null for
  // untagged dates.
  label: string | null;
  // Set only for a school_day date tagged SE or EX — the calendar_events
  // row to create. label is null (and labelMissing true) when the tag
  // has no matching legend entry, so the composer can skip writing a row
  // (calendar_events.label is NOT NULL) and flag it for a human instead
  // of guessing or violating the constraint.
  event: {
    category: EventCategoryT3;
    label: string | null;
    labelMissing: boolean;
  } | null;
}

export function classifyDatesT3(
  datesISO: string[],
  tagByDate: Map<string, string>,
  legendLabelByDate: Map<string, string>,
  blankDates: Set<string>
): DateClassificationT3[] {
  return datesISO.map((date) => {
    const tag = tagByDate.get(date) ?? null;
    const label = legendLabelByDate.get(date) ?? null;

    if (tag === 'SH') {
      return { date, dayType: 'school_holiday', label, event: null };
    }
    if (tag === 'PH') {
      return { date, dayType: 'public_holiday', label, event: null };
    }
    if (tag === 'SE') {
      return {
        date,
        dayType: 'school_day',
        label,
        event: {
          category: 'school_event',
          label,
          labelMissing: label === null,
        },
      };
    }
    if (tag === 'EX') {
      return {
        date,
        dayType: 'school_day',
        label,
        event: { category: 'term_exam', label, labelMissing: label === null },
      };
    }

    return {
      date,
      dayType: blankDates.has(date) ? 'no_class' : 'school_day',
      label: null,
      event: null,
    };
  });
}
