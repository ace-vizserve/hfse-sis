/**
 * PATCH /api/attendance/daily busts the drill caches for THE SECTION'S
 * academic year — not for whatever year happens to be current.
 *
 * WHY THIS IS A CHANGE AND NOT A REFACTOR. The handler used to end with
 * `invalidateDrillTags('attendance', await requireCurrentAyCode(service))`.
 * That is a round trip of its own, paid on every PATCH, and the attendance
 * grid PATCHes one cell at a time — so it was also the single most-repeated
 * read in the module. The AY code now rides along on the `sections` query the
 * handler already makes for the day-type lookup, which costs nothing extra.
 *
 * But the two are not the same value. For a mark inside the current year they
 * agree. For a BACK-DATED CORRECTION in a year that is no longer current they
 * do not, and the section's own year is the right one: the old code busted a
 * year nothing had changed and left the year that did change cached. So this
 * is recorded as a deliberate semantic move in the right direction, with a
 * test that would fail if someone "restored" the old behaviour.
 *
 * The fallback is asserted too. Over-invalidating a cache is harmless;
 * under-invalidating is not — so a sections row that somehow carries no
 * academic year falls back to the current one rather than skipping the bust.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SS_ID = '11111111-1111-4111-8111-111111111111';
const TERM = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';

// An academic_coordinator skips the teacher-only section gate — this file is
// about the invalidation at the end of the handler, not the gate at the top
// (that is __tests__/attendance/daily-enrolment-read-gate.test.ts's job).
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-admin', email: 'admin@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
  logActions: vi.fn(() => Promise.resolve()),
}));

const invalidateDrillTags = vi.fn((_module: string, _ayCode: string) => {});
vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: (module: string, ayCode: string) =>
    invalidateDrillTags(module, ayCode),
}));

// The year that is CURRENT — deliberately different from the year the section
// under test belongs to, so the two can never be confused for one another.
const requireCurrentAyCode = vi.fn(() => Promise.resolve('AY2030'));
vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: () => requireCurrentAyCode(),
}));

vi.mock('@/lib/attendance/mutations', () => ({
  writeDailyBatch: vi.fn(
    (
      _service: unknown,
      inputs: Array<{ termId: string; sectionStudentId: string }>
    ) =>
      Promise.resolve(
        new Map(
          inputs.map((i) => [
            `${i.termId}|${i.sectionStudentId}`,
            { attendance_pct: 100 },
          ])
        )
      )
  ),
}));

// Whether the sections row carries a joined academic year, and which.
let sectionAyCode: string | null = 'AY2025';

function buildService() {
  return {
    from(table: string) {
      if (table === 'section_students') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: SS_ID, section_id: SECTION }],
                error: null,
              }),
          }),
        };
      }
      if (table === 'sections') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  {
                    id: SECTION,
                    name: 'P1 Grit',
                    levels: { code: 'P1' },
                    academic_years: sectionAyCode
                      ? { ay_code: sectionAyCode }
                      : null,
                  },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === 'attendance_daily') {
        const chain = {
          select: () => chain,
          in: () => chain,
          order: () => chain,
          range: () => Promise.resolve({ data: [], error: null }),
        };
        return chain;
      }
      if (table === 'school_calendar') {
        return {
          select: (_cols: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            return {
              eq: () => ({
                eq: () => ({
                  in: () =>
                    Promise.resolve({
                      data: [
                        {
                          day_type: 'school_day',
                          audience: 'all',
                          hbl_overlay: false,
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

function patchRequest() {
  return {
    json: () =>
      Promise.resolve({
        entries: [
          {
            sectionStudentId: SS_ID,
            termId: TERM,
            date: '2099-02-10',
            status: 'P',
          },
        ],
      }),
  } as unknown as import('next/server').NextRequest;
}

async function patchAndExpectResponse(): Promise<Response> {
  const { PATCH } = await import('@/app/api/attendance/daily/route');
  const res = await PATCH(patchRequest());
  if (!res) throw new Error('PATCH returned no response');
  return res;
}

beforeEach(() => {
  invalidateDrillTags.mockClear();
  requireCurrentAyCode.mockClear();
  sectionAyCode = 'AY2025';
});

describe('PATCH /api/attendance/daily — which academic year gets invalidated', () => {
  it("busts the SECTION's year, not the current one", async () => {
    const res = await patchAndExpectResponse();

    expect(res.status).toBe(200);
    expect(invalidateDrillTags).toHaveBeenCalledWith('attendance', 'AY2025');
    // The whole point: the current year is AY2030 and it is NOT what was
    // busted. A back-dated correction in a closed year has to invalidate that
    // year's caches.
    expect(invalidateDrillTags).not.toHaveBeenCalledWith(
      'attendance',
      'AY2030'
    );
  });

  it('costs no round trip for the year — requireCurrentAyCode is not called', async () => {
    await patchAndExpectResponse();

    // The AY code rides on the `sections` read the handler already makes. The
    // grid PATCHes one cell at a time, so this read was being paid per cell.
    expect(requireCurrentAyCode).not.toHaveBeenCalled();
  });

  it('falls back to the current year when the section carries none', async () => {
    // Over-invalidating is harmless; under-invalidating is not. A missing join
    // must not turn into a skipped bust.
    sectionAyCode = null;

    await patchAndExpectResponse();

    expect(requireCurrentAyCode).toHaveBeenCalled();
    expect(invalidateDrillTags).toHaveBeenCalledWith('attendance', 'AY2030');
  });
});
