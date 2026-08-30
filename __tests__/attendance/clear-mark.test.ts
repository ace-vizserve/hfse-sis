/**
 * Clearing an attendance mark — the round trip, migration 134.
 *
 * A mark is undone by writing a row whose `status` is NULL, not by deleting
 * anything and not by inventing a sixth status. The ledger stays append-only,
 * the prior mark survives with its author and timestamp, and a NULL row falls
 * out of every rollup aggregate because FILTER counts only TRUE.
 *
 * Three things have to agree for that to work, and each is asserted here
 * rather than assumed:
 *
 *   1. the PAYLOAD may carry a null status, and may NOT smuggle a reason or a
 *      note alongside it — the same rule the database enforces with
 *      `attendance_daily_cleared_has_no_reason_chk`, stated in zod so the
 *      teacher gets a 400 with words instead of a 500 with a constraint name;
 *   2. the ROUTE lets the null through to the writer, and lets it through
 *      even on a day the calendar has since closed;
 *   3. the AUDIT LOG says what happened in English. The failure mode this
 *      guards is not a crash — it is a row on /attendance/audit-log reading
 *      "P1 Grit · 10 Feb 2099" and nothing else, or worse, the literal word
 *      "null" shown to a school administrator.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DailyBulkSchema, DailyEntrySchema } from '@/lib/schemas/attendance';
import { auditContextSummary } from '@/lib/audit/humanize';

// DailyEntrySchema validates these as UUIDs and 400s on anything else, so the
// fixtures have to be real ones or the route never reaches the write.
const SS = '11111111-1111-4111-8111-111111111111';
const TERM = '33333333-3333-4333-8333-333333333333';
const SEC = '44444444-4444-4444-8444-444444444444';

// ─────────────────────────────────────────────────────────────────────────
// 1. The payload
// ─────────────────────────────────────────────────────────────────────────

describe('a cleared entry validates, and carries nothing with it', () => {
  const base = { sectionStudentId: SS, termId: TERM, date: '2099-02-10' };

  it('accepts an explicit null status', () => {
    const parsed = DailyEntrySchema.safeParse({ ...base, status: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.status).toBeNull();
  });

  it('still refuses a status the register does not have', () => {
    // Nullable, not "anything goes" — the enum is intact underneath.
    expect(DailyEntrySchema.safeParse({ ...base, status: 'CL' }).success).toBe(
      false
    );
  });

  it('refuses a reason riding along with a clear', () => {
    // The database refuses this too. Catching it here is what turns a
    // constraint violation into a sentence.
    const parsed = DailyEntrySchema.safeParse({
      ...base,
      status: null,
      exReason: 'mc',
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a note riding along with a clear', () => {
    // The one that actually matters: a cleared day still holding "medical
    // certificate submitted" reads as unmarked while carrying an excuse
    // underneath it.
    const parsed = DailyEntrySchema.safeParse({
      ...base,
      status: null,
      exNote: 'medical certificate submitted',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts explicit nulls for the reason and the note', () => {
    // What the grid actually sends when it clears a cell.
    const parsed = DailyEntrySchema.safeParse({
      ...base,
      status: null,
      exReason: null,
      exNote: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('takes a clear inside a bulk submit too', () => {
    const parsed = DailyBulkSchema.safeParse({
      entries: [
        { ...base, status: 'P' },
        { ...base, date: '2099-02-11', status: null },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. The audit line
// ─────────────────────────────────────────────────────────────────────────

describe('a cleared mark reads as English on the audit log', () => {
  it('says what was undone', () => {
    const summary = auditContextSummary('attendance.daily.correct', {
      section_name: 'Grit',
      date: '2099-02-10',
      status: null,
      prior_status: 'A',
    });
    expect(summary).toContain('Grit');
    expect(summary).toContain('Mark cleared');
    expect(summary).toContain('was Absent');
  });

  it('never shows a school administrator the word "null"', () => {
    // The whole point of the branch. `str(null)` is '', so without it the
    // line would name the class and the date and then say nothing at all —
    // and the obvious "fix" of printing the raw value is worse.
    const summary = auditContextSummary('attendance.daily.correct', {
      section_name: 'Grit',
      date: '2099-02-10',
      status: null,
      prior_status: 'A',
    });
    expect(summary.toLowerCase()).not.toContain('null');
    expect(summary.toLowerCase()).not.toContain('undefined');
  });

  it('does not claim a transition when there was no prior mark', () => {
    const summary = auditContextSummary('attendance.daily.update', {
      section_name: 'Grit',
      date: '2099-02-10',
      status: null,
    });
    expect(summary).toContain('Mark cleared');
    expect(summary).not.toContain('was ');
    expect(summary).not.toContain('→');
  });

  it('leaves an ordinary mark change exactly as it was', () => {
    // The clear branch keys on `status` being present AND null; an absent key
    // is `undefined` and must not be mistaken for one.
    const summary = auditContextSummary('attendance.daily.correct', {
      section_name: 'Grit',
      date: '2099-02-10',
      status: 'P',
      prior_status: 'A',
    });
    expect(summary).toContain('Absent → Present');
    expect(summary).not.toContain('cleared');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. The route
// ─────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-adviser', email: 'adviser@hfse.test' },
      role: 'academic_coordinator', // skips the teacher-only section gate
    })
  ),
}));

const logAction = vi.fn((_call: { context: Record<string, unknown> }) =>
  Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: { context: Record<string, unknown> }) => logAction(call),
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

const written = vi.fn(
  (_inputs: Array<{ termId: string; sectionStudentId: string }>) => {}
);
vi.mock('@/lib/attendance/mutations', () => ({
  writeDailyBatch: vi.fn(
    (
      _service: unknown,
      inputs: Array<{ termId: string; sectionStudentId: string }>
    ) => {
      written(inputs);
      return Promise.resolve(
        new Map(
          inputs.map((i) => [
            `${i.termId}|${i.sectionStudentId}`,
            { attendance_pct: 100 },
          ])
        )
      );
    }
  ),
}));

type SbRow = Record<string, unknown>;

/** The prior ledger the route reads to fill `prior_status`. */
let priorLedgerRows: SbRow[] = [];
/** What `school_calendar` says about 2099-02-10 for this term. */
let calendarDayType = 'school_day';

function buildService() {
  return {
    from(table: string) {
      if (table === 'section_students') {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [{ id: SS, section_id: SEC }],
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
                    id: SEC,
                    name: 'Grit',
                    levels: { code: 'P1' },
                    academic_years: { ay_code: 'AY9999' },
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
              return { eq: () => Promise.resolve({ count: 1, error: null }) };
            }
            return {
              eq: () => ({
                eq: () => ({
                  in: () =>
                    Promise.resolve({
                      data: [
                        {
                          day_type: calendarDayType,
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

function patchRequest(entries: SbRow[]) {
  return {
    json: () => Promise.resolve({ entries }),
  } as unknown as import('next/server').NextRequest;
}

/**
 * Call the handler and hand back a response that is definitely there.
 *
 * `PATCH`'s inferred return type includes `undefined` (the auth guard's early
 * return), which no path these tests take can produce. Asserted once here so
 * the four call sites can read `res.status` without a `!` each.
 */
async function callPatch(entries: SbRow[]) {
  const { PATCH } = await import('@/app/api/attendance/daily/route');
  const res = await PATCH(patchRequest(entries));
  if (!res) throw new Error('PATCH returned no response');
  return res;
}

describe('PATCH /api/attendance/daily — clearing a mark', () => {
  beforeEach(() => {
    logAction.mockClear();
    written.mockClear();
    priorLedgerRows = [];
    calendarDayType = 'school_day';
  });

  it('hands the null status straight through to the ledger writer', async () => {
    const res = await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: null },
    ]);

    expect(res.status).toBe(200);
    const inputs = written.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inputs[0].status).toBeNull();
    expect(inputs[0].exReason).toBeNull();
    expect(inputs[0].exNote).toBeNull();
  });

  it('echoes the cleared status back to the grid', async () => {
    // The grid holds an optimistic empty cell; the response has to agree with
    // it, or the next render puts the mark back.
    const res = await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: null },
    ]);
    const body = (await res.json()) as {
      results: Array<{ status: string | null }>;
    };
    expect(body.results[0].status).toBeNull();
  });

  it('records what was undone, and renders it', async () => {
    priorLedgerRows = [
      {
        section_student_id: SS,
        date: '2099-02-10',
        status: 'A',
        recorded_at: '2099-02-10T02:00:00Z',
      },
    ];
    await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: null },
    ]);

    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx.status).toBeNull();
    expect(ctx.prior_status).toBe('A');
    // ⚠ Closes the writer↔renderer loop rather than trusting either half.
    const summary = auditContextSummary('attendance.daily.correct', ctx);
    expect(summary).toContain('Mark cleared (was Absent)');
  });

  it('omits prior_status when the day was already cleared', async () => {
    // The newest row IS the current mark, and it is a clear — so there is no
    // prior mark to name. A `null` must never reach the renderer, which could
    // only print it as the word "null".
    priorLedgerRows = [
      {
        section_student_id: SS,
        date: '2099-02-10',
        status: null,
        recorded_at: '2099-02-10T09:00:00Z',
      },
      {
        section_student_id: SS,
        date: '2099-02-10',
        status: 'A',
        recorded_at: '2099-02-10T02:00:00Z',
      },
    ];
    await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: 'P' },
    ]);

    expect('prior_status' in logAction.mock.calls[0][0].context).toBe(false);
  });

  it('lets a clear through on a day the calendar has since closed', async () => {
    // ⚠ THE CASE THIS EXISTS FOR. A day is marked, the registrar then corrects
    // the calendar to say the school was shut, and the mark left behind is now
    // unreachable — blocked from being changed and, without this, blocked from
    // being removed. Clearing only ever takes a mark away, so the write-gate
    // has nothing to protect.
    calendarDayType = 'public_holiday';
    const res = await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: null },
    ]);
    expect(res.status).toBe(200);
    expect(written).toHaveBeenCalledTimes(1);
  });

  it('still refuses to PUT a mark on a closed day', async () => {
    // The gate is narrowed for clears only. If this ever passes, the widening
    // took the whole rule with it.
    calendarDayType = 'public_holiday';
    const res = await callPatch([
      { sectionStudentId: SS, termId: TERM, date: '2099-02-10', status: 'P' },
    ]);
    expect(res.status).toBe(409);
    expect(written).not.toHaveBeenCalled();
  });
});
