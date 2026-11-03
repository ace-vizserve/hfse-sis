import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// As in parent-portal-accounts.test.ts: the mock checks the caller's role
// against the list the ROUTE passed in, so a widened list fails the 403 tests.
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

vi.mock('@/lib/auth/require-page-roles', () => ({
  requirePageRoles: async () => ({ role: callerRole }),
}));

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

type AuditParams = {
  action: string;
  entityType: string;
  entityId: string;
  context: Record<string, unknown>;
};
const logAction = vi.fn((_params: AuditParams) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (params: AuditParams) => logAction(params),
}));

// ── A small stand-in for the service client ─────────────────────────────────
// Holds real rows and real files, so each test can assert where the student
// ended up rather than which calls were made.
type Row = Record<string, unknown>;
type Failure = { message: string };

let tables: Record<string, Row[]> = {};
let files: Set<string> = new Set();
let insertFailures: Record<string, Failure> = {};
let deleteFailures: Record<string, Failure> = {};
/** The delete happens, but its answer never arrives. */
let lostDeleteAnswer: Set<string> = new Set();
let readFailures: Record<string, Failure> = {};
/** A failure that fires once, then lets the same table work again. */
let insertFailOnce: Record<string, Failure> = {};
let silentDeleteTables: Set<string> = new Set();
let copyFailures: Record<string, Failure> = {};
let removeFailure: Failure | null = null;
let inserted: { table: string; row: Row }[] = [];
let copies: { from: string; to: string }[] = [];

function builder(table: string) {
  const filters: Row = {};
  let operation: 'select' | 'insert' | 'delete' = 'select';
  let pendingRow: Row | null = null;
  let descending = false;
  let limit: number | null = null;
  let nonNull: string | null = null;
  let range: [number, number] | null = null;

  const matching = () =>
    (tables[table] ?? []).filter(
      (row) =>
        Object.entries(filters).every(([key, value]) => row[key] === value) &&
        (nonNull === null || row[nonNull] != null)
    );

  const run = (): { data: Row[] | null; error: Failure | null } => {
    if (operation === 'insert') {
      inserted.push({ table, row: pendingRow as Row });
      const once = insertFailOnce[table];
      if (once) {
        delete insertFailOnce[table];
        return { data: null, error: once };
      }
      if (insertFailures[table]) {
        return { data: null, error: insertFailures[table] };
      }
      (tables[table] ??= []).push(pendingRow as Row);
      return { data: null, error: null };
    }
    if (operation === 'delete') {
      if (lostDeleteAnswer.has(table)) {
        const gone = matching();
        tables[table] = (tables[table] ?? []).filter((r) => !gone.includes(r));
        return { data: null, error: { message: 'connection lost' } };
      }
      if (deleteFailures[table]) {
        return { data: null, error: deleteFailures[table] };
      }
      if (silentDeleteTables.has(table)) return { data: [], error: null };
      const gone = matching();
      tables[table] = (tables[table] ?? []).filter((r) => !gone.includes(r));
      return { data: gone, error: null };
    }
    if (readFailures[table]) return { data: null, error: readFailures[table] };
    let rows = matching();
    if (descending) {
      rows = [...rows].sort((a, b) => Number(b.id) - Number(a.id));
    }
    if (limit !== null) rows = rows.slice(0, limit);
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };

  const chain = {
    select() {
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
    order(column: string, options?: { ascending?: boolean }) {
      if (column === 'id' && options?.ascending === false) descending = true;
      return chain;
    },
    limit(count: number) {
      limit = count;
      return chain;
    },
    range(from: number, to: number) {
      range = [from, to];
      return chain;
    },
    insert(row: Row) {
      operation = 'insert';
      pendingRow = row;
      return chain;
    },
    delete() {
      operation = 'delete';
      return chain;
    },
    maybeSingle() {
      const { data, error } = run();
      return Promise.resolve({ data: data?.[0] ?? null, error });
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return chain;
}

const service = {
  from: (table: string) => builder(table),
  storage: {
    from: (bucket: string) => {
      expect(bucket).toBe('parent-portal');
      return {
        copy: async (from: string, to: string) => {
          copies.push({ from, to });
          if (copyFailures[from]) {
            return { data: null, error: copyFailures[from] };
          }
          files.add(to);
          return { data: { path: to }, error: null };
        },
        remove: async (paths: string[]) => {
          if (removeFailure) return { data: null, error: removeFailure };
          for (const path of paths) files.delete(path);
          return { data: paths.map((name) => ({ name })), error: null };
        },
      };
    },
  },
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service,
}));

const route = await import('@/app/api/sis/admin/parent-portal/transfer/route');
const {
  APP_URL_FIELDS,
  DOC_URL_FIELDS,
  STRIP_FIELDS,
  listApplications,
  nextStudentNumber,
  transferOne,
} = await import('@/lib/parent-portal/transfer');

const asService = service as unknown as Parameters<typeof transferOne>[0];

// `requireRole`'s result type lets `auth.error` read as possibly undefined.
async function post(body: unknown) {
  const response = (await route.POST(
    new NextRequest('http://localhost/api/sis/admin/parent-portal/transfer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )) as Response;
  return { status: response.status, json: await response.json() };
}

async function get(query: string) {
  const response = (await route.GET(
    new NextRequest(
      `http://localhost/api/sis/admin/parent-portal/transfer${query}`
    )
  )) as Response;
  return { status: response.status, json: await response.json() };
}

const FROM_APP = 'ay2026_enrolment_applications';
const FROM_DOC = 'ay2026_enrolment_documents';
const FROM_STATUS = 'ay2026_enrolment_status';
const TO_APP = 'ay2027_enrolment_applications';
const TO_DOC = 'ay2027_enrolment_documents';
const TO_STATUS = 'ay2027_enrolment_status';

const url = (path: string) =>
  `https://x.supabase.co/storage/v1/object/public/parent-portal/${path}`;
const PASSPORT = 'ay2026/documents/1_E260012_passport.pdf';
const PHOTO = 'ay2026/photos/2_E260012_photo.jpg';

function application(extra: Row = {}): Row {
  return {
    id: 12,
    idx: 12,
    created_at: '2026-01-01T00:00:00Z',
    fts: "'tan':1",
    enroleeNumber: 'E260012',
    studentNumber: 'H260012',
    enroleeFullName: 'Tan Mei',
    firstName: 'Mei',
    lastName: 'Tan',
    middleName: null,
    levelApplied: 'Primary 1',
    category: 'New',
    enroleePhoto: url(PHOTO),
    ...extra,
  };
}

function documents(extra: Row = {}): Row {
  return {
    id: 7,
    created_at: '2026-01-01T00:00:00Z',
    enroleeNumber: 'E260012',
    studentNumber: 'H260012',
    passport: url(PASSPORT),
    passportStatus: 'Valid',
    ...extra,
  };
}

function statusRow(extra: Row = {}): Row {
  return {
    id: 9,
    created_at: '2026-01-01T00:00:00Z',
    enroleeNumber: 'E260012',
    enroleeName: 'Tan Mei',
    applicationStatus: 'Submitted',
    ...extra,
  };
}

function setStudent(
  rows: {
    application?: Row;
    documents?: Row | null;
    status?: Row | null;
  } = {}
) {
  tables[FROM_APP].push(rows.application ?? application());
  if (rows.documents !== null) {
    tables[FROM_DOC].push(rows.documents ?? documents());
  }
  if (rows.status !== null)
    tables[FROM_STATUS].push(rows.status ?? statusRow());
}

const INPUT = {
  sourceAy: 'AY2026',
  targetAy: 'AY2027',
  enroleeNumber: 'E260012',
};

function targetRowCount() {
  return (
    tables[TO_APP].filter((r) => r.enroleeNumber !== 'E270044').length +
    tables[TO_DOC].length +
    tables[TO_STATUS].length
  );
}

beforeEach(() => {
  callerRole = 'superadmin';
  logAction.mockClear();
  tables = {
    academic_years: [
      { ay_code: 'AY2028' },
      { ay_code: 'AY2027' },
      { ay_code: 'AY2026' },
    ],
    [FROM_APP]: [],
    [FROM_DOC]: [],
    [FROM_STATUS]: [],
    // Highest id in the to-year is 44, so the next number is 45.
    [TO_APP]: [{ id: 44, enroleeNumber: 'E270044' }],
    [TO_DOC]: [],
    [TO_STATUS]: [],
  };
  files = new Set([PASSPORT, PHOTO]);
  insertFailures = {};
  insertFailOnce = {};
  deleteFailures = {};
  lostDeleteAnswer = new Set();
  readFailures = {};
  silentDeleteTables = new Set();
  copyFailures = {};
  removeFailure = null;
  inserted = [];
  copies = [];
});

describe('the portal lists copied across', () => {
  it('skips the generated columns and remaps every link field', () => {
    expect([...STRIP_FIELDS].sort()).toEqual([
      'created_at',
      'fts',
      'id',
      'idx',
    ]);
    expect(APP_URL_FIELDS).toEqual(['enroleePhoto']);
    expect(DOC_URL_FIELDS).toContain('passport');
    expect(DOC_URL_FIELDS).toContain('guardianPass');
    expect(DOC_URL_FIELDS).toHaveLength(17);
  });
});

describe('nextStudentNumber', () => {
  it('keeps the number of a current student', () => {
    expect(nextStudentNumber('Current', 'H260012', '27', 45)).toBe('H260012');
    expect(nextStudentNumber('VizSchool Current', 'V260012', '27', 45)).toBe(
      'V260012'
    );
  });

  it('gives a new student a new number with the same first letter', () => {
    expect(nextStudentNumber('New', 'H260012', '27', 45)).toBe('H270045');
    expect(nextStudentNumber('VizSchool New', 'V260012', '27', 45)).toBe(
      'V270045'
    );
  });

  it('falls back to H when there is no number to keep', () => {
    expect(nextStudentNumber('Current', null, '27', 45)).toBe('H270045');
    expect(nextStudentNumber('New', null, '27', 45)).toBe('H270045');
    expect(nextStudentNumber('Current', '', '27', 45)).toBe('H270045');
  });
});

describe('POST /api/sis/admin/parent-portal/transfer', () => {
  const body = {
    sourceAy: 'AY2026',
    targetAy: 'AY2027',
    enroleeNumbers: ['E260012'],
  };

  it.each(['school_admin', 'academic_coordinator', 'registrar', 'teacher'])(
    'refuses %s with a 403 and moves nothing',
    async (role) => {
      callerRole = role;
      setStudent();
      const { status } = await post(body);
      expect(status).toBe(403);
      expect(inserted).toHaveLength(0);
      expect(tables[FROM_APP]).toHaveLength(1);
    }
  );

  it('refuses the same from-year and to-year', async () => {
    setStudent();
    const { status, json } = await post({ ...body, targetAy: 'AY2026' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/different/i);
    expect(inserted).toHaveLength(0);
  });

  it('refuses a year that does not exist', async () => {
    expect((await post({ ...body, targetAy: 'AY2099' })).status).toBe(400);
    expect((await post({ ...body, sourceAy: 'AY2099' })).status).toBe(400);
  });

  // The value becomes part of a table name, so only a real year code may pass.
  it('refuses a table slug or anything else that is not a year code', async () => {
    expect((await post({ ...body, targetAy: 'ay2027' })).status).toBe(400);
    expect((await post({ ...body, sourceAy: 'audit_log; drop' })).status).toBe(
      400
    );
  });

  it('refuses an empty list of students', async () => {
    const { status } = await post({ ...body, enroleeNumbers: [] });
    expect(status).toBe(400);
  });

  it('moves a student and writes one audit row with the keys the log reads', async () => {
    setStudent();
    const { status, json } = await post(body);

    expect(status).toBe(200);
    expect(json.moved).toBe(1);
    expect(json.failed).toBe(0);
    expect(logAction).toHaveBeenCalledTimes(1);

    const audit = logAction.mock.calls[0][0];
    expect(audit.action).toBe('parent_portal.application_transfer');
    expect(audit.entityType).toBe('parent_portal');
    expect(audit.entityId).toBe('E270045');
    expect(audit.context).toEqual({
      student_name: 'Tan, Mei',
      source_ay: 'AY2026',
      target_ay: 'AY2027',
      old_enrolee_number: 'E260012',
      new_enrolee_number: 'E270045',
      old_student_number: 'H260012',
      new_student_number: 'H270045',
    });
  });

  it('one bad student does not stop the others, and only successes are audited', async () => {
    setStudent();
    setStudent({
      application: application({
        id: 13,
        enroleeNumber: 'E260013',
        studentNumber: 'H260013',
        enroleePhoto: null,
      }),
      documents: null,
      status: null,
    });

    const { status, json } = await post({
      ...body,
      enroleeNumbers: ['E269999', 'E260012', 'E260013'],
    });

    expect(status).toBe(200);
    expect(json.moved).toBe(2);
    expect(json.failed).toBe(1);
    expect(json.results[0]).toMatchObject({
      enroleeNumber: 'E269999',
      ok: false,
    });
    expect(json.results[0].error).toMatch(/no application/i);
    // Numbered one after another, not both from the same highest id.
    expect(json.results[1].newEnroleeNumber).toBe('E270045');
    expect(json.results[2].newEnroleeNumber).toBe('E270046');
    expect(logAction).toHaveBeenCalledTimes(2);
  });

  it('writes no audit row for a move that failed', async () => {
    setStudent();
    insertFailures[TO_DOC] = { message: 'column "x" does not exist' };
    const { json } = await post(body);
    expect(json.failed).toBe(1);
    expect(logAction).not.toHaveBeenCalled();
  });

  it('reports a warning from the old files beside a success, and still audits', async () => {
    setStudent();
    removeFailure = { message: 'storage is down' };
    const { json } = await post(body);
    expect(json.results[0].ok).toBe(true);
    expect(json.results[0].warning).toContain(PASSPORT);
    expect(logAction).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/sis/admin/parent-portal/transfer', () => {
  it.each(['academic_coordinator', 'school_admin', 'superadmin'])(
    'lets %s read the list',
    async (role) => {
      callerRole = role;
      setStudent();
      const { status, json } = await get('?ay=AY2026');
      expect(status).toBe(200);
      expect(json.applications).toEqual([
        {
          enroleeNumber: 'E260012',
          studentNumber: 'H260012',
          name: 'Tan, Mei',
          level: 'Primary 1',
          category: 'New',
          applicationMissing: false,
          linkStatus: null,
        },
      ]);
    }
  );

  it.each(['teacher', 'registrar', 'p-file'])('refuses %s', async (role) => {
    callerRole = role;
    expect((await get('?ay=AY2026')).status).toBe(403);
  });

  it('refuses a missing or unknown year', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?ay=AY2099')).status).toBe(400);
    expect((await get('?ay=ay2026')).status).toBe(400);
  });
});

describe('listApplications', () => {
  it('leaves out rows with no enrolee number and uses the slug for the table', async () => {
    tables[FROM_APP].push(application(), application({ enroleeNumber: null }));
    const rows = await listApplications(asService, 'AY2026');
    expect(rows.map((r) => r.enroleeNumber)).toEqual(['E260012']);
  });

  it('never prints a missing name part', async () => {
    tables[FROM_APP].push(
      application({ firstName: 'Mei', lastName: null, middleName: null })
    );
    const rows = await listApplications(asService, 'AY2026');
    expect(rows[0].name).toBe('Mei');
  });

  it.each([FROM_APP, FROM_DOC, FROM_STATUS])(
    'throws when %s cannot be read, so the page does not say "empty" or hide a record',
    async (table) => {
      setStudent();
      readFailures[table] = { message: 'db down' };
      await expect(listApplications(asService, 'AY2026')).rejects.toThrow(
        /db down/
      );
    }
  );

  it('does not mark a student missing for having all three rows', async () => {
    setStudent();
    const rows = await listApplications(asService, 'AY2026');
    expect(rows).toHaveLength(1);
    expect(rows[0].applicationMissing).toBe(false);
  });

  it('lists a status-only record as missing, named and typed from the status row', async () => {
    tables[FROM_STATUS].push(
      statusRow({
        enroleeNumber: 'E260099',
        enroleeName: 'Lim Ana',
        enroleeType: 'Current',
        levelApplied: 'Primary 3',
      })
    );
    const rows = await listApplications(asService, 'AY2026');
    expect(rows).toEqual([
      {
        enroleeNumber: 'E260099',
        studentNumber: null,
        name: 'Lim Ana',
        level: 'Primary 3',
        category: 'Current',
        applicationMissing: true,
      },
    ]);
  });

  it('lists a documents-only record as missing, with its student number', async () => {
    tables[FROM_DOC].push(
      documents({ enroleeNumber: 'E260098', studentNumber: 'H260098' })
    );
    const rows = await listApplications(asService, 'AY2026');
    expect(rows).toEqual([
      {
        enroleeNumber: 'E260098',
        studentNumber: 'H260098',
        name: 'No name on the record',
        level: null,
        category: null,
        applicationMissing: true,
      },
    ]);
  });

  it('lists a record with documents and status but no application once', async () => {
    tables[FROM_DOC].push(
      documents({ enroleeNumber: 'E260097', studentNumber: 'H260097' })
    );
    tables[FROM_STATUS].push(
      statusRow({ enroleeNumber: 'E260097', enroleeName: 'Goh Ben' })
    );
    const rows = await listApplications(asService, 'AY2026');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      enroleeNumber: 'E260097',
      studentNumber: 'H260097',
      name: 'Goh Ben',
      applicationMissing: true,
    });
  });
});

describe('transferOne, when it works', () => {
  it('moves the three rows and the files, and empties the from-year', async () => {
    setStudent();
    const result = await transferOne(asService, INPUT);

    expect(result).toMatchObject({
      ok: true,
      newEnroleeNumber: 'E270045',
      newStudentNumber: 'H270045',
    });
    expect(result).not.toHaveProperty('warning');
    expect(tables[FROM_APP]).toHaveLength(0);
    expect(tables[FROM_DOC]).toHaveLength(0);
    expect(tables[FROM_STATUS]).toHaveLength(0);
    expect(tables[TO_DOC]).toHaveLength(1);
    expect(tables[TO_STATUS]).toHaveLength(1);
    expect(files.has(PASSPORT)).toBe(false);
    expect(files.has('ay2027/documents/1_E260012_passport.pdf')).toBe(true);
    expect(files.has('ay2027/photos/2_E260012_photo.jpg')).toBe(true);
  });

  it('does not put generated columns in any insert', async () => {
    setStudent();
    await transferOne(asService, INPUT);
    expect(inserted).toHaveLength(3);
    for (const { row } of inserted) {
      for (const column of ['id', 'idx', 'created_at', 'fts']) {
        expect(row).not.toHaveProperty(column);
      }
    }
  });

  it('remaps the links to the to-year folder, using the lowercase slug', async () => {
    setStudent();
    await transferOne(asService, INPUT);

    const app = tables[TO_APP].find((r) => r.enroleeNumber === 'E270045');
    expect(app?.enroleePhoto).toBe(url('ay2027/photos/2_E260012_photo.jpg'));
    expect(tables[TO_DOC][0].passport).toBe(
      url('ay2027/documents/1_E260012_passport.pdf')
    );
    expect(tables[TO_DOC][0].enroleeNumber).toBe('E270045');
    expect(tables[TO_STATUS][0].enroleeNumber).toBe('E270045');
    // Every copy lands on the path its link now points at.
    expect(copies).toEqual(
      expect.arrayContaining([
        { from: PASSPORT, to: 'ay2027/documents/1_E260012_passport.pdf' },
        { from: PHOTO, to: 'ay2027/photos/2_E260012_photo.jpg' },
      ])
    );
  });

  it('keeps the student number of a current student on the moved rows', async () => {
    setStudent({ application: application({ category: 'Current' }) });
    const result = await transferOne(asService, INPUT);

    expect(result).toMatchObject({
      ok: true,
      newEnroleeNumber: 'E270045',
      newStudentNumber: 'H260012',
    });
    expect(tables[TO_DOC][0].studentNumber).toBe('H260012');
  });

  it('writes a new student its new number on the documents row too', async () => {
    setStudent();
    await transferOne(asService, INPUT);
    expect(tables[TO_DOC][0].studentNumber).toBe('H270045');
  });

  it('moves up past a number already taken in any of the three tables', async () => {
    setStudent();
    tables[TO_APP].push({ id: 3, enroleeNumber: 'E270045' });
    tables[TO_DOC].push({ id: 3, enroleeNumber: 'E270046' });
    tables[TO_STATUS].push({ id: 3, enroleeNumber: 'E270047' });
    const result = await transferOne(asService, INPUT);
    expect(result).toMatchObject({
      ok: true,
      newEnroleeNumber: 'E270048',
      newStudentNumber: 'H270048',
    });
  });

  it('starts at 1 in an empty to-year', async () => {
    tables[TO_APP] = [];
    setStudent();
    const result = await transferOne(asService, INPUT);
    expect(result).toMatchObject({ ok: true, newEnroleeNumber: 'E270001' });
  });

  it('succeeds with no documents row, no status row and no files', async () => {
    setStudent({
      application: application({ enroleePhoto: null }),
      documents: null,
      status: null,
    });
    const result = await transferOne(asService, INPUT);

    expect(result).toMatchObject({ ok: true, newEnroleeNumber: 'E270045' });
    expect(tables[FROM_APP]).toHaveLength(0);
    expect(tables[TO_DOC]).toHaveLength(0);
    expect(tables[TO_STATUS]).toHaveLength(0);
    expect(copies).toHaveLength(0);
  });

  it('copies a file two fields share once', async () => {
    setStudent({
      documents: documents({ pass: url(PASSPORT) }),
    });
    await transferOne(asService, INPUT);
    expect(copies.filter((c) => c.from === PASSPORT)).toHaveLength(1);
  });

  // The portal stopped here: copying a file onto itself fails. The link is
  // still good, and the file may be another year's, so it is left alone.
  it('leaves a link to another year alone: not copied, not removed', async () => {
    const OTHER_YEAR = 'ay2025/documents/old_birth_cert.pdf';
    files.add(OTHER_YEAR);
    setStudent({ documents: documents({ birthCert: url(OTHER_YEAR) }) });

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(true);
    expect(tables[TO_DOC][0].birthCert).toBe(url(OTHER_YEAR));
    expect(copies.some((c) => c.from === OTHER_YEAR)).toBe(false);
    expect(files.has(OTHER_YEAR)).toBe(true);
  });

  it('reports the files it could not remove, without undoing the move', async () => {
    setStudent();
    removeFailure = { message: 'storage is down' };
    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warning).toContain(PASSPORT);
    expect(result.warning).toContain(PHOTO);
    expect(tables[FROM_APP]).toHaveLength(0);
    expect(tables[TO_DOC]).toHaveLength(1);
  });
});

describe('transferOne, when something fails before the deletes', () => {
  it('stops with a reason when there is no application', async () => {
    const result = await transferOne(asService, INPUT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no application/i);
    expect(inserted).toHaveLength(0);
  });

  // The portal read a failed documents read as "no documents row", then moved
  // the student without them and left the row behind.
  it('stops when the documents row cannot be read, rather than leaving it behind', async () => {
    setStudent();
    readFailures[FROM_DOC] = { message: 'read failed' };
    const result = await transferOne(asService, INPUT);
    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(tables[FROM_APP]).toHaveLength(1);
  });

  it('a failed application insert touches nothing else', async () => {
    setStudent();
    insertFailures[TO_APP] = { message: 'column "x" does not exist' };
    const before = tables[TO_APP].length;

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('column "x" does not exist');
    expect(tables[TO_APP]).toHaveLength(before);
    expect(tables[FROM_APP]).toHaveLength(1);
    expect(copies).toHaveLength(0);
  });

  it('a failed documents insert leaves no to-year rows and deletes nothing', async () => {
    setStudent();
    insertFailures[TO_DOC] = { message: 'column "x" does not exist' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('column "x" does not exist');
    expect(targetRowCount()).toBe(0);
    expect(tables[FROM_APP]).toHaveLength(1);
    expect(tables[FROM_DOC]).toHaveLength(1);
    expect(tables[FROM_STATUS]).toHaveLength(1);
    expect(copies).toHaveLength(0);
  });

  it('a failed status insert removes the two rows already inserted', async () => {
    setStudent();
    insertFailures[TO_STATUS] = { message: 'nope' };
    const result = await transferOne(asService, INPUT);
    expect(result.ok).toBe(false);
    expect(targetRowCount()).toBe(0);
    expect(tables[FROM_STATUS]).toHaveLength(1);
  });

  it('a failed copy removes the rows and only the copies this move made', async () => {
    setStudent();
    // Already at the destination, and not ours to delete.
    const PREEXISTING = 'ay2027/documents/1_E260012_passport.pdf';
    files.add(PREEXISTING);
    copyFailures[PASSPORT] = { message: 'The resource already exists' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('already exists');
    expect(targetRowCount()).toBe(0);
    expect(files.has(PREEXISTING)).toBe(true);
    expect(files.has('ay2027/photos/2_E260012_photo.jpg')).toBe(false);
    expect(files.has(PASSPORT)).toBe(true);
    expect(files.has(PHOTO)).toBe(true);
    expect(tables[FROM_APP]).toHaveLength(1);
  });
});

describe('transferOne, when a source delete fails', () => {
  it('a failed status delete: nothing was deleted, to-year rows and copies go', async () => {
    setStudent();
    deleteFailures[FROM_STATUS] = { message: 'delete refused' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('delete refused');
    expect(targetRowCount()).toBe(0);
    expect(tables[FROM_APP]).toHaveLength(1);
    expect(tables[FROM_DOC]).toHaveLength(1);
    expect(tables[FROM_STATUS]).toHaveLength(1);
    expect(files.has('ay2027/photos/2_E260012_photo.jpg')).toBe(false);
    expect(files.has(PASSPORT)).toBe(true);
  });

  it('a later failure restores the source rows already deleted, as they were', async () => {
    setStudent();
    deleteFailures[FROM_APP] = { message: 'delete refused' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    expect(tables[FROM_APP]).toHaveLength(1);
    expect(tables[FROM_DOC]).toHaveLength(1);
    expect(tables[FROM_STATUS]).toHaveLength(1);
    // Its own id and date back; only a generated column can't be written.
    expect(tables[FROM_DOC][0]).toEqual(documents());
    expect(tables[FROM_STATUS][0]).toEqual(statusRow());
    expect(targetRowCount()).toBe(0);
    expect(files.has('ay2027/photos/2_E260012_photo.jpg')).toBe(false);
    // Old files are only removed after every delete worked.
    expect(files.has(PASSPORT)).toBe(true);
    expect(files.has(PHOTO)).toBe(true);
  });

  it('a delete that landed but lost its answer: the row is put back, not lost', async () => {
    setStudent();
    lostDeleteAnswer.add(FROM_APP);

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    expect(tables[FROM_APP]).toHaveLength(1);
    expect(tables[FROM_DOC]).toHaveLength(1);
    expect(tables[FROM_STATUS]).toHaveLength(1);
    expect(targetRowCount()).toBe(0);
    expect(files.has(PASSPORT)).toBe(true);
  });

  it('a delete that removed no row did not work, even with no error', async () => {
    setStudent();
    silentDeleteTables.add(FROM_APP);

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    expect(tables[FROM_DOC]).toHaveLength(1);
    expect(tables[FROM_STATUS]).toHaveLength(1);
    expect(targetRowCount()).toBe(0);
  });

  it('asks for an audit row only when the undo could not finish', async () => {
    setStudent();
    deleteFailures[FROM_APP] = { message: 'delete refused' };

    const clean = await transferOne(asService, INPUT);

    expect(clean.ok).toBe(false);
    if (!clean.ok) expect(clean.needsChecking).toBe(false);
  });

  // The to-year copy is then the only copy left. Removing it would lose the
  // family's application for good.
  it('keeps the to-year copy when a source row cannot be restored, and says so', async () => {
    setStudent();
    deleteFailures[FROM_APP] = { message: 'delete refused' };
    insertFailOnce[FROM_DOC] = { message: 'restore refused' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('restore refused');
    expect(result.error).toContain('E270045');
    expect(tables[TO_DOC]).toHaveLength(1);
    expect(tables[TO_STATUS]).toHaveLength(1);
    expect(tables[TO_APP].some((r) => r.enroleeNumber === 'E270045')).toBe(
      true
    );
    expect(files.has('ay2027/documents/1_E260012_passport.pdf')).toBe(true);
  });

  it('says so when the undo itself cannot remove a to-year row', async () => {
    setStudent();
    insertFailures[TO_STATUS] = { message: 'insert refused' };
    deleteFailures[TO_DOC] = { message: 'cleanup refused' };

    const result = await transferOne(asService, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('insert refused');
    expect(result.error).toContain('cleanup refused');
    expect(result.error).toContain('E270045');
  });
});
