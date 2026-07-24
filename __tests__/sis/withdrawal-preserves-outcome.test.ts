import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Dependency mocks for the PATCH route tests below ────────────────────────
// The pure-helper tests (buildWithdrawalAdmissionsPatch) don't touch any of
// these, so the mocks are inert for them.

let mockRole: 'academic_coordinator' | 'school_admin' | 'superadmin' =
  'academic_coordinator';
vi.mock('@/lib/auth/require-role', () => ({
  requireRole: vi.fn(() =>
    Promise.resolve({
      user: { id: 'u-1', email: 'staff@hfse.test' },
      role: mockRole,
    })
  ),
}));

vi.mock('@/lib/audit/log-action', () => ({
  logAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/cache/invalidate-drill-tags', () => ({
  invalidateAllOperationalDrills: vi.fn(),
  invalidateDrillTags: vi.fn(),
}));

const updateSpy = vi.fn((_patch: Record<string, unknown>) => {});

const BEFORE_ROW = {
  id: 'enrolment-1',
  section_id: 'section-1',
  bus_no: null,
  classroom_officer_role: null,
  academics_notes: null,
  admin_notes: null,
  enrollment_status: 'active',
  enrollment_date: null,
  withdrawal_date: null,
  withdrawal_reason: null,
  withdrawal_notes: null,
  late_enrollee_term_number: null,
};

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'section_students') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: BEFORE_ROW, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            updateSpy(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === 'sections') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test mock: ${table}`);
    },
  })),
}));

import {
  buildWithdrawalAdmissionsPatch,
  PATCH,
} from '@/app/api/sections/[id]/students/[enrolmentId]/route';
import { EnrolmentMetadataSchema } from '@/lib/schemas/enrolment';

describe('post-enrolment withdrawal preserves the application outcome', () => {
  const BASE = {
    actorEmail: 'registrar@hfse.test',
    todayIso: '2026-06-26T00:00:00.000Z',
    admissionsAlreadyTerminal: false,
    withdrawalReason: 'Transferred to another school',
    withdrawalNotes: null,
  };

  it('does NOT write applicationStatus (outcome is append-only)', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect('applicationStatus' in patch).toBe(false);
  });

  it('still writes applicationUpdatedDate and applicationUpdatedBy', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect(patch.applicationUpdatedDate).toBe(BASE.todayIso);
    expect(patch.applicationUpdatedBy).toBe(BASE.actorEmail);
  });

  it('writes applicationTerminalReason when admissions is not already terminal', () => {
    const patch = buildWithdrawalAdmissionsPatch(BASE);
    expect(patch.applicationTerminalReason).toBe(BASE.withdrawalReason);
    expect(patch.applicationTerminalNotes).toBeNull();
  });

  it('skips applicationTerminalReason when admissions is already terminal', () => {
    const patch = buildWithdrawalAdmissionsPatch({
      ...BASE,
      admissionsAlreadyTerminal: true,
    });
    expect('applicationTerminalReason' in patch).toBe(false);
    expect('applicationTerminalNotes' in patch).toBe(false);
  });

  it('omits applicationTerminalReason when no withdrawal reason is provided', () => {
    const patch = buildWithdrawalAdmissionsPatch({
      ...BASE,
      withdrawalReason: undefined,
    });
    expect('applicationTerminalReason' in patch).toBe(false);
  });
});

// ── academics_notes / admin_notes per-field write gating (migration 093) ────

function buildRequest(body: Record<string, unknown>) {
  return new Request(
    'http://localhost/api/sections/section-1/students/enrolment-1',
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  ) as unknown as import('next/server').NextRequest;
}

function callPatch(body: Record<string, unknown>) {
  return PATCH(buildRequest(body), {
    params: Promise.resolve({ id: 'section-1', enrolmentId: 'enrolment-1' }),
  }) as unknown as Promise<Response>;
}

describe('PATCH /api/sections/[id]/students/[enrolmentId] — academics_notes / admin_notes gating', () => {
  beforeEach(() => {
    mockRole = 'academic_coordinator';
    updateSpy.mockClear();
  });

  it('an academic_coordinator can set academics_notes and it round-trips into the update payload', async () => {
    mockRole = 'academic_coordinator';
    const res = await callPatch({
      academics_notes: 'Needs extra support in Math',
    });
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      academics_notes: 'Needs extra support in Math',
    });
  });

  it('an academic_coordinator PATCHing admin_notes gets 403 field_forbidden and the update is never called', async () => {
    mockRole = 'academic_coordinator';
    const res = await callPatch({ admin_notes: 'Fee arrears' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('field_forbidden');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('a school_admin can set admin_notes', async () => {
    mockRole = 'school_admin';
    const res = await callPatch({ admin_notes: 'Fee arrears' });
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      admin_notes: 'Fee arrears',
    });
  });

  it('a superadmin can set admin_notes', async () => {
    mockRole = 'superadmin';
    const res = await callPatch({ admin_notes: 'Fee arrears' });
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('EnrolmentMetadataSchema — academics_notes / admin_notes', () => {
  it('empty string for academics_notes transforms to null', () => {
    const parsed = EnrolmentMetadataSchema.parse({ academics_notes: '' });
    expect(parsed.academics_notes).toBeNull();
  });

  it('empty string for admin_notes transforms to null', () => {
    const parsed = EnrolmentMetadataSchema.parse({ admin_notes: '' });
    expect(parsed.admin_notes).toBeNull();
  });

  it('trims and caps at 200 chars, matching the withdrawal_notes pattern', () => {
    const parsed = EnrolmentMetadataSchema.parse({
      academics_notes: '  Needs extra support in Math  ',
    });
    expect(parsed.academics_notes).toBe('Needs extra support in Math');
    expect(() =>
      EnrolmentMetadataSchema.parse({ admin_notes: 'x'.repeat(201) })
    ).toThrow();
  });
});
