/**
 * A school-calendar day can be aimed at one level (migration 196).
 *
 * The write route takes a level code as `audience`, or several audiences in
 * `audiences` written in one upsert; and DELETE `?audience=P1` removes only
 * the P1 row. An audience DELETE does not know is a 400 — it used to fall back
 * to 'all', which would remove the whole-school row instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCHOOL_CALENDAR_MAX_ROWS,
  schoolCalendarAudiences,
  SchoolCalendarUpsertSchema,
} from '@/lib/schemas/attendance';

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/auth/require-capability', () => ({
  requireCapability: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-reg', email: 'registrar@hfse.test' },
      role: 'academic_coordinator',
    })
  ),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateDrillTags: vi.fn(),
}));

vi.mock('@/lib/cache/ay-code-for-row', () => ({
  ayCodeForTerm: vi.fn(() => Promise.resolve('AY2026')),
}));

// Every chained call is recorded as [verb, ...args] so a test can read which
// filters a statement carried and which rows an upsert sent.
type Call = [string, ...unknown[]];
let statements: Call[][];
// Rows a SELECT answers with (the audit's before read); every other statement
// answers with no rows.
let selectRows: unknown[];

function buildService() {
  return {
    from(table: string) {
      const calls: Call[] = [['from', table]];
      statements.push(calls);
      const obj: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: calls.some((c) => c[0] === 'select') ? selectRows : [],
            error: null,
          }),
      };
      for (const verb of ['select', 'eq', 'in', 'delete', 'upsert']) {
        obj[verb] = (...args: unknown[]) => {
          calls.push([verb, ...args]);
          return obj;
        };
      }
      return obj;
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

const TERM = '33333333-3333-4333-8333-333333333333';

function req(url: string, body?: unknown) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: new URL(url),
  } as unknown as import('next/server').NextRequest;
}

const entry = (date: string) => ({ date, dayType: 'no_class' as const });

beforeEach(() => {
  vi.clearAllMocks();
  statements = [];
  selectRows = [];
});

async function loggedContext() {
  const { logAction } = await import('@/lib/audit/log-action');
  const calls = vi.mocked(logAction).mock.calls as unknown as Array<
    [{ context: Record<string, unknown> }]
  >;
  expect(calls).toHaveLength(1);
  return calls[0][0].context;
}

describe('SchoolCalendarUpsertSchema', () => {
  it('takes a level code as the audience', () => {
    const r = SchoolCalendarUpsertSchema.safeParse({
      termId: TERM,
      audience: 'P1',
      entries: [entry('2026-11-09')],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(schoolCalendarAudiences(r.data)).toEqual(['P1']);
  });

  it('defaults to the whole school when no audience is sent', () => {
    const r = SchoolCalendarUpsertSchema.parse({
      termId: TERM,
      entries: [entry('2026-11-09')],
    });
    expect(schoolCalendarAudiences(r)).toEqual(['all']);
  });

  it('accepts an audiences list and drops repeats', () => {
    const r = SchoolCalendarUpsertSchema.parse({
      termId: TERM,
      audiences: ['P1', 'P2', 'P1'],
      entries: [entry('2026-11-09')],
    });
    expect(schoolCalendarAudiences(r)).toEqual(['P1', 'P2']);
  });

  it('lets audiences win when both are sent', () => {
    const r = SchoolCalendarUpsertSchema.parse({
      termId: TERM,
      audience: 'primary',
      audiences: ['S1'],
      entries: [entry('2026-11-09')],
    });
    expect(schoolCalendarAudiences(r)).toEqual(['S1']);
  });

  it('rejects a code it does not know', () => {
    for (const bad of [
      { audience: 'P7' },
      { audience: 'YS' },
      { audiences: ['P1', 'bogus'] },
      { audiences: [] },
    ]) {
      const r = SchoolCalendarUpsertSchema.safeParse({
        termId: TERM,
        ...bad,
        entries: [entry('2026-11-09')],
      });
      expect(r.success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('caps the total rows one save writes', () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      entry(`2027-01-${String((i % 28) + 1).padStart(2, '0')}`)
    );
    const tenLevels = [
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'S1',
      'S2',
      'S3',
      'S4',
    ];
    // 200 × 10 is exactly at the cap.
    expect(200 * tenLevels.length).toBe(SCHOOL_CALENDAR_MAX_ROWS);
    expect(
      SchoolCalendarUpsertSchema.safeParse({
        termId: TERM,
        audiences: tenLevels,
        entries,
      }).success
    ).toBe(true);
    // 200 × 11 is over it.
    const over = SchoolCalendarUpsertSchema.safeParse({
      termId: TERM,
      audiences: [...tenLevels, 'primary'],
      entries,
    });
    expect(over.success).toBe(false);
    if (!over.success) {
      expect(over.error.issues[0].message).toContain('too much for one save');
    }
  });
});

describe('POST /api/attendance/calendar', () => {
  it('writes every entry once per audience in one upsert', async () => {
    const { POST } = await import('@/app/api/attendance/calendar/route');
    const res = await POST(
      req('http://x/api', {
        termId: TERM,
        audiences: ['P1', 'P2'],
        entries: [entry('2026-11-09'), entry('2026-11-10')],
      })
    );
    expect(res?.status).toBe(200);

    const upserts = statements.flat().filter((c) => c[0] === 'upsert');
    expect(upserts).toHaveLength(1);
    const [, rows, opts] = upserts[0] as [
      string,
      Array<{ audience: string; date: string }>,
      { onConflict: string },
    ];
    expect(opts.onConflict).toBe('term_id,audience,date');
    expect(rows.map((r) => `${r.audience}:${r.date}`).sort()).toEqual([
      'P1:2026-11-09',
      'P1:2026-11-10',
      'P2:2026-11-09',
      'P2:2026-11-10',
    ]);

    // The before read for the audit diff covers both audiences.
    const beforeRead = statements.find((s) => s.some((c) => c[0] === 'select'));
    expect(beforeRead).toContainEqual(['in', 'audience', ['P1', 'P2']]);
  });

  it('logs a one-audience save in the same shape as before', async () => {
    const { POST } = await import('@/app/api/attendance/calendar/route');
    await POST(
      req('http://x/api', {
        termId: TERM,
        audience: 'P1',
        entries: [entry('2026-11-09')],
      })
    );
    const context = await loggedContext();
    expect(context.audience).toBe('P1');
    expect(context).not.toHaveProperty('audiences');
  });

  it("gives each audience's diff its own before value", async () => {
    // P1 already has a row on the date; P2 has none.
    selectRows = [
      {
        date: '2026-11-09',
        audience: 'P1',
        day_type: 'school_day',
        hbl_overlay: false,
        label: null,
      },
    ];
    const { POST } = await import('@/app/api/attendance/calendar/route');
    await POST(
      req('http://x/api', {
        termId: TERM,
        audiences: ['P1', 'P2'],
        entries: [entry('2026-11-09')],
      })
    );
    const context = await loggedContext();
    expect(context.audiences).toEqual(['P1', 'P2']);
    const diffs = context.diffs as Array<{
      audience: string;
      before_day_type: string | null;
    }>;
    const before = Object.fromEntries(
      diffs.map((d) => [d.audience, d.before_day_type])
    );
    expect(before).toEqual({ P1: 'school_day', P2: null });
  });
});

describe('DELETE /api/attendance/calendar', () => {
  it('removes only the row for the level asked for', async () => {
    const { DELETE } = await import('@/app/api/attendance/calendar/route');
    const res = await DELETE(
      req(`http://x/api?termId=${TERM}&date=2026-11-09&audience=P1`)
    );
    expect(res?.status).toBe(200);

    const del = statements.find((s) => s.some((c) => c[0] === 'delete'));
    expect(del).toContainEqual(['eq', 'audience', 'P1']);
    expect(del).toContainEqual(['eq', 'date', '2026-11-09']);
    expect(del).toContainEqual(['eq', 'term_id', TERM]);
  });

  it('refuses an audience it does not know instead of removing the whole-school row', async () => {
    const { DELETE } = await import('@/app/api/attendance/calendar/route');
    const res = await DELETE(
      req(`http://x/api?termId=${TERM}&date=2026-11-09&audience=bogus`)
    );
    expect(res?.status).toBe(400);
    expect(statements.some((s) => s.some((c) => c[0] === 'delete'))).toBe(
      false
    );
  });
});
