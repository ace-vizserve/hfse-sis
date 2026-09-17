/**
 * A parent's filing is audited when it is filed.
 *
 * The route used to say the approval flow logged the filing. It did not — the
 * approval flow logs DECISIONS — so a filing nobody had decided yet left no
 * trace at all. These pin the `declaration.file` row: the parent as actor with
 * no role, one row per child, and presence only for the note and certificate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuditRow = {
  action: string;
  entityType: string;
  entityId: string | null;
  context: Record<string, unknown>;
};

const logActions = vi.fn(
  (_service: unknown, _actor: unknown, _rows: AuditRow[]) => Promise.resolve()
);
vi.mock('@/lib/audit/log-action', () => ({
  logActions: (service: unknown, actor: unknown, rows: AuditRow[]) =>
    logActions(service, actor, rows),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => ({ limited: false }),
  tooManyRequests: vi.fn(),
}));
vi.mock('@/lib/cors', () => ({ corsHeaders: () => ({}) }));
vi.mock('@/lib/dates', () => ({ sgToday: () => '2026-09-01' }));

const PARENT_ID = 'u-parent';
const PARENT_PATH = `declarations/${PARENT_ID}/mc.pdf`;

vi.mock('@/lib/declarations/parent', () => ({
  loadFilableStudents: vi.fn(() =>
    Promise.resolve([
      {
        studentNumber: 'H250123',
        studentId: 'stu-1',
        sectionStudentId: 'ss-1',
        sectionId: 'sec-1',
        academicYearId: 'ay-1',
        displayName: 'Ana Reyes',
        levelCode: 'P4',
        levelType: 'primary',
        sectionName: 'Diligence',
      },
    ])
  ),
  listParentDeclarations: vi.fn(() => Promise.resolve([])),
}));

let ladderThrows = false;
vi.mock('@/lib/declarations/approval', () => ({
  openDeclarationApprovals: vi.fn(() =>
    ladderThrows
      ? Promise.reject(new Error('ladder down'))
      : Promise.resolve({ unconfigured: 0 })
  ),
}));

vi.mock('@/lib/declarations/filing-window', () => ({
  alreadyFiledMessage: () => '',
  filingCoversAnySchoolDay: () => Promise.resolve(true),
  findOverlappingFilings: () => Promise.resolve([]),
  NO_SCHOOL_DAY_MESSAGE: '',
}));

let rollbackError: { message: string } | null = null;

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: PARENT_ID, email: 'Parent@Example.com' } },
          error: null,
        }),
    },
    from: () => ({
      insert: () => ({
        select: () =>
          Promise.resolve({
            data: [
              {
                id: 'decl-1',
                student_id: 'stu-1',
                section_id: 'sec-1',
                status: 'pending',
              },
            ],
            error: null,
          }),
      }),
      delete: () => ({
        in: () => Promise.resolve({ error: rollbackError }),
      }),
    }),
  }),
}));

function request(body: unknown) {
  return new Request('http://x/api/parent/v2/declarations', {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const BODY = {
  declarationType: 'absence',
  studentNumbers: ['H250123'],
  startDate: '2026-09-02',
  endDate: '2026-09-03',
  withMedical: true,
  evidencePath: PARENT_PATH,
  parentNote: 'Fever since Monday night',
};

beforeEach(() => {
  vi.clearAllMocks();
  ladderThrows = false;
  rollbackError = null;
});

describe('POST /api/parent/v2/declarations — audit', () => {
  it('logs the filing, with the parent as actor and no role', async () => {
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(request(BODY));

    expect(res.status).toBe(201);
    expect(logActions).toHaveBeenCalledTimes(1);
    const [, actor, rows] = logActions.mock.calls[0];
    expect(actor).toEqual({
      id: PARENT_ID,
      email: 'parent@example.com',
      role: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'declaration.file',
      entityType: 'student_declaration',
      entityId: 'decl-1',
    });
    expect(rows[0].context).toMatchObject({
      filed_by: 'parent',
      status: 'pending',
      declaration_type: 'absence',
      student_id: 'stu-1',
      student_number: 'H250123',
      student_name: 'Ana Reyes',
      section_student_id: 'ss-1',
      section_id: 'sec-1',
      section_name: 'Diligence',
      start_date: '2026-09-02',
      end_date: '2026-09-03',
      with_medical: true,
      evidence_kind: 'file',
      parent_note_present: true,
      approval_steps_configured: true,
    });

    // Presence only — never the words, never the file.
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('Fever');
    expect(serialised).not.toContain(PARENT_PATH);
  });

  it('logs nothing when a failed ladder is rolled back cleanly', async () => {
    ladderThrows = true;
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(request(BODY));

    expect(res.status).toBe(500);
    expect(logActions).not.toHaveBeenCalled();
  });

  it('logs the stranded filing when the rollback itself fails', async () => {
    ladderThrows = true;
    rollbackError = { message: 'permission denied' };
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(request(BODY));

    expect(res.status).toBe(500);
    expect(logActions).toHaveBeenCalledTimes(1);
    expect(logActions.mock.calls[0][2][0].context).toMatchObject({
      partial: true,
      failed_step: 'approval_ladder',
      rollback_failed: true,
    });
  });
});
