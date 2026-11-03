import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// The one Parent Portal page and the route behind its year picker. The point of
// most of these: a recovery link opens a family's form with no login, and these
// rows go to the browser of everyone who may open the page.

let callerRole: string = 'superadmin';
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: async (allowed: string[]) =>
    allowed.includes(callerRole)
      ? {
          user: { id: 'super-1', email: 'super@hfse.test' },
          role: callerRole,
        }
      : {
          error: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
        },
}));

let pageRoles: string[] = [];
vi.mock('@/lib/auth/require-page-roles', () => ({
  requirePageRoles: async (allowed: string[]) => {
    pageRoles = allowed;
    return { role: callerRole };
  },
}));

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: () => Promise.resolve(),
}));

vi.mock('@/lib/academic-year', () => ({
  listAyCodes: async () => ['AY2027', 'AY2026'],
  getCurrentAcademicYear: async () => ({ ay_code: 'AY2027' }),
}));

// ── A small stand-in for the service client ─────────────────────────────────
type Row = Record<string, unknown>;

let tables: Record<string, Row[]> = {};
let selects: Record<string, string> = {};
let readFailures: Record<string, { message: string }> = {};
let reads: string[] = [];
let authUsers: Row[] = [];
let authReads = 0;

function builder(table: string) {
  const filters: Row = {};
  let sortColumn: string | null = null;
  let sortDescending = false;
  let nonNull: string | null = null;
  let range: [number, number] | null = null;

  const run = () => {
    reads.push(table);
    if (readFailures[table]) return { data: null, error: readFailures[table] };
    let rows = (tables[table] ?? []).filter(
      (row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value) &&
        (nonNull === null || row[nonNull] != null)
    );
    if (sortColumn) {
      const column = sortColumn;
      rows = [...rows].sort((a, b) => {
        const order = String(a[column]).localeCompare(String(b[column]));
        return sortDescending ? -order : order;
      });
    }
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };

  const chain = {
    select(columns: string) {
      selects[table] = columns;
      return chain;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return chain;
    },
    not(column: string) {
      nonNull = column;
      return chain;
    },
    // The first order is the one that matters; the rest break ties.
    order(column: string, options?: { ascending?: boolean }) {
      if (!sortColumn) {
        sortColumn = column;
        sortDescending = options?.ascending === false;
      }
      return chain;
    },
    range(from: number, to: number) {
      range = [from, to];
      return chain;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return chain;
}

const service = {
  from: (table: string) => builder(table),
  auth: {
    admin: {
      listUsers: async () => {
        authReads += 1;
        return { data: { users: authUsers }, error: null };
      },
    },
  },
};
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service,
}));

const page = await import('@/app/(sis)/sis/admin/parent-portal/page');
const route = await import('@/app/api/sis/admin/parent-portal/transfer/route');
const { listApplicationRows } = await import('@/lib/parent-portal/recovery');
const { ApplicationsTab } =
  await import('@/components/sis/parent-portal/applications-tab');
const { AccountsTab } =
  await import('@/components/sis/parent-portal/accounts-tab');

const TOKEN = '11111111-2222-3333-4444-555555555555';
const OLD_TOKEN = '99999999-2222-3333-4444-555555555555';
const FUTURE = '2999-01-01T00:00:00Z';
const PAST = '2001-01-01T00:00:00Z';

function token(extra: Row): Row {
  return {
    token: TOKEN,
    academic_year: 'ay2027',
    enrolee_number: 'E270001',
    created_at: '2026-11-01T00:00:00Z',
    expires_at: FUTURE,
    used_at: null,
    ...extra,
  };
}

async function open(tab?: string | string[]) {
  return page.default({
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  });
}

async function get(query: string) {
  const response = (await route.GET(
    new NextRequest(
      `http://localhost/api/sis/admin/parent-portal/transfer${query}`
    )
  )) as Response;
  return { status: response.status, json: await response.json() };
}

async function rows(includeLink: boolean) {
  return listApplicationRows(service as never, 'AY2027', { includeLink });
}

function propsOf<T>(element: unknown, component: unknown): T | null {
  const node = element as { type?: unknown; props?: Row } | null;
  if (!node || typeof node !== 'object') return null;
  if (node.type === component) return node.props as T;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = propsOf<T>(child, component);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  callerRole = 'superadmin';
  pageRoles = [];
  selects = {};
  readFailures = {};
  reads = [];
  authReads = 0;
  authUsers = [
    {
      id: 'parent-1',
      email: 'mei@example.com',
      user_metadata: {
        fullName: 'Tan, Mei',
        relationship: 'mother',
        temporary_password: 'Secret-Temp-Pass1',
      },
      app_metadata: {},
    },
  ];
  tables = {
    ay2027_enrolment_applications: [
      {
        id: 1,
        enroleeNumber: 'E270001',
        studentNumber: 'H270001',
        firstName: 'Wei',
        lastName: 'Tan',
        levelApplied: 'Primary 1',
        category: 'New',
      },
    ],
    ay2027_enrolment_documents: [
      { id: 1, enroleeNumber: 'E270001', studentNumber: 'H270001' },
    ],
    ay2027_enrolment_status: [
      { id: 1, enroleeNumber: 'E270001', enroleeName: 'Tan, Wei' },
      {
        id: 2,
        enroleeNumber: 'E270002',
        enroleeName: 'Lim, Ana',
        enroleeType: 'Current',
        levelApplied: 'Primary 2',
      },
    ],
    enrolment_recovery_tokens: [],
  };
  vi.stubEnv('NEXT_PUBLIC_PARENT_PORTAL_URL', 'https://portal.test');
});

describe('the page', () => {
  it('lets the three SIS Admin roles open it', async () => {
    await open();
    expect(pageRoles).toEqual([
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ]);
  });

  it.each([
    ['no tab', undefined],
    ['applications', 'applications'],
    ['a tab that does not exist', 'nonsense'],
    ['a repeated tab', ['accounts', 'accounts']],
  ])('opens Applications for %s', async (_label, tab) => {
    const element = await open(tab);
    expect(propsOf(element, ApplicationsTab)).not.toBeNull();
    expect(propsOf(element, AccountsTab)).toBeNull();
    expect(authReads).toBe(0);
  });

  it('opens Parent accounts for ?tab=accounts, and reads no applications', async () => {
    const element = await open('accounts');
    expect(propsOf(element, AccountsTab)).not.toBeNull();
    expect(propsOf(element, ApplicationsTab)).toBeNull();
    expect(reads).not.toContain('ay2027_enrolment_applications');
    expect(reads).not.toContain('enrolment_recovery_tokens');
  });

  it('only a superadmin can act', async () => {
    const asSuperadmin = await open();
    expect(
      propsOf<{ canAct: boolean }>(asSuperadmin, ApplicationsTab)?.canAct
    ).toBe(true);

    callerRole = 'school_admin';
    const asViewer = await open();
    expect(
      propsOf<{ canAct: boolean }>(asViewer, ApplicationsTab)?.canAct
    ).toBe(false);
    const accounts = await open('accounts');
    expect(propsOf<{ canAct: boolean }>(accounts, AccountsTab)?.canAct).toBe(
      false
    );
  });

  it('never sends a temporary password to the browser', async () => {
    const payload = JSON.stringify(await open('accounts'));
    expect(payload).toContain('mei@example.com');
    expect(payload).not.toContain('Secret-Temp-Pass1');
  });

  it.each([
    'ay2027_enrolment_applications',
    'ay2027_enrolment_documents',
    'ay2027_enrolment_status',
    'enrolment_recovery_tokens',
  ])(
    'errors rather than showing a short table when %s fails',
    async (table) => {
      readFailures[table] = { message: 'db down' };
      await expect(open()).rejects.toThrow(/db down/);
    }
  );

  it('lists a status-only record as missing, in the page and the route', async () => {
    const element = await open();
    const props = propsOf<{
      initialApplications: {
        enroleeNumber: string;
        applicationMissing: boolean;
      }[];
    }>(element, ApplicationsTab);
    expect(
      props?.initialApplications.find((r) => r.enroleeNumber === 'E270002')
    ).toMatchObject({
      name: 'Lim, Ana',
      category: 'Current',
      level: 'Primary 2',
      applicationMissing: true,
    });

    const { json } = await get('?ay=AY2027');
    expect(json.applications).toEqual(props?.initialApplications);
  });
});

describe('what a viewer receives', () => {
  beforeEach(() => {
    tables.enrolment_recovery_tokens = [
      token({ enrolee_number: 'E270001' }),
      token({ token: OLD_TOKEN, enrolee_number: 'E270002' }),
    ];
  });

  it.each(['school_admin', 'academic_coordinator'])(
    "keeps the token and link out of a %s's page payload, and still shows the status",
    async (role) => {
      callerRole = role;
      const payload = JSON.stringify(await open());
      expect(payload).toContain('Pending');
      expect(payload).not.toContain(TOKEN);
      expect(payload).not.toContain(OLD_TOKEN);
      expect(payload).not.toContain('complete-enrolment');
      expect(payload).not.toContain('linkUrl');
      expect(selects.enrolment_recovery_tokens).not.toContain('token');
    }
  );

  it.each(['school_admin', 'academic_coordinator'])(
    "keeps the token and link out of a %s's answer from the route",
    async (role) => {
      callerRole = role;
      const { status, json } = await get('?ay=AY2027');
      const payload = JSON.stringify(json);
      expect(status).toBe(200);
      expect(payload).toContain('Pending');
      expect(payload).not.toContain(TOKEN);
      expect(payload).not.toContain('complete-enrolment');
      expect(selects.enrolment_recovery_tokens).not.toContain('token');
    }
  );

  it('gives a superadmin the link, in the page and the route', async () => {
    const link = `https://portal.test/complete-enrolment/${TOKEN}`;
    expect(JSON.stringify(await open())).toContain(link);
    expect(JSON.stringify((await get('?ay=AY2027')).json)).toContain(link);
  });

  it('refuses everyone else at the route', async () => {
    callerRole = 'teacher';
    expect((await get('?ay=AY2027')).status).toBe(403);
  });

  it('answers 500 at the route when a read fails', async () => {
    readFailures.ay2027_enrolment_status = { message: 'db down' };
    const { status, json } = await get('?ay=AY2027');
    expect(status).toBe(500);
    expect(json.error).toMatch(/db down/);
  });
});

describe('the link status on a row', () => {
  it('is null with no link', async () => {
    const [row] = await rows(true);
    expect(row.linkStatus).toBeNull();
    expect(row).not.toHaveProperty('linkUrl');
  });

  it('reads Pending, Completed and Expired', async () => {
    tables.enrolment_recovery_tokens = [token({})];
    expect((await rows(false))[0].linkStatus).toBe('Pending');

    tables.enrolment_recovery_tokens = [
      token({ used_at: '2026-11-02T00:00:00Z' }),
    ];
    expect((await rows(false))[0].linkStatus).toBe('Completed');

    tables.enrolment_recovery_tokens = [token({ expires_at: PAST })];
    expect((await rows(false))[0].linkStatus).toBe('Expired');
  });

  it('uses the latest link, whichever order they are stored in', async () => {
    tables.enrolment_recovery_tokens = [
      token({ token: OLD_TOKEN, expires_at: PAST }),
      token({ created_at: '2026-11-03T00:00:00Z' }),
      token({
        token: OLD_TOKEN,
        created_at: '2026-10-01T00:00:00Z',
        used_at: '2026-10-02T00:00:00Z',
      }),
    ];
    const [row] = await rows(true);
    expect(row.linkStatus).toBe('Pending');
    expect(row.linkUrl).toBe(`https://portal.test/complete-enrolment/${TOKEN}`);
  });

  it('offers a superadmin only a link that still works', async () => {
    tables.enrolment_recovery_tokens = [token({ expires_at: PAST })];
    expect(await rows(true)).not.toContainEqual(
      expect.objectContaining({ linkUrl: expect.anything() })
    );

    tables.enrolment_recovery_tokens = [
      token({ used_at: '2026-11-02T00:00:00Z' }),
    ];
    expect(await rows(true)).not.toContainEqual(
      expect.objectContaining({ linkUrl: expect.anything() })
    );
  });

  it('shows on a record with no application too', async () => {
    tables.enrolment_recovery_tokens = [token({ enrolee_number: 'E270002' })];
    const row = (await rows(true)).find((r) => r.enroleeNumber === 'E270002');
    expect(row?.applicationMissing).toBe(true);
    expect(row?.linkStatus).toBe('Pending');
  });

  it("does not take another year's link", async () => {
    tables.enrolment_recovery_tokens = [token({ academic_year: 'ay2026' })];
    expect((await rows(true))[0].linkStatus).toBeNull();
  });

  it('reaches past the first thousand links', async () => {
    tables.enrolment_recovery_tokens = Array.from({ length: 1200 }, (_, i) =>
      token({
        token: `t${i}`,
        enrolee_number: `E27${String(1000 + i)}`,
        // E270001's link is the oldest, so it lands on the second page.
        created_at: new Date(
          Date.UTC(2026, 0, 1) + (1200 - i) * 60000
        ).toISOString(),
      })
    ).concat(token({ created_at: '2025-01-01T00:00:00Z' }));
    const row = (await rows(false)).find((r) => r.enroleeNumber === 'E270001');
    expect(row?.linkStatus).toBe('Pending');
  });
});
