import type { DayType } from '@/lib/schemas/attendance';

// "Term break" is intentionally NOT a ClosedReason — it has no lossless
// day_type and is modelled as a `term_break` event + the inter-term gap band
// (spec D1). These three reasons round-trip 1:1 with day_type.
export type ClosedReason = 'public_holiday' | 'school_holiday' | 'no_class';

// `hblOverlay` is only meaningful for `school_holiday` (KD #98), so the union
// is narrowed to make `hblOverlay` on any other closed reason a compile error —
// the invalid state is unrepresentable rather than silently discarded.
export type DayStatus =
  | { kind: 'open'; hbl: boolean }
  | { kind: 'closed'; reason: 'school_holiday'; hblOverlay: boolean }
  | {
      kind: 'closed';
      reason: Exclude<ClosedReason, 'school_holiday'>;
      hblOverlay?: never;
    };

export type CalendarStorage = { dayType: DayType; hblOverlay: boolean };

export function dayStatusToStorage(s: DayStatus): CalendarStorage {
  if (s.kind === 'open') {
    return { dayType: s.hbl ? 'hbl' : 'school_day', hblOverlay: false };
  }
  if (s.reason === 'school_holiday') {
    return { dayType: 'school_holiday', hblOverlay: s.hblOverlay };
  }
  // public_holiday | no_class
  return { dayType: s.reason, hblOverlay: false };
}

export function storageToDayStatus(s: CalendarStorage): DayStatus {
  switch (s.dayType) {
    case 'school_day':
      return { kind: 'open', hbl: false };
    case 'hbl':
      return { kind: 'open', hbl: true };
    case 'school_holiday':
      return {
        kind: 'closed',
        reason: 'school_holiday',
        hblOverlay: s.hblOverlay,
      };
    case 'public_holiday':
      return { kind: 'closed', reason: 'public_holiday' };
    case 'no_class':
      return { kind: 'closed', reason: 'no_class' };
  }
}

export function isEncodableStatus(s: DayStatus): boolean {
  return s.kind === 'open' || (s.reason === 'school_holiday' && s.hblOverlay);
}

export const CLOSED_REASON_LABELS: Record<ClosedReason, string> = {
  public_holiday: 'Public holiday',
  school_holiday: 'School holiday',
  no_class: 'No class',
};

/** Plain-English label a human reads at a glance: "School day", "HBL",
 *  "Public holiday", etc. Used in cells, the day sheet, and the list. */
export function dayStatusLabel(s: DayStatus): string {
  if (s.kind === 'open') return s.hbl ? 'HBL' : 'School day';
  if (s.reason === 'school_holiday') {
    return s.hblOverlay ? 'School holiday (HBL)' : 'School holiday';
  }
  return CLOSED_REASON_LABELS[s.reason];
}

/** "School day" — the unremarkable default; cells skip rendering a chip for it. */
export function isPlainSchoolDay(s: DayStatus): boolean {
  return s.kind === 'open' && !s.hbl;
}
