/**
 * SectionScheduleAssignSchema — the payload for PATCH /api/sections/[id]/schedule.
 *
 * The subtle part is null-vs-absent. `schedule` is nullable but NOT optional,
 * because clearing a schedule and forgetting to send one are different
 * intentions and must not collapse into the same write. A section created by
 * hand starts null (the create route drops the field), so "set it back to
 * unspecified" is a real action a registrar needs — but it has to be asked for
 * explicitly, never inferred from a missing key.
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEDULE_VALUES,
  SectionScheduleAssignSchema,
} from '@/lib/schemas/section';

describe('SectionScheduleAssignSchema', () => {
  it.each(SCHEDULE_VALUES)('accepts %s', (value) => {
    const parsed = SectionScheduleAssignSchema.safeParse({ schedule: value });
    expect(parsed.success).toBe(true);
  });

  it('accepts an explicit null — clearing is a real action', () => {
    const parsed = SectionScheduleAssignSchema.safeParse({ schedule: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.schedule).toBeNull();
  });

  it('rejects an omitted key, so a malformed body cannot silently clear', () => {
    expect(SectionScheduleAssignSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a value outside the enum', () => {
    // Guards against a caller inventing e.g. 'am'/'pm' or passing a display
    // label ('Morning') instead of the stored value.
    expect(
      SectionScheduleAssignSchema.safeParse({ schedule: 'Morning' }).success
    ).toBe(false);
    expect(
      SectionScheduleAssignSchema.safeParse({ schedule: 'evening' }).success
    ).toBe(false);
  });

  it('rejects an empty string — the UI’s "Not set" choice must send null', () => {
    // The dialog models "Not set" as '' in local state; it must convert to
    // null before sending, not pass the empty string through.
    expect(
      SectionScheduleAssignSchema.safeParse({ schedule: '' }).success
    ).toBe(false);
  });
});
