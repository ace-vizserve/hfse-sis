// @vitest-environment node
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'admissions' as string,
  tables: {} as Record<string, unknown[]>,
  inserted: [] as Record<string, unknown>[],
  uploads: [] as string[],
  logged: [] as Record<string, unknown>[],
  /** Rows a `.neq(...)` query (the slug clash check) answers with. */
  clash: [] as unknown[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: async (roles: string[]) =>
    roles.includes(state.role)
      ? {
          user: { id: 'u1', email: 'a@b.c' },
          role: state.role,
        }
      : { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: async (a: Record<string, unknown>) => {
    state.logged.push(a);
  },
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const rows = () => state.tables[table] ?? [];
      const q: Record<string, unknown> = {};
      const self = () => q;
      let isClashCheck = false;
      for (const m of ['select', 'eq', 'limit']) q[m] = self;
      q.neq = () => {
        isClashCheck = true;
        return q;
      };
      q.update = (row: Record<string, unknown>) => {
        state.updates.push(row);
        return q;
      };
      q.insert = (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return q;
      };
      q.single = () => Promise.resolve({ data: { id: 'new-id' }, error: null });
      q.maybeSingle = () =>
        Promise.resolve({
          data: rows()[0] ?? null,
          error: null,
        });
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({
          data: isClashCheck ? state.clash : rows(),
          error: null,
        }).then(res);
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.uploads.push(path);
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/${path}` },
        }),
      }),
    },
  }),
}));

import { POST as closePost } from '@/app/api/sis/events/[id]/close/route';
import { POST as imagePost } from '@/app/api/sis/events/[id]/image/route';
import { POST as publishPost } from '@/app/api/sis/events/[id]/publish/route';
import { PATCH } from '@/app/api/sis/events/[id]/route';
import { POST as createPost } from '@/app/api/sis/events/route';

// Handlers type as Response | undefined (requireRole's error branch); the
// tests only ever see a response.
const call =
  <A extends unknown[]>(fn: (...a: A) => Promise<Response | undefined>) =>
  async (...a: A) =>
    (await fn(...a)) as Response;

const ID = '11111111-1111-4111-8111-111111111111';
const ctx = { params: Promise.resolve({ id: ID }) };

const json = (body: unknown) =>
  new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function imageRequest(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return new Request('http://x', { method: 'POST', body: fd });
}

const question = (over: Record<string, unknown> = {}) => ({
  id: 'q1',
  type: 'short',
  label: 'Allergies',
  help: '',
  required: false,
  imageUrl: null,
  choices: [],
  allowOther: false,
  agreement: '',
  showWhen: null,
  ...over,
});
const section = (scope: string, questions: unknown[]) => ({
  id: 's1',
  title: 'Section',
  description: '',
  scope,
  allowingOnly: false,
  questions,
});

beforeEach(() => {
  state.role = 'admissions';
  state.tables = {};
  state.inserted = [];
  state.uploads = [];
  state.logged = [];
  state.clash = [];
  state.updates = [];
});

describe('staff event APIs', () => {
  it('refuses a teacher on every route', async () => {
    state.role = 'teacher';
    const statuses = [
      (await call(createPost)(json({ title: 'Trip' }))).status,
      (await call(PATCH)(json({}), ctx)).status,
      (await call(publishPost)(json({}), ctx)).status,
      (await call(closePost)(json({}), ctx)).status,
      (
        await call(imagePost)(
          imageRequest(new File(['x'], 'a.png', { type: 'image/png' })),
          ctx
        )
      ).status,
    ];
    expect(statuses).toEqual([403, 403, 403, 403, 403]);
  });

  it('creates an event with a unique slug and logs it', async () => {
    state.tables.academic_years = [{ id: 'ay1' }];
    state.tables.parent_events = [{ slug: 'sports-day' }];
    const res = await call(createPost)(json({ title: 'Sports Day' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'new-id', slug: 'sports-day-2' });
    expect(state.inserted[0]).toMatchObject({
      academic_year_id: 'ay1',
      answer_mode: 'consent',
      audience: 'all',
      form: { sections: [] },
      created_by: 'u1',
    });
    expect(state.logged[0]).toMatchObject({ action: 'parent_event.create' });
  });

  it('rejects a signature in a child section on save', async () => {
    const res = await call(PATCH)(
      json({
        form: {
          sections: [section('child', [question({ type: 'signature' })])],
        },
      }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it('saves a form and logs only which parts changed', async () => {
    state.tables.parent_events = [
      { id: ID, updated_at: '2026-11-01T00:00:00Z' },
    ];
    const res = await call(PATCH)(
      json({ form: { sections: [section('family', [question()])] } }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ savedAt: '2026-11-01T00:00:00Z' });
    expect(state.logged[0]).toMatchObject({
      action: 'parent_event.update',
      context: { details: false, form: true },
    });
  });

  it('saves a typed link, cleaned to letters, numbers and hyphens', async () => {
    state.tables.parent_events = [
      { id: ID, updated_at: '2026-11-01T00:00:00Z' },
    ];
    const res = await call(PATCH)(
      json({ slug: '  Camp Pandayan 2026! ' }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      savedAt: '2026-11-01T00:00:00Z',
      slug: 'camp-pandayan-2026',
    });
    expect(state.updates[0]).toEqual({ slug: 'camp-pandayan-2026' });
  });

  it('refuses a link another event uses, and one with no letters', async () => {
    state.tables.parent_events = [{ id: ID }];
    state.clash = [{ id: 'other' }];
    const taken = await call(PATCH)(json({ slug: 'sports-day' }), ctx);
    expect(taken.status).toBe(409);
    expect((await taken.json()).error).toBe(
      'Another event already uses this link.'
    );
    const empty = await call(PATCH)(json({ slug: '!!!' }), ctx);
    expect(empty.status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('refuses to publish an empty form with the exact message', async () => {
    state.tables.parent_events = [
      { id: ID, form: { sections: [] }, published_at: null },
    ];
    const res = await call(publishPost)(json({}), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'Add at least one question or info text before publishing.'
    );
  });

  it('publishes a form that has a question', async () => {
    state.tables.parent_events = [
      {
        id: ID,
        form: { sections: [section('family', [question()])] },
        published_at: null,
      },
    ];
    const res = await call(publishPost)(json({}), ctx);
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).publishedAt).toBe('string');
    expect(state.logged[0]).toMatchObject({ action: 'parent_event.publish' });
  });

  it('closes an event early', async () => {
    state.tables.parent_events = [{ id: ID }];
    const res = await call(closePost)(json({}), ctx);
    expect(res.status).toBe(200);
    expect(state.logged[0]).toMatchObject({ action: 'parent_event.close' });
  });

  it('rejects a gif and a 6 MB png, accepts a small png', async () => {
    state.tables.parent_events = [{ id: ID }];
    const gif = await call(imagePost)(
      imageRequest(new File(['x'], 'a.gif', { type: 'image/gif' })),
      ctx
    );
    expect(gif.status).toBe(400);

    const big = await call(imagePost)(
      imageRequest(
        new File([new Uint8Array(6 * 1024 * 1024)], 'a.png', {
          type: 'image/png',
        })
      ),
      ctx
    );
    expect(big.status).toBe(400);

    const ok = await call(imagePost)(
      imageRequest(new File(['x'], 'a.png', { type: 'image/png' })),
      ctx
    );
    expect(ok.status).toBe(200);
    expect(state.uploads[0]).toMatch(new RegExp(`^events/${ID}/.+\\.png$`));
    expect((await ok.json()).url).toContain(state.uploads[0]);
  });
});
