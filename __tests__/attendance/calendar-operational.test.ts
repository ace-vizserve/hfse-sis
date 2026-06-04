import { describe, expect, it } from 'vitest';
import {
  dayStatusToStorage,
  storageToDayStatus,
  isEncodableStatus,
  type DayStatus,
} from '@/lib/attendance/calendar-operational';
import { isEncodableDayType } from '@/lib/schemas/attendance';

const ALL_STATUSES: DayStatus[] = [
  { kind: 'open', hbl: false },
  { kind: 'open', hbl: true },
  { kind: 'closed', reason: 'public_holiday' },
  { kind: 'closed', reason: 'school_holiday', hblOverlay: false },
  { kind: 'closed', reason: 'school_holiday', hblOverlay: true },
  { kind: 'closed', reason: 'no_class' },
];

describe('operational mapping', () => {
  it('round-trips every DayStatus through storage', () => {
    for (const s of ALL_STATUSES) {
      expect(storageToDayStatus(dayStatusToStorage(s))).toEqual(s);
    }
  });

  it('encodability matches the underlying schema rule', () => {
    for (const s of ALL_STATUSES) {
      const { dayType, hblOverlay } = dayStatusToStorage(s);
      expect(isEncodableStatus(s)).toBe(
        isEncodableDayType(dayType, hblOverlay)
      );
    }
  });

  it('maps known storage rows to the right UI status', () => {
    expect(
      storageToDayStatus({ dayType: 'school_day', hblOverlay: false })
    ).toEqual({ kind: 'open', hbl: false });
    expect(storageToDayStatus({ dayType: 'hbl', hblOverlay: false })).toEqual({
      kind: 'open',
      hbl: true,
    });
    expect(
      storageToDayStatus({ dayType: 'school_holiday', hblOverlay: true })
    ).toEqual({ kind: 'closed', reason: 'school_holiday', hblOverlay: true });
  });
});
