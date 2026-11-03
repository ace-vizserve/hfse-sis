import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const sendEmail = vi.fn((_message: Record<string, unknown>) =>
  Promise.resolve<{ error: { message: string } | null }>({ error: null })
);
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendEmail };
  },
}));

// ── A small stand-in for the service client ─────────────────────────────────
type Row = Record<string, unknown>;

const TOKEN = '11111111-2222-3333-4444-555555555555';

let tables: Record<string, Row[]> = {};
let inserted: { table: string; row: Row }[] = [];
let updated: { table: string; values: Row; filters: Row }[] = [];
let insertError: { message: string } | null = null;

function builder(table: string) {
  const filters: Row = {};
  let pendingInsert: Row | null = null;
  let pendingUpdate: Row | null = null;

  const matching = () =>
    (tables[table] ?? []).filter((row) =>
      Object.entries(filters).every(([key, value]) => row[key] === value)
    );

  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return chain;
    },
    order() {
      return chain;
    },
    insert(row: Row) {
      pendingInsert = row;
      inserted.push({ table, row });
      return chain;
    },
    update(values: Row) {
      pendingUpdate = values;
      return chain;
    },
    maybeSingle() {
      const rows = matching();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    single() {
      if (insertError) {
        return Promise.resolve({ data: null, error: insertError });
      }
      return Promise.resolve({
        data: { ...pendingInsert, token: TOKEN },
        error: null,
      });
    },
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      if (pendingUpdate) {
        updated.push({ table, values: pendingUpdate, filters });
        return Promise.resolve({ data: [], error: null }).then(resolve);
      }
      return Promise.resolve({ data: matching(), error: null }).then(resolve);
    },
  };
  return chain;
}

const service = { from: (table: string) => builder(table) };
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => service,
}));

const route =
  await import('@/app/api/sis/admin/parent-portal/recovery-link/route');
const {
  REQUIRED_APPLICATION_FIELDS_BY_SECTION,
  incompleteApplicationSections,
} = await import('@/lib/parent-portal/recovery');

// `requireRole`'s result type lets `auth.error` read as possibly undefined.
async function post(body: unknown) {
  const response = (await route.POST(
    new NextRequest(
      'http://localhost/api/sis/admin/parent-portal/recovery-link',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  )) as Response;
  return { status: response.status, json: await response.json() };
}

const ENROLEE = 'E270003';

function completeApplication(extra: Row = {}): Row {
  const row: Row = {
    enroleeNumber: ENROLEE,
    studentNumber: 'H270003',
    enroleeFullName: 'Tan, Wei',
    category: 'New',
    paracetamolConsent: true,
  };
  for (const fields of Object.values(REQUIRED_APPLICATION_FIELDS_BY_SECTION)) {
    for (const field of fields) row[field] = 'filled';
  }
  return { ...row, ...extra };
}

const DOCUMENTS: Row = { enroleeNumber: ENROLEE, studentNumber: 'H270003' };
const STATUS: Row = {
  enroleeNumber: ENROLEE,
  enroleeName: 'Tan, Wei (status)',
  enroleeType: 'Current',
};

function setRecord(rows: { application?: Row; documents?: Row; status?: Row }) {
  tables.ay2027_enrolment_applications = rows.application
    ? [rows.application]
    : [];
  tables.ay2027_enrolment_documents = rows.documents ? [rows.documents] : [];
  tables.ay2027_enrolment_status = rows.status ? [rows.status] : [];
}

function tokenInserts() {
  return inserted.filter((i) => i.table === 'enrolment_recovery_tokens');
}

beforeEach(() => {
  callerRole = 'superadmin';
  tables = {
    academic_years: [
      { ay_code: 'AY2027' },
      { ay_code: 'AY2026' },
      { ay_code: 'AY2025' },
    ],
    ay2026_enrolment_applications: [],
    ay2025_enrolment_applications: [],
  };
  setRecord({});
  inserted = [];
  updated = [];
  insertError = null;
  logAction.mockClear();
  sendEmail.mockClear();
  sendEmail.mockImplementation(() => Promise.resolve({ error: null }));
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('NEXT_PUBLIC_PARENT_PORTAL_URL', 'https://portal.test');
});

describe('who may act', () => {
  it.each(['school_admin', 'academic_coordinator', 'teacher'])(
    'gives %s a 403 on both actions, and touches nothing',
    async (role) => {
      callerRole = role;
      setRecord({ documents: DOCUMENTS, status: STATUS });

      const check = await post({ action: 'check', enroleeNumber: ENROLEE });
      const generate = await post({
        action: 'generate',
        enroleeNumber: ENROLEE,
        recipientEmails: 'mei@example.com',
      });

      expect(check.status).toBe(403);
      expect(generate.status).toBe(403);
      expect(tokenInserts()).toHaveLength(0);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(logAction).not.toHaveBeenCalled();
    }
  );
});

describe('check', () => {
  it('says complete when all three rows exist and are complete', async () => {
    setRecord({
      application: completeApplication(),
      documents: DOCUMENTS,
      status: STATUS,
    });

    const { status, json } = await post({
      action: 'check',
      enroleeNumber: ENROLEE,
    });

    expect(status).toBe(200);
    expect(json).toEqual({
      complete: true,
      academicYear: 'ay2027',
      enroleeNumber: ENROLEE,
    });
  });

  it('lists what is missing, and asks for everything with no application', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status, json } = await post({
      action: 'check',
      enroleeNumber: ` ${ENROLEE.toLowerCase()} `,
    });

    expect(status).toBe(200);
    expect(json).toMatchObject({
      academicYear: 'ay2027',
      enroleeNumber: ENROLEE,
      category: 'Current',
      studentName: 'Tan, Wei (status)',
      studentNumber: 'H270003',
      present: { applications: false, documents: true, status: true },
      applicationsIncomplete: false,
      missing: ['applications'],
      suggestedSections: [
        'studentInfo',
        'familyInfo',
        'enrollmentInfo',
        'uploads',
      ],
    });
  });

  it('suggests only the unfinished sections of an application that exists', async () => {
    setRecord({
      application: completeApplication({ motherEmail: '' }),
      status: STATUS,
    });

    const { json } = await post({ action: 'check', enroleeNumber: ENROLEE });

    expect(json.applicationsIncomplete).toBe(true);
    expect(json.missing).toEqual(['applications', 'documents']);
    expect(json.suggestedSections).toEqual(['familyInfo', 'uploads']);
  });

  it('prefills the emails from the application', async () => {
    setRecord({
      application: completeApplication({
        motherEmail: 'mei@example.com',
        fatherEmail: 'jun@example.com',
      }),
    });

    const { json } = await post({ action: 'check', enroleeNumber: ENROLEE });

    expect(json.knownEmails).toBe('jun@example.com, mei@example.com');
  });

  it('falls back to another year by student number for the emails', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });
    tables.ay2026_enrolment_applications = [
      { studentNumber: 'H270003', motherEmail: 'older@example.com' },
    ];

    const { json } = await post({ action: 'check', enroleeNumber: ENROLEE });

    expect(json.knownEmails).toBe('older@example.com');
  });

  it('refuses a number whose year is not on file', async () => {
    const { status, json } = await post({
      action: 'check',
      enroleeNumber: 'E990001',
    });

    expect(status).toBe(400);
    expect(json.error).toContain('E990001');
  });

  it('refuses a record it cannot put a category on', async () => {
    const { status } = await post({ action: 'check', enroleeNumber: ENROLEE });
    expect(status).toBe(422);
  });

  it('gives a 400 with no enrolee number', async () => {
    const { status } = await post({ action: 'check', enroleeNumber: '  ' });
    expect(status).toBe(400);
  });
});

describe('generate', () => {
  it('gives a 409 when nothing is missing, and makes no link', async () => {
    setRecord({
      application: completeApplication(),
      documents: DOCUMENTS,
      status: STATUS,
    });

    const { status } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(status).toBe(409);
    expect(tokenInserts()).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('forces all sections when there is no application row', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      sections: ['familyInfo'],
    });

    const all = ['studentInfo', 'familyInfo', 'enrollmentInfo', 'uploads'];
    expect(json.sections).toEqual(all);
    expect(tokenInserts()[0].row.sections).toEqual(all);
  });

  it('keeps the chosen sections when the application exists', async () => {
    setRecord({
      application: completeApplication({ motherEmail: '' }),
      status: STATUS,
    });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      sections: ['uploads'],
    });

    expect(json.sections).toEqual(['uploads']);
  });

  it('writes the token the portal expects, with the year in its lower-case form', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });
    const before = Date.now();

    await post({ action: 'generate', enroleeNumber: ENROLEE });

    const after = Date.now();
    const { row } = tokenInserts()[0];
    expect(row).toMatchObject({
      // The portal builds table names from this, so `AY2027` would break it.
      academic_year: 'ay2027',
      enrolee_number: ENROLEE,
      student_number: 'H270003',
      student_name: 'Tan, Wei (status)',
      category: 'Current',
      missing_tables: ['applications'],
      created_by: 'super@hfse.test',
    });
    const week = 7 * 24 * 60 * 60 * 1000;
    const expires = new Date(row.expires_at as string).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + week);
    expect(expires).toBeLessThanOrEqual(after + week);
  });

  it('builds the link from the configured portal address', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
    });

    expect(json.token).toBe(TOKEN);
    expect(json.url).toBe(`https://portal.test/complete-enrolment/${TOKEN}`);
  });

  it('falls back to the live portal address', async () => {
    vi.stubEnv('NEXT_PUBLIC_PARENT_PORTAL_URL', undefined);
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
    });

    expect(json.url).toBe(
      `https://enrol.hfse.edu.sg/complete-enrolment/${TOKEN}`
    );
  });

  it('builds the link from the portal address alone, ignoring any path', async () => {
    const before = process.env.NEXT_PUBLIC_PARENT_PORTAL_URL;
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL =
      'https://enrol.hfse.edu.sg/admission/dashboard';
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
    });

    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL = before;
    expect(json.url).toBe(
      `https://enrol.hfse.edu.sg/complete-enrolment/${TOKEN}`
    );
  });

  it('emails the link, and records who it went to', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com, jun@example.com',
    });

    expect(json.emailSent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = sendEmail.mock.calls[0][0];
    expect(message.subject).toBe(
      'Action Required: Complete Your Enrollment Information'
    );
    expect(message.html).toContain(
      `https://portal.test/complete-enrolment/${TOKEN}`
    );
    expect(updated[0]).toMatchObject({
      table: 'enrolment_recovery_tokens',
      values: { notified_email: 'mei@example.com, jun@example.com' },
      filters: { token: TOKEN },
    });
  });

  it('sends to the test inbox outside production, not to the family', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(JSON.stringify(sendEmail.mock.calls[0][0].to)).not.toContain(
      'mei@example.com'
    );
  });

  it('still returns the link when the email fails', async () => {
    sendEmail.mockImplementation(() =>
      Promise.resolve({ error: { message: 'mailbox on fire' } })
    );
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status, json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(status).toBe(200);
    expect(json.emailSent).toBe(false);
    expect(json.emailError).toContain('mailbox on fire');
    expect(json.url).toContain(TOKEN);
    expect(updated).toHaveLength(0);
  });

  it('still returns the link when sending throws', async () => {
    sendEmail.mockImplementation(() => Promise.reject(new Error('no network')));
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status, json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(status).toBe(200);
    expect(json.emailSent).toBe(false);
    expect(json.url).toContain(TOKEN);
  });

  it('still returns the link when email is not set up', async () => {
    vi.stubEnv('RESEND_API_KEY', undefined);
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status, json } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(status).toBe(200);
    expect(json.emailSent).toBe(false);
    expect(json.url).toContain(TOKEN);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('writes the audit row the summary reads, with no token or link in it', async () => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(logAction).toHaveBeenCalledTimes(1);
    const params = logAction.mock.calls[0][0];
    expect(params).toMatchObject({
      action: 'parent_portal.recovery_link_create',
      entityType: 'parent_portal',
      entityId: ENROLEE,
      context: {
        student_name: 'Tan, Wei (status)',
        enrolee_number: ENROLEE,
        sent_to: ['mei@example.com'],
      },
    });
    expect(JSON.stringify(params)).not.toContain(TOKEN);
    expect(JSON.stringify(params)).not.toContain('complete-enrolment');
  });

  it('does not claim it was sent when the email failed', async () => {
    sendEmail.mockImplementation(() =>
      Promise.resolve({ error: { message: 'nope' } })
    );
    setRecord({ documents: DOCUMENTS, status: STATUS });

    await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(logAction.mock.calls[0][0].context.sent_to).toEqual([]);
  });

  it('gives a 500 and logs nothing when the token cannot be saved', async () => {
    insertError = { message: 'insert failed' };
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      recipientEmails: 'mei@example.com',
    });

    expect(status).toBe(500);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it.each([
    ['a bad email', { recipientEmails: 'mei@example.com, not-an-email' }],
    ['an unknown section', { sections: ['bankDetails'] }],
    ['no sections at all', { sections: [] }],
  ])('gives a 400 for %s', async (_name, extra) => {
    setRecord({ documents: DOCUMENTS, status: STATUS });

    const { status } = await post({
      action: 'generate',
      enroleeNumber: ENROLEE,
      ...extra,
    });

    expect(status).toBe(400);
    expect(tokenInserts()).toHaveLength(0);
  });
});

describe('the completeness rule the portal also holds', () => {
  it('treats an unanswered paracetamol consent as unfinished student info', () => {
    expect(
      incompleteApplicationSections(
        completeApplication({ paracetamolConsent: null })
      )
    ).toEqual(['studentInfo']);
  });

  it('keeps false as an answer', () => {
    expect(
      incompleteApplicationSections(
        completeApplication({ paracetamolConsent: false })
      )
    ).toEqual([]);
  });

  // The portal consumes the token, so both copies must agree. Skipped where the
  // portal repo is not checked out beside this one (CI).
  const PORTAL_SOURCE = join(
    process.cwd(),
    '..',
    'app-online-admission',
    'supabase',
    'functions',
    '_shared',
    'enrolment-payload.ts'
  );

  it.skipIf(!existsSync(PORTAL_SOURCE))(
    "matches the portal's list of required fields",
    () => {
      const source = readFileSync(PORTAL_SOURCE, 'utf8');
      const block = source.match(
        /REQUIRED_APPLICATION_FIELDS_BY_SECTION[^=]*=\s*\{([\s\S]*?)\n\};/
      );
      expect(block).not.toBeNull();

      const portal = Object.fromEntries(
        [...block![1].matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)].map(
          ([, section, fields]) => [
            section,
            [...fields.matchAll(/"(\w+)"/g)].map(([, field]) => field),
          ]
        )
      );

      expect(REQUIRED_APPLICATION_FIELDS_BY_SECTION).toEqual(portal);
    }
  );
});
