/**
 * The Book list page's writes (plan 2026-10-28-books-supplies-tracker.md,
 * Phase 4): the role gate on every route, Remove refused (409) once a student
 * has been given the item, a duplicate refused (409), and copying a year
 * refused when the target already has a list.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let role = 'admissions';
const audit = vi.fn<(...a: unknown[]) => Promise<void>>(() =>
  Promise.resolve()
);

type Call = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: unknown[][];
  head?: boolean;
};
type Result = { data?: unknown; error?: unknown; count?: number | null };
const calls: Call[] = [];
let handle: (c: Call) => Result = () => ({ data: null, error: null });

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn((allowed: string[]) =>
    Promise.resolve(
      allowed.includes(role)
        ? { user: { id: 'u1', email: 'w@hfse.test' }, role }
        : {
            error: new Response(JSON.stringify({ error: 'forbidden' }), {
              status: 403,
            }),
          }
    )
  ),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (...a: unknown[]) => audit(...a),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      const q: Record<string, unknown> = {};
      const chain =
        (name: string) =>
        (...args: unknown[]) => {
          call.filters.push([name, ...args]);
          return q;
        };
      q.select = (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) call.head = true;
        return q;
      };
      q.insert = (payload: unknown) => {
        call.op = 'insert';
        call.payload = payload;
        return q;
      };
      q.update = (payload: unknown) => {
        call.op = 'update';
        call.payload = payload;
        return q;
      };
      q.delete = () => {
        call.op = 'delete';
        return q;
      };
      for (const name of ['eq', 'in', 'order', 'limit', 'range'])
        q[name] = chain(name);
      const settle = () => {
        calls.push(call);
        return Promise.resolve({
          data: null,
          error: null,
          count: null,
          ...handle(call),
        });
      };
      q.maybeSingle = settle;
      q.single = settle;
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        settle().then(res, rej);
      return q;
    },
  }),
}));

import { POST as copyYear } from '@/app/api/sis/supplies/copy-year/route';
import { DELETE, PATCH } from '@/app/api/sis/supplies/items/[id]/route';
import { POST as createItem } from '@/app/api/sis/supplies/items/route';

const ITEM = '11111111-1111-4111-8111-111111111111';
const LEVEL = '22222222-2222-4222-8222-222222222222';
const itemParams = { params: Promise.resolve({ id: ITEM }) };

const req = (method: string, body?: unknown) =>
  new Request('http://x/api', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const STORED = {
  id: ITEM,
  kind: 'book',
  level_id: LEVEL,
  class_type: 'Global',
  subject: 'English',
  title: 'Grammar P5',
  publisher: null,
  isbn: null,
  academic_year: { ay_code: 'AY2027' },
};

const eqValue = (c: Call, col: string) =>
  c.filters.find((f) => f[0] === 'eq' && f[1] === col)?.[2];

beforeEach(() => {
  role = 'admissions';
  calls.length = 0;
  audit.mockClear();
  handle = () => ({ data: null, error: null });
});

describe('book list writes — role gate', () => {
  it('refuses a role that cannot edit the student record, and touches nothing', async () => {
    role = 'teacher';
    const responses = [
      await createItem(
        req('POST', {
          kind: 'supply',
          ay: 'AY2027',
          title: 'Pencil',
          youngstartersOnly: false,
        })
      ),
      await PATCH(
        req('PATCH', {
          kind: 'supply',
          title: 'Pen',
          youngstartersOnly: false,
        }),
        itemParams
      ),
      await DELETE(req('DELETE'), itemParams),
      await copyYear(req('POST', { from: 'AY2027', to: 'AY2026' })),
    ] as Response[];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(calls).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/sis/supplies/items/[id]', () => {
  it('refuses with 409 when any student has been given the item', async () => {
    handle = (c) =>
      c.table === 'supply_items'
        ? { data: STORED }
        : c.table === 'supply_handovers'
          ? { count: 3 }
          : {};
    const res = (await DELETE(req('DELETE'), itemParams)) as Response;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.given).toBe(3);
    expect(body.error).toMatch(/3 students have been given this/);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('deletes and audits an item nobody has been given', async () => {
    handle = (c) =>
      c.table === 'supply_items' && c.op === 'select'
        ? { data: STORED }
        : c.table === 'supply_handovers'
          ? { count: 0 }
          : {};
    const res = (await DELETE(req('DELETE'), itemParams)) as Response;
    expect(res.status).toBe(200);
    const del = calls.find((c) => c.op === 'delete');
    expect(del?.table).toBe('supply_items');
    expect(eqValue(del!, 'id')).toBe(ITEM);
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: 'sis.supplies.item_delete',
      entityId: ITEM,
    });
  });
});

describe('POST /api/sis/supplies/items', () => {
  const book = {
    kind: 'book',
    ay: 'AY2027',
    levelId: LEVEL,
    subject: 'English',
    title: 'Grammar P5',
    publisher: '',
    isbn: null,
    classType: 'Global',
  };

  it('adds a book at the end of the list, blank fields stored as none', async () => {
    handle = (c) => {
      if (c.table === 'academic_years') return { data: { id: 'ay-27' } };
      if (c.table === 'levels')
        return {
          data: { id: LEVEL, label: 'Primary Five', level_type: 'primary' },
        };
      if (c.op === 'insert') return { data: { id: ITEM } };
      return { data: { sort_order: 41 } };
    };
    const res = (await createItem(req('POST', book))) as Response;
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.op === 'insert')?.payload).toEqual({
      academic_year_id: 'ay-27',
      kind: 'book',
      sort_order: 42,
      subject: 'English',
      title: 'Grammar P5',
      publisher: null,
      isbn: null,
      class_type: 'Global',
      level_id: LEVEL,
    });
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: 'sis.supplies.item_create',
    });
  });

  it('a Secondary book is always for both tracks', async () => {
    handle = (c) => {
      if (c.table === 'academic_years') return { data: { id: 'ay-27' } };
      if (c.table === 'levels')
        return {
          data: { id: LEVEL, label: 'Secondary One', level_type: 'secondary' },
        };
      if (c.op === 'insert') return { data: { id: ITEM } };
      return { data: null };
    };
    await createItem(req('POST', book));
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({
      class_type: null,
      sort_order: 1,
    });
  });

  it('refuses a duplicate with 409', async () => {
    handle = (c) => {
      if (c.table === 'academic_years') return { data: { id: 'ay-27' } };
      if (c.table === 'levels')
        return {
          data: { id: LEVEL, label: 'Primary Five', level_type: 'primary' },
        };
      if (c.op === 'insert')
        return { error: { code: '23505', message: 'duplicate key' } };
      return { data: null };
    };
    const res = (await createItem(req('POST', book))) as Response;
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already on the list/);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses a book with no title', async () => {
    const res = (await createItem(
      req('POST', { ...book, title: '   ' })
    )) as Response;
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('PATCH /api/sis/supplies/items/[id]', () => {
  it('refuses to turn a book into a supply', async () => {
    handle = (c) => (c.table === 'supply_items' ? { data: STORED } : {});
    const res = (await PATCH(
      req('PATCH', { kind: 'supply', title: 'Pen', youngstartersOnly: false }),
      itemParams
    )) as Response;
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('saves a book’s fields and audits before and after', async () => {
    handle = (c) => {
      if (c.table === 'levels')
        return {
          data: { id: LEVEL, label: 'Primary Five', level_type: 'primary' },
        };
      if (c.op === 'update') return { data: [{ id: ITEM }] };
      return { data: STORED };
    };
    const res = (await PATCH(
      req('PATCH', {
        kind: 'book',
        subject: 'English',
        title: 'Grammar P5 (2nd ed.)',
        publisher: 'Star',
        isbn: '978-1',
        classType: null,
      }),
      itemParams
    )) as Response;
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.op === 'update')?.payload).toMatchObject({
      title: 'Grammar P5 (2nd ed.)',
      publisher: 'Star',
      isbn: '978-1',
      class_type: null,
    });
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: 'sis.supplies.item_update',
      context: { before: { title: 'Grammar P5' } },
    });
  });
});

describe('POST /api/sis/supplies/copy-year', () => {
  const years = (c: Call) =>
    eqValue(c, 'ay_code') === 'AY2027' ? { id: 'ay-27' } : { id: 'ay-26' };

  it('refuses a target year that already has items, and copies nothing', async () => {
    handle = (c) =>
      c.table === 'academic_years'
        ? { data: years(c) }
        : c.head
          ? { count: 12 }
          : { data: [] };
    const res = (await copyYear(
      req('POST', { from: 'AY2027', to: 'AY2026' })
    )) as Response;
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it('copies every active item into an empty year, keeping its place', async () => {
    const source = [
      {
        kind: 'book',
        level_id: LEVEL,
        class_type: 'Global',
        subject: 'English',
        title: 'Grammar P5',
        publisher: null,
        isbn: null,
        sort_order: 4,
      },
      {
        kind: 'supply',
        level_id: null,
        class_type: null,
        subject: null,
        title: 'Pencil',
        publisher: null,
        isbn: null,
        sort_order: 900,
      },
    ];
    handle = (c) =>
      c.table === 'academic_years'
        ? { data: years(c) }
        : c.head
          ? { count: 0 }
          : c.op === 'insert'
            ? {}
            : { data: source };
    const res = (await copyYear(
      req('POST', { from: 'AY2027', to: 'AY2026' })
    )) as Response;
    expect(res.status).toBe(200);
    expect((await res.json()).copied).toBe(2);
    const read = calls.find(
      (c) => c.table === 'supply_items' && c.op === 'select' && !c.head
    );
    expect(eqValue(read!, 'academic_year_id')).toBe('ay-27');
    expect(eqValue(read!, 'is_active')).toBe(true);
    expect(calls.find((c) => c.op === 'insert')?.payload).toEqual(
      source.map((r) => ({ ...r, academic_year_id: 'ay-26' }))
    );
    expect(audit.mock.calls[0][0]).toMatchObject({
      action: 'sis.supplies.copy_year',
      entityId: 'ay-26',
      context: { from_ay: 'AY2027', to_ay: 'AY2026', copied: 2 },
    });
  });

  it('refuses copying a year onto itself', async () => {
    const res = (await copyYear(
      req('POST', { from: 'AY2027', to: 'ay2027' })
    )) as Response;
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });
});
