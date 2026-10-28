/**
 * /api/sis/students/[enroleeNumber]/supplies — the role gate, and that a tick
 * may only name items on the student's own list.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudentSupplies } from '@/lib/sis/supplies/types';

let role: string = 'admissions';
let capabilities: string[] = [];
let sectionId: string | null = 'section-1';
let list: StudentSupplies = { needsClass: true };
const writes: Array<{
  op: string;
  table: string;
  payload?: unknown;
  filters: unknown[];
}> = [];
const audit = vi.fn<(...a: unknown[]) => Promise<void>>(() =>
  Promise.resolve()
);

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
vi.mock('@/lib/auth/permission-map', () => ({
  roleCan: vi.fn((_r: string, cap: string) =>
    Promise.resolve(capabilities.includes(cap))
  ),
}));
vi.mock('@/lib/auth/staff-list', () => ({
  getStaffDisplayNameById: vi.fn(() => Promise.resolve([['u1', 'Ms Wynne']])),
}));
vi.mock('@/lib/audit/log-action', () => ({
  logActions: (...a: unknown[]) => audit(...a),
}));
vi.mock('@/lib/sis/queries', () => ({
  getCurrentSection: vi.fn(() =>
    Promise.resolve(
      sectionId ? { id: sectionId, name: 'P3 Courtesy', level: {} } : null
    )
  ),
}));
vi.mock('@/lib/sis/supplies/student-list', async (importActual) => {
  const actual =
    await importActual<typeof import('@/lib/sis/supplies/student-list')>();
  return {
    ...actual,
    loadStudentSupplies: vi.fn(
      (_s: unknown, args: { sectionId: string | null }) =>
        Promise.resolve(args.sectionId ? list : { needsClass: true })
    ),
  };
});
vi.mock('@/lib/supabase/admissions', () => ({
  createAdmissionsClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = () =>
        Promise.resolve({ data: { studentNumber: 'H123' }, error: null });
      return q;
    },
  }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const rec = {
        op: '',
        table,
        payload: undefined as unknown,
        filters: [] as unknown[],
      };
      const q: Record<string, unknown> = {};
      // `.select('item_id')` returns the rows the write changed — every
      // upserted row, and the ids the delete's `.in()` named.
      let changedIds: string[] = [];
      q.upsert = (payload: unknown) => {
        rec.op = 'upsert';
        rec.payload = payload;
        writes.push(rec);
        changedIds = (payload as { item_id: string }[]).map((r) => r.item_id);
        return q;
      };
      q.delete = () => {
        rec.op = 'delete';
        writes.push(rec);
        return q;
      };
      q.eq = (...f: unknown[]) => {
        rec.filters.push(['eq', ...f]);
        return q;
      };
      q.in = (...f: unknown[]) => {
        rec.filters.push(['in', ...f]);
        changedIds = f[1] as string[];
        return q;
      };
      q.select = () =>
        Promise.resolve({
          data: changedIds.map((item_id) => ({ item_id })),
          error: null,
        });
      return q;
    },
  }),
}));

import {
  GET,
  POST,
} from '@/app/api/sis/students/[enroleeNumber]/supplies/route';

const ITEM_A = '11111111-1111-4111-8111-111111111111';
const ITEM_B = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';

const params = { params: Promise.resolve({ enroleeNumber: 'E001' }) };
// The handlers' inferred type carries `| undefined` from requireRole's union;
// every path returns a response.
const post = async (body: unknown) =>
  (await POST(
    new Request('http://x/api/sis/students/E001/supplies', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params
  )) as Response;
const get = async () =>
  (await GET(
    new Request('http://x/api/sis/students/E001/supplies?ay=AY2027'),
    params
  )) as Response;

beforeEach(() => {
  role = 'admissions';
  capabilities = [];
  sectionId = 'section-1';
  writes.length = 0;
  audit.mockClear();
  list = {
    groups: [
      {
        name: 'English',
        kind: 'book',
        items: [
          { id: ITEM_A, title: 'Grammar P3', meta: null, given: null },
          {
            id: ITEM_B,
            title: 'Reader P3',
            meta: null,
            given: { at: '2027-01-12T01:00:00Z', byName: 'Ms Wynne' },
          },
        ],
      },
    ],
  };
});

describe('supplies route — role gate', () => {
  it('POST refuses a role that cannot edit the student record', async () => {
    role = 'teacher';
    const res = await post({ ay: 'AY2027', itemIds: [ITEM_A], given: true });
    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it('GET refuses a role with neither the writer role nor the read capability', async () => {
    role = 'teacher';
    expect((await get()).status).toBe(403);
  });

  it('GET lets a read-capability holder see the list', async () => {
    role = 'teacher';
    capabilities = ['documents_pre_enrolment.read'];
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(list);
  });

  it('GET with no class answers needsClass', async () => {
    sectionId = null;
    expect(await (await get()).json()).toEqual({ needsClass: true });
  });
});

describe('supplies route — POST', () => {
  it('rejects an item that is not on the student list, and writes nothing', async () => {
    const res = await post({
      ay: 'AY2027',
      itemIds: [ITEM_A, FOREIGN],
      given: true,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).itemIds).toEqual([FOREIGN]);
    expect(writes).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it('ticks only the items not given yet, and audits each', async () => {
    const res = await post({
      ay: 'AY2027',
      itemIds: [ITEM_A, ITEM_B],
      given: true,
    });
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe('upsert');
    expect(writes[0].payload).toEqual([
      {
        item_id: ITEM_A,
        student_number: 'H123',
        given_by: 'u1',
        given_by_name: 'Ms Wynne',
      },
    ]);
    const rows = audit.mock.calls[0][2] as Array<{
      action: string;
      entityId: string;
    }>;
    expect(rows.map((r) => [r.action, r.entityId])).toEqual([
      ['sis.supplies.given', ITEM_A],
    ]);
  });

  it('unticks by deleting the handover row', async () => {
    const res = await post({ ay: 'AY2027', itemIds: [ITEM_B], given: false });
    expect(res.status).toBe(200);
    expect(writes[0]).toMatchObject({
      op: 'delete',
      table: 'supply_handovers',
    });
    expect(writes[0].filters).toEqual([
      ['eq', 'student_number', 'H123'],
      ['in', 'item_id', [ITEM_B]],
    ]);
    const rows = audit.mock.calls[0][2] as Array<{ action: string }>;
    expect(rows.map((r) => r.action)).toEqual(['sis.supplies.ungiven']);
  });

  it('refuses a student with no class', async () => {
    sectionId = null;
    const res = await post({ ay: 'AY2027', itemIds: [ITEM_A], given: true });
    expect(res.status).toBe(422);
    expect(writes).toEqual([]);
  });
});
