// @vitest-environment node
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/sis/events — the builder's "Copy from another event" list.

const state = vi.hoisted(() => ({
  role: 'admissions' as string,
  events: [] as {
    id: string;
    academic_year_id: string;
    title: string;
    form: unknown;
  }[],
  currentAy: 'ay-now' as string | null,
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: async (roles: string[]) =>
    roles.includes(state.role)
      ? { user: { id: 'u1', email: 'a@b.c' }, role: state.role }
      : { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const rows = (): Record<string, unknown>[] =>
        table === 'academic_years'
          ? state.currentAy
            ? [{ id: state.currentAy, is_current: true }]
            : []
          : state.events;
      const result = () => rows().filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.order = () => q;
      q.eq = (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      };
      q.neq = (col: string, v: unknown) => {
        filters.push((r) => r[col] !== v);
        return q;
      };
      q.maybeSingle = () =>
        Promise.resolve({ data: result()[0] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: result(), error: null }).then(res);
      return q;
    },
  }),
}));

import { GET } from '@/app/api/sis/events/route';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const form = {
  sections: [
    {
      id: 's1',
      title: 'Camp',
      description: '',
      scope: 'child',
      allowingOnly: false,
      questions: [],
    },
  ],
};

const get = async (qs = '') =>
  (await GET(new Request(`http://x/api/sis/events${qs}`))) as Response;

beforeEach(() => {
  state.role = 'admissions';
  state.currentAy = 'ay-now';
  state.events = [
    { id: A, academic_year_id: 'ay-old', title: 'This one', form },
    { id: B, academic_year_id: 'ay-old', title: 'Same year', form },
    { id: C, academic_year_id: 'ay-now', title: 'Other year', form },
  ];
});

describe('GET /api/sis/events', () => {
  it('refuses a teacher', async () => {
    state.role = 'teacher';
    expect((await get(`?exclude=${A}`)).status).toBe(403);
  });

  it("lists the excluded event's year without it", async () => {
    const res = await get(`?exclude=${A}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      events: [{ id: B, title: 'Same year', form }],
    });
  });

  it('uses the current year when nothing is excluded', async () => {
    const body = await (await get()).json();
    expect(body.events.map((e: { id: string }) => e.id)).toEqual([C]);
  });

  it('404s an unknown or malformed excluded id', async () => {
    expect((await get('?exclude=nope')).status).toBe(404);
    expect(
      (await get('?exclude=44444444-4444-4444-8444-444444444444')).status
    ).toBe(404);
  });

  it('skips an event whose stored form does not parse', async () => {
    state.events[1].form = { sections: 'broken' };
    const body = await (await get(`?exclude=${A}`)).json();
    expect(body.events).toEqual([]);
  });
});
