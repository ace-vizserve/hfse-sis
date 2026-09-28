import { describe, it, expect, vi, beforeEach } from 'vitest';

// The nightly auto-sync used to run for the CURRENT year only, so an Enrolled
// child in next year's intake whose class was set in Directus waited in the
// queue until someone clicked through. It now walks every year the queue
// shows, each with its own preload and its own audit row.

const mocks = vi.hoisted(() => ({
  listUnsyncedScopeAyCodes: vi.fn(),
  loadUnsyncedEnrolledStudents: vi.fn(),
  syncOneStudent: vi.fn(),
  logAction: vi.fn(),
  sectionYears: [] as string[],
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateAllOperationalDrills: vi.fn(),
}));
vi.mock('@/lib/audit/log-action', () => ({ logAction: mocks.logAction }));
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => ({}),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () =>
        table === 'levels'
          ? Promise.resolve({ data: [{ id: 'l1', label: 'Primary One' }] })
          : {
              eq: (_col: string, ay: string) => {
                mocks.sectionYears.push(ay);
                return Promise.resolve({
                  data: [
                    { id: `sec-${ay}`, level_id: 'l1', name: 'Courageous' },
                  ],
                });
              },
            },
    }),
  }),
}));
vi.mock('@/lib/sis/unsynced-students', () => ({
  listUnsyncedScopeAyCodes: mocks.listUnsyncedScopeAyCodes,
  loadUnsyncedEnrolledStudents: mocks.loadUnsyncedEnrolledStudents,
}));
vi.mock('@/lib/sync/students', () => ({
  syncOneStudent: mocks.syncOneStudent,
}));

import { GET } from '@/app/api/sis/students/auto-sync/route';

function row(ayCode: string, enroleeNumber: string, blocker: string | null) {
  return {
    ayCode,
    enroleeNumber,
    studentNumber: `S-${enroleeNumber}`,
    firstName: 'A',
    middleName: null,
    lastName: 'B',
    enroleeFullName: `Child ${enroleeNumber}`,
    levelApplied: 'Primary One',
    classType: null,
    preferredSchedule: null,
    classLevel: 'Primary One',
    classSection: 'Courageous',
    applicationStatus: 'Enrolled',
    gapReason: 'not_synced' as const,
    blocker,
  };
}

function request() {
  return new Request('http://x/api/sis/students/auto-sync', {
    method: 'GET',
    headers: { authorization: 'Bearer s3cret' },
  }) as unknown as Parameters<typeof GET>[0];
}

describe('auto-sync runs every in-scope year', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sectionYears = [];
    process.env.CRON_SECRET = 's3cret';
  });

  it('syncs each year with that year’s preload and writes one audit row per year', async () => {
    mocks.listUnsyncedScopeAyCodes.mockResolvedValue(['AY2026', 'AY2027']);
    mocks.loadUnsyncedEnrolledStudents.mockImplementation(async (ay: string) =>
      ay === 'AY2026'
        ? [
            row(ay, 'E1', null),
            { ...row(ay, 'E9', null), gapReason: 'no_class_section' },
          ]
        : [row(ay, 'E2', null), row(ay, 'E3', 'There is no class called "X"')]
    );
    mocks.syncOneStudent.mockImplementation(
      async (_s: unknown, _a: unknown, enrolee: string) =>
        enrolee === 'E3'
          ? { ok: false, change: 'skipped', error: 'section "X" not found' }
          : { ok: true, change: 'enrolled' }
    );

    const res = await GET(request());
    const body = await res.json();

    // Only not_synced rows are attempted, each under its own year.
    const calls = mocks.syncOneStudent.mock.calls.map((c) => [
      c[2],
      c[3],
      c[4],
    ]);
    expect(calls.map((c) => [c[0], c[1]])).toEqual([
      ['E1', 'AY2026'],
      ['E2', 'AY2027'],
      ['E3', 'AY2027'],
    ]);
    // …and each year's syncs get THAT year's classes.
    expect(calls[0][2].sections[0].id).toBe('sec-AY2026');
    expect(calls[1][2].sections[0].id).toBe('sec-AY2027');
    expect(mocks.sectionYears).toEqual(['AY2026', 'AY2027']);

    // One audit row per year, entity = the year.
    expect(mocks.logAction).toHaveBeenCalledTimes(2);
    const audits = mocks.logAction.mock.calls.map((c) => c[0]);
    expect(audits.map((a) => a.action)).toEqual([
      'sis.student.auto_sync_batch',
      'sis.student.auto_sync_batch',
    ]);
    expect(audits.map((a) => a.entityId)).toEqual(['AY2026', 'AY2027']);
    // The failure carries the plain-English blocker next to the sync's reason.
    expect(audits[1].context.failures).toEqual([
      expect.objectContaining({
        enroleeNumber: 'E3',
        error: 'section "X" not found',
        blocker: 'There is no class called "X"',
      }),
    ]);

    // Response totals span both years; by_ay keeps each year's own.
    expect(body.total_candidates).toBe(3);
    expect(body.by_outcome).toEqual({ enrolled: 2, skipped: 1 });
    expect(body.error_count).toBe(1);
    expect(body.by_ay.map((a: { ay_code: string }) => a.ay_code)).toEqual([
      'AY2026',
      'AY2027',
    ]);
  });

  it('refuses without the cron secret', async () => {
    const res = await GET(
      new Request('http://x', { method: 'GET' }) as unknown as Parameters<
        typeof GET
      >[0]
    );
    expect(res.status).toBe(401);
    expect(mocks.listUnsyncedScopeAyCodes).not.toHaveBeenCalled();
  });

  it('500s when no year is in scope', async () => {
    mocks.listUnsyncedScopeAyCodes.mockResolvedValue([]);
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(mocks.logAction).not.toHaveBeenCalled();
  });
});
