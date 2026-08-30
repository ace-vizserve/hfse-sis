/**
 * The daily-attendance writer's audit context.
 *
 * lib/audit/humanize.ts has always been able to render
 * "P1 Grit · Feb 10 · Absent → Present" — __tests__/audit/humanize.test.ts
 * asserts exactly that, and passed, because it feeds the renderer synthetic
 * input. The WRITER never supplied `section_name` or `prior_status`, so every
 * real row on /attendance/audit-log showed neither: no class, no before/after.
 *
 * That gap sat open since the route was written and mattered the moment the
 * academics team proposed letting an admin mark a register on an absent
 * teacher's behalf — a delegation policy whose whole point is accountability,
 * resting on a log that could not say which class was touched.
 *
 * These tests close the writer↔renderer loop: they assert the context the
 * route emits AND push it through the renderer.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-adviser', email: 'adviser@hfse.test' },
      role: 'academic_coordinator', // skips the teacher-only section gate
    })
  ),
}));

// Typed on the way in so `mock.calls[n][0].context` survives `tsc --noEmit`
// (vitest alone infers `[]` for an argument-less vi.fn and the index access
// then fails type-check even though the test runs).
const logAction = vi.fn((_call: { context: Record<string, unknown> }) =>
  Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: { context: Record<string, unknown> }) => logAction(call),
  // The real helper writes ONE array insert (phase 5); this stand-in keeps
  // fanning out to one `logAction` per row on purpose, so the assertions below
  // can address a single student's context by index. What is being measured
  // here is the CONTENT of each row, not how many round trips carry them —
  // the row shaping the two paths share is pinned in
  // __tests__/audit/log-actions-batch.test.ts.
  logActions: (
    _service: unknown,
    _actor: unknown,
    rows: Array<{ context: Record<string, unknown> }>
  ) => Promise.all(rows.map((row) => logAction(row))),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY9999')),
}));

vi.mock('@/lib/attendance/mutations', () => ({
  // Mirrors the real contract: one rollup per unique (term, student), keyed
  // the way the route looks them up. The route writes the whole class in one
  // call now rather than looping one entry at a time.
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

// ── Supabase service stub ──────────────────────────────────────────────────
// Only the tables the route touches on the happy path. `school_calendar`
// returns a school_day row so the write-gate never blocks.

type SbRow = Record<string, unknown>;

// DailyEntrySchema validates these as UUIDs and 400s on anything else, so the
// fixtures have to be real ones or the route never reaches the write loop.
const SS_GRIT = '11111111-1111-4111-8111-111111111111';
const SS_HONESTY = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const SEC_GRIT = '44444444-4444-4444-8444-444444444444';
const SEC_HONESTY = '55555555-5555-4555-8555-555555555555';

let priorLedgerRows: SbRow[] = [];
let priorQueryCount = 0;

function buildService() {
  const service = {
    from(table: string) {
      if (table === 'section_students') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { id: SS_GRIT, section_id: SEC_GRIT },
                  { id: SS_HONESTY, section_id: SEC_HONESTY },
                ],
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
                  { id: SEC_GRIT, name: 'Grit', levels: { code: 'P1' } },
                  { id: SEC_HONESTY, name: 'Honesty', levels: { code: 'P1' } },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === 'attendance_daily') {
        priorQueryCount += 1;
        // fetchAllPages drives .range(); return everything on the first page.
        const chain = {
          select: () => chain,
          in: () => chain,
          order: () => chain,
          range: (from: number) =>
            Promise.resolve({
              data: from === 0 ? priorLedgerRows : [],
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'school_calendar') {
        return {
          select: (_cols: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              const headChain = {
                eq: () => Promise.resolve({ count: 1, error: null }),
              };
              return headChain;
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
  return service;
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

function patchRequest(entries: SbRow[]) {
  return {
    json: () => Promise.resolve({ entries }),
  } as unknown as import('next/server').NextRequest;
}

function contextsFromLog(): SbRow[] {
  return logAction.mock.calls.map((c) => c[0].context);
}

describe('PATCH /api/attendance/daily — audit context', () => {
  beforeEach(() => {
    logAction.mockClear();
    priorLedgerRows = [];
    priorQueryCount = 0;
  });

  it('records the class the mark belongs to', async () => {
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'A',
        },
      ])
    );

    const [ctx] = contextsFromLog();
    expect(ctx.section_id).toBe(SEC_GRIT);
    expect(ctx.section_name).toBe('Grit');
  });

  it('records the previous status when there is one', async () => {
    priorLedgerRows = [
      {
        section_student_id: SS_GRIT,
        date: '2099-02-10',
        status: 'A',
        recorded_at: '2099-02-10T02:00:00Z',
      },
    ];
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        },
      ])
    );

    expect(contextsFromLog()[0].prior_status).toBe('A');
  });

  it('omits prior_status entirely on a first mark', async () => {
    // Absent, not null — a first mark is not a transition, and humanize
    // renders just the new status when the key is missing.
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        },
      ])
    );

    expect('prior_status' in contextsFromLog()[0]).toBe(false);
  });

  it('takes the newest ledger row when a mark was corrected repeatedly', async () => {
    // Append-only ledger: the CURRENT mark is the newest recorded_at, not the
    // first row the database happens to return.
    priorLedgerRows = [
      {
        section_student_id: SS_GRIT,
        date: '2099-02-10',
        status: 'EX',
        recorded_at: '2099-02-10T09:00:00Z',
      },
      {
        section_student_id: SS_GRIT,
        date: '2099-02-10',
        status: 'A',
        recorded_at: '2099-02-10T02:00:00Z',
      },
    ];
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        },
      ])
    );

    expect(contextsFromLog()[0].prior_status).toBe('EX');
  });

  it('gives each row its OWN class when a submit spans two sections', async () => {
    // The map is keyed by enrolment, not by request — the easy thing to get
    // wrong is stamping every row with the first section's name.
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        },
        {
          sectionStudentId: SS_HONESTY,
          termId: TERM,
          date: '2099-02-10',
          status: 'A',
        },
      ])
    );

    const names = contextsFromLog().map((c) => c.section_name);
    expect(names).toEqual(['Grit', 'Honesty']);
  });

  it('reads the prior ledger once for the whole batch', async () => {
    // The performance property, asserted rather than assumed: this must not
    // become one query per entry.
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest(
        Array.from({ length: 30 }, (_, i) => ({
          sectionStudentId: i % 2 === 0 ? SS_GRIT : SS_HONESTY,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        }))
      )
    );

    expect(logAction).toHaveBeenCalledTimes(30);
    expect(priorQueryCount).toBe(1);
  });

  it('renders through the humanizer as class · date · before → after', async () => {
    // Closes the writer↔renderer loop that has been open since this route was
    // written: humanize.test.ts proves the renderer works on synthetic input,
    // this proves the writer actually produces that input.
    const { auditContextSummary } = await import('@/lib/audit/humanize');
    priorLedgerRows = [
      {
        section_student_id: SS_GRIT,
        date: '2099-02-10',
        status: 'A',
        recorded_at: '2099-02-10T02:00:00Z',
      },
    ];
    const { PATCH } = await import('@/app/api/attendance/daily/route');
    await PATCH(
      patchRequest([
        {
          sectionStudentId: SS_GRIT,
          termId: TERM,
          date: '2099-02-10',
          status: 'P',
        },
      ])
    );

    const summary = auditContextSummary(
      'attendance.daily.update',
      contextsFromLog()[0]
    );
    expect(summary).toContain('Grit');
    expect(summary).toContain('→');
  });
});
