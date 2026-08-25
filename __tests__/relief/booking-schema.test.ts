import { describe, expect, it } from 'vitest';

import { ReliefBookingSchema } from '@/lib/schemas/teacher-assignment';

// The Cover page's booking body. It covers a whole absence at once, so the
// shape has one job the per-class PATCH does not: it must be able to say "end
// this" as clearly as it says "start this".

const AWAY = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';

describe('booking an absence', () => {
  it('takes a substitute and a window', () => {
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
      relief_teacher_user_id: SUB,
      relief_started_on: '2026-09-01',
      relief_ended_on: '2026-09-05',
    });
    expect(r.success).toBe(true);
  });

  it('accepts no dates at all — cover from now until ended', () => {
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
      relief_teacher_user_id: SUB,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an end before the start', () => {
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
      relief_teacher_user_id: SUB,
      relief_started_on: '2026-09-05',
      relief_ended_on: '2026-09-01',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/cannot be before/i);
  });

  it('rejects a date that is not yyyy-MM-dd', () => {
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
      relief_teacher_user_id: SUB,
      relief_started_on: '1 Sep 2026',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing teacher with words a school admin can act on', () => {
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
    });
    expect(r.success).toBe(false);
    // Not "expected string, received undefined".
    expect(r.error?.issues[0]?.message).toMatch(/Choose a teacher/);
  });
});

describe('ending an absence', () => {
  it('accepts null as the substitute — that is what ends it', () => {
    // ⚠ The whole reason the field is nullable. "She is back early" is one
    // decision about one absence; without this it would be N trips through N
    // class rows, and the Cover page could not end what it displays.
    const r = ReliefBookingSchema.safeParse({
      covered_teacher_user_id: AWAY,
      relief_teacher_user_id: null,
    });
    expect(r.success).toBe(true);
  });

  it('still requires knowing whose absence is being ended', () => {
    const r = ReliefBookingSchema.safeParse({ relief_teacher_user_id: null });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/who is away/i);
  });
});
