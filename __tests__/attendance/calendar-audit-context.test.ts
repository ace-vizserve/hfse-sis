/**
 * The school calendar's audit rows say what a change REPLACED.
 *
 * A delete used to log only the date (or, for an event, nothing but its id —
 * which points at nothing once the row is gone); an event edit logged only the
 * fields sent, never what they were before; and copy-from-prior-AY returned a
 * 500 with no audit row at all when its events failed after the days had
 * already been overwritten. These pin the before values and the partial row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuditCall = {
  action: string;
  entityId: string | null;
  context: Record<string, unknown>;
};

const logAction = vi.fn((_call: AuditCall) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (call: AuditCall) => logAction(call),
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

vi.mock('@/lib/academic-year', () => ({
  requireCurrentAyCode: vi.fn(() => Promise.resolve('AY2026')),
}));

// Per-test answers, keyed by table and verb.
type Result = { data: unknown; error: { message: string } | null };
let answers: Record<string, Result>;

function chain(result: Result) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  Object.assign(obj, {
    select: self,
    eq: self,
    in: self,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  });
  return obj;
}

function buildService() {
  return {
    from(table: string) {
      const read = answers[`${table}.select`] ?? { data: null, error: null };
      const obj = chain(read);
      for (const verb of ['delete', 'update', 'insert', 'upsert']) {
        obj[verb] = () =>
          chain(answers[`${table}.${verb}`] ?? { data: null, error: null });
      }
      return obj;
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

const TERM = '33333333-3333-4333-8333-333333333333';
const EVENT = '66666666-6666-4666-8666-666666666666';

const eventRow = (over: Record<string, unknown> = {}) => ({
  term_id: TERM,
  start_date: '2026-07-14',
  end_date: '2026-07-16',
  label: 'Leadership Camp',
  category: 'other',
  audience: 'all',
  levels: ['P4', 'P5'],
  section_ids: null,
  tentative: false,
  ...over,
});

function req(url: string, body?: unknown) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: new URL(url),
  } as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  answers = {};
});

describe('DELETE /api/attendance/calendar', () => {
  it('records what the day was before it was removed', async () => {
    answers['school_calendar.delete'] = {
      data: [
        { day_type: 'public_holiday', label: 'Deepavali', hbl_overlay: false },
      ],
      error: null,
    };
    const { DELETE } = await import('@/app/api/attendance/calendar/route');
    await DELETE(
      req(`http://x/api?termId=${TERM}&date=2026-11-08&audience=all`)
    );

    expect(logAction.mock.calls[0][0].context).toEqual({
      date: '2026-11-08',
      audience: 'all',
      removed: true,
      before_day_type: 'public_holiday',
      before_label: 'Deepavali',
      before_hbl_overlay: false,
    });
  });
});

describe('/api/attendance/calendar/events', () => {
  it('PATCH records the event before and after', async () => {
    answers['calendar_events.select'] = { data: eventRow(), error: null };
    answers['calendar_events.update'] = {
      data: [eventRow({ label: 'Leadership Camp (P4-S4)' })],
      error: null,
    };
    const { PATCH } =
      await import('@/app/api/attendance/calendar/events/route');
    await PATCH(
      req('http://x/api', { id: EVENT, label: 'Leadership Camp (P4-S4)' })
    );

    const ctx = logAction.mock.calls[0][0].context;
    expect(ctx).toMatchObject({
      id: EVENT,
      label: 'Leadership Camp (P4-S4)',
      updated: true,
      before: { label: 'Leadership Camp', levels: ['P4', 'P5'] },
      after: { label: 'Leadership Camp (P4-S4)' },
    });
  });

  it('DELETE records what was deleted', async () => {
    answers['calendar_events.delete'] = { data: [eventRow()], error: null };
    const { DELETE } =
      await import('@/app/api/attendance/calendar/events/route');
    await DELETE(req(`http://x/api?id=${EVENT}`));

    const call = logAction.mock.calls[0][0];
    expect(call.entityId).toBe(EVENT);
    expect(call.context).toMatchObject({
      removed: true,
      termId: TERM,
      startDate: '2026-07-14',
      endDate: '2026-07-16',
      label: 'Leadership Camp',
      category: 'other',
      audience: 'all',
      levels: ['P4', 'P5'],
    });
  });
});

describe('POST /api/attendance/calendar/copy-from-prior-ay', () => {
  const body = {
    targetTermId: TERM,
    markTentative: true,
    dayTypeRows: [
      { date: '2026-08-10', dayType: 'public_holiday', audience: 'all' },
      { date: '2026-08-11', dayType: 'school_day', audience: 'all' },
    ],
    events: [
      {
        startDate: '2026-07-14',
        endDate: '2026-07-16',
        label: 'Leadership Camp',
        category: 'other',
        audience: 'all',
      },
    ],
  };

  it('logs the days it already overwrote when the events then fail', async () => {
    answers['terms.select'] = { data: { id: TERM }, error: null };
    // One of the two days already had a row, and it said something else.
    answers['school_calendar.select'] = {
      data: [
        {
          date: '2026-08-10',
          audience: 'all',
          day_type: 'school_day',
          label: null,
        },
      ],
      error: null,
    };
    answers['school_calendar.upsert'] = { data: null, error: null };
    answers['calendar_events.insert'] = {
      data: null,
      error: { message: 'boom' },
    };
    const { POST } =
      await import('@/app/api/attendance/calendar/copy-from-prior-ay/route');
    const res = await POST(req('http://x/api', body));

    expect(res?.status).toBe(500);
    expect(logAction).toHaveBeenCalledTimes(1);
    expect(logAction.mock.calls[0][0].context).toMatchObject({
      partial: true,
      failed_step: 'events_insert',
      dayTypeRowsCopied: 2,
      eventsCopied: 0,
      overwrittenDays: [
        {
          date: '2026-08-10',
          audience: 'all',
          before_day_type: 'school_day',
          before_label: null,
          after_day_type: 'public_holiday',
          after_label: null,
        },
      ],
    });
  });

  it('lists the events it copied', async () => {
    answers['terms.select'] = { data: { id: TERM }, error: null };
    answers['school_calendar.select'] = { data: [], error: null };
    answers['school_calendar.upsert'] = { data: null, error: null };
    answers['calendar_events.insert'] = {
      data: [
        {
          id: EVENT,
          start_date: '2026-07-14',
          end_date: '2026-07-16',
          label: 'Leadership Camp',
        },
      ],
      error: null,
    };
    const { POST } =
      await import('@/app/api/attendance/calendar/copy-from-prior-ay/route');
    await POST(req('http://x/api', body));

    expect(logAction.mock.calls[0][0].context).toMatchObject({
      eventsCopied: 1,
      overwrittenDays: [],
      copiedEvents: [
        {
          id: EVENT,
          startDate: '2026-07-14',
          endDate: '2026-07-16',
          label: 'Leadership Camp',
        },
      ],
    });
  });
});
