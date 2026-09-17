/**
 * SIS Admin audit rows — the pieces that record what a write REPLACED, and
 * what a write that failed half-way had already committed.
 *
 *   1. `buildPreviousReliefContext` names the cover a relief write overwrote,
 *      and says nothing when there was none.
 *   2. `classLabel` reads the way staff name a class.
 *   3. PATCH /api/sis/ay-setup/terms/[termId]: the term dates commit before the
 *      calendar resync, so a resync failure still writes the audit row (marked
 *      partial) with flat old/new keys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logActionMock, resyncMock } = vi.hoisted(() => ({
  logActionMock: vi.fn(async (_entry: Record<string, unknown>) => undefined),
  resyncMock: vi.fn(async (..._args: unknown[]) => ({
    deleted: 0,
    inserted: 0,
  })),
}));

vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: vi.fn(async () => [['u-relief', 'Ms Relief']]),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (entry: Record<string, unknown>) => logActionMock(entry),
}));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));
vi.mock('@/lib/attendance/calendar', () => ({
  resyncTermCalendarWindow: (...args: unknown[]) => resyncMock(...args),
}));
vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(async () => ({
    user: { id: 'u-admin', email: 'admin@hfse.test' },
    role: 'school_admin',
  })),
}));

const termRow = {
  id: 'term-3',
  academic_year_id: 'ay-1',
  term_number: 3,
  label: 'Term 3',
  start_date: '2026-06-01',
  end_date: '2026-08-28',
  virtue_theme: null,
  grading_lock_date: null,
};
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: termRow, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

import {
  buildPreviousReliefContext,
  classLabel,
} from '@/lib/audit/assignment-context';
import { PATCH } from '@/app/api/sis/ay-setup/terms/[termId]/route';

beforeEach(() => {
  logActionMock.mockClear();
  resyncMock.mockClear();
});

describe('buildPreviousReliefContext', () => {
  it('names the cover that was replaced', async () => {
    const ctx = await buildPreviousReliefContext({
      relief_teacher_user_id: 'u-relief',
      relief_started_on: '2026-09-14',
      relief_ended_on: '2026-09-18',
      relief_reason: 'Medical leave',
    });
    expect(ctx).toEqual({
      previous_relief_teacher_user_id: 'u-relief',
      previous_relief_teacher_name: 'Ms Relief',
      previous_relief_started_on: '2026-09-14',
      previous_relief_ended_on: '2026-09-18',
      previous_relief_reason: 'Medical leave',
    });
  });

  it('says nothing when the class had no cover', async () => {
    expect(
      await buildPreviousReliefContext({
        relief_teacher_user_id: null,
        relief_started_on: null,
        relief_ended_on: null,
        relief_reason: null,
      })
    ).toEqual({});
  });
});

describe('classLabel', () => {
  it('reads the way staff name a class', () => {
    expect(classLabel('Diligence', 'P4')).toBe('P4 Diligence');
    expect(classLabel('Diligence', 'P4', 'MATH')).toBe('P4 Diligence · MATH');
    expect(classLabel(null, 'P4')).toBeNull();
  });
});

describe('PATCH /api/sis/ay-setup/terms/[termId]', () => {
  const patch = async (body: unknown): Promise<Response> =>
    (await PATCH(
      new Request('http://localhost/api/sis/ay-setup/terms/term-3', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      { params: Promise.resolve({ termId: 'term-3' }) }
    )) as Response;

  it('audits the saved dates even when the school-day resync fails', async () => {
    resyncMock.mockImplementationOnce(async () => {
      throw new Error('calendar write failed');
    });
    const res = await patch({
      startDate: '2026-06-08',
      endDate: '2026-08-28',
    });
    expect(res.status).toBe(500);
    expect(logActionMock).toHaveBeenCalledTimes(1);
    expect(logActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ay.term_dates.update',
        entityId: 'term-3',
        context: expect.objectContaining({
          term_number: 3,
          old_start_date: '2026-06-01',
          new_start_date: '2026-06-08',
          old_end_date: '2026-08-28',
          new_end_date: '2026-08-28',
          partial: true,
          failed_step: 'calendar_resync',
        }),
      })
    );
  });

  it('writes the flat keys on a clean save too, without the partial flag', async () => {
    const res = await patch({
      startDate: '2026-06-08',
      endDate: '2026-08-28',
    });
    expect(res.status).toBe(200);
    const ctx = logActionMock.mock.calls[0][0].context as Record<
      string,
      unknown
    >;
    expect(ctx.old_start_date).toBe('2026-06-01');
    expect(ctx.new_start_date).toBe('2026-06-08');
    expect(ctx).not.toHaveProperty('partial');
  });
});
