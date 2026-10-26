/**
 * Three rare shapes of a parent's filing, each of which used to go wrong.
 *
 * 1. A certificate path with `..` in it started with the parent's own folder
 *    and passed the check, though it pointed into someone else's.
 * 2. A multi-child filing whose approval ladder failed partway was rolled
 *    back, but the requests already opened for the earlier children were not:
 *    `approval_requests` has no foreign key to its subject, so they stayed in
 *    an approver's queue pointing at nothing.
 * 3. Two submits of a multi-child filing racing each other: the insert is one
 *    statement, so one duplicate child meant nobody was inserted — and the
 *    route still answered "already filed" for the siblings it never filed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isOwnParentEvidencePath,
  PARTLY_FILED_MESSAGE,
} from '@/lib/declarations/parent';

const PARENT_ID = 'u-parent';

const CHILDREN = [
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
  {
    studentNumber: 'H250456',
    studentId: 'stu-2',
    sectionStudentId: 'ss-2',
    sectionId: 'sec-2',
    academicYearId: 'ay-1',
    displayName: 'Ben Reyes',
    levelCode: 'P2',
    levelType: 'primary',
    sectionName: 'Honesty',
  },
];

let existing: Array<Record<string, unknown>> = [];
vi.mock('@/lib/declarations/parent', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/lib/declarations/parent')>();
  return {
    ...real,
    loadFilableStudents: () => Promise.resolve(CHILDREN),
    listParentDeclarations: () => Promise.resolve(existing),
  };
});

let ladderThrows = false;
vi.mock('@/lib/declarations/approval', () => ({
  DECLARATION_SUBJECT_TYPE: 'student_declaration',
  openDeclarationApprovals: () =>
    ladderThrows
      ? Promise.reject(new Error('ladder down on the second child'))
      : Promise.resolve({ unconfigured: 0 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => ({ limited: false }),
  userRateLimit: () => ({ limited: false }),
  tooManyRequests: vi.fn(),
}));
vi.mock('@/lib/cors', () => ({ corsHeaders: () => ({}) }));
vi.mock('@/lib/dates', () => ({ sgToday: () => '2026-09-01' }));
vi.mock('@/lib/audit/log-action', () => ({
  logActions: () => Promise.resolve(),
}));
vi.mock('@/lib/declarations/filing-window', () => ({
  alreadyFiledMessage: () => '',
  filingCoversAnySchoolDay: () => Promise.resolve(true),
  findOverlappingFilings: () => Promise.resolve([]),
  NO_SCHOOL_DAY_MESSAGE: '',
}));

let insertError: { code: string; message: string } | null = null;
const deletes: Array<{ table: string; filters: Array<[string, unknown]> }> = [];

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: PARENT_ID, email: 'parent@example.com' } },
          error: null,
        }),
    },
    from: (table: string) => ({
      insert: () => ({
        select: () =>
          Promise.resolve(
            insertError
              ? { data: null, error: insertError }
              : {
                  data: [
                    {
                      id: 'decl-1',
                      student_id: 'stu-1',
                      section_id: 'sec-1',
                      status: 'pending',
                    },
                    {
                      id: 'decl-2',
                      student_id: 'stu-2',
                      section_id: 'sec-2',
                      status: 'pending',
                    },
                  ],
                  error: null,
                }
          ),
      }),
      delete: () => {
        const entry = { table, filters: [] as Array<[string, unknown]> };
        deletes.push(entry);
        const chain = {
          eq: (col: string, v: unknown) => {
            entry.filters.push([col, v]);
            return chain;
          },
          in: (col: string, v: unknown) => {
            entry.filters.push([col, v]);
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  }),
}));

function post(body: Record<string, unknown>) {
  return new Request('http://x/api/parent/v2/declarations', {
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify(body),
  });
}

const BOTH = {
  declarationType: 'absence',
  studentNumbers: ['H250123', 'H250456'],
  startDate: '2026-09-02',
  endDate: '2026-09-02',
  withMedical: false,
};

beforeEach(() => {
  existing = [];
  ladderThrows = false;
  insertError = null;
  deletes.length = 0;
});

describe('1. a certificate path cannot climb out of the parent’s folder', () => {
  it('accepts the parent’s own upload', () => {
    expect(
      isOwnParentEvidencePath(PARENT_ID, `declarations/${PARENT_ID}/a.pdf`)
    ).toBe(true);
  });

  it('refuses ".." even though the path starts with the right prefix', () => {
    expect(
      isOwnParentEvidencePath(
        PARENT_ID,
        `declarations/${PARENT_ID}/../other/mc.pdf`
      )
    ).toBe(false);
  });

  it('refuses another parent’s folder', () => {
    expect(
      isOwnParentEvidencePath(PARENT_ID, 'declarations/someone-else/mc.pdf')
    ).toBe(false);
  });

  it('the route answers 403 for a ".." path', async () => {
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(
      post({
        ...BOTH,
        studentNumbers: ['H250123'],
        withMedical: true,
        evidencePath: `declarations/${PARENT_ID}/../other/mc.pdf`,
      })
    );
    expect(res.status).toBe(403);
  });
});

describe('2. a failed ladder takes its approval requests back out', () => {
  it('deletes the requests for every inserted filing, then the filings', async () => {
    ladderThrows = true;
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(post(BOTH));

    expect(res.status).toBe(500);
    expect(deletes.map((d) => d.table)).toEqual([
      'approval_requests',
      'student_declarations',
    ]);
    expect(deletes[0].filters).toEqual([
      ['subject_type', 'student_declaration'],
      ['subject_id', ['decl-1', 'decl-2']],
    ]);
    expect(deletes[1].filters).toEqual([['id', ['decl-1', 'decl-2']]]);
  });
});

describe('3. a racing duplicate is only a success when every child is on record', () => {
  const filed = (studentNumber: string) => ({
    studentNumber,
    declarationType: 'absence',
    startDate: '2026-09-02',
    endDate: '2026-09-02',
    filingGroupId: 'g-1',
  });

  it('answers 200 when both children are already filed', async () => {
    insertError = { code: '23505', message: 'duplicate' };
    existing = [filed('H250123'), filed('H250456')];
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(post(BOTH));

    expect(res.status).toBe(200);
    expect((await res.json()).alreadyFiled).toBe(true);
  });

  it('answers 409 when only one of them is — the other was never filed', async () => {
    insertError = { code: '23505', message: 'duplicate' };
    existing = [filed('H250123')];
    const { POST } = await import('@/app/api/parent/v2/declarations/route');
    const res = await POST(post(BOTH));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(PARTLY_FILED_MESSAGE);
  });
});
