/**
 * PATCH /api/attendance/daily read the SAME `section_students` rows twice per
 * submit — once inside `assertAdviserForSections` (the teacher authorisation
 * gate) and once again a few lines later to resolve section names and level
 * types. Same table, same columns, same ids; only the second list was deduped,
 * which `.in()` does not care about. Phase 3 item 5 hoists it to one read.
 *
 * ⚠ THE POINT OF THIS FILE IS THE GATE, NOT THE SAVING. One of those reads
 * decides whether a teacher may write another class's register. A hoist that
 * turned a failed lookup into an EMPTY RESULT — and an empty result into "no
 * sections to object to, therefore allowed" — would be a security regression
 * paid for with one round trip. So the fail-closed cases below are asserted
 * first and must hold identically before and after the hoist:
 *
 *   - the lookup ERRORS            -> 403, never 200
 *   - the lookup returns NO ROWS   -> 403 (ids that match no enrolment)
 *   - the ids resolve to a section the teacher does not advise -> 403
 *
 * The round-trip count is asserted separately, and is the only assertion here
 * that is expected to change: 2 before the hoist, 1 after.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real uuids — DailyEntrySchema 400s on anything else, and a 400 would make
// every assertion below vacuous.
const SS_MINE = '11111111-1111-4111-8111-111111111111';
const SS_THEIRS = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const SEC_MINE = '44444444-4444-4444-8444-444444444444';
const SEC_THEIRS = '55555555-5555-4555-8555-555555555555';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-teacher', email: 'teacher@hfse.test' },
      // A TEACHER — the only role the section gate runs for.
      role: 'teacher',
    })
  ),
}));

// The viewer advises SEC_MINE and nothing else.
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: vi.fn(() =>
    Promise.resolve([
      { section_id: SEC_MINE, role: 'form_adviser', subject_id: null },
    ])
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
  logActions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY9999')),
}));

const writeDailyBatch = vi.fn(
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
);
vi.mock('@/lib/attendance/mutations', () => ({
  writeDailyBatch: (
    service: unknown,
    inputs: Array<{ termId: string; sectionStudentId: string }>
  ) => writeDailyBatch(service, inputs),
}));

// ── Service stub ───────────────────────────────────────────────────────────

type EnrolmentOutcome =
  | { kind: 'ok'; rows: Array<{ id: string; section_id: string }> }
  | { kind: 'error'; message: string };

let enrolmentOutcome: EnrolmentOutcome = { kind: 'ok', rows: [] };
let enrolmentReads = 0;

function buildService() {
  return {
    from(table: string) {
      if (table === 'section_students') {
        enrolmentReads += 1;
        return {
          select: () => ({
            in: () =>
              Promise.resolve(
                enrolmentOutcome.kind === 'error'
                  ? { data: null, error: { message: enrolmentOutcome.message } }
                  : { data: enrolmentOutcome.rows, error: null }
              ),
          }),
        };
      }
      if (table === 'sections') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { id: SEC_MINE, name: 'P1 Grit', levels: { code: 'P1' } },
                  {
                    id: SEC_THEIRS,
                    name: 'P1 Honesty',
                    levels: { code: 'P1' },
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

function patchRequest(sectionStudentIds: string[]) {
  return {
    json: () =>
      Promise.resolve({
        entries: sectionStudentIds.map((id) => ({
          sectionStudentId: id,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        })),
      }),
  } as unknown as import('next/server').NextRequest;
}

// Every return path in the handler yields a response, but its INFERRED type is
// `NextResponse | undefined`, so `res.status` does not typecheck. The existing
// sibling tests never hit this because they discard PATCH's return value. Narrow
// once here instead of at five call sites, and throw loudly rather than assert
// the union away — if the handler ever really does fall through without
// responding, that is a bug this should surface, not hide.
async function patchAndExpectResponse(
  request: import('next/server').NextRequest
): Promise<Response> {
  const { PATCH } = await import('@/app/api/attendance/daily/route');
  const res = await PATCH(request);
  if (!res) throw new Error('PATCH returned no response');
  return res;
}

beforeEach(() => {
  enrolmentReads = 0;
  writeDailyBatch.mockClear();
  enrolmentOutcome = {
    kind: 'ok',
    rows: [{ id: SS_MINE, section_id: SEC_MINE }],
  };
});

describe('PATCH /api/attendance/daily — the enrolment read that gates the write', () => {
  it('refuses when the enrolment lookup ERRORS — never allows on a failed read', async () => {
    enrolmentOutcome = { kind: 'error', message: 'connection reset' };

    const res = await patchAndExpectResponse(patchRequest([SS_MINE]));

    expect(res.status).toBe(403);
    // The load-bearing half: nothing was written on the way to that refusal.
    expect(writeDailyBatch).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('enrolment lookup failed');
  });

  it('refuses when the ids resolve to NO rows — an empty result is not permission', async () => {
    // The exact shape a naive hoist would get wrong: no rows means no section
    // ids, and "no section ids" must not read as "no section to object to".
    enrolmentOutcome = { kind: 'ok', rows: [] };

    const res = await patchAndExpectResponse(patchRequest([SS_MINE]));

    expect(res.status).toBe(403);
    expect(writeDailyBatch).not.toHaveBeenCalled();
  });

  it('refuses a class the teacher does not advise', async () => {
    enrolmentOutcome = {
      kind: 'ok',
      rows: [{ id: SS_THEIRS, section_id: SEC_THEIRS }],
    };

    const res = await patchAndExpectResponse(patchRequest([SS_THEIRS]));

    expect(res.status).toBe(403);
    expect(writeDailyBatch).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not form adviser');
  });

  it('refuses when ONE of several entries belongs to another class', async () => {
    enrolmentOutcome = {
      kind: 'ok',
      rows: [
        { id: SS_MINE, section_id: SEC_MINE },
        { id: SS_THEIRS, section_id: SEC_THEIRS },
      ],
    };

    const res = await patchAndExpectResponse(
      patchRequest([SS_MINE, SS_THEIRS])
    );

    expect(res.status).toBe(403);
    expect(writeDailyBatch).not.toHaveBeenCalled();
  });

  it('allows a class the teacher advises, and reads section_students ONCE', async () => {
    const res = await patchAndExpectResponse(patchRequest([SS_MINE, SS_MINE]));

    expect(res.status).toBe(200);
    expect(writeDailyBatch).toHaveBeenCalledTimes(1);
    // The saving. Before the hoist this was 2: the gate resolved the enrolments
    // and then the audit/level-type block resolved the same ids again.
    expect(enrolmentReads).toBe(1);
  });
});
