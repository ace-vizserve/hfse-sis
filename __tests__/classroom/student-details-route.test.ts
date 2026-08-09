/**
 * GET /api/classroom/[sectionId]/students/[studentNumber]
 *
 * THE WHOLE AUTHORISATION MODEL IS THE SECTION. The caller must hold a
 * classroom capability over the section in the URL, AND the student must be on
 * that section's roster. Both halves matter and the second is the one worth
 * testing hardest: without it, any teacher could read any student in the school
 * by pairing their own section id with a guessed student number, and the guess
 * is cheap — student numbers are sequential.
 *
 * Scoping this way is also why no "does this teacher teach this student"
 * resolver had to be written. `loadClassroomAccess` already answers the section
 * question everywhere else in Classroom (lib/classroom/scope.ts), and the
 * roster lookup answers the rest.
 *
 * The shaping itself is tested against its real implementation in
 * student-details.test.ts; it is mocked out here so these cases test the
 * route's guard ORDER and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Auth ────────────────────────────────────────────────────────────────────
let mockAuth: unknown = {
  user: { id: 'teacher-1' },
  role: 'teacher' as const,
};
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: () => Promise.resolve(mockAuth),
}));

// ── Classroom capability ────────────────────────────────────────────────────
let mockCapability: 'adviser' | 'subject' | 'oversight' | null = 'adviser';
const mockLoadClassroomAccess = vi.fn(() =>
  Promise.resolve({ capability: mockCapability, assignments: [] })
);
vi.mock('@/lib/classroom/queries', () => ({
  loadClassroomAccess: () => mockLoadClassroomAccess(),
}));

// ── studentNumber -> students row ───────────────────────────────────────────
let mockStudent: { studentId: string } | null = { studentId: 'student-1' };
vi.mock('@/lib/sis/records-history', () => ({
  findStudentByNumber: () => Promise.resolve(mockStudent),
}));

// ── The admissions read ─────────────────────────────────────────────────────
let mockSource: Record<string, unknown> | null = { allergies: true };
const mockLoadSource = vi.fn(() => Promise.resolve(mockSource));
vi.mock('@/lib/classroom/student-details-source', () => ({
  loadStudentDetailsSource: () => mockLoadSource(),
}));

// ── section_students roster lookup ──────────────────────────────────────────
let mockRosterRow: { id: string } | null = { id: 'enrolment-1' };
const eqCalls: Array<[string, unknown]> = [];
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => {
        const chain = {
          eq: (column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
          },
          neq: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: mockRosterRow, error: null }),
        };
        return chain;
      },
    }),
  }),
}));

import { GET } from '@/app/api/classroom/[sectionId]/students/[studentNumber]/route';

function call(sectionId = 'section-1', studentNumber = 'H260127') {
  return GET(new Request('http://test/'), {
    params: Promise.resolve({ sectionId, studentNumber }),
  });
}

beforeEach(() => {
  mockAuth = { user: { id: 'teacher-1' }, role: 'teacher' as const };
  mockCapability = 'adviser';
  mockStudent = { studentId: 'student-1' };
  mockSource = { allergies: true };
  mockRosterRow = { id: 'enrolment-1' };
  eqCalls.length = 0;
  vi.clearAllMocks();
});

describe('who may read a student', () => {
  it('answers a form adviser', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toHaveProperty('medical');
  });

  it('answers a subject teacher on the same section', async () => {
    // Medical and home contacts are not adviser-only: Melissa asked for this
    // at the training explicitly as a subject teacher ("for us teachers").
    mockCapability = 'subject';
    const res = await call();
    expect(res.status).toBe(200);
  });

  it('answers a coordinator, who oversees every section', async () => {
    mockCapability = 'oversight';
    expect((await call()).status).toBe(200);
  });

  it('turns away a teacher with no capability over the section', async () => {
    mockCapability = null;
    expect((await call()).status).toBe(404);
  });

  it('passes an auth failure straight back', async () => {
    const forbidden = new Response(null, { status: 403 });
    mockAuth = { error: forbidden };
    expect((await call()).status).toBe(403);
  });
});

describe('the student must be on THIS section roster', () => {
  it('turns away a student who is on no roster row for the section', async () => {
    // The guessed-student-number case. The caller holds a real capability over
    // a real section; the student simply is not in it.
    mockRosterRow = null;
    expect((await call()).status).toBe(404);
  });

  it('turns away a student number that matches nobody', async () => {
    mockStudent = null;
    expect((await call()).status).toBe(404);
  });

  it('filters the roster lookup by BOTH the section and the student', async () => {
    await call('section-9', 'H260127');
    expect(eqCalls).toEqual([
      ['section_id', 'section-9'],
      ['student_id', 'student-1'],
    ]);
  });
});

describe('a student with no admissions row', () => {
  it('answers with an empty record rather than a 404', async () => {
    // Backfilled historic students can sit on a roster with no application row
    // behind them. The drawer should say "Nothing recorded", not fail to open.
    mockSource = null;
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMedical).toBe(false);
    expect(body.hasLearning).toBe(false);
    expect(body.contacts.people).toEqual([]);
  });
});
