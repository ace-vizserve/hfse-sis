/**
 * POST /api/declarations/staff — a member of staff attaching a medical
 * certificate the parent could not file.
 *
 * Mr Ace asked for this twice in the same words: staff must be able to attach
 * one themselves "if the parent wasn't able to". A paper MC handed in at the
 * office is the commonest case in the school today, and until now it ended in
 * a drawer with nothing on the day.
 *
 * FIVE THINGS ARE PINNED HERE, and each one is a way this route could quietly
 * be wrong rather than visibly broken:
 *
 *   1. AUTHORISATION IS THE REGISTER'S. A teacher who does not mark that
 *      class's register cannot record a certificate against it. Refusing this
 *      is the whole difference between "the office logged an absence" and
 *      "anybody with a login can write medical evidence onto any child".
 *
 *   2. THE ATTACHMENT MUST BE THE CALLER'S OWN UPLOAD. `evidencePath` is just
 *      a string in the request body, and a path outside the caller's folder is
 *      an attempt to attach somebody else's certificate to a child they can
 *      reach — where every staff screen would then render it.
 *
 *   3. PROOF CAN BE A LINK, NOT ONLY A FILE. Singapore issues digital MCs as a
 *      URL; a route that demanded an upload would turn away the commonest
 *      modern certificate.
 *
 *   4. THE ROW LANDS `approved` WITH `register_written_at` NULL. Already
 *      approved because the school recording its own evidence has nobody left
 *      to vet it; register untouched because the person doing this is already
 *      marking the day EX through the normal attendance path, and writing the
 *      days again would append a second mark to each one.
 *
 *   5. THE AUDIT ROW IS WRITTEN. ⚠ THIS IS THE ONE THAT MATTERS MOST AND IS
 *      THE EASIEST TO DROP. With no `approval_request` behind it the filing
 *      appears in no declarations queue and produces no Activity-panel event —
 *      `lib/activity/feed.ts` derives its events from `approval_request_stages`
 *      and there are none. `audit_log` is therefore the ONLY trace the action
 *      leaves anywhere in the system. Presence only: never the document, never
 *      the link.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real uuids — the schema refuses anything else, and a 400 would make every
// assertion below vacuous.
const ENROLMENT = '11111111-1111-4111-8111-111111111111';
const SEC_MINE = '44444444-4444-4444-8444-444444444444';
const SEC_THEIRS = '55555555-5555-4555-8555-555555555555';
const STUDENT = '66666666-6666-4666-8666-666666666666';
const AY = '77777777-7777-4777-8777-777777777777';
const ME = 'u-teacher';

// ── Mocks ──────────────────────────────────────────────────────────────────

let caller: { id: string; email: string | null; role: string } = {
  id: ME,
  email: 'teacher@hfse.test',
  role: 'teacher',
};

vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: caller.id, email: caller.email },
      role: caller.role,
    })
  ),
}));

// The viewer advises SEC_MINE and nothing else.
let assignments: Array<{ section_id: string; role: string }> = [
  { section_id: SEC_MINE, role: 'form_adviser' },
];
vi.mock('@/lib/auth/teacher-assignments', () => ({
  loadEffectiveAssignmentsForUser: vi.fn(() => Promise.resolve(assignments)),
}));

// The calendar is not what this file is about — `filingCoversAnySchoolDay` has
// its own suite. Every date here is a school day unless a test says otherwise.
let schoolDays: string[] = ['2026-09-02'];
vi.mock('@/lib/attendance/school-days', () => ({
  expandSchoolDays: vi.fn(() => Promise.resolve(schoolDays)),
}));

// Fixed "today" so the backdate and lookahead guards cannot start failing on a
// future test run. Everything else in lib/dates stays real.
vi.mock('@/lib/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dates')>()),
  sgToday: () => '2026-08-31',
}));

/** The shape this route hands `logAction`. Typed so the assertions below are. */
type AuditCall = {
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string | null; email: string | null };
  context: Record<string, unknown>;
};

const logAction = vi.fn((_args: AuditCall) => Promise.resolve());
vi.mock('@/lib/audit/log-action', () => ({
  logAction: (args: AuditCall) => logAction(args),
  logActions: vi.fn(() => Promise.resolve()),
}));

/**
 * The audit row this request wrote.
 *
 * ⚠ It THROWS when there is none rather than returning undefined. A test that
 * silently read `undefined` here and then asserted nothing about it would pass
 * while the only trace this filing leaves went missing — which is precisely
 * the failure these tests exist to catch.
 */
function auditRow(index = 0): AuditCall {
  const call = logAction.mock.calls[index];
  if (!call) throw new Error('no audit row was written');
  return call[0];
}

// ── Service stub ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

let enrolmentRow: Row | null;
let sectionRow: Row | null;
let studentRow: Row | null;
let overlapRows: Row[];
let insertError: { code?: string; message: string } | null;
let conflictLookupRow: Row | null;
let inserted: Row | null;

function reads(result: unknown) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  Object.assign(obj, {
    select: self,
    eq: self,
    in: self,
    lte: self,
    gte: self,
    order: self,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  });
  return obj;
}

function buildService() {
  return {
    from(table: string) {
      if (table === 'section_students') {
        return reads({ data: enrolmentRow, error: null });
      }
      if (table === 'sections') return reads({ data: sectionRow, error: null });
      if (table === 'students') return reads({ data: studentRow, error: null });
      if (table === 'student_declarations') {
        const obj: Record<string, unknown> = {};
        const self = () => obj;
        Object.assign(obj, {
          select: self,
          eq: self,
          in: self,
          lte: self,
          gte: self,
          // The overlap read is awaited straight off the chain.
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown
          ) =>
            Promise.resolve({ data: overlapRows, error: null }).then(
              resolve,
              reject
            ),
          // The 23505 branch's "what won the race" lookup.
          maybeSingle: () =>
            Promise.resolve({ data: conflictLookupRow, error: null }),
          insert: (row: Row) => {
            inserted = row;
            return {
              select: () => ({
                single: () =>
                  Promise.resolve(
                    insertError
                      ? { data: null, error: insertError }
                      : {
                          data: {
                            id: 'decl-1',
                            status: 'approved',
                            created_at: '2026-08-31T02:00:00Z',
                          },
                          error: null,
                        }
                  ),
              }),
            };
          },
        });
        return obj;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => buildService(),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const OWN_PATH = `declarations/staff/${ME}/abc.pdf`;

async function post(body: unknown) {
  const { POST } = await import('@/app/api/declarations/staff/route');
  const res = await POST(
    new Request('http://test/api/declarations/staff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  // Next's generated route types widen a handler's return to include
  // `undefined`; every branch of this one returns, so a missing response is a
  // real bug rather than a case to model.
  if (!res) throw new Error('the route returned no response');
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

const validBody = (over: Record<string, unknown> = {}) => ({
  sectionStudentId: ENROLMENT,
  startDate: '2026-09-02',
  endDate: '2026-09-02',
  evidencePath: OWN_PATH,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  caller = { id: ME, email: 'teacher@hfse.test', role: 'teacher' };
  assignments = [{ section_id: SEC_MINE, role: 'form_adviser' }];
  schoolDays = ['2026-09-02'];
  enrolmentRow = { id: ENROLMENT, student_id: STUDENT, section_id: SEC_MINE };
  sectionRow = {
    id: SEC_MINE,
    name: 'Diligence',
    academic_year_id: AY,
    levels: { code: 'P4' },
  };
  studentRow = {
    id: STUDENT,
    student_number: 'H250123',
    first_name: 'Ana',
    last_name: 'Reyes',
  };
  overlapRows = [];
  insertError = null;
  conflictLookupRow = null;
  inserted = null;
});

// ── 1. Authorisation is the register's ─────────────────────────────────────

describe('who may record a certificate', () => {
  it('refuses a teacher who does not mark that class register', async () => {
    // Same child, but the enrolment resolves to a class this teacher does not
    // advise. This is the case the route exists to refuse.
    enrolmentRow = {
      id: ENROLMENT,
      student_id: STUDENT,
      section_id: SEC_THEIRS,
    };
    sectionRow = { ...(sectionRow as Row), id: SEC_THEIRS };

    const { status, json } = await post(validBody());

    expect(status).toBe(403);
    expect(inserted).toBeNull();
    // ⚠ Plain English, and no section uuid. A school admin is not IT, and the
    // person reading this is a teacher who opened the wrong class.
    expect(json.error).toBe(
      'You can only record a certificate for a class whose register you mark.'
    );
    expect(String(json.error)).not.toContain(SEC_THEIRS);
  });

  it('admits a CO-ADVISER, because the database already does', async () => {
    // Migration 124's `is_adviser_for_section` admits a co-adviser, so testing
    // the `form_adviser` literal here would refuse somebody the register
    // itself lets them write — the exact class of gap KD #193 found in seven
    // places at once.
    assignments = [{ section_id: SEC_MINE, role: 'co_adviser' }];
    const { status } = await post(validBody());
    expect(status).toBe(201);
  });

  it('refuses a teacher holding the class only as a SUBJECT teacher', async () => {
    assignments = [{ section_id: SEC_MINE, role: 'subject_teacher' }];
    const { status } = await post(validBody());
    expect(status).toBe(403);
    expect(inserted).toBeNull();
  });

  it('fails CLOSED when the assignment lookup breaks', async () => {
    // "No assignments came back" is not "no section to object to". A lookup
    // that throws must refuse, never wave the write through.
    const mod = await import('@/lib/auth/teacher-assignments');
    vi.mocked(mod.loadEffectiveAssignmentsForUser).mockRejectedValueOnce(
      new Error('connection reset')
    );
    const { status } = await post(validBody());
    expect(status).toBe(403);
    expect(inserted).toBeNull();
  });

  it('lets the office write any class', async () => {
    // Registrar and above mark any section on the daily route; this matches it
    // rather than inventing a narrower rule for the same act.
    caller = {
      id: 'u-office',
      email: 'office@hfse.test',
      role: 'school_admin',
    };
    assignments = [];
    enrolmentRow = {
      id: ENROLMENT,
      student_id: STUDENT,
      section_id: SEC_THEIRS,
    };
    sectionRow = { ...(sectionRow as Row), id: SEC_THEIRS };

    // ⚠ THEIR OWN upload folder, not the teacher's. The prefix check is per
    // caller and does not care what role they hold — an office account may
    // write any class's register and still may not attach a colleague's file.
    const { status } = await post(
      validBody({ evidencePath: 'declarations/staff/u-office/abc.pdf' })
    );
    expect(status).toBe(201);
  });
});

// ── 2. The attachment must be the caller's own upload ──────────────────────

describe('the attachment must belong to the caller', () => {
  it("refuses a path in another person's folder", async () => {
    const { status, json } = await post(
      validBody({
        evidencePath: 'declarations/staff/u-someone-else/theirs.pdf',
      })
    );
    expect(status).toBe(403);
    expect(inserted).toBeNull();
    expect(json.error).toBe(
      'That attachment could not be matched to this upload.'
    );
  });

  it("refuses a PARENT's folder, which is a different prefix entirely", async () => {
    const { status } = await post(
      validBody({ evidencePath: `declarations/${ME}/lifted.pdf` })
    );
    expect(status).toBe(403);
    expect(inserted).toBeNull();
  });

  it('refuses a traversal that starts with the right prefix', async () => {
    // `declarations/staff/<me>/../<them>/x.pdf` passes a naive startsWith and
    // is not this person's folder.
    const { status } = await post(
      validBody({
        evidencePath: `declarations/staff/${ME}/../u-someone-else/x.pdf`,
      })
    );
    expect(status).toBe(403);
    expect(inserted).toBeNull();
  });

  it('is checked BEFORE anything is read from the database', async () => {
    // A refusal that first resolved the child would leak "this student exists"
    // to a request that was never allowed to ask.
    enrolmentRow = null;
    const { status } = await post(
      validBody({ evidencePath: 'declarations/staff/u-other/x.pdf' })
    );
    expect(status).toBe(403);
  });
});

// ── 3. Proof can be a file OR a link ───────────────────────────────────────

describe('file or link', () => {
  it('accepts an uploaded file on its own', async () => {
    const { status } = await post(
      validBody({ evidencePath: OWN_PATH, evidenceUrl: undefined })
    );
    expect(status).toBe(201);
    expect(inserted).toMatchObject({
      evidence_path: OWN_PATH,
      evidence_url: null,
    });
  });

  it('accepts an mc.gov.sg link on its own', async () => {
    // Singapore issues digital MCs as a URL — a link is the certificate, not a
    // fallback for one.
    const { status } = await post(
      validBody({
        evidencePath: undefined,
        evidenceUrl: 'https://mc.gov.sg/x9',
      })
    );
    expect(status).toBe(201);
    expect(inserted).toMatchObject({
      evidence_path: null,
      evidence_url: 'https://mc.gov.sg/x9',
    });
  });

  it('accepts both together', async () => {
    const { status } = await post(
      validBody({ evidenceUrl: 'https://mc.gov.sg/x9' })
    );
    expect(status).toBe(201);
    expect(inserted).toMatchObject({
      evidence_path: OWN_PATH,
      evidence_url: 'https://mc.gov.sg/x9',
    });
  });

  it('refuses neither, in words rather than a constraint name', async () => {
    // `student_declarations_medical_needs_evidence_chk` would refuse this row
    // anyway; the point of catching it here is that the database's refusal is
    // unreadable to anybody outside the code.
    const { status, json } = await post(
      validBody({ evidencePath: undefined, evidenceUrl: undefined })
    );
    expect(status).toBe(400);
    expect(inserted).toBeNull();
    const issues = json.issues as Array<{ message: string }>;
    expect(issues[0].message).toMatch(/attach the medical certificate/i);
    expect(JSON.stringify(json)).not.toMatch(/_chk|student_declarations/);
  });

  it('refuses a non-https link', async () => {
    const { status } = await post(
      validBody({ evidencePath: undefined, evidenceUrl: 'javascript:alert(1)' })
    );
    expect(status).toBe(400);
    expect(inserted).toBeNull();
  });
});

// ── 4. Approved, with the register left alone ──────────────────────────────

describe('what lands in the table', () => {
  it('goes in already approved and never touches the register', async () => {
    const { status, json } = await post(validBody());
    expect(status).toBe(201);

    expect(inserted).toMatchObject({
      declaration_type: 'absence',
      status: 'approved',
      with_medical: true,
      student_id: STUDENT,
      section_student_id: ENROLMENT,
      section_id: SEC_MINE,
      academic_year_id: AY,
      start_date: '2026-09-02',
      end_date: '2026-09-02',
      // ⚠ THE POINT OF THIS ASSERTION. KD #197's register write fires when the
      // last approval stage approves. Here the teacher is already marking the
      // day EX through the normal attendance path — that IS the register
      // write, and doing it again would append a second mark for the day.
      register_written_at: null,
      register_days_written: null,
    });

    // Who filed it, kept on the row. `filed_by` has no foreign key (migration
    // 125), so a staff id sits in it as legitimately as a parent's.
    expect(inserted).toMatchObject({
      filed_by: ME,
      filed_by_email: 'teacher@hfse.test',
    });

    const declaration = json.declaration as Record<string, unknown>;
    expect(declaration.status).toBe('approved');
    expect(declaration.recordedBySchool).toBe(true);
    expect(declaration.studentNumber).toBe('H250123');
  });

  it('never writes staff text into the parent note column', async () => {
    // `parent_note` is rendered on every staff screen as *the parent's
    // message*. Anything of ours stored there would be read back as words the
    // family never wrote.
    await post(validBody());
    expect(inserted).toMatchObject({ parent_note: null });
  });

  it('carries no travel fields, so the shape CHECK cannot bite', async () => {
    await post(validBody());
    expect(inserted).toMatchObject({
      destination_country: null,
      destination_city: null,
    });
  });
});

// ── 5. The audit row ───────────────────────────────────────────────────────

describe('the audit row', () => {
  it('is written, and is the only trace this filing leaves', async () => {
    await post(validBody({ evidenceUrl: 'https://mc.gov.sg/x9' }));

    expect(logAction).toHaveBeenCalledTimes(1);
    const call = auditRow();

    expect(call.action).toBe('declaration.approve');
    expect(call.entityType).toBe('student_declaration');
    expect(call.entityId).toBe('decl-1');
    expect(call.actor).toMatchObject({ id: ME, email: 'teacher@hfse.test' });

    expect(call.context).toMatchObject({
      // What tells this apart from a filing the ladder approved.
      recorded_by_school: true,
      declaration_type: 'absence',
      with_medical: true,
      // Whether a file or a link was attached — presence, never the thing.
      evidence_kind: 'both',
      student_id: STUDENT,
      student_number: 'H250123',
      section_id: SEC_MINE,
      section_name: 'P4 Diligence',
      start_date: '2026-09-02',
      end_date: '2026-09-02',
    });
  });

  it('records WHICH kind of proof was attached', async () => {
    await post(validBody({ evidenceUrl: undefined }));
    expect(auditRow().context.evidence_kind).toBe('file');

    logAction.mockClear();
    await post(
      validBody({
        evidencePath: undefined,
        evidenceUrl: 'https://mc.gov.sg/x9',
      })
    );
    expect(auditRow().context.evidence_kind).toBe('link');
  });

  it('never puts the document or the link in the log', async () => {
    // Migration 109's rule, restated by 125: `audit_log` is readable by every
    // is_registrar_or_above() user and can never be corrected, and a URL to a
    // child's medical certificate is exactly what that rule is about.
    await post(validBody({ evidenceUrl: 'https://mc.gov.sg/x9' }));
    const serialised = JSON.stringify(auditRow().context);
    expect(serialised).not.toContain('mc.gov.sg');
    expect(serialised).not.toContain(OWN_PATH);
  });

  it('is not written when the filing was refused', async () => {
    assignments = [];
    await post(validBody());
    expect(logAction).not.toHaveBeenCalled();
  });
});

// ── The duplicate question (point 8) ───────────────────────────────────────

describe('days that are already spoken for', () => {
  it('refuses when a live parent filing already covers the days', async () => {
    // ⚠ THE UNIQUE INDEX CANNOT SEE THIS. `student_declarations_no_duplicate_filing`
    // keys on `filed_by`, and a staff filing carries the STAFF member's id — so
    // it can never collide with a parent's row for the same child and dates.
    // The overlap check is the only thing standing between one illness and two
    // rows.
    overlapRows = [
      {
        student_id: STUDENT,
        start_date: '2026-09-01',
        end_date: '2026-09-03',
        declaration_type: 'absence',
        status: 'pending',
      },
    ];

    const { status, json } = await post(validBody());

    expect(status).toBe(409);
    expect(inserted).toBeNull();
    // Worded for the OFFICE, not for a parent: telling the school to "contact
    // the school office" would be absurd. It says what exists and what to do
    // with the certificate in hand.
    expect(json.error).toMatch(/already has an absence on record/i);
    expect(json.error).toMatch(/attach the certificate there/i);
    expect(json.alreadyFiled).toBe(true);
    expect((json.overlapping as unknown[]).length).toBe(1);
  });

  it('words an already-approved clash differently', async () => {
    overlapRows = [
      {
        student_id: STUDENT,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        declaration_type: 'absence',
        status: 'approved',
      },
    ];
    const { status, json } = await post(validBody());
    expect(status).toBe(409);
    expect(json.error).toMatch(/already has an approved absence on record/i);
  });

  it('never surfaces a raw duplicate error to the user', async () => {
    // Two requests in flight at once — neither sees the other in the overlap
    // check and they race to the insert. The loser is answered with a success
    // and the row that won, exactly as the parent route answers the same race.
    // What must never happen is a 500 carrying a constraint name.
    insertError = { code: '23505', message: 'duplicate key value violates …' };
    conflictLookupRow = {
      id: 'decl-existing',
      created_at: '2026-08-31T01:00:00Z',
    };

    const { status, json } = await post(validBody());

    expect(status).toBe(200);
    expect(json.alreadyFiled).toBe(true);
    expect((json.declaration as { id: string }).id).toBe('decl-existing');
    expect(JSON.stringify(json)).not.toMatch(/23505|duplicate key/);
  });

  it('does not let a rejected filing block the office', async () => {
    // A filing turned down for the want of a certificate is precisely when the
    // office needs to record one. `findOverlappingFilings` counts only
    // `pending` and `approved`, and migration 130 removed `rejected` from the
    // index, so nothing anywhere stands in the way.
    overlapRows = [];
    const { status } = await post(validBody());
    expect(status).toBe(201);
  });
});

// ── How the audit row READS ────────────────────────────────────────────────

describe('the audit-log line a school admin actually sees', () => {
  it('says the office recorded it, and what was attached', async () => {
    // ⚠ THE ROW IS NOT THE FEATURE — THE SENTENCE IS. This filing appears in
    // no queue and no Activity panel, so the audit-log line is the only place
    // anybody can see it happened. A context nobody renders would satisfy
    // every assertion above and still leave the action invisible.
    const { auditContextSummary, auditActionLabel } =
      await import('@/lib/audit/humanize');

    const summary = auditContextSummary('declaration.approve', {
      recorded_by_school: true,
      declaration_type: 'absence',
      with_medical: true,
      evidence_kind: 'file',
      section_name: 'P4 Diligence',
      start_date: '2026-09-02',
      end_date: '2026-09-02',
    });

    expect(auditActionLabel('declaration.approve')).toBe(
      'Absence declaration approved'
    );
    expect(summary).toContain('P4 Diligence');
    expect(summary).toContain('with certificate');
    expect(summary).toContain('recorded by the school office');
    expect(summary).toContain('certificate uploaded');
    // A staff filing has no ladder, so there is no step and no outcome — and
    // the renderer must not invent one.
    expect(summary).not.toMatch(/moved to the next step|fully approved/);
  });

  it('still reads correctly for a filing the LADDER approved', async () => {
    // The two share an action name, so the staff branch must not swallow the
    // parent path it was added beside.
    const { auditContextSummary } = await import('@/lib/audit/humanize');
    const summary = auditContextSummary('declaration.approve', {
      declaration_type: 'absence',
      with_medical: true,
      section_name: 'P4 Diligence',
      start_date: '2026-09-02',
      end_date: '2026-09-02',
      stage_label: 'Officer in charge',
      outcome: 'completed',
    });
    expect(summary).toContain('Officer in charge');
    expect(summary).toContain('fully approved');
    expect(summary).not.toContain('school office');
  });
});

// ── The calendar ───────────────────────────────────────────────────────────

describe('dates the school is shut', () => {
  it('refuses a range with no school day in it at all', async () => {
    schoolDays = [];
    const { status, json } = await post(validBody());
    expect(status).toBe(400);
    expect(inserted).toBeNull();
    expect(json.error).toMatch(/school is closed for all of those dates/i);
  });

  it('lets the filing through when the calendar lookup itself fails', async () => {
    // A certificate the office cannot record is a wall they cannot get past;
    // a filing on a closed day is a small mess somebody can see and fix. Same
    // posture as the parent route.
    const mod = await import('@/lib/attendance/school-days');
    vi.mocked(mod.expandSchoolDays).mockRejectedValueOnce(
      new Error('calendar unreachable')
    );
    const { status } = await post(validBody());
    expect(status).toBe(201);
  });
});
