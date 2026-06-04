import { describe, expect, it } from 'vitest';
import {
  isEncodableDayType,
  DAY_TYPE_VALUES,
  type DayType,
} from '@/lib/schemas/attendance';
import {
  dayStatusToStorage,
  storageToDayStatus,
  isEncodableStatus,
} from '@/lib/attendance/calendar-operational';

describe('encodable allowlist invariant', () => {
  it('storage->status->storage preserves encodability for every day_type x overlay', () => {
    const overlays = [false, true];
    for (const dayType of DAY_TYPE_VALUES as unknown as DayType[]) {
      for (const hblOverlay of overlays) {
        const before = isEncodableDayType(dayType, hblOverlay);
        const status = storageToDayStatus({ dayType, hblOverlay });
        const after = isEncodableDayType(
          dayStatusToStorage(status).dayType,
          dayStatusToStorage(status).hblOverlay
        );
        expect(after).toBe(before);
        expect(isEncodableStatus(status)).toBe(before);
      }
    }
  });
});
